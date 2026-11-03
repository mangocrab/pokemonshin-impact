import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { io, type Socket } from "socket.io-client";
import { randomBytes, createHash } from "node:crypto";
import { SANCTUARY, SANCTUARY_CHEST } from "../../shared/adventure.js";
const base = process.env.TEST_BASE_URL;
test("Serin quests isolate target battles and treasure, enforce region/owner/chain guards and persist exactly-once rewards", { skip: !base }, async () => {
  const db = new PrismaClient();
  type User = { id: string; username: string; worldId: string; cookie: string; socket: Socket; position: { x: number; y: number } };
  const users: User[] = [];
  const post = (u: User, path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { Cookie: u.cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = async (u: User, path = "/api/story") => (await fetch(base + path, { headers: { Cookie: u.cookie } })).json();
  const quest = (u: User, op: string, questId: string, worldId = u.worldId) => post(u, "/api/story/" + op, { worldId, questId });
  const talk = (u: User, worldId = u.worldId) => post(u, "/api/story/talk", { worldId, npcId: "serin" });
  const view = async (u: User, id: string) => (await get(u)).quests.find((q: any) => q.id === id);
  async function connect(u: User) { await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Connect timeout")), 5000); u.socket.once("world:ready", () => { clearTimeout(timer); resolve(); }); u.socket.once("connect_error", reject); u.socket.connect(); }); }
  async function walk(u: User, x: number, y: number) {
    const end = Date.now() + 12000;
    while (Date.now() < end) { const dx = x - u.position.x, dy = y - u.position.y, d = Math.hypot(dx, dy); u.socket.emit("world:move", d < 8 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d }); if (d < 8) return; await new Promise((r) => setTimeout(r, 55)); }
    throw new Error("Walk blocked at " + JSON.stringify(u.position));
  }
  async function win(u: User, encounterId: string, during?: () => Promise<void>) {
    const r = await post(u, "/api/battle/start", { encounterId }); assert.equal(r.status, 200); let s = (await r.json()).battle;
    if (during) await during();
    for (let turn = 0; turn < 30 && s.status === "active"; turn++) {
      const action = s.phase === "replacement" ? { type: "switch", slot: s.team.findIndex((f: { hp: number }) => f.hp > 0) } : turn === 0 && encounterId === "sanctuary-bloom" ? { type: "switch", slot: 3 } : { type: "skill", skillId: s.team[s.activeSlot].skills[0] };
      const move = await post(u, "/api/battle/action", { battleId: s.id, expectedVersion: s.version, action }); assert.equal(move.status, 200); s = (await move.json()).battle;
    }
    assert.equal(s.status, "won"); return s;
  }
  try {
    for (let i = 0; i < 3; i++) {
      const row = await db.user.create({ data: { username: "serin_" + Date.now().toString(36) + i, nickname: "안뜰 기록자", passwordHash: "fixture-unused", world: { create: { positionX: i < 2 ? 1740 : 800, positionY: i < 2 ? 900 : 560 } } }, include: { world: true } });
      const token = randomBytes(32).toString("hex"); await db.session.create({ data: { userId: row.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 300000) } });
      const u: User = { id: row.id, username: row.username, worldId: row.world!.id, cookie: "solara=" + token, socket: io(base!, { autoConnect: false, extraHeaders: { Cookie: "solara=" + token } }), position: { x: 0, y: 0 } }; users.push(u);
      if (i < 2) await db.worldRegion.create({ data: { worldId: u.worldId, regionId: SANCTUARY.id } });
      u.socket.on("world:ready", (r) => { u.position = r.position; }); u.socket.on("world:position", (p) => { u.position = p; }); await connect(u);
    }
    const [host, guest, locked] = users;
    assert.equal((await view(locked, "sanctuary-song")).state, "locked"); assert.equal((await talk(locked)).status, 403);
    assert.equal((await quest(locked, "accept", "sanctuary-song")).status, 403);
    assert.equal((await quest(host, "accept", "sanctuary-song")).status, 409);
    for (const u of [host, guest]) await db.worldQuest.create({ data: { worldId: u.worldId, questId: "first-gift", progress: 1, acceptedAt: new Date(Date.now() - 1000), claimedAt: new Date() } });
    await db.worldRegion.delete({ where: { worldId_regionId: { worldId: host.worldId, regionId: SANCTUARY.id } } });
    assert.equal((await talk(host)).status, 403); assert.equal((await view(host, "sanctuary-song")).state, "locked");
    await db.worldRegion.create({ data: { worldId: host.worldId, regionId: SANCTUARY.id } });
    await walk(host, 1870, 900); await walk(host, 1870, 720); await win(host, "sanctuary-bloom");
    await walk(host, 1870, 900); await walk(host, 1740, 900);
    assert.equal((await view(host, "sanctuary-song")).state, "available");
    assert.equal((await quest(host, "accept", "sanctuary-keepsake")).status, 409);
    assert.equal((await post(host, "/api/story/accept", { worldId: host.worldId, questId: "sanctuary-song", progress: 1 })).status, 400);
    const accepts = await Promise.all([quest(host, "accept", "sanctuary-song"), quest(host, "accept", "sanctuary-song")]); assert.ok(accepts.every((r) => r.status === 200));
    assert.equal((await view(host, "sanctuary-song")).progress, 0); assert.equal((await quest(host, "claim", "sanctuary-song")).status, 409);
    await quest(guest, "accept", "sanctuary-song");
    await post(host, "/api/social/access", { access: "request" }); await post(guest, "/api/social/request", { username: host.username });
    const entry = (await get(host, "/api/social")).entries.find((e: any) => e.incoming); assert.equal((await post(host, "/api/social/entry-answer", { id: entry.id, decision: "accept" })).status, 200);
    await walk(guest, 800, 800); await walk(guest, 1740, 800); await walk(guest, 1740, 900);
    const visit = await talk(guest, host.worldId); assert.equal(visit.status, 200); assert.equal((await visit.json()).isOwner, false);
    for (const worldId of [guest.worldId, host.worldId]) for (const op of ["accept", "claim"]) assert.equal((await quest(guest, op, "sanctuary-song", worldId)).status, 403);
    await post(guest, "/api/social/leave", {});
    // A real unrelated victory must still advance the original general quest only.
    await db.worldQuest.create({ data: { worldId: host.worldId, questId: "coast-guardian", progress: 0 } });
    await walk(host, 1740, 800); await walk(host, 740, 800); await walk(host, 740, 560); await win(host, "coral-crab");
    assert.equal((await view(host, "coast-guardian")).progress, 1); assert.equal((await view(host, "sanctuary-song")).progress, 0);
    await walk(host, 740, 800); await walk(host, 1870, 800); await walk(host, 1870, 720);
    await win(host, "sanctuary-bloom", async () => { assert.equal((await talk(host)).status, 409); assert.equal((await quest(host, "claim", "sanctuary-song")).status, 409); });
    assert.equal((await view(host, "sanctuary-song")).state, "ready"); assert.equal((await view(guest, "sanctuary-song")).progress, 0);
    assert.equal((await quest(host, "claim", "sanctuary-song")).status, 409);
    await walk(host, 1870, 900); await walk(host, 1740, 900);
    const before = (await get(host, "/api/economy")).wallet;
    const claims = await Promise.all([quest(host, "claim", "sanctuary-song"), quest(host, "claim", "sanctuary-song")]); assert.ok(claims.every((r) => r.status === 200));
    assert.deepEqual((await Promise.all(claims.map((r) => r.json()))).map((r) => r.claimed).sort(), [false, true]);
    let after = (await get(host, "/api/economy")).wallet; assert.equal(after.conch, before.conch + 240); assert.equal(after.shell, before.shell + 900);
    // Old coast discoveries must not fulfill the targeted sanctuary chest objective.
    await db.world.update({ where: { id: host.worldId }, data: { progress: { chests: ["coast-1", "grove-1", "harbor-1"] } } });
    assert.equal((await quest(host, "accept", "sanctuary-keepsake")).status, 200); assert.equal((await view(host, "sanctuary-keepsake")).progress, 0);
    assert.equal((await quest(host, "claim", "sanctuary-keepsake")).status, 409);
    await walk(host, 1780, 800); assert.equal((await post(host, "/api/world/chest", { worldId: host.worldId, chestId: SANCTUARY_CHEST.id })).status, 200);
    assert.equal((await view(host, "sanctuary-keepsake")).progress, 1);
    await walk(host, 1740, 900); const chestWallet = (await get(host, "/api/economy")).wallet;
    assert.equal((await quest(host, "claim", "sanctuary-keepsake")).status, 200);
    after = (await get(host, "/api/economy")).wallet; assert.equal(after.conch, chestWallet.conch + 160); assert.equal(after.shell, chestWallet.shell + 600);
    assert.equal((await quest(host, "claim", "sanctuary-keepsake")).status, 200); assert.deepEqual((await get(host, "/api/economy")).wallet, after);
    host.socket.disconnect(); await new Promise((r) => setTimeout(r, 100)); await connect(host);
    for (const id of ["sanctuary-song", "sanctuary-keepsake"]) assert.equal((await view(host, id)).state, "claimed");
    assert.equal(await db.worldQuest.count({ where: { worldId: host.worldId, questId: "sanctuary-song" } }), 1);
  } finally {
    for (const u of users) u.socket.disconnect(); await new Promise((r) => setTimeout(r, 100));
    try { await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }); } finally { await db.$disconnect(); }
  }
});
