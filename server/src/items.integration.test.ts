import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
const base = process.env.TEST_BASE_URL;
type User = { id: string; username: string; cookie: string; socket: Socket };
async function user(db: PrismaClient, suffix: string): Promise<User> {
  const u = await db.user.create({ data: { username: "item_" + Date.now().toString(36) + suffix, nickname: "소지품 여행자", passwordHash: "fixture-unused", world: { create: {} } } });
  const token = randomBytes(32).toString("hex");
  await db.session.create({ data: { userId: u.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
  const socket = io(base!, { autoConnect: false, extraHeaders: { Cookie: "solara=" + token } });
  await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error("Connect timeout")), 4000); socket.once("world:ready", () => { clearTimeout(timeout); resolve(); }); socket.once("connect_error", reject); socket.connect(); });
  return { id: u.id, username: u.username, cookie: "solara=" + token, socket };
}
function post(u: User, path: string, data: unknown) { return fetch(base + path, { method: "POST", headers: { Cookie: u.cookie, "Content-Type": "application/json" }, body: JSON.stringify(data) }); }
async function get(u: User, path: string) { const r = await fetch(base + path, { headers: { Cookie: u.cookie } }); assert.equal(r.status, 200); return r.json(); }
async function quantity(db: PrismaClient, u: User, itemId = "summer-tonic") { return (await db.inventory.findUniqueOrThrow({ where: { userId_itemId: { userId: u.id, itemId } } })).quantity; }
async function cleanup(db: PrismaClient, users: User[]) { for (const u of users) u.socket.disconnect(); await new Promise((r) => setTimeout(r, 150)); try { await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }); } finally { await db.$disconnect(); } }
test("consumable purchases and solo actions commit once, validate ownership and roll back invalid spending", { skip: !base }, async () => {
  const db = new PrismaClient(), users: User[] = [];
  try {
    assert.equal((await fetch(base + "/api/battle/items")).status, 401);
    const a = await user(db, "a"), b = await user(db, "b"); users.push(a, b);
    await get(a, "/api/battle/items"); await get(b, "/api/battle/items");
    assert.equal(await quantity(db, a), 4); assert.equal(await quantity(db, a, "cleansing-salt"), 2);
    await get(a, "/api/battle/items"); assert.equal(await quantity(db, a), 4);
    const initial = await get(a, "/api/economy"), key = randomUUID();
    const buy = { itemId: "summer-tonic", count: 5, requestId: key, expectedRevision: initial.wallet.revision };
    const bought = await Promise.all([post(a, "/api/economy/supplies", buy), post(a, "/api/economy/supplies", buy)]);
    assert.ok(bought.every((r) => r.status === 200)); assert.equal(await quantity(db, a), 9);
    let wallet = (await get(a, "/api/economy")).wallet; assert.equal(wallet.shell, initial.wallet.shell - 750);
    assert.equal((await post(a, "/api/economy/supplies", { ...buy, count: 1 })).status, 409);
    for (const invalid of [{ ...buy, count: 0 }, { ...buy, count: 11 }, { ...buy, itemId: "training-book" }, { ...buy, userId: b.id }]) assert.equal((await post(a, "/api/economy/supplies", invalid)).status, 400);
    await db.wallet.update({ where: { userId: a.id }, data: { shell: 0 } });
    const insufficient = randomUUID(); assert.equal((await post(a, "/api/economy/supplies", { ...buy, count: 1, requestId: insufficient, expectedRevision: wallet.revision })).status, 409);
    assert.equal(await quantity(db, a), 9); assert.equal(await db.economyMutation.count({ where: { userId: a.id, requestId: insufficient } }), 0);
    await db.wallet.update({ where: { userId: a.id }, data: { shell: 10000 } });
    const start = await post(a, "/api/battle/start", { encounterId: "coral-crab" }); assert.equal(start.status, 200); let s = (await start.json()).battle;
    const act = (action: unknown, version = s.version) => post(a, "/api/battle/action", { battleId: s.id, expectedVersion: version, action });
    assert.equal((await act({ type: "item", itemId: "summer-tonic" })).status, 400);
    assert.equal((await act({ type: "item", itemId: "cleansing-salt" })).status, 400);
    assert.equal((await act({ type: "item", itemId: "training-book" })).status, 400);
    assert.equal((await act({ type: "item", itemId: "summer-tonic", userId: b.id })).status, 400);
    assert.equal(await quantity(db, a), 9);
    s = (await (await act({ type: "defend" })).json()).battle;
    const injured = s.team[s.activeSlot].hp, version = s.version;
    const used = await Promise.all([act({ type: "item", itemId: "summer-tonic" }, version), act({ type: "item", itemId: "summer-tonic" }, version)]);
    assert.deepEqual(used.map((r) => r.status).sort(), [200, 409]); s = (await used.find((r) => r.status === 200)!.json()).battle;
    assert.match(s.log.join(" "), new RegExp("HP " + (240 - injured) + " 회복"));
    assert.equal(s.round, 3); assert.equal(await quantity(db, a), 8); assert.equal(await quantity(db, b), 4); assert.equal(s.itemUses, undefined);
    assert.equal((await db.battle.findUniqueOrThrow({ where: { id: s.id } })).version, 2);
    await db.inventory.update({ where: { userId_itemId: { userId: a.id, itemId: "summer-tonic" } }, data: { quantity: 0 } });
    assert.equal((await act({ type: "item", itemId: "summer-tonic" })).status, 409); assert.equal((await get(a, "/api/battle")).battle.version, s.version);
    s.team[s.activeSlot].statuses = [{ id: "burn", expiresAfterRound: 8 }, { id: "slow", expiresAfterRound: 8 }]; s.team[s.activeSlot].cooldowns.reef = 9;
    await db.battle.update({ where: { id: s.id }, data: { state: s } });
    const clean = await act({ type: "item", itemId: "cleansing-salt" }); assert.equal(clean.status, 200); s = (await clean.json()).battle;
    assert.equal(await quantity(db, a, "cleansing-salt"), 1); assert.deepEqual(s.team[s.activeSlot].statuses, []); assert.equal(s.team[s.activeSlot].cooldowns.reef, 9);
    wallet = (await get(a, "/api/economy")).wallet;
    assert.equal((await post(a, "/api/economy/supplies", { itemId: "summer-tonic", count: 1, requestId: randomUUID(), expectedRevision: wallet.revision })).status, 409);
    assert.equal(await quantity(db, a), 0);
    assert.equal((await act({ type: "flee" })).status, 200);
    await get(a, "/api/battle/items"); assert.equal(await quantity(db, a), 0); assert.equal(await quantity(db, a, "cleansing-salt"), 1);
  } finally { await cleanup(db, users); }
});
test("co-op item choices charge only on execution, never on invalid last choice, cancellation or withdrawal", { skip: !base }, async () => {
  const db = new PrismaClient(), users: User[] = [];
  try {
    const host = await user(db, "h"), guest = await user(db, "g"); users.push(host, guest);
    for (const u of users) await get(u, "/api/battle/items");
    await post(host, "/api/social/access", { access: "request" }); await post(guest, "/api/social/request", { username: host.username });
    const entry = (await get(host, "/api/social")).entries.find((e: any) => e.incoming); await post(host, "/api/social/entry-answer", { id: entry.id, decision: "accept" });
    async function start() {
      const r = await post(host, "/api/coop/start", { encounterId: "coral-crab" }); assert.equal(r.status, 200); const id = (await r.json()).battle.id;
      assert.equal((await post(guest, "/api/coop/ready", { battleId: id })).status, 200);
      const row = await db.coopBattle.findUniqueOrThrow({ where: { id } }); const s: any = row.state;
      for (const m of s.members) m.state.team[0].hp = 100; s.enemy.blockedUntilRound = 1; s.enemy.attack = 1;
      await db.coopBattle.update({ where: { id }, data: { state: s } }); return id;
    }
    const command = (u: User, id: string, round: number, action: unknown) => post(u, "/api/coop/action", { battleId: id, expectedRound: round, action });
    let id = await start();
    assert.equal((await command(host, id, 1, { type: "item", itemId: "summer-tonic" })).status, 200);
    assert.equal(await quantity(db, host), 4); assert.equal(await quantity(db, guest), 4);
    assert.equal((await command(host, id, 1, { type: "item", itemId: "summer-tonic" })).status, 409);
    assert.equal((await command(guest, id, 1, { type: "item", itemId: "summer-tonic", userId: host.id })).status, 400);
    await db.inventory.update({ where: { userId_itemId: { userId: guest.id, itemId: "summer-tonic" } }, data: { quantity: 0 } });
    assert.equal((await command(guest, id, 1, { type: "item", itemId: "summer-tonic" })).status, 409);
    assert.equal(await quantity(db, host), 4); assert.equal(await db.coopRound.count({ where: { battleId: id } }), 0);
    assert.equal((await command(guest, id, 1, { type: "defend" })).status, 200);
    assert.equal(await quantity(db, host), 3); assert.equal(await quantity(db, guest), 0);
    let s: any = (await db.coopBattle.findUniqueOrThrow({ where: { id } })).state;
    assert.equal(s.round, 2); assert.equal(s.members.find((m: any) => m.userId === host.id).state.team[0].hp, 220); assert.ok(s.members.every((m: any) => m.state.itemUses === undefined));
    assert.equal((await command(host, id, 2, { type: "item", itemId: "summer-tonic" })).status, 200); assert.equal(await quantity(db, host), 3);
    assert.equal((await post(host, "/api/coop/leave", { battleId: id })).status, 200); assert.equal(await quantity(db, host), 3);
    await db.inventory.update({ where: { userId_itemId: { userId: guest.id, itemId: "summer-tonic" } }, data: { quantity: 1 } });
    id = await start();
    assert.equal((await command(guest, id, 1, { type: "item", itemId: "summer-tonic" })).status, 200);
    assert.equal((await post(guest, "/api/coop/leave", { battleId: id })).status, 200); assert.equal(await quantity(db, guest), 1);
    assert.equal((await command(host, id, 1, { type: "defend" })).status, 200); assert.equal(await quantity(db, host), 3); assert.equal(await quantity(db, guest), 1);
    assert.equal((await post(host, "/api/coop/leave", { battleId: id })).status, 200);
    assert.equal(await db.coopMember.count({ where: { userId: { in: users.map((u) => u.id) }, activeUserId: { not: null } } }), 0);
  } finally { await cleanup(db, users); }
});
