import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { SANCTUARY, SANCTUARY_CHEST, TIDE_PUZZLE } from "../../shared/adventure.js";
const base = process.env.TEST_BASE_URL;
test("puzzle revisions, owner-only progress, one-time rewards and world-specific region access persist", { skip: !base }, async () => {
  const db = new PrismaClient();
  type User = { id: string; username: string; worldId: string; cookie: string; socket: Socket; position: { x: number; y: number }; regions: string[] };
  const users: User[] = [];
  async function get(u: User, path = "/api/adventure") { const r = await fetch(base + path, { headers: { Cookie: u.cookie } }); assert.equal(r.status, 200); return r.json(); }
  function post(u: User, path: string, body: unknown) { return fetch(base + path, { method: "POST", headers: { Cookie: u.cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  async function rune(u: User, value: string, revision?: number, worldId = u.worldId) {
    const state = await get(u);
    return post(u, "/api/adventure/rune", { worldId, puzzleId: TIDE_PUZZLE.id, expectedRevision: revision ?? state.puzzle.revision, rune: value });
  }
  async function walk(u: User, x: number, y: number) {
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        const dx = x - u.position.x, dy = y - u.position.y, d = Math.hypot(dx, dy);
        u.socket.emit("world:move", d < 9 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d });
        if (d < 9) { clearInterval(timer); clearTimeout(timeout); resolve(); }
      }, 55);
      const timeout = setTimeout(() => { clearInterval(timer); reject(new Error(`Walk blocked at ${JSON.stringify(u.position)}`)); }, 8000);
    });
  }
  async function reconnect(u: User) {
    u.socket.disconnect(); await new Promise((r) => setTimeout(r, 100));
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Reconnect timeout")), 4000);
      u.socket.once("world:ready", () => { clearTimeout(timeout); resolve(); }); u.socket.connect();
    });
  }
  async function pushAtGate(u: User) {
    await walk(u, 1565, 800);
    for (let i = 0; i < 6; i++) { u.socket.emit("world:move", { x: 999, y: 0, regions: [SANCTUARY.id] }); await new Promise((r) => setTimeout(r, 55)); }
    assert.ok(u.position.x <= 1570);
  }
  try {
    assert.equal((await fetch(base + "/api/adventure")).status, 401);
    for (let i = 0; i < 3; i++) {
      const row = await db.user.create({ data: { username: `puzzle_${Date.now()}_${i}`, nickname: "밀물 여행자", passwordHash: "fixture-unused", world: { create: { positionX: i === 2 ? 800 : 1460, positionY: i === 2 ? 560 : 800 } } }, include: { world: true } });
      const raw = randomBytes(32).toString("hex"); await db.session.create({ data: { userId: row.id, id: createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
      const u: User = { id: row.id, username: row.username, worldId: row.world!.id, cookie: "solara=" + raw, position: { x: 0, y: 0 }, regions: [], socket: io(base!, { autoConnect: false, extraHeaders: { Cookie: "solara=" + raw } }) }; users.push(u);
      assert.equal((await fetch(base + "/api/adventure", { headers: { Cookie: u.cookie } })).status, 409);
      u.socket.on("world:position", (p) => { u.position = p; });
      u.socket.on("adventure:changed", (p) => { u.regions = p.regions; });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Connect timeout")), 4000);
        u.socket.on("world:ready", (r) => { u.position = r.position; u.regions = r.regions; clearTimeout(timeout); resolve(); });
        u.socket.once("connect_error", reject); u.socket.connect();
      });
    }
    const [host, guest, remote] = users;
    assert.equal((await rune(host, "sun")).status, 409);
    assert.equal(await db.worldPuzzle.count({ where: { worldId: host.worldId } }), 0);
    assert.equal((await post(remote, "/api/adventure/inspect", { worldId: remote.worldId, puzzleId: TIDE_PUZZLE.id })).status, 409);
    assert.equal((await post(remote, "/api/adventure/inspect", { worldId: host.worldId, puzzleId: TIDE_PUZZLE.id })).status, 403);
    const combatResponse = await post(remote, "/api/battle/start", { encounterId: "coral-crab" });
    assert.equal(combatResponse.status, 200);
    const combat = (await combatResponse.json()).battle;
    const blockedInspect = await post(remote, "/api/adventure/inspect", { worldId: remote.worldId, puzzleId: TIDE_PUZZLE.id });
    assert.equal(blockedInspect.status, 409); assert.match((await blockedInspect.json()).error, /전투/);
    assert.equal((await rune(remote, "sun")).status, 409);
    assert.equal((await post(remote, "/api/battle/action", { battleId: combat.id, expectedVersion: combat.version, action: { type: "flee" } })).status, 200);
    await db.worldQuest.createMany({ data: [host, guest].map((u) => ({ worldId: u.worldId, questId: "first-gift", progress: 1, acceptedAt: new Date(Date.now() - 1000), claimedAt: new Date() })) });
    await db.worldQuest.create({ data: { worldId: host.worldId, questId: "coastal-map", progress: 0 } });
    const before = (await get(host, "/api/economy")).wallet;
    assert.equal((await post(host, "/api/world/chest", { worldId: host.worldId, chestId: SANCTUARY_CHEST.id })).status, 403);
    assert.equal((await rune(host, "fire")).status, 400);
    assert.equal((await post(host, "/api/adventure/rune", { worldId: host.worldId, puzzleId: TIDE_PUZZLE.id, expectedRevision: 0, rune: "sun", solved: true })).status, 400);
    await pushAtGate(host); await walk(host, 1460, 800);
    assert.equal((await rune(host, "reset")).status, 200);
    assert.equal((await rune(host, "moon")).status, 200); assert.equal((await get(host)).puzzle.progress, 0);
    assert.equal((await rune(host, "sun")).status, 200);
    await reconnect(host); assert.equal((await get(host)).puzzle.progress, 1);
    const version = (await get(host)).puzzle.revision;
    const parallel = await Promise.all([rune(host, "leaf", version), rune(host, "leaf", version)]);
    assert.deepEqual(parallel.map((r) => r.status).sort(), [200, 409]); assert.equal((await get(host)).puzzle.progress, 2);
    assert.deepEqual((await get(host, "/api/economy")).wallet, before);
    await post(host, "/api/social/access", { access: "request" }); await post(guest, "/api/social/request", { username: host.username });
    const entry = (await get(host, "/api/social")).entries.find((e: any) => e.incoming);
    assert.equal((await post(host, "/api/social/entry-answer", { id: entry.id, decision: "accept" })).status, 200);
    await walk(guest, 800, 700); await walk(guest, 1460, 700); await walk(guest, 1460, 800);
    const inspected = await post(guest, "/api/adventure/inspect", { worldId: host.worldId, puzzleId: TIDE_PUZZLE.id }); assert.equal(inspected.status, 200); assert.equal((await inspected.json()).state.isOwner, false);
    for (const worldId of [host.worldId, guest.worldId]) assert.equal((await rune(guest, "wave", undefined, worldId)).status, 403);
    const lastVersion = (await get(host)).puzzle.revision;
    const solved = await Promise.all([rune(host, "wave", lastVersion), rune(host, "wave", lastVersion)]);
    assert.deepEqual(solved.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await get(host)).puzzle.solved, true); assert.ok((await get(guest)).regions.includes(SANCTUARY.id));
    let wallet = (await get(host, "/api/economy")).wallet; assert.equal(wallet.conch, before.conch + 160); assert.equal(wallet.shell, before.shell + 500);
    assert.equal((await rune(host, "reset")).status, 200); assert.deepEqual((await get(host, "/api/economy")).wallet, wallet);
    assert.equal(await db.worldRegion.count({ where: { worldId: guest.worldId } }), 0);
    assert.equal((await post(host, "/api/world/chest", { worldId: host.worldId, chestId: SANCTUARY_CHEST.id })).status, 409);
    await walk(host, 1780, 800); await walk(guest, 1780, 800);
    assert.ok(host.position.x > 1660); assert.ok(guest.position.x > 1660);
    assert.equal((await post(guest, "/api/world/chest", { worldId: host.worldId, chestId: SANCTUARY_CHEST.id })).status, 403);
    const opened = await Promise.all([post(host, "/api/world/chest", { worldId: host.worldId, chestId: SANCTUARY_CHEST.id }), post(host, "/api/world/chest", { worldId: host.worldId, chestId: SANCTUARY_CHEST.id })]);
    assert.deepEqual((await Promise.all(opened.map((r) => r.json()))).map((r) => r.opened).sort(), [false, true]);
    wallet = (await get(host, "/api/economy")).wallet; assert.equal(wallet.conch, before.conch + 400); assert.equal(wallet.shell, before.shell + 1250);
    assert.equal((await db.worldQuest.findUniqueOrThrow({ where: { worldId_questId: { worldId: host.worldId, questId: "coastal-map" } } })).progress, 0);
    await reconnect(host); assert.ok(host.position.x > 1660); assert.equal((await get(host)).treasureOpened, true); assert.ok(host.regions.includes(SANCTUARY.id));
    await post(guest, "/api/social/leave", {}); assert.deepEqual((await get(guest)).regions, []); assert.equal((await get(guest)).puzzle.progress, 0);
    await pushAtGate(guest);
    await assert.rejects(db.worldPuzzle.update({ where: { worldId_puzzleId: { worldId: host.worldId, puzzleId: TIDE_PUZZLE.id } }, data: { progress: 2 } }));
    await assert.rejects(db.worldPuzzle.update({ where: { worldId_puzzleId: { worldId: host.worldId, puzzleId: TIDE_PUZZLE.id } }, data: { revision: -1 } }));
  } finally {
    for (const u of users) u.socket.disconnect(); await new Promise((r) => setTimeout(r, 150));
    try { await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }); } finally { await db.$disconnect(); }
  }
});
