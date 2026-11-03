import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { SANCTUARY } from "../../shared/adventure.js";
import { SANCTUARY_ENCOUNTER } from "../../shared/combat.js";
const base = process.env.TEST_BASE_URL;
test("four-player sanctuary boss uses host unlock, real proximity, shared recharge, reconnect and exactly-once personal rewards", { skip: !base }, async () => {
  const db = new PrismaClient();
  type User = { id: string; username: string; worldId: string; cookie: string; socket: Socket; position: { x: number; y: number }; world: string };
  const users: User[] = [];
  const post = (u: User, path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { Cookie: u.cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = async (u: User, path: string) => (await fetch(base + path, { headers: { Cookie: u.cookie } })).json();
  async function eventually(fn: () => Promise<boolean>) { const until = Date.now() + 6000; while (Date.now() < until) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error("Co-op condition timed out"); }
  async function connect(u: User) { await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Connect timeout")), 5000); u.socket.once("world:ready", () => { clearTimeout(timer); resolve(); }); u.socket.once("connect_error", reject); u.socket.connect(); }); }
  async function walk(u: User, x: number, y: number) {
    const until = Date.now() + 12000;
    while (Date.now() < until) {
      const dx = x - u.position.x, dy = y - u.position.y, d = Math.hypot(dx, dy);
      u.socket.emit("world:move", d < 8 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d });
      if (d < 8) return; await new Promise((r) => setTimeout(r, 55));
    }
    throw new Error("Movement blocked at " + JSON.stringify(u.position));
  }
  try {
    for (let i = 0; i < 4; i++) {
      const row = await db.user.create({ data: { username: "bloomCo_" + Date.now().toString(36) + i, nickname: "꽃등 동료" + i, passwordHash: "fixture-unused", world: { create: { positionX: i === 0 ? 1870 : 800, positionY: i === 0 ? 720 : 560 } } }, include: { world: true } });
      const token = randomBytes(32).toString("hex"); await db.session.create({ data: { userId: row.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 300000) } });
      const u: User = { id: row.id, username: row.username, worldId: row.world!.id, cookie: "solara=" + token, socket: io(base!, { autoConnect: false, extraHeaders: { Cookie: "solara=" + token } }), position: { x: 0, y: 0 }, world: "" }; users.push(u);
      if (i === 0) await db.worldRegion.create({ data: { worldId: u.worldId, regionId: SANCTUARY.id } });
      await db.worldQuest.createMany({ data: [
        { worldId: u.worldId, questId: "first-gift", progress: 1, acceptedAt: new Date(Date.now() - 1000), claimedAt: new Date() },
        { worldId: u.worldId, questId: "coast-guardian", progress: 0 },
      ] });
      u.socket.on("world:ready", (r) => { u.world = r.worldId; u.position = r.position; }); u.socket.on("world:position", (p) => { u.position = p; }); await connect(u);
    }
    const [host, guest] = users;
    const start = (u: User, extra = {}) => post(u, "/api/coop/start", { encounterId: SANCTUARY_ENCOUNTER.id, ...extra });
    assert.equal((await start(guest, { regions: [SANCTUARY.id], x: 1870, y: 720 })).status, 403);
    assert.equal((await start(host)).status, 409);
    await post(host, "/api/social/access", { access: "request" });
    for (const u of users.slice(1)) {
      await post(u, "/api/social/request", { username: host.username }); const entry = (await get(host, "/api/social")).entries.find((e: any) => e.incoming);
      assert.equal((await post(host, "/api/social/entry-answer", { id: entry.id, decision: "accept" })).status, 200);
    }
    assert.equal((await start(host, { x: 800, y: 560 })).status, 409);
    await Promise.all(users.slice(1).map(async (u) => { await walk(u, 800, 800); await walk(u, 1870, 800); await walk(u, 1870, 720); }));
    assert.equal((await start(guest)).status, 403);
    await db.worldRegion.delete({ where: { worldId_regionId: { worldId: host.worldId, regionId: SANCTUARY.id } } });
    assert.equal((await start(host)).status, 403); await db.worldRegion.create({ data: { worldId: host.worldId, regionId: SANCTUARY.id } });
    let r = await start(host); assert.equal(r.status, 200); const id = (await r.json()).battle.id;
    assert.equal((await start(host)).status, 409);
    for (const u of users.slice(1)) assert.equal((await post(u, "/api/coop/ready", { battleId: id })).status, 200);
    const state = async (): Promise<any> => (await db.coopBattle.findUniqueOrThrow({ where: { id } })).state;
    let s = await state(); assert.equal(s.enemy.name, "안뜰 만개지기"); assert.equal(s.enemy.maxHp, 1088); assert.equal(s.enemy.element, "자연");
    const before = await Promise.all(users.map(async (u) => (await get(u, "/api/economy")).wallet));
    const act = (u: User, round: number, action: unknown) => post(u, "/api/coop/action", { battleId: id, expectedRound: round, action });
    for (const u of users) assert.equal((await act(u, 1, { type: "switch", slot: 3 })).status, 200);
    for (const u of users) assert.equal((await act(u, 2, { type: "defend" })).status, 200);
    s = await state(); const beforeBurst = s.members.map((m: any) => m.state.team[3].hp);
    for (const u of users.slice(0, 3)) assert.equal((await act(u, 3, { type: "defend" })).status, 200);
    assert.equal((await state()).round, 3);
    assert.equal((await act(users[3], 3, { type: "defend" })).status, 200);
    s = await state(); assert.equal(s.round, 4); assert.equal(s.enemy.blockedUntilRound, 4);
    assert.ok(s.members.every((m: any, i: number) => m.state.team[3].hp < beforeBurst[i]));
    assert.equal(s.log.filter((l: string) => l.includes("한여름의 만개:")).length, 4);
    assert.equal(s.log.filter((l: string) => l.includes("다음 1라운드 행동 불가")).length, 1);
    guest.socket.disconnect(); await eventually(async () => Boolean((await state()).members.find((m: any) => m.userId === guest.id).reconnectUntil));
    assert.equal((await act(host, 4, { type: "defend" })).status, 409);
    await connect(guest); await eventually(async () => !(await get(host, "/api/coop")).battle.coop.paused);
    s = await state(); assert.equal(s.enemy.blockedUntilRound, 4); assert.equal(s.round, 4); assert.match(s.log.join(" "), /협동 전투를 재개/);
    const restHp = s.members.map((m: any) => m.state.team[3].hp);
    for (const u of users) assert.equal((await act(u, 4, { type: "defend" })).status, 200);
    s = await state(); assert.deepEqual(s.members.map((m: any) => m.state.team[3].hp), restHp);
    let finalRound = 5;
    for (let n = 0; n < 15 && s.status === "active"; n++) {
      finalRound = s.round;
      for (const u of users) { r = await act(u, s.round, { type: "skill", skillId: "ember" }); assert.equal(r.status, 200); }
      s = await state();
    }
    assert.equal(s.status, "won");
    for (let i = 0; i < users.length; i++) {
      const after = (await get(users[i], "/api/economy")).wallet;
      assert.equal(after.conch, before[i].conch + 40); assert.equal(after.shell, before[i].shell + 500);
      assert.equal((await db.worldQuest.findUniqueOrThrow({ where: { worldId_questId: { worldId: users[i].worldId, questId: "coast-guardian" } } })).progress, i === 0 ? 1 : 0);
      assert.equal(await db.worldRegion.count({ where: { worldId: users[i].worldId } }), i === 0 ? 1 : 0);
    }
    assert.equal((await act(host, finalRound, { type: "skill", skillId: "ember" })).status, 403);
    assert.equal((await get(host, "/api/economy")).wallet.conch, before[0].conch + 40);
    assert.equal(await db.coopBattle.count({ where: { ownerId: host.id } }), 1);
    assert.equal(await db.coopMember.count({ where: { battleId: id, activeUserId: { not: null } } }), 0);
  } finally {
    for (const u of users) u.socket.disconnect(); await new Promise((r) => setTimeout(r, 100));
    try { await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }); } finally { await db.$disconnect(); }
  }
});
