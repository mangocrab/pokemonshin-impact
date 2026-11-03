import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
const base = process.env.TEST_BASE_URL;
async function eventually(fn: () => Promise<boolean>, timeout = 8000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error("Recovery condition timed out"); }
type User = { id: string; username: string; worldId: string; cookie: string; socket: Socket; world: string };
async function connect(u: User) { await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Connect timeout")), 5000); u.socket.once("world:ready", () => { clearTimeout(timer); resolve(); }); u.socket.once("connect_error", reject); u.socket.connect(); }); }
async function fixture(db: PrismaClient, url: string) {
  const users: User[] = [];
  for (let i = 0; i < 2; i++) {
    const row = await db.user.create({ data: { username: "resume_" + Date.now().toString(36) + i, nickname: "복귀" + i, passwordHash: "fixture-unused", world: { create: {} } }, include: { world: true } });
    const raw = randomBytes(32).toString("hex"); await db.session.create({ data: { userId: row.id, id: createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
    const u: User = { id: row.id, username: row.username, worldId: row.world!.id, cookie: "solara=" + raw, socket: io(url, { autoConnect: false, extraHeaders: { Cookie: "solara=" + raw } }), world: "" }; users.push(u);
    u.socket.on("world:ready", (r) => { u.world = r.worldId; }); await connect(u);
  }
  return users;
}
function api(url: string) {
  const post = (u: User, path: string, data: unknown) => fetch(url + path, { method: "POST", headers: { Cookie: u.cookie, "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const get = async (u: User, path: string) => { const r = await fetch(url + path, { headers: { Cookie: u.cookie } }); assert.equal(r.status, 200); return r.json(); };
  return { post, get };
}
async function join(db: PrismaClient, url: string, users: User[]) {
  const [h, g] = users, { post, get } = api(url);
  await post(h, "/api/social/access", { access: "request" }); await post(g, "/api/social/request", { username: h.username });
  const entry = (await get(h, "/api/social")).entries.find((e: any) => e.incoming);
  assert.equal((await post(h, "/api/social/entry-answer", { id: entry.id, decision: "accept" })).status, 200);
  const start = await post(h, "/api/coop/start", { encounterId: "coral-crab" }); assert.equal(start.status, 200);
  const id = (await start.json()).battle.id; assert.equal((await post(g, "/api/coop/ready", { battleId: id })).status, 200);
  for (const u of users) await get(u, "/api/battle/items");
  const s: any = (await db.coopBattle.findUniqueOrThrow({ where: { id } })).state;
  for (const m of s.members) m.state.team[0].hp = 100; s.enemy.blockedUntilRound = 1;
  await db.coopBattle.update({ where: { id }, data: { state: s } }); return id;
}
async function quantity(db: PrismaClient, u: User) { return (await db.inventory.findUniqueOrThrow({ where: { userId_itemId: { userId: u.id, itemId: "summer-tonic" } } })).quantity; }
test("disconnect grace restores choices and items, parks visitors safely and expires or cancels explicit departures", { skip: !base }, async () => {
  const db = new PrismaClient(); let users: User[] = [];
  const { post, get } = api(base!);
  const state = async (id: string): Promise<any> => (await db.coopBattle.findUniqueOrThrow({ where: { id } })).state;
  try {
    users = await fixture(db, base!); const [h, g] = users; let id = await join(db, base!, users);
    const act = (u: User, round: number, action: unknown) => post(u, "/api/coop/action", { battleId: id, expectedRound: round, action });
    assert.equal((await act(h, 1, { type: "item", itemId: "summer-tonic" })).status, 200);
    g.socket.disconnect(); await eventually(async () => Boolean((await state(id)).members.find((m: any) => m.userId === g.id).reconnectUntil));
    assert.equal((await state(id)).round, 1); assert.equal(await quantity(db, h), 4);
    assert.equal((await act(h, 1, { type: "defend" })).status, 409);
    await connect(g); await eventually(async () => !(await get(h, "/api/coop")).battle.coop.paused);
    assert.equal(g.world, h.worldId); assert.equal((await state(id)).round, 1); assert.equal(await quantity(db, h), 4);
    assert.equal((await act(g, 1, { type: "defend" })).status, 200); assert.equal(await quantity(db, h), 3);
    assert.equal(await db.coopRound.count({ where: { battleId: id } }), 1);
    assert.equal((await act(h, 1, { type: "item", itemId: "summer-tonic" })).status, 409);
    h.socket.disconnect(); await eventually(async () => g.world === g.worldId);
    assert.equal((await post(g, "/api/coop/resume", { battleId: id })).status, 409);
    await connect(h); assert.equal((await post(g, "/api/coop/resume", { battleId: id })).status, 200);
    assert.equal(g.world, h.worldId); assert.equal((await state(id)).round, 2); assert.equal(await quantity(db, h), 3);
    assert.equal((await act(g, 2, { type: "item", itemId: "summer-tonic" })).status, 200);
    g.socket.disconnect(); await eventually(async () => Boolean((await state(id)).members.find((m: any) => m.userId === g.id).reconnectUntil));
    let s = await state(id); s.members.find((m: any) => m.userId === g.id).reconnectUntil = Date.now() - 10;
    s.deadline = Date.now() - 10;
    await db.coopBattle.update({ where: { id }, data: { state: s, deadline: new Date(Date.now() - 1) } });
    await eventually(async () => !(await db.coopMember.findUnique({ where: { activeUserId: g.id } })));
    assert.ok((await state(id)).deadline > Date.now() + 55000, "remaining players receive a fresh round deadline after recovery expires");
    assert.equal(await quantity(db, g), 4); await connect(g); assert.equal(g.world, g.worldId);
    assert.equal((await post(g, "/api/coop/resume", { battleId: id })).status, 403);
    await post(h, "/api/coop/leave", { battleId: id });
    id = await join(db, base!, users); h.socket.disconnect(); await eventually(async () => g.world === g.worldId);
    assert.equal((await post(h, "/api/social/access", { access: "blocked" })).status, 200);
    await eventually(async () => (await state(id)).status === "abandoned"); await connect(h);
    id = await join(db, base!, users); h.socket.disconnect(); await eventually(async () => g.world === g.worldId);
    s = await state(id); for (const m of s.members) m.reconnectUntil = Date.now() - 10;
    await db.coopBattle.update({ where: { id }, data: { state: s, deadline: new Date(Date.now() - 1) } });
    await eventually(async () => (await state(id)).status === "abandoned");
    assert.equal(await db.coopMember.count({ where: { battleId: id, activeUserId: { not: null } } }), 0);
    await connect(h); id = await join(db, base!, users);
    assert.equal((await post(h, "/api/logout", {})).status, 200);
    await eventually(async () => (await state(id)).status === "abandoned" && g.world === g.worldId);
  } finally {
    for (const u of users) u.socket.disconnect(); await new Promise((r) => setTimeout(r, 100));
    try { await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }); } finally { await db.$disconnect(); }
  }
});
test("actual server crash and restart recover pending choices without replaying committed item consumption", { skip: !base || !process.env.DATABASE_URL }, async () => {
  const root = new PrismaClient(), schema = "recovery_" + Date.now().toString(36);
  const databaseUrl = new URL(process.env.DATABASE_URL!); databaseUrl.searchParams.set("schema", schema);
  const db = new PrismaClient({ datasourceUrl: databaseUrl.toString() }); let child: ChildProcess | undefined, users: User[] = [], logs = "";
  const port = await new Promise<number>((resolve) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const n = (s.address() as { port: number }).port; s.close(() => resolve(n)); }); });
  const url = `http://127.0.0.1:${port}`, { post, get } = api(url);
  async function boot() {
    child = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl.toString(), PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (s) => { logs = (logs + s).slice(-6000); }); child.stderr?.on("data", (s) => { logs = (logs + s).slice(-6000); });
    await eventually(async () => { try { return (await fetch(url + "/api/health")).ok; } catch { return false; } }, 10000);
  }
  async function kill() { if (child && child.exitCode === null && child.signalCode === null) { const stopped = new Promise<void>((resolve) => child!.once("exit", () => resolve())); child.kill("SIGKILL"); await stopped; } }
  try {
    await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl.toString() }, stdio: "pipe", timeout: 30000 });
    await boot(); users = await fixture(db, url); const [h, g] = users, id = await join(db, url, users);
    const act = (u: User, action: unknown, round = 1) => post(u, "/api/coop/action", { battleId: id, expectedRound: round, action });
    assert.equal((await act(h, { type: "item", itemId: "summer-tonic" })).status, 200); assert.equal(await quantity(db, h), 4);
    await kill(); for (const u of users) u.socket.disconnect(); await boot(); await connect(h); await connect(g);
    let s: any = (await db.coopBattle.findUniqueOrThrow({ where: { id } })).state;
    assert.equal(s.round, 1); assert.equal(s.members.find((m: any) => m.userId === h.id).choice.type, "item"); assert.equal(await quantity(db, h), 4); assert.equal(g.world, h.worldId);
    assert.equal((await act(g, { type: "defend" })).status, 200); assert.equal(await quantity(db, h), 3);
    await kill(); for (const u of users) u.socket.disconnect(); await boot(); await connect(h); await connect(g);
    s = (await db.coopBattle.findUniqueOrThrow({ where: { id } })).state;
    assert.equal(s.round, 2); assert.equal(await quantity(db, h), 3); assert.equal(await db.coopRound.count({ where: { battleId: id } }), 1);
    assert.equal((await act(h, { type: "item", itemId: "summer-tonic" }, 1)).status, 409);
    assert.equal((await get(g, "/api/coop")).battle.coop.paused, false);
  } catch (e) { throw new Error(`${e instanceof Error ? e.stack : e}\nIsolated server log: ${logs}`); }
  finally {
    for (const u of users) u.socket.disconnect(); await kill(); await db.$disconnect();
    try { await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await root.$disconnect(); }
  }
});
