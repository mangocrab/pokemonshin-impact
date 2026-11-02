import { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { authenticate, db } from "./auth.js";
import { getActor, serial, WorldError, type Actor } from "./exploration.js";
import { activeCoop } from "./combat/coop.js";
import { ensureEconomy, addItem } from "./economy-store.js";
import { chestCount, storyView } from "./story-store.js";
import { NPCS, QUESTS } from "../../shared/story.js";
import { INTERACTION_RADIUS } from "../../shared/world.js";
const id = z.string().min(1).max(80);
const talkSchema = z.object({ worldId: id, npcId: id }).strict();
const questSchema = z.object({ worldId: id, questId: id }).strict();
async function liveActor(userId: string) {
  const actor = await getActor(userId);
  if (!actor?.sockets.size) throw new WorldError(409, "월드 접속이 끝나면 다시 시도하세요.");
  return actor;
}
async function canInteract(actor: Actor, worldId: string, npcId: string) {
  if (actor.worldId !== worldId) throw new WorldError(403, "현재 방문 중인 월드와 다릅니다.");
  if (actor.battleId || await activeCoop(actor.userId)) throw new WorldError(409, "전투를 마친 뒤 대화하세요.");
  const npc = NPCS.find((n) => n.id === npcId);
  if (!npc) throw new WorldError(400, "존재하지 않는 주민입니다.");
  if (Math.hypot(actor.position.x - npc.x, actor.position.y - npc.y) > INTERACTION_RADIUS)
    throw new WorldError(409, "주민 가까이 이동하세요.");
  return npc;
}
export function registerStory(io: Server) {
  const router = Router();
  router.use(async (req, res, next) => {
    const user = await authenticate(req);
    if (!user?.world) { res.status(401).json({ error: "로그인이 필요합니다." }); return; }
    res.locals.user = user; next();
  });
  router.get("/", async (_req, res, next) => {
    try {
      const view = await serial(async () => {
        const actor = await liveActor(res.locals.user.id);
        return db.$transaction((tx) => storyView(tx, actor.worldId, actor.worldId === actor.homeWorldId));
      });
      res.json(view);
    } catch (error) { failure(error, res, next); }
  });
  router.post("/:operation", async (req, res, next) => {
    try {
      const result = await serial(async () => {
        const actor = await liveActor(res.locals.user.id);
        if (req.params.operation === "talk") {
          const input = talkSchema.parse(req.body), npc = await canInteract(actor, input.worldId, input.npcId);
          const isOwner = actor.worldId === actor.homeWorldId;
          return { npcId: npc.id, worldId: actor.worldId, isOwner, lines: [...npc.dialogue, ...(isOwner ? [] : ["친구의 월드에 온 손님이구나! 이야기는 함께 나눌 수 있지만, 이곳의 부탁과 보상은 월드 주인만 진행할 수 있어."])], story: await db.$transaction((tx) => storyView(tx, actor.worldId, isOwner)) };
        }
        if (!["accept", "claim"].includes(req.params.operation as string)) throw new WorldError(404, "알 수 없는 모험 요청입니다.");
        const input = questSchema.parse(req.body);
        if (actor.worldId !== actor.homeWorldId || input.worldId !== actor.homeWorldId)
          throw new WorldError(403, "방문자는 월드의 부탁이나 보상을 변경할 수 없습니다.");
        const quest = QUESTS.find((q) => q.id === input.questId);
        if (!quest) throw new WorldError(400, "존재하지 않는 부탁입니다.");
        await canInteract(actor, input.worldId, quest.npcId);
        return db.$transaction(async (tx) => {
          if (quest.requires && !(await tx.worldQuest.findUnique({ where: { worldId_questId: { worldId: input.worldId, questId: quest.requires } } }))?.claimedAt)
            throw new WorldError(409, "앞선 부탁을 완료하고 보상을 받아야 합니다.");
          const key = { worldId: input.worldId, questId: quest.id };
          let claimed = false;
          if (req.params.operation === "accept") {
            const progress = quest.objective === "chest" ? Math.min(quest.target, await chestCount(tx, input.worldId)) : 0;
            await tx.worldQuest.createMany({ data: [{ ...key, progress }], skipDuplicates: true });
          } else {
            const row = await tx.worldQuest.findUnique({ where: { worldId_questId: key } });
            if (!row) throw new WorldError(409, "먼저 부탁을 받아 주세요.");
            if (!row.claimedAt && row.progress < quest.target) throw new WorldError(409, "아직 부탁의 목표를 달성하지 않았습니다.");
            const changed = await tx.worldQuest.updateMany({ where: { ...key, claimedAt: null, progress: { gte: quest.target } }, data: { claimedAt: new Date() } });
            if (changed.count) {
              await ensureEconomy(tx, actor.userId);
              await tx.wallet.update({ where: { userId: actor.userId }, data: { conch: { increment: quest.reward.conch }, shell: { increment: quest.reward.shell }, revision: { increment: 1 } } });
              for (const [itemId, amount] of Object.entries(quest.reward.items)) await addItem(tx, actor.userId, itemId, amount);
              claimed = true;
            }
          }
          return { story: await storyView(tx, input.worldId, true), claimed };
        });
      });
      if (req.params.operation !== "talk") io.to(`world:${result.story.worldId}`).emit("story:changed");
      res.json(result);
    } catch (error) { failure(error, res, next); }
  });
  return router;
}
function failure(error: unknown, res: import("express").Response, next: import("express").NextFunction) {
  if (error instanceof WorldError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof z.ZodError) { res.status(400).json({ error: "대화 또는 부탁 요청을 확인하세요." }); return; }
  next(error);
}
