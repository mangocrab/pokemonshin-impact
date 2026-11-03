import { requireConsumable, consumeItems } from "./items.js";
import { recordWorldVictory } from "../story-store.js";
import { grantLoot } from "../economy-store.js";
import { Router } from "express";
import { randomInt, randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate, db } from "../auth.js";
import {
  serial,
  getActor,
  onlineActors,
  setCombatDeparture,
  setCombatSuspender,
  switchWorld,
  type Actor,
  WorldError,
} from "../exploration.js";
import { roster, grantExperience } from "../training.js";
import {
  ENCOUNTERS,
  type BattleAction,
  type BattleState,
  blockedReason,
} from "../../../shared/combat.js";
import {
  type CoopState,
  coopView,
  autoChoices,
  livingMembers,
  coopPaused,
  nextCoopDeadline,
  COOP_RECONNECT_MS,
  cooperativeEnemy,
} from "../../../shared/coop.js";
import {
  createBattle,
  normalizeBattle,
  resolveBattle,
  resolveRound,
  validateBattleAction,
  BattleRuleError,
} from "./engine.js";
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const rng = () => randomInt(0, 0x100000000) / 0x100000000;
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("item"), itemId: z.enum(["summer-tonic", "cleansing-salt"]) }).strict(),
  z.object({ type: z.literal("skill"), skillId: z.string().min(1).max(50) }),
  z.object({ type: z.literal("ultimate") }),
  z.object({ type: z.literal("switch"), slot: z.number().int().min(0).max(3) }),
  z.object({ type: z.literal("defend") }),
  z.object({ type: z.literal("wait") }),
  z.object({ type: z.literal("continue") }),
]);
let channel: Server;
let recovered = false;
export async function activeCoop(userId: string) {
  const m = await db.coopMember.findUnique({
    where: { activeUserId: userId },
    include: { battle: true },
  });
  return m?.battle.state as unknown as CoopState | undefined;
}
export async function currentCoopView(userId: string) {
  const s = await activeCoop(userId);
  return s ? coopView(s, userId) : null;
}
async function publish(s: CoopState) {
  for (const m of s.members) {
    channel
      .to(`personal:${m.userId}`)
      .emit("battle:state", coopView(s, m.userId));
    if (s.status === "won" && !m.left)
      channel.to(`personal:${m.userId}`).emit("characters:changed");
  }
}
async function save(
  s: CoopState,
  resolvedRound?: { round: number; actions: unknown; itemUses?: { userId: string; itemId: string }[] },
  selection?: { userId: string; itemId: string },
) {
  if (s.status !== "active" && s.status !== "lobby") for (const m of s.members) delete m.reconnectUntil;
  await db.$transaction(
    async (tx) => {
      if (selection) await requireConsumable(tx, selection.userId, selection.itemId);
      await consumeItems(tx, resolvedRound?.itemUses ?? []);
      if (s.status === "won")
        for (const m of s.members.filter((m) => m.ready && !m.left)) {
          await tx.coopReward.create({
            data: { battleId: s.id, userId: m.userId, experience: 120 },
          });
          await grantLoot(
            tx,
            m.userId,
            m.state.team.map((f) => f.id),
            true,
          );
          m.state.reward = await grantExperience(
            tx,
            m.userId,
            m.state.team.map((f) => f.id),
            120,
          );
        }
      if (s.status === "won" && s.members.some((m) => m.userId === s.ownerId && m.ready && !m.left))
        await recordWorldVictory(tx, s.worldId, s.enemy.id);
      const updated = await tx.coopBattle.updateMany({
        where: { id: s.id, version: s.version },
        data: {
          version: s.version + 1,
          status: s.status,
          deadline: new Date(nextCoopDeadline(s)),
          state: json({ ...s, version: s.version + 1 }),
        },
      });
      if (updated.count !== 1)
        throw new WorldError(409, "협동 전투 정보가 갱신되었습니다.");
      if (resolvedRound)
        await tx.coopRound.create({
          data: {
            battleId: s.id,
            round: resolvedRound.round,
            actions: json(resolvedRound.actions),
            log: json(s.log),
          },
        });
      for (const m of s.members)
        if (m.left || !["lobby", "active"].includes(s.status))
          await tx.coopMember.update({
            where: { battleId_userId: { battleId: s.id, userId: m.userId } },
            data: { activeUserId: null },
          });
    },
    { timeout: 15000 },
  );
  s.version++;
  for (const m of s.members) {
    const actor = await getActor(m.userId);
    if (actor && (m.left || !["lobby", "active"].includes(s.status)))
      actor.battleId = undefined;
  }
  await publish(s);
  for (const userId of new Set((resolvedRound?.itemUses ?? []).map((u) => u.userId))) channel.to(`personal:${userId}`).emit("economy:changed");
}
function startReady(s: CoopState) {
  const members = s.members.filter((m) => !m.left);
  if (members.length < 2) return false;
  if (!members.every((m) => m.ready) || coopPaused(s)) return false;
  s.status = "active";
  s.enemy = cooperativeEnemy(s.enemy, members.length);
  s.deadline = Date.now() + 60000;
  s.log = [
    "협동 보스전 시작! 모두 행동을 선택하세요. 3라운드마다 광역 공격을 사용합니다.",
  ];
  autoChoices(s);
  return true;
}
export function resolveIfReady(s: CoopState, random = rng) {
  if (coopPaused(s)) return undefined;
  autoChoices(s);
  const members = livingMembers(s);
  if (!members.length) {
    s.status = "lost";
    s.log = ["모두 쓰러져 협동 전투가 종료되었습니다."];
    return undefined;
  }
  if (members.some((m) => !m.choice || m.state.phase === "replacement"))
    return undefined;
  const previous = s.round;
  const actions = members.map((m) => ({ userId: m.userId, action: m.choice }));
  const active = s.members.filter((m) => m.ready && !m.left);
  for (const m of active) {
    m.state.enemy = s.enemy;
    m.state.round = s.round;
  }
  const log = resolveRound(
    active.map((m) => ({
      key: m.userId,
      state: m.state,
      action: m.choice ?? { type: "wait" },
    })),
    s.enemy,
    s.round,
    random,
    true,
  );
  const itemUses = active.flatMap((m) => (m.state.itemUses ?? []).map((itemId) => ({ userId: m.userId, itemId })));
  for (const m of s.members) delete m.state.itemUses;
  s.log = log;
  s.round++;
  s.deadline = Date.now() + 60000;
  if (active[0].state.status === "won" || active[0].state.status === "lost")
    s.status = active[0].state.status;
  for (const m of s.members) m.choice = null;
  autoChoices(s);
  return { round: previous, actions, itemUses };
}
export async function withdrawCoop(userId: string) {
  const s = await activeCoop(userId);
  if (!s) return;
  const m = s.members.find((m) => m.userId === userId)!;
  const wasPaused = coopPaused(s);
  m.left = true;
  m.choice = null;
  delete m.reconnectUntil;
  if (wasPaused && !coopPaused(s)) s.deadline = Date.now() + 60000;
  let resolved;
  if (s.ownerId === userId) {
    s.status = "abandoned";
    s.log = ["소유자가 전투를 종료하여 협동 전투가 취소되었습니다."];
  } else if (s.status === "lobby") {
    if (s.members.filter((m) => !m.left).length < 2) {
      s.status = "abandoned";
      s.log = ["참가자가 부족하여 모집이 취소되었습니다."];
    } else startReady(s);
  } else {
    resolved = resolveIfReady(s);
    if (s.status === "active" && !resolved)
      s.log = [
        `${m.nickname}이(가) 나갔습니다. 남은 참가자가 계속 진행합니다.`,
      ];
  }
  await save(s, resolved);
}
export async function suspendCoop(actor: Actor) {
  const s = await activeCoop(actor.userId);
  if (!s || !["lobby", "active"].includes(s.status)) return false;
  const until = Date.now() + COOP_RECONNECT_MS;
  for (const m of s.members) if (!m.left && (m.userId === actor.userId || actor.userId === s.ownerId)) m.reconnectUntil ??= until;
  s.log = ["연결 복구를 기다리며 협동 전투를 일시정지했습니다. 선택한 행동은 보존됩니다."];
  await save(s);
  return true;
}
async function resumeMember(s: CoopState, actor: Actor, announce: boolean) {
  const member = s.members.find((m) => m.userId === actor.userId && !m.left);
  if (!member) throw new WorldError(403, "복귀할 수 없는 참가자입니다.");
  if (member.reconnectUntil === undefined && actor.worldId === s.worldId) return;
  if (member.reconnectUntil !== undefined && member.reconnectUntil <= Date.now()) throw new WorldError(409, "전투 복귀 시간이 지났습니다.");
  const world = await db.world.findUnique({ where: { id: s.worldId }, select: { ownerId: true, access: true } });
  if (!world || world.ownerId !== s.ownerId || world.access === "blocked") throw new WorldError(403, "복귀할 수 없는 월드입니다.");
  if (actor.userId !== s.ownerId) {
    const owner = await getActor(s.ownerId);
    if (!owner?.sockets.size || owner.worldId !== s.worldId || s.members.find((m) => m.userId === s.ownerId)?.reconnectUntil)
      throw new WorldError(409, "소유자의 월드 재접속을 기다리세요.");
    if (actor.worldId !== s.worldId) {
      if ((await onlineActors()).filter((a) => a.worldId === s.worldId).length >= 4) throw new WorldError(409, "월드가 가득 찼습니다.");
      await switchWorld(actor, s.worldId, "저장된 협동 전투에 복귀했습니다.", { preserveBattle: true, announce });
    }
  } else if (actor.worldId !== actor.homeWorldId || s.worldId !== actor.homeWorldId) throw new WorldError(403, "소유자의 개인 월드에서 복귀하세요.");
  const wasPaused = coopPaused(s);
  delete member.reconnectUntil;
  let resolved;
  if (wasPaused && !coopPaused(s)) {
    s.deadline = Date.now() + 60000;
    s.log = ["모든 참가자가 복귀하여 협동 전투를 재개했습니다. 행동을 선택하세요."];
    if (s.status === "lobby") startReady(s);
    else resolved = resolveIfReady(s);
  }
  await save(s, resolved);
}
export async function restoreCoop(actor: Actor) {
  const s = await activeCoop(actor.userId);
  if (!s) return;
  actor.battleId = s.id;
  const m = s.members.find((m) => m.userId === actor.userId);
  if (!m?.reconnectUntil) return;
  if (m.reconnectUntil <= Date.now()) { await expireCoop(s.id); return; }
  try { await resumeMember(s, actor, false); }
  catch (e) { if (!(e instanceof WorldError) || e.status !== 409) throw e; }
}
export async function recoverCoop() {
  const rows = await db.coopBattle.findMany({ where: { status: { in: ["lobby", "active"] } } });
  for (const row of rows) {
    const s = row.state as unknown as CoopState;
    s.version = row.version;
    for (const m of s.members) {
      m.state = normalizeBattle(m.state); delete m.state.itemUses;
      if (!m.left) m.reconnectUntil = Date.now() + COOP_RECONNECT_MS;
    }
    s.log = ["서버가 재시작되었습니다. 30초 안에 재접속하여 저장된 협동 전투에 복귀하세요."];
    await save(s);
  }
  await db.coopMember.updateMany({ where: { activeUserId: { not: null }, battle: { status: { notIn: ["lobby", "active"] } } }, data: { activeUserId: null } });
  recovered = true;
}
export async function expireCoop(id: string, now = Date.now()) {
  const record = await db.coopBattle.findUnique({ where: { id } });
  if (
    !record ||
    !["lobby", "active"].includes(record.status) ||
    record.deadline.getTime() > now
  )
    return;
  const s = record.state as unknown as CoopState;
  if (coopPaused(s)) {
    const expired = s.members.filter((m) => !m.left && m.reconnectUntil !== undefined && m.reconnectUntil <= now);
    if (expired.some((m) => m.userId === s.ownerId)) await withdrawCoop(s.ownerId);
    else for (const m of expired) await withdrawCoop(m.userId);
    return;
  }
  if (s.status === "lobby") {
    s.status = "abandoned";
    s.log = ["참여 확인 시간이 만료되었습니다."];
    await save(s);
    return;
  }
  for (const m of livingMembers(s)) {
    if (m.state.phase === "replacement") {
      const slot = m.state.team.findIndex((f) => f.hp > 0);
      delete m.state.team[m.state.activeSlot].preparing;
      m.state.activeSlot = slot;
      m.state.phase = "choice";
    }
    if (!m.choice) {
      const f = m.state.team[m.state.activeSlot];
      m.choice = blockedReason(f, s.round)
        ? { type: "wait" }
        : f.preparing
          ? { type: f.preparing.readyRound > s.round ? "wait" : "continue" }
          : { type: "defend" };
    }
  }
  const resolved = resolveIfReady(s);
  s.log.push("선택 제한시간이 지나 미선택 행동을 자동 처리했습니다.");
  await save(s, resolved);
}
export function registerCoop(io: Server) {
  channel = io;
  setCombatDeparture(withdrawCoop);
  setCombatSuspender(suspendCoop);
  const timer = setInterval(() => {
    if (!recovered) return;
    void serial(async () => {
      const due = await db.coopBattle.findMany({
        where: {
          status: { in: ["lobby", "active"] },
          deadline: { lte: new Date() },
        },
      });
      for (const row of due) await expireCoop(row.id);
    }).catch((error) =>
      console.error(
        "Co-op deadline failed:",
        error instanceof Error ? error.message : "unknown",
      ),
    );
  }, 1000);
  timer.unref();
  const router = Router();
  router.use(async (req, res, next) => {
    const user = await authenticate(req);
    if (!user?.world) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    res.locals.user = user;
    next();
  });
  router.get("/", async (_req, res) =>
    res.json({ battle: await currentCoopView(res.locals.user.id) }),
  );
  router.post("/:operation", async (req, res, next) => {
    try {
      const result = await serial(async () => {
        const u = res.locals.user,
          actor = await getActor(u.id);
        if (!actor?.sockets.size)
          throw new WorldError(409, "월드에 먼저 접속하세요.");
        if (req.params.operation === "start") {
          if (actor.worldId !== actor.homeWorldId)
            throw new WorldError(
              403,
              "월드 소유자만 협동 전투를 모집할 수 있습니다.",
            );
          const encounter = ENCOUNTERS.find((e) => e.id === req.body?.encounterId);
          if (!encounter)
            throw new WorldError(400, "알 수 없는 적입니다.");
          if ("regionId" in encounter && !(await db.worldRegion.findUnique({ where: { worldId_regionId: { worldId: actor.worldId, regionId: encounter.regionId } } })))
            throw new WorldError(403, "먼저 이 월드의 지역을 해금하세요.");
          const candidates = (await onlineActors())
            .filter(
              (a) =>
                a.worldId === actor.worldId &&
                Math.hypot(
                  a.position.x - encounter.x,
                  a.position.y - encounter.y,
                ) <= encounter.radius,
            )
            .sort((a, b) =>
              a.userId === u.id
                ? -1
                : b.userId === u.id
                  ? 1
                  : a.userId.localeCompare(b.userId),
            );
          if (
            !candidates.some((a) => a.userId === u.id) ||
            candidates.length < 2 ||
            candidates.length > 4
          )
            throw new WorldError(
              409,
              "적 근처에 소유자를 포함한 2~4명이 있어야 합니다.",
            );
          for (const a of candidates)
            if (
              a.battleId ||
              (await db.battle.findUnique({
                where: { activeUserId: a.userId },
              })) ||
              (await activeCoop(a.userId))
            )
              throw new WorldError(409, "이미 전투 중인 참가자가 있습니다.");
          const id = randomUUID(),
            members = [];
          for (const a of candidates) {
            const state = createBattle(
              id,
              (await roster(a.userId))
                .filter((c) => c.slot !== null)
                .sort((a, b) => a.slot! - b.slot!)
                .slice(0, 4),
              encounter,
            );
            members.push({
              userId: a.userId,
              nickname: a.nickname,
              ready: a.userId === u.id,
              left: false,
              state,
              choice: null,
            });
          }
          const s: CoopState = {
            id,
            ownerId: u.id,
            worldId: actor.worldId,
            version: 0,
            round: 1,
            status: "lobby",
            deadline: Date.now() + 60000,
            enemy: createBattle(id, undefined, encounter).enemy,
            members,
            log: ["협동 전투 참여를 확인하세요. 수락한 참가자만 시작합니다."],
          };
          await db.coopBattle.create({
            data: {
              id,
              ownerId: u.id,
              worldId: actor.worldId,
              deadline: new Date(nextCoopDeadline(s)),
              state: json(s),
              members: {
                create: candidates.map((a) => ({
                  userId: a.userId,
                  activeUserId: a.userId,
                })),
              },
            },
          });
          for (const a of candidates) a.battleId = id;
          await publish(s);
          return coopView(s, u.id);
        }
        const id = z.string().min(1).max(80).parse(req.body?.battleId);
        const s = await activeCoop(u.id);
        if (!s || s.id !== id)
          throw new WorldError(403, "참가하지 않은 협동 전투입니다.");
        const member = s.members.find((m) => m.userId === u.id)!;
        if (req.params.operation === "leave") {
          await withdrawCoop(u.id);
          const row = await db.coopBattle.findUniqueOrThrow({ where: { id } });
          return coopView(row.state as unknown as CoopState, u.id);
        }
        if (req.params.operation === "resume") {
          await resumeMember(s, actor, true);
          return coopView(s, u.id);
        }
        if (coopPaused(s)) throw new WorldError(409, "참가자의 전투 복귀를 기다리는 중입니다.");
        if (actor.worldId !== s.worldId) throw new WorldError(403, "전투가 진행 중인 월드에서 행동하세요.");
        if (req.params.operation === "ready") {
          if (s.status !== "lobby" || member.ready)
            throw new WorldError(409, "이미 처리된 참여 확인입니다.");
          member.ready = true;
          startReady(s);
          await save(s);
          return coopView(s, u.id);
        }
        if (req.params.operation !== "action" || s.status !== "active")
          throw new WorldError(409, "행동을 선택할 수 없는 전투입니다.");
        const body = z
          .object({
            expectedRound: z.number().int().positive(),
            action: actionSchema,
          })
          .parse(req.body);
        if (s.round !== body.expectedRound || member.choice)
          throw new WorldError(409, "이미 선택했거나 지난 라운드입니다.");
        if (member.state.team.every((f) => f.hp <= 0))
          throw new WorldError(409, "전멸하여 관전 중입니다.");
        member.state.round = s.round;
        member.state.enemy = s.enemy;
        validateBattleAction(member.state, body.action);
        if (member.state.phase === "replacement") {
          const replacement = resolveBattle(member.state, body.action, rng);
          member.state = replacement;
          member.state.enemy = s.enemy;
        } else member.choice = body.action;
        const resolved = resolveIfReady(s);
        await save(s, resolved, body.action.type === "item" ? { userId: u.id, itemId: body.action.itemId } : undefined);
        return coopView(s, u.id);
      });
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
