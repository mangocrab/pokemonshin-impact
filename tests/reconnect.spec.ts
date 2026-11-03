import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
test("guest reload preserves pending item, host reload returns guest safely and explicit resume continues once", async ({ browser }, testInfo) => {
  test.setTimeout(90000);
  const db = new PrismaClient(), contexts: BrowserContext[] = [], pages: Page[] = [], users: { id: string; username: string }[] = [], errors: string[] = [];
  const fight = (p: Page) => p.getByRole("dialog", { name: "산호 해안 전투", exact: true });
  const tonic = (p: Page) => fight(p).getByRole("region", { name: "전투 아이템", exact: true }).getByRole("button", { name: /^여름 과즙/ });
  async function ready(p: Page) { await expect(p.getByRole("status")).toContainText("불러왔습니다", { timeout: 15000 }); }
  async function normal(p: Page, round: number) { await expect(fight(p).getByRole("heading", { name: `${round}라운드 · 행동 선택`, exact: true })).toBeVisible(); }
  async function quantity() { return (await db.inventory.findUniqueOrThrow({ where: { userId_itemId: { userId: users[0].id, itemId: "summer-tonic" } } })).quantity; }
  try {
    for (let i = 0; i < 2; i++) {
      const u = await db.user.create({ data: { username: "webResume_" + Date.now().toString(36) + i, nickname: "복귀 동료" + i, passwordHash: "fixture-unused", world: { create: {} } } }); users.push(u);
      const raw = randomBytes(32).toString("hex"); await db.session.create({ data: { userId: u.id, id: createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
      const context = await browser.newContext({ baseURL: "http://127.0.0.1:5173", viewport: testInfo.project.name === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: testInfo.project.name === "mobile" }); contexts.push(context);
      await context.addCookies([{ name: "solara", value: raw, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
      const p = await context.newPage(); pages.push(p); p.on("pageerror", (e) => errors.push(e.message)); await p.goto("/"); await ready(p);
    }
    const [h, g] = pages;
    await h.request.post("/api/social/access", { data: { access: "request" } }); await g.request.post("/api/social/request", { data: { username: users[0].username } });
    const entry = (await (await h.request.get("/api/social")).json()).entries.find((e: any) => e.incoming);
    expect((await h.request.post("/api/social/entry-answer", { data: { id: entry.id, decision: "accept" } })).status()).toBe(200);
    await h.getByRole("button", { name: "협동 보스전 모집", exact: true }).click();
    await fight(g).getByRole("button", { name: "협동 전투 참여", exact: true }).click(); await normal(h, 1); await normal(g, 1);
    const current = (await (await h.request.get("/api/coop")).json()).battle;
    const row = await db.coopBattle.findUniqueOrThrow({ where: { id: current.id } }); const s: any = row.state;
    for (const m of s.members) m.state.team[0].hp = 100; s.enemy.blockedUntilRound = 1; s.enemy.attack = 1;
    await db.coopBattle.update({ where: { id: current.id }, data: { state: s } });
    await h.reload(); await ready(h);
    await expect(fight(g).getByRole("region", { name: "협동 재접속", exact: true })).toBeVisible();
    await fight(g).getByRole("button", { name: "협동 전투 복귀", exact: true }).click(); await normal(h, 1); await normal(g, 1);
    const response = h.waitForResponse((r) => r.url().endsWith("/api/coop/action") && r.request().method() === "POST");
    await tonic(h).click(); expect((await response).status()).toBe(200); expect(await quantity()).toBe(4);
    await g.reload(); await ready(g); await normal(g, 1);
    expect((await (await h.request.get("/api/coop")).json()).battle.coop.submitted).toBe(true); expect(await quantity()).toBe(4);
    await fight(g).getByRole("button", { name: /^방어/ }).click(); await normal(h, 2); await normal(g, 2);
    await expect(tonic(h)).toContainText("3개"); expect(await quantity()).toBe(3);
    expect(await db.coopRound.count({ where: { battleId: current.id } })).toBe(1);
    await h.reload(); await ready(h);
    await expect(g.getByText("내 월드 · 1/4", { exact: true })).toBeVisible();
    await expect(fight(g).getByRole("region", { name: "협동 재접속", exact: true })).toBeVisible();
    await pageShot(g, "parked-for-recovery.png");
    await fight(g).getByRole("button", { name: "협동 전투 복귀", exact: true }).click(); await normal(h, 2); await normal(g, 2);
    expect((await (await g.request.get("/api/social")).json()).currentWorld.isOwner).toBe(false);
    expect(await quantity()).toBe(3);
    const pending = h.waitForResponse((r) => r.url().endsWith("/api/coop/action") && r.request().method() === "POST"); await tonic(h).click(); expect((await pending).status()).toBe(200);
    await fight(h).getByRole("button", { name: "협동 전투 취소", exact: true }).click();
    await expect(fight(h).getByRole("heading", { name: "전투 종료", exact: true })).toBeVisible(); expect(await quantity()).toBe(3);
    expect(errors).toEqual([]);
    async function pageShot(p: Page, name: string) { await p.screenshot({ path: testInfo.outputPath(name) }); }
  } finally {
    for (const p of pages) await p.request.post("/api/logout").catch(() => {});
    for (const c of contexts) await c.close().catch(() => {});
    try { await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }); } finally { await db.$disconnect(); }
  }
});
