import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { SANCTUARY } from "../../shared/adventure.js";
import { SANCTUARY_ENCOUNTER, type BattleState } from "../../shared/combat.js";
const base = process.env.TEST_BASE_URL;
test("sanctuary battle checks live ownership, database unlock and distance, persists enemy state and grants ordinary solo loot once", { skip: !base }, async () => {
  const db = new PrismaClient();
  type User = { id: string; username: string; worldId: string; cookie: string; socket: Socket };
  const users: User[] = [];
  const post = (u: User, path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { Cookie: u.cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = async (u: User, path: string) => (await fetch(base + path, { headers: { Cookie: u.cookie } })).json();
  async function connect(u: User) {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("World connection timeout")), 5000); u.socket.once("world:ready", () => { clearTimeout(timer); resolve(); }); u.socket.once("connect_error", reject); u.socket.connect(); });
  }
  const start = (u: User, extra = {}) => post(u, "/api/battle/start", { encounterId: SANCTUARY_ENCOUNTER.id, ...extra });
  try {
    for (let i = 0; i < 3; i++) {
      const row = await db.user.create({ data: { username: "bloom_" + Date.now().toString(36) + i, nickname: "안뜰 검증", passwordHash: "fixture-unused", world: { create: { positionX: i === 0 ? 1870 : 800, positionY: i === 0 ? 720 : 560 } } }, include: { world: true } });
      const raw = randomBytes(32).toString("hex"); await db.session.create({ data: { userId: row.id, id: createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
      const u: User = { id: row.id, username: row.username, worldId: row.world!.id, cookie: "solara=" + raw, socket: io(base!, { autoConnect: false, extraHeaders: { Cookie: "solara=" + raw } }) }; users.push(u);
      if (i < 2) await db.worldRegion.create({ data: { worldId: u.worldId, regionId: SANCTUARY.id } });
      await connect(u);
    }
    const [host, remote, locked] = users;
    assert.equal((await fetch(base + "/api/battle/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ encounterId: SANCTUARY_ENCOUNTER.id }) })).status, 401);
    assert.equal((await start(locked, { regions: [SANCTUARY.id], x: 1870, y: 720 })).status, 403);
    assert.equal((await start(remote, { x: 1870, y: 720 })).status, 409);
    // A stale in-memory region cache is insufficient: start checks the current DB grant.
    await db.worldRegion.delete({ where: { worldId_regionId: { worldId: host.worldId, regionId: SANCTUARY.id } } });
    assert.equal((await start(host)).status, 403);
    await db.worldRegion.create({ data: { worldId: host.worldId, regionId: SANCTUARY.id } });
    await post(host, "/api/social/access", { access: "request" }); await post(remote, "/api/social/request", { username: host.username });
    const entry = (await get(host, "/api/social")).entries.find((e: any) => e.incoming);
    assert.equal((await post(host, "/api/social/entry-answer", { id: entry.id, decision: "accept" })).status, 200);
    assert.equal((await start(remote)).status, 403); assert.equal((await start(host)).status, 409);
    assert.equal((await post(remote, "/api/social/leave", {})).status, 200);
    assert.equal((await post(host, "/api/coop/start", { encounterId: SANCTUARY_ENCOUNTER.id })).status, 409);
    await db.worldQuest.createMany({ data: [
      { worldId: host.worldId, questId: "first-gift", progress: 1, acceptedAt: new Date(Date.now() - 1000), claimedAt: new Date() },
      { worldId: host.worldId, questId: "coast-guardian", progress: 0 },
    ] });
    const before = (await get(host, "/api/economy")).wallet;
    const starts = await Promise.all([start(host), start(host)]); assert.ok(starts.every((r) => r.status === 200));
    const states = await Promise.all(starts.map((r) => r.json())); let s: BattleState = states[0].battle;
    assert.equal(s.id, states[1].battle.id); assert.equal(s.enemy.element, "자연"); assert.equal(s.enemy.maxHp, 320);
    const act = (u: User, action: unknown, snapshot = s) => post(u, "/api/battle/action", { battleId: snapshot.id, expectedVersion: snapshot.version, action });
    assert.equal((await act(locked, { type: "defend" })).status, 404);
    assert.equal((await act(host, { type: "skill", skillId: "bloomBurst" })).status, 400);
    for (const action of [{ type: "switch", slot: 3 }, { type: "defend" }, { type: "defend" }]) { const r = await act(host, action); assert.equal(r.status, 200); s = (await r.json()).battle; }
    assert.equal(s.round, 4); assert.equal(s.enemy.blockedUntilRound, 4);
    host.socket.disconnect(); await new Promise((r) => setTimeout(r, 100)); await connect(host);
    const restored = (await get(host, "/api/battle")).battle; assert.equal(restored.id, s.id); assert.equal(restored.enemy.blockedUntilRound, 4); assert.deepEqual(restored.enemy, s.enemy);
    const hp = s.team[3].hp; let r = await act(host, { type: "defend" }); assert.equal(r.status, 200); s = (await r.json()).battle; assert.equal(s.team[3].hp, hp);
    let last = s;
    for (let i = 0; i < 20 && s.status === "active"; i++) { last = s; r = await act(host, { type: "skill", skillId: "ember" }); assert.equal(r.status, 200); s = (await r.json()).battle; }
    assert.equal(s.status, "won");
    const after = (await get(host, "/api/economy")).wallet; assert.equal(after.conch, before.conch + 20); assert.equal(after.shell, before.shell + 250);
    assert.equal((await db.worldQuest.findUniqueOrThrow({ where: { worldId_questId: { worldId: host.worldId, questId: "coast-guardian" } } })).progress, 1);
    assert.equal((await act(host, { type: "skill", skillId: "ember" }, last)).status, 409);
    assert.deepEqual((await get(host, "/api/economy")).wallet, after);
    assert.equal(await db.battle.count({ where: { userId: host.id } }), 1);
  } finally {
    for (const u of users) u.socket.disconnect(); await new Promise((r) => setTimeout(r, 100));
    try { await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }); } finally { await db.$disconnect(); }
  }
});
