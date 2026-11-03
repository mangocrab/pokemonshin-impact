import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { SANCTUARY } from "../shared/adventure";
test("friends challenge sanctuary together, see area intent, recover shared recharge and keep personal loot", async ({ browser }, testInfo) => {
  test.setTimeout(90000);
  const db = new PrismaClient(), users: { id: string; username: string; worldId: string; cookie: string }[] = [], contexts: BrowserContext[] = [], pages: Page[] = [], errors: string[] = [];
  let observer: Socket | undefined, position = { x: 800, y: 560 };
  const fight = (p: Page) => p.getByRole("dialog", { name: "산호 해안 전투", exact: true });
  async function walk(x: number, y: number) {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const dx = x - position.x, dy = y - position.y, d = Math.hypot(dx, dy);
      observer!.emit("world:move", d < 8 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d });
      if (d < 8) return; await new Promise((r) => setTimeout(r, 16));
    }
    throw new Error("Sanctuary approach blocked at " + JSON.stringify(position));
  }
  async function choose(p: Page, name: RegExp) {
    const response = p.waitForResponse((r) => r.url().endsWith("/api/coop/action") && r.request().method() === "POST");
    await fight(p).getByRole("button", { name }).click(); const r = await response; expect(r.status()).toBe(200); return (await r.json()).battle;
  }
  try {
    for (let i = 0; i < 2; i++) {
      const u = await db.user.create({ data: { username: "webBloomCo_" + Date.now().toString(36) + i, nickname: "안뜰 동료" + i, passwordHash: "fixture-unused", world: { create: { positionX: i === 0 ? 1870 : 800, positionY: i === 0 ? 720 : 560 } } }, include: { world: true } });
      const token = randomBytes(32).toString("hex"); await db.session.create({ data: { userId: u.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 240000) } });
      users.push({ id: u.id, username: u.username, worldId: u.world!.id, cookie: "solara=" + token });
      if (i === 0) await db.worldRegion.create({ data: { worldId: u.world!.id, regionId: SANCTUARY.id } });
      const context = await browser.newContext({ baseURL: "http://127.0.0.1:5173", viewport: testInfo.project.name === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: testInfo.project.name === "mobile" }); contexts.push(context);
      await context.addCookies([{ name: "solara", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
      const p = await context.newPage(); pages.push(p); p.on("pageerror", (e) => errors.push(e.message)); await p.goto("/"); await expect(p.getByRole("status")).toContainText("불러왔습니다", { timeout: 15000 });
    }
    const [host, guest] = pages;
    await host.request.post("/api/social/access", { data: { access: "request" } }); await guest.request.post("/api/social/request", { data: { username: users[0].username } });
    const entry = (await (await host.request.get("/api/social")).json()).entries.find((e: any) => e.incoming);
    expect((await host.request.post("/api/social/entry-answer", { data: { id: entry.id, decision: "accept" } })).status()).toBe(200);
    await expect(host.getByText("내 월드 · 2/4", { exact: true })).toBeVisible();
    // Real, server-validated movement setup; the guest's own region remains locked.
    observer = io("http://127.0.0.1:3001", { autoConnect: false, extraHeaders: { Cookie: users[1].cookie } });
    observer.on("world:position", (p) => { position = p; });
    await new Promise<void>((resolve, reject) => { observer!.once("world:ready", (r) => { position = r.position; resolve(); }); observer!.once("connect_error", reject); observer!.connect(); });
    await walk(800, 800); await walk(1870, 800); await walk(1870, 720); observer.disconnect();
    const wallets = await Promise.all(pages.map(async (p) => (await (await p.request.get("/api/economy")).json()).wallet));
    await host.getByRole("button", { name: "안뜰 협동 보스전 모집", exact: true }).click();
    await fight(guest).getByRole("button", { name: "협동 전투 참여", exact: true }).click();
    for (const p of pages) { await expect(fight(p).getByRole("heading", { name: "안뜰 만개지기", exact: true })).toBeVisible(); await expect(fight(p).getByLabel("적 행동 예고")).toContainText("모두를 공격"); }
    for (const p of pages) await choose(p, /태오/);
    for (const p of pages) await choose(p, /^방어/);
    for (const p of pages) await expect(fight(p).getByLabel("적 행동 예고")).toContainText("다음 행동: 한여름의 만개");
    const first = await choose(host, /^방어/); expect(first.round).toBe(3); expect(first.coop.submitted).toBe(true);
    const burst = await choose(guest, /^방어/); expect(burst.round).toBe(4); expect(burst.enemy.blockedUntilRound).toBe(4);
    expect(burst.log.filter((l: string) => l.includes("한여름의 만개:")).length).toBe(2);
    await guest.reload(); await expect(guest.getByRole("status")).toContainText("불러왔습니다");
    await expect(fight(guest).getByLabel("적 행동 예고")).toContainText("1라운드 행동 불가");
    await expect(fight(host).getByRole("heading", { name: "4라운드 · 행동 선택", exact: true })).toBeVisible();
    await expect(fight(guest).getByLabel("전투 기록")).toContainText("협동 전투를 재개");
    await guest.screenshot({ path: testInfo.outputPath("cooperative-bloom-recovery.png") });
    for (const p of pages) await choose(p, /^방어/);
    let s = (await (await host.request.get("/api/coop")).json()).battle;
    for (let n = 0; n < 15 && s.status === "active"; n++) { for (const p of pages) s = await choose(p, /^불씨 날리기/); }
    expect(s.status).toBe("won");
    for (let i = 0; i < pages.length; i++) {
      await expect(fight(pages[i]).getByRole("heading", { name: "승리", exact: true })).toBeVisible();
      const after = (await (await pages[i].request.get("/api/economy")).json()).wallet; expect(after.conch).toBe(wallets[i].conch + 40); expect(after.shell).toBe(wallets[i].shell + 500);
      expect(await db.worldRegion.count({ where: { worldId: users[i].worldId } })).toBe(i === 0 ? 1 : 0);
    }
    await host.screenshot({ path: testInfo.outputPath("cooperative-bloom-victory.png") }); expect(errors).toEqual([]);
  } finally {
    observer?.disconnect(); for (const p of pages) await p.request.post("/api/logout").catch(() => {}); for (const c of contexts) await c.close().catch(() => {});
    try { await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }); } finally { await db.$disconnect(); }
  }
});
