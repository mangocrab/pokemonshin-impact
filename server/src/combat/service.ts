import { requireConsumable, consumeItems } from "./items.js";
import { ensureEconomy } from "../economy-store.js";
import { recordWorldVictory } from "../story-store.js";
import { activeCoop, currentCoopView, restoreCoop } from "./coop.js";
import { roster, awardVictory, setTrainingNotifier } from "../training.js";
import { Router } from "express";
import { randomInt, randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate, db } from "../auth.js";
import {
  getActor,
  onlineActors,
  serial,
  WorldError,
  setBattleRestorer,
} from "../exploration.js";
import {
  BattleRuleError,
  createBattle,
  resolveBattle,
  normalizeBattle,
} from "./engine.js";
import {
  CHARACTERS,
  ENCOUNTER,
  type BattleState,
} from "../../../shared/combat.js";
const json = (value: unknown) => value as Prisma.InputJsonValue;
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("item"), itemId: z.enum(["summer-tonic", "cleansing-salt"]) }).strict(),
  z.object({ type: z.literal("skill"), skillId: z.string().min(1).max(50) }),
  z.object({ type: z.literal("switch"), slot: z.number().int().min(0).max(3) }),
  z.object({ type: z.literal("ultimate") }),
  z.object({ type: z.literal("wait") }),
  z.object({ type: z.literal("continue") }),
  z.object({ type: z.literal("defend") }),
  z.object({ type: z.literal("flee") }),
]);
export function registerCombat(io: Server) {
  setTrainingNotifier((userId) =>
    io.to(`personal:${userId}`).emit("characters:changed"),
  );
  setBattleRestorer(async (actor) => {
    const battle = await db.battle.findUnique({
      where: { activeUserId: actor.userId },
    });
    actor.battleId = battle?.id;
    if (!battle) await restoreCoop(actor);
  });
  const router = Router();
  router.use(async (req, res, next) => {
    const u = await authenticate(req);
    if (!u?.world) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    res.locals.user = u;
    next();
  });
  router.get("/", async (_req, res) => {
    const b = await db.battle.findUnique({
      where: { activeUserId: res.locals.user.id },
    });
    res.json({
      battle: b
        ? normalizeBattle(b.state as unknown as BattleState)
        : await currentCoopView(res.locals.user.id),
    });
  });
  router.get("/items", async (_req, res) => {
    const userId = res.locals.user.id;
    await db.$transaction((tx) => ensureEconomy(tx, userId));
    res.json({ items: await db.inventory.findMany({ where: { userId, itemId: { in: ["summer-tonic", "cleansing-salt"] } }, select: { itemId: true, quantity: true } }) });
  });
  router.get("/characters", async (_req, res) => {
    res.json({ characters: await roster(res.locals.user.id) });
  });
  router.post("/:operation", async (req, res, next) => {
    try {
      let itemConsumed = false;
      const result = await serial(async () => {
        const u = res.locals.user,
          actor = await getActor(u.id);
        if (!actor?.sockets.size)
          throw new WorldError(409, "월드 서버에 먼저 접속하세요.");
        if (actor.worldId !== actor.homeWorldId)
          throw new WorldError(
            403,
            "현재 전투는 자신의 개인 월드에서만 시작할 수 있습니다.",
          );
        if (await activeCoop(u.id))
          throw new WorldError(409, "협동 전투 참여 중입니다.");
        if (req.params.operation === "start") {
          if (req.body?.encounterId !== ENCOUNTER.id)
            throw new WorldError(400, "알 수 없는 적입니다.");
          const existing = await db.battle.findUnique({
            where: { activeUserId: u.id },
          });
          if (existing) {
            actor.battleId = existing.id;
            return normalizeBattle(existing.state as unknown as BattleState);
          }
          if (
            Math.hypot(
              actor.position.x - ENCOUNTER.x,
              actor.position.y - ENCOUNTER.y,
            ) > ENCOUNTER.radius
          )
            throw new WorldError(409, "적 가까이 이동하세요.");
          if (
            (await onlineActors()).some(
              (a) => a.worldId === actor.worldId && a.userId !== u.id,
            )
          )
            throw new WorldError(
              409,
              "혼자 전투하려면 개인 월드에 혼자 있어야 합니다. 친구와 함께라면 협동 보스전을 모집하세요.",
            );
          const team = (await roster(u.id))
            .filter((c) => c.slot !== null)
            .sort((a, b) => a.slot! - b.slot!)
            .slice(0, 4);
          const state = createBattle(randomUUID(), team);
          await db.battle.create({
            data: {
              id: state.id,
              userId: u.id,
              activeUserId: u.id,
              worldId: actor.worldId,
              state: json(state),
            },
          });
          actor.battleId = state.id;
          return state;
        }
        if (req.params.operation !== "action")
          throw new WorldError(404, "알 수 없는 전투 요청입니다.");
        const parsed = z
          .object({
            battleId: z.string().min(1).max(80),
            expectedVersion: z.number().int().nonnegative(),
            action: actionSchema,
          })
          .parse(req.body);
        const current = await db.battle.findFirst({
          where: { id: parsed.battleId, userId: u.id },
        });
        if (!current) throw new WorldError(404, "전투를 찾을 수 없습니다.");
        if (
          current.status !== "active" ||
          current.version !== parsed.expectedVersion
        )
          throw new WorldError(
            409,
            "이미 처리된 행동입니다. 최신 전투 상태를 확인하세요.",
          );
        const previous = current.state as unknown as BattleState;
        const state = await db.$transaction(async (tx) => {
          if (parsed.action.type === "item") await requireConsumable(tx, u.id, parsed.action.itemId);
          const state = resolveBattle(previous, parsed.action, () => randomInt(0, 0x100000000) / 0x100000000);
          const uses = state.itemUses ?? [];
          itemConsumed = uses.length > 0;
          await consumeItems(tx, uses.map((itemId) => ({ userId: u.id, itemId })));
          delete state.itemUses;
          if (state.status === "won")
            state.reward = await awardVictory(
              tx,
              u.id,
              current.id,
              state.team.map((c) => c.id),
            );
          if (state.status === "won") await recordWorldVictory(tx, current.worldId);
          const changed = await tx.battle.updateMany({
            where: {
              id: current.id,
              userId: u.id,
              status: "active",
              version: parsed.expectedVersion,
            },
            data: {
              status: state.status,
              version: state.version,
              state: json(state),
              activeUserId: state.status === "active" ? u.id : null,
            },
          });
          if (changed.count !== 1)
            throw new WorldError(409, "이미 처리된 행동입니다.");
          await tx.battleRound.create({
            data: {
              battleId: current.id,
              version: state.version,
              round: previous.round,
              action: json(parsed.action),
              log: json(state.log),
            },
          });
          return state;
        });
        actor.battleId = state.status === "active" ? state.id : undefined;
        return state;
      });
      io.to(`personal:${res.locals.user.id}`).emit("battle:state", result);
      if (itemConsumed) io.to(`personal:${res.locals.user.id}`).emit("economy:changed");
      if (result.reward)
        io.to(`personal:${res.locals.user.id}`).emit("characters:changed");
      res.json({ battle: result });
    } catch (error) {
      if (error instanceof WorldError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof BattleRuleError || error instanceof z.ZodError) {
        res.status(400).json({
          error:
            error instanceof BattleRuleError
              ? error.message
              : "행동 입력을 확인하세요.",
        });
        return;
      }
      next(error);
    }
  });
  return router;
}
