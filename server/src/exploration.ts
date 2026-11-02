import { recordChestDiscovery } from "./story-store.js";
import { ensureEconomy, addItem } from "./economy-store.js";
import type { Server } from "socket.io";
import { db } from "./auth.js";
import { move } from "./world.js";
import {
  WORLD,
  SPAWN,
  CHESTS,
  INTERACTION_RADIUS,
  isWalkable,
  type Position,
} from "../../shared/world.js";
export type Actor = {
  battleId?: string;
  userId: string;
  nickname: string;
  homeWorldId: string;
  homePosition: Position;
  worldId: string;
  position: Position;
  last: number;
  sockets: Set<string>;
  saved: Promise<void>;
  version: number;
  queuedVersion: number;
};
let leaveCombat: (userId: string) => Promise<void> = async () => {};
export function setCombatDeparture(fn: typeof leaveCombat) {
  leaveCombat = fn;
}
let restoreBattle: (actor: Actor) => Promise<void> = async () => {};
export function setBattleRestorer(fn: typeof restoreBattle) {
  restoreBattle = fn;
}
let channel: Server;
let queue: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => {}).then(fn);
  queue = next.catch(() => {});
  return next;
}
const actors = new Map<string, Promise<Actor>>();
export async function getActor(userId: string) {
  return actors.get(userId);
}
async function acquire(userId: string, worldId: string, socketId: string) {
  let pending = actors.get(userId);
  if (!pending) {
    pending = db.world
      .findUniqueOrThrow({
        where: { id: worldId },
        include: { owner: { select: { nickname: true } } },
      })
      .then((world) => ({
        userId,
        nickname: world.owner.nickname,
        homeWorldId: worldId,
        homePosition: isWalkable({ x: world.positionX, y: world.positionY })
          ? { x: world.positionX, y: world.positionY }
          : { ...SPAWN },
        worldId,
        position: isWalkable({ x: world.positionX, y: world.positionY })
          ? { x: world.positionX, y: world.positionY }
          : { ...SPAWN },
        last: performance.now(),
        sockets: new Set<string>(),
        saved: Promise.resolve(),
        version: 0,
        queuedVersion: 0,
      }));
    actors.set(userId, pending);
    pending.catch(() => {
      if (actors.get(userId) === pending) actors.delete(userId);
    });
  }
  return pending.then((actor) => {
    actor.sockets.add(socketId);
    return actor;
  });
}
function save(actor: Actor) {
  if (actor.version === actor.queuedVersion) return actor.saved;
  const version = actor.version;
  actor.queuedVersion = version;
  const { x, y } = actor.homePosition;
  // Serialize writes so a delayed older save cannot overwrite a newer location.
  actor.saved = actor.saved
    .catch(() => {})
    .then(async () => {
      await db.world.update({
        where: { id: actor.homeWorldId },
        data: { positionX: x, positionY: y },
      });
    })
    .catch((error) => {
      if (actor.queuedVersion === version) actor.queuedVersion = -1;
      throw error;
    });
  return actor.saved;
}
export async function openedChests(worldId: string) {
  const world = await db.world.findUniqueOrThrow({
    where: { id: worldId },
    include: { openedChests: true },
  });
  const legacy = world.progress as { chests?: string[] };
  return [
    ...new Set([
      ...(Array.isArray(legacy.chests) ? legacy.chests : []),
      ...world.openedChests.map((c) => c.chestId),
    ]),
  ];
}
export class WorldError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function openChest(
  userId: string,
  worldId: unknown,
  chestId: unknown,
  ownedWorldId: string,
) {
  if (worldId !== ownedWorldId)
    throw new WorldError(403, "월드 소유자만 상자를 열 수 있습니다.");
  const current = await getActor(userId);
  if (!current || current.worldId !== ownedWorldId)
    throw new WorldError(403, "방문 중에는 월드 진행도를 변경할 수 없습니다.");
  if (current.battleId)
    throw new WorldError(409, "전투 중에는 상자를 열 수 없습니다.");
  const chest = CHESTS.find((c) => c.id === chestId);
  if (!chest) throw new WorldError(400, "존재하지 않는 상자입니다.");
  const actor = await getActor(userId);
  if (
    !actor?.sockets.size ||
    Math.hypot(actor.position.x - chest.x, actor.position.y - chest.y) >
      INTERACTION_RADIUS
  )
    throw new WorldError(409, "상자 가까이 이동하세요.");
  if ((await openedChests(ownedWorldId)).includes(chest.id)) return false;
  try {
    await db.$transaction(async (tx) => {
      await tx.worldChest.create({
        data: { worldId: ownedWorldId, chestId: chest.id },
      });
      await recordChestDiscovery(tx, ownedWorldId);
      await ensureEconomy(tx, userId);
      await tx.wallet.update({
        where: { userId },
        data: {
          conch: { increment: 40 },
          shell: { increment: 300 },
          revision: { increment: 1 },
        },
      });
      await addItem(tx, userId, "training-book", 1);
      await addItem(tx, userId, "growth-stone", 2);
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
}
export function registerExploration(io: Server) {
  channel = io;
  io.on("connection", (socket) => {
    let actor: Actor | undefined;
    // Install the listener before waiting for I/O, so early disconnects cannot leak actors.
    socket.on("disconnect", () => {
      if (actor)
        void serial(() => release(actor!, socket.id, socket.data.userId)).catch(
          console.error,
        );
    });
    void serial(async () => {
      actor = await acquire(socket.data.userId, socket.data.worldId, socket.id);
      if (!socket.connected) {
        await release(actor, socket.id, socket.data.userId);
        return;
      }
      await restoreBattle(actor);
      const chests = await openedChests(actor.worldId);
      if (!socket.connected) return;
      socket.join(`personal:${socket.data.userId}`);
      socket.join(`world:${actor.worldId}`);
      socket.emit("world:ready", {
        position: actor.position,
        world: WORLD,
        worldId: actor.worldId,
        opened: chests,
        isOwner: actor.worldId === actor.homeWorldId,
        userId: actor.userId,
      });
      await broadcastPlayers(actor.worldId);
      notifySocial();
      socket.on("world:move", (input: unknown) => {
        if (
          !actor ||
          actor.battleId ||
          !input ||
          typeof input !== "object" ||
          !("x" in input) ||
          !("y" in input) ||
          typeof input.x !== "number" ||
          typeof input.y !== "number" ||
          !Number.isFinite(input.x) ||
          !Number.isFinite(input.y)
        )
          return;
        const now = performance.now(),
          dt = (now - actor.last) / 1000;
        actor.last = now;
        const next = move(actor.position, input as Position, dt);
        const changed = next.x !== actor.position.x || next.y !== actor.position.y;
        if (changed && actor.worldId === actor.homeWorldId) actor.version++;
        actor.position = next;
        if (actor.worldId === actor.homeWorldId)
          actor.homePosition = { ...next };
        io.to(`personal:${socket.data.userId}`).emit(
          "world:position",
          actor.position,
        );
        if (changed) void broadcastPlayers(actor.worldId);
      });
      socket.on("world:save", async (ack: unknown) => {
        if (typeof ack !== "function" || !actor) return;
        try {
          await save(actor);
          ack({ ok: true });
        } catch {
          ack({ ok: false, error: "위치 저장에 실패했습니다." });
        }
      });
    }).catch((error) => {
      console.error(
        "World initialization failed:",
        error instanceof Error ? error.message : "unknown",
      );
      socket.emit("world:error", "월드를 불러올 수 없습니다. 다시 접속하세요.");
      socket.disconnect(true);
    });
  });
  const timer = setInterval(() => {
    for (const pending of actors.values())
      void pending
        .then((actor) => {
          if (actor.sockets.size) return save(actor);
        })
        .catch((error) =>
          console.error(
            "Position save failed:",
            error instanceof Error ? error.message : "unknown",
          ),
        );
  }, 2000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await serial(async () => {});
    await Promise.all(
      [...actors.values()].map(async (pending) => save(await pending)),
    );
  };
}
async function release(actor: Actor, socketId: string, userId: string) {
  actor.sockets.delete(socketId);
  if (actor.sockets.size) return;
  const oldWorld = actor.worldId;
  await leaveCombat(userId);
  await returnVisitors(actor.homeWorldId);
  await save(actor);
  if (!actor.sockets.size) actors.delete(userId);
  await broadcastPlayers(oldWorld);
  notifySocial();
}
export async function onlineActors() {
  return (await Promise.all(actors.values())).filter((a) => a.sockets.size > 0);
}
export async function broadcastPlayers(worldId: string) {
  const list = (await onlineActors())
    .filter((a) => a.worldId === worldId)
    .map((a) => ({
      userId: a.userId,
      nickname: a.nickname,
      position: a.position,
      isOwner: a.homeWorldId === worldId,
    }));
  channel.to(`world:${worldId}`).emit("world:players", list);
}
export function notifySocial() {
  channel.emit("social:changed");
}
async function returnVisitors(worldId: string) {
  for (const visitor of (await onlineActors()).filter(
    (a) => a.worldId === worldId && a.homeWorldId !== worldId,
  ))
    await switchWorld(
      visitor,
      visitor.homeWorldId,
      "월드 소유자가 떠나 개인 월드로 돌아왔습니다.",
    );
}
export async function switchWorld(
  actor: Actor,
  worldId: string,
  message = "월드를 이동했습니다.",
) {
  const opened = await openedChests(worldId);
  const oldWorld = actor.worldId;
  if (actor.battleId && worldId !== oldWorld) await leaveCombat(actor.userId);
  if (actor.battleId && worldId !== oldWorld)
    throw new WorldError(409, "전투를 마친 후 월드를 이동하세요.");
  if (oldWorld === actor.homeWorldId && worldId !== oldWorld)
    await returnVisitors(oldWorld);
  await save(actor);
  for (const id of actor.sockets) {
    const socket = channel.sockets.sockets.get(id);
    if (socket) await socket.leave(`world:${oldWorld}`);
  }
  actor.worldId = worldId;
  actor.position =
    worldId === actor.homeWorldId ? { ...actor.homePosition } : { ...SPAWN };
  actor.last = performance.now();
  for (const id of actor.sockets) {
    const socket = channel.sockets.sockets.get(id);
    if (socket) {
      await socket.join(`world:${worldId}`);
      socket.emit("world:ready", {
        position: actor.position,
        world: WORLD,
        worldId,
        opened,
        isOwner: worldId === actor.homeWorldId,
        userId: actor.userId,
        message,
      });
    }
  }
  await broadcastPlayers(oldWorld);
  await broadcastPlayers(worldId);
  notifySocial();
}
export async function enterWorld(userId: string, hostId: string) {
  const visitor = await getActor(userId),
    host = await getActor(hostId);
  if (
    !visitor?.sockets.size ||
    !host?.sockets.size ||
    host.worldId !== host.homeWorldId
  )
    throw new WorldError(
      409,
      "두 플레이어가 모두 접속하고 소유자가 자신의 월드에 있어야 합니다.",
    );
  if (visitor.battleId || host.battleId)
    throw new WorldError(409, "전투 중에는 월드에 입장할 수 없습니다.");
  if (visitor.userId === host.userId)
    throw new WorldError(400, "자신의 월드에는 신청할 수 없습니다.");
  if (visitor.worldId === host.homeWorldId) return;
  if (
    (await onlineActors()).filter((a) => a.worldId === host.homeWorldId)
      .length >= 4
  )
    throw new WorldError(409, "월드가 가득 찼습니다. 최대 4명입니다.");
  await switchWorld(visitor, host.homeWorldId);
}
export async function blockVisitors(worldId: string) {
  const owner = (await onlineActors()).find((a) => a.homeWorldId === worldId);
  if (owner) await leaveCombat(owner.userId);
  await returnVisitors(worldId);
}
