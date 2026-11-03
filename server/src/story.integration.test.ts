import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { io, type Socket } from "socket.io-client";
const base = process.env.TEST_BASE_URL;
test("NPC quests validate distance and ownership, persist objectives and grant each reward once", { skip: !base }, async () => {
  const db = new PrismaClient();
  type User = { id: string; username: string; worldId: string; cookie: string; socket: Socket; position: { x: number; y: number } };
  const users: User[] = [];
  async function get(u: User, path = "/api/story") { const r = await fetch(base + path, { headers: { Cookie: u.cookie } }); assert.equal(r.status, 200); return r.json(); }
  function post(u: User, path: string, body: unknown) { return fetch(base + path, { method: "POST", headers: { Cookie: u.cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  function quest(u: User, op: string, questId: string, worldId = u.worldId) { return post(u, "/api/story/" + op, { worldId, questId }); }
  async function walk(u: User, x: number, y: number) {
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        const dx = x - u.position.x, dy = y - u.position.y, distance = Math.hypot(dx, dy);
        u.socket.emit("world:move", distance < 10 ? { x: 0, y: 0 } : { x: dx / distance, y: dy / distance });
        if (distance < 10) { clearInterval(timer); clearTimeout(timeout); resolve(); }
      }, 55);
      const timeout = setTimeout(() => { clearInterval(timer); reject(new Error(`Walk timed out at ${JSON.stringify(u.position)}`)); }, 8000);
    });
  }
  async function fight(u: User, during?: () => Promise<void>) {
    await walk(u, 740, 560);
    const r = await post(u, "/api/battle/start", { encounterId: "coral-crab" }); assert.equal(r.status, 200);
    let s = (await r.json()).battle;
    if (during) await during();
    for (let n = 0; n < 50 && s.status === "active"; n++) {
      const action = s.phase === "replacement" ? { type: "switch", slot: s.team.findIndex((f: any) => f.hp > 0) } : { type: "skill", skillId: s.team[s.activeSlot].skills[0] };
      const move = await post(u, "/api/battle/action", { battleId: s.id, expectedVersion: s.version, action }); assert.equal(move.status, 200);
      s = (await move.json()).battle;
    }
    assert.equal(s.status, "won"); return s;
  }
  try {
    assert.equal((await fetch(base + "/api/story")).status, 401);
    for (let i = 0; i < 2; i++) {
      const row = await db.user.create({ data: { username: `story_${Date.now()}_${i}`, nickname: "이야기 여행자", passwordHash: "fixture-unused", world: { create: { positionX: 845, positionY: 640 } } }, include: { world: true } });
      const raw = randomBytes(32).toString("hex");
      await db.session.create({ data: { userId: row.id, id: createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
      const u: User = { id: row.id, username: row.username, worldId: row.world!.id, cookie: "solara=" + raw, position: { x: 845, y: 640 }, socket: io(base!, { autoConnect: false, extraHeaders: { Cookie: "solara=" + raw } }) }; users.push(u);
      assert.equal((await fetch(base + "/api/story", { headers: { Cookie: u.cookie } })).status, 409);
      u.socket.on("world:position", (p) => { u.position = p; });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Socket timeout")), 4000);
        u.socket.on("world:ready", (r) => { u.position = r.position; clearTimeout(timeout); resolve(); });
        u.socket.once("connect_error", reject); u.socket.connect();
      });
    }
    const [host, guest] = users;
    assert.equal((await get(host)).quests[0].state, "available");
    assert.equal((await quest(host, "accept", "coast-guardian")).status, 409);
    assert.equal((await post(host, "/api/story/talk", { worldId: host.worldId, npcId: "moru" })).status, 409);
    assert.equal((await post(host, "/api/story/talk", { worldId: host.worldId, npcId: "fake" })).status, 400);
    assert.equal((await post(host, "/api/story/talk", { worldId: guest.worldId, npcId: "daon" })).status, 403);
    assert.equal((await post(host, "/api/story/accept", { worldId: host.worldId, questId: "first-gift", progress: 1 })).status, 400);
    const first = await Promise.all([quest(host, "accept", "first-gift"), quest(host, "accept", "first-gift")]);
    assert.ok(first.every((r) => r.status === 200));
    assert.equal(await db.worldQuest.count({ where: { worldId: host.worldId } }), 1);
    assert.equal((await quest(host, "claim", "first-gift")).status, 409);
    assert.equal((await quest(guest, "accept", "first-gift")).status, 200);
    await post(host, "/api/social/access", { access: "request" }); await post(guest, "/api/social/request", { username: host.username });
    const entry = (await get(host, "/api/social")).entries.find((e: any) => e.incoming);
    assert.equal((await post(host, "/api/social/entry-answer", { id: entry.id, decision: "accept" })).status, 200);
    await walk(guest, 845, 640);
    const talk = await post(guest, "/api/story/talk", { worldId: host.worldId, npcId: "daon" }); assert.equal(talk.status, 200);
    assert.equal((await talk.json()).isOwner, false);
    for (const worldId of [host.worldId, guest.worldId]) for (const op of ["accept", "claim"])
      assert.equal((await quest(guest, op, "first-gift", worldId)).status, 403);
    await walk(host, 890, 560);
    assert.equal((await post(host, "/api/world/chest", { worldId: host.worldId, chestId: "coast-1" })).status, 200);
    assert.equal((await get(host)).quests[0].progress, 1);
    assert.equal((await db.worldQuest.findUniqueOrThrow({ where: { worldId_questId: { worldId: guest.worldId, questId: "first-gift" } } })).progress, 0);
    assert.equal((await quest(host, "claim", "first-gift")).status, 409); // must return to Daon
    await walk(host, 845, 640);
    const before = (await get(host, "/api/economy")).wallet;
    const claims = await Promise.all([quest(host, "claim", "first-gift"), quest(host, "claim", "first-gift")]);
    assert.ok(claims.every((r) => r.status === 200));
    assert.deepEqual((await Promise.all(claims.map((r) => r.json()))).map((r) => r.claimed).sort(), [false, true]);
    let wallet = (await get(host, "/api/economy")).wallet;
    assert.equal(wallet.conch, before.conch + 160); assert.equal(wallet.shell, before.shell + 500);
    await quest(host, "claim", "first-gift"); assert.deepEqual((await get(host, "/api/economy")).wallet, wallet);
    await post(guest, "/api/social/leave", {});
    const priorBattle = await fight(host); // a win before accepting must not count
    await walk(host, 845, 640);
    assert.equal((await quest(host, "accept", "coast-guardian")).status, 200);
    assert.equal((await get(host)).quests.find((q: any) => q.id === "coast-guardian").progress, 0);
    assert.equal((await post(host, "/api/battle/action", { battleId: priorBattle.id, expectedVersion: priorBattle.version - 1, action: { type: "defend" } })).status, 409);
    await fight(host, async () => {
      assert.equal((await post(host, "/api/story/talk", { worldId: host.worldId, npcId: "daon" })).status, 409);
      assert.equal((await quest(host, "accept", "coast-guardian")).status, 409);
      assert.equal((await quest(host, "claim", "first-gift")).status, 409);
    });
    assert.equal((await get(host)).quests.find((q: any) => q.id === "coast-guardian").state, "ready");
    // A real reconnect restores progress without changing wallet or rewarding again.
    host.socket.disconnect();
    await new Promise((r) => setTimeout(r, 80));
    await new Promise<void>((resolve) => { host.socket.once("world:ready", () => resolve()); host.socket.connect(); });
    assert.equal((await get(host)).quests[0].state, "claimed");
    await walk(host, 845, 640); assert.equal((await quest(host, "claim", "coast-guardian")).status, 200);
    // Mixed normalized and legacy discoveries are deduplicated and unknown IDs ignored.
    await db.world.update({ where: { id: host.worldId }, data: { progress: { chests: ["coast-1", "grove-1", "unknown-chest"] } } });
    await walk(host, 900, 740); await walk(host, 1210, 740); await walk(host, 1210, 700);
    assert.equal((await quest(host, "accept", "coastal-map")).status, 200);
    assert.equal((await get(host)).quests.find((q: any) => q.id === "coastal-map").progress, 2);
    await walk(host, 1260, 800); assert.equal((await post(host, "/api/world/chest", { worldId: host.worldId, chestId: "harbor-1" })).status, 200);
    await walk(host, 1210, 700); assert.equal((await quest(host, "claim", "coastal-map")).status, 200);
    assert.ok((await get(host)).quests.filter((q: any) => ["first-gift", "coast-guardian", "coastal-map"].includes(q.id)).every((q: any) => q.state === "claimed"));
    assert.equal((await get(host)).quests.find((q: any) => q.id === "sanctuary-song").state, "locked");
    assert.equal((await get(guest)).quests[0].state, "active");
    assert.equal((await get(guest)).quests[0].progress, 0);
    await assert.rejects(db.worldQuest.update({ where: { worldId_questId: { worldId: guest.worldId, questId: "first-gift" } }, data: { progress: -1 } }));
    await assert.rejects(db.worldQuest.update({ where: { worldId_questId: { worldId: guest.worldId, questId: "first-gift" } }, data: { claimedAt: new Date() } }));
  } finally {
    for (const u of users) u.socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    try { await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }); } finally { await db.$disconnect(); }
  }
});
