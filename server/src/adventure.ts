import { Router } from "express";
import { z } from "zod";
import { authenticate, db } from "./auth.js";
import { activeCoop } from "./combat/coop.js";
import { getActor, serial, refreshRegions, WorldError } from "./exploration.js";
import { ensureEconomy, addItem } from "./economy-store.js";
import { SANCTUARY, SANCTUARY_CHEST, TIDE_PUZZLE, nearPuzzle, type AdventureView } from "../../shared/adventure.js";
import type { Prisma } from "@prisma/client";
const input = z.object({ worldId: z.string().min(1).max(80), puzzleId: z.literal("tide-bells"), expectedRevision: z.number().int().nonnegative(), rune: z.enum(["sun", "leaf", "wave", "moon", "reset"]) }).strict();
const inspect = z.object({ worldId: z.string().min(1).max(80), puzzleId: z.literal("tide-bells") }).strict();
const sequence = ["sun", "leaf", "wave"];
async function view(tx: Prisma.TransactionClient, worldId: string, isOwner: boolean): Promise<AdventureView> {
  const [puzzle, regions, prerequisite, chest] = await Promise.all([
    tx.worldPuzzle.findUnique({ where: { worldId_puzzleId: { worldId, puzzleId: TIDE_PUZZLE.id } } }),
    tx.worldRegion.findMany({ where: { worldId } }),
    tx.worldQuest.findUnique({ where: { worldId_questId: { worldId, questId: "first-gift" } } }),
    tx.worldChest.findUnique({ where: { worldId_chestId: { worldId, chestId: SANCTUARY_CHEST.id } } }),
  ]);
  return { worldId, isOwner, eligible: Boolean(prerequisite?.claimedAt), regions: regions.map((r) => r.regionId), puzzle: { progress: puzzle?.progress ?? 0, revision: puzzle?.revision ?? 0, solved: Boolean(puzzle?.solvedAt) }, treasureOpened: Boolean(chest) };
}
export const adventureRouter = Router();
adventureRouter.use(async (req, res, next) => {
  const user = await authenticate(req);
  if (!user?.world) { res.status(401).json({ error: "로그인이 필요합니다." }); return; }
  res.locals.user = user; next();
});
adventureRouter.get("/", async (_req, res, next) => {
  try {
    const data = await serial(async () => {
      const actor = await getActor(res.locals.user.id);
      if (!actor?.sockets.size) throw new WorldError(409, "월드 접속이 끝나면 다시 시도하세요.");
      return db.$transaction((tx) => view(tx, actor.worldId, actor.worldId === actor.homeWorldId));
    }); res.json(data);
  } catch (e) { failure(e, res, next); }
});
adventureRouter.post("/:operation", async (req, res, next) => {
  try {
    const result = await serial(async () => {
      if (!["inspect", "rune"].includes(req.params.operation as string)) throw new WorldError(404, "알 수 없는 탐험 요청입니다.");
      const body = req.params.operation === "inspect" ? inspect.parse(req.body) : input.parse(req.body);
      const actor = await getActor(res.locals.user.id);
      if (!actor?.sockets.size) throw new WorldError(409, "월드에 먼저 접속하세요.");
      if (actor.worldId !== body.worldId) throw new WorldError(403, "현재 월드와 다릅니다.");
      if (req.params.operation === "rune" && actor.worldId !== actor.homeWorldId) throw new WorldError(403, "방문자는 영구적인 퍼즐 상태를 바꿀 수 없습니다.");
      if (actor.battleId || await activeCoop(actor.userId)) throw new WorldError(409, "전투를 마친 뒤 제단을 조사하세요.");
      if (!nearPuzzle(actor.position)) throw new WorldError(409, "제단 가까이 이동하세요.");
      if (req.params.operation === "inspect") return { state: await db.$transaction((tx) => view(tx, body.worldId, actor.worldId === actor.homeWorldId)), correct: false, rewarded: false };
      const data = input.parse(body);
      const result = await db.$transaction(async (tx) => {
        const state = await view(tx, data.worldId, true);
        if (!state.eligible) throw new WorldError(409, "다온의 ‘여름의 첫 선물’ 보상을 먼저 받으세요.");
        if (state.puzzle.revision !== data.expectedRevision) throw new WorldError(409, "이미 처리된 울림입니다. 최신 퍼즐을 다시 불러오세요.");
        if (state.puzzle.solved) return { state, correct: true, rewarded: false };
        await tx.worldPuzzle.createMany({ data: [{ worldId: data.worldId, puzzleId: data.puzzleId }], skipDuplicates: true });
        const correct = data.rune !== "reset" && sequence[state.puzzle.progress] === data.rune;
        const progress = correct ? state.puzzle.progress + 1 : 0, solved = progress === sequence.length;
        const changed = await tx.worldPuzzle.updateMany({ where: { worldId: data.worldId, puzzleId: data.puzzleId, revision: data.expectedRevision, solvedAt: null }, data: { progress, revision: { increment: 1 }, solvedAt: solved ? new Date() : null } });
        if (changed.count !== 1) throw new WorldError(409, "퍼즐 상태가 바뀌었습니다.");
        if (solved) {
          await tx.worldRegion.create({ data: { worldId: data.worldId, regionId: SANCTUARY.id } });
          await ensureEconomy(tx, actor.userId);
          await tx.wallet.update({ where: { userId: actor.userId }, data: { conch: { increment: TIDE_PUZZLE.reward.conch }, shell: { increment: TIDE_PUZZLE.reward.shell }, revision: { increment: 1 } } });
          await addItem(tx, actor.userId, "growth-stone", TIDE_PUZZLE.reward.growth);
        }
        return { state: await view(tx, data.worldId, true), correct, rewarded: solved };
      });
      await refreshRegions(body.worldId);
      return result;
    });
    res.json(result);
  } catch (e) { failure(e, res, next); }
});
function failure(error: unknown, res: import("express").Response, next: import("express").NextFunction) {
  if (error instanceof WorldError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof z.ZodError) { res.status(400).json({ error: "퍼즐 요청을 확인하세요." }); return; }
  next(error);
}
