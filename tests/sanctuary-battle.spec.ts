import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { SANCTUARY } from "../shared/adventure";
test("challenge bloom in unlocked sanctuary, react to its intent, restore recharge and win personal rewards", async ({ page, context }, testInfo) => {
  const db = new PrismaClient(), errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const u = await db.user.create({ data: { username: "webBloom_" + Date.now().toString(36), nickname: "꽃등 여행자", passwordHash: "fixture-unused", world: { create: { positionX: 1870, positionY: 720 } } }, include: { world: true } });
  try {
    await db.worldRegion.create({ data: { worldId: u.world!.id, regionId: SANCTUARY.id } });
    const token = randomBytes(32).toString("hex"); await db.session.create({ data: { userId: u.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
    await context.addCookies([{ name: "solara", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
    await page.goto("/"); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await page.getByRole("button", { name: "지역 지도", exact: true }).click();
    const map = page.getByRole("dialog", { name: "지역 지도", exact: true }); await expect(map).toContainText("꽃등지기"); await map.getByRole("button", { name: "닫기", exact: true }).click();
    const wallet = (await (await page.request.get("/api/economy")).json()).wallet;
    await page.getByRole("button", { name: "안뜰 꽃등지기와 전투", exact: true }).click();
    const fight = page.getByRole("dialog", { name: "산호 해안 전투", exact: true }), intent = fight.getByLabel("적 행동 예고");
    async function choose(name: RegExp) {
      const response = page.waitForResponse((r) => r.url().endsWith("/api/battle/action") && r.request().method() === "POST");
      await fight.getByRole("button", { name }).click(); const r = await response; expect(r.status()).toBe(200); return (await r.json()).battle;
    }
    await expect(intent).toContainText("다음 행동: 잎새 바람");
    await choose(/태오/); await expect(intent).toContainText("다음 행동: 휘감는 줄기");
    await choose(/^방어/); await expect(intent).toContainText("다음 행동: 한여름의 만개");
    await expect(intent.getByText("다음 행동: 한여름의 만개", { exact: true })).toBeInViewport({ ratio: 1 });
    expect(await intent.evaluate((el) => el.getBoundingClientRect().width / el.closest("article")!.getBoundingClientRect().width)).toBeGreaterThan(0.8);
    await page.screenshot({ path: testInfo.outputPath("bloom-intent.png") });
    const s = await choose(/^방어/); expect(s.round).toBe(4); expect(s.enemy.blockedUntilRound).toBe(4);
    await page.reload(); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await expect(intent).toContainText("다음 행동: 기술 반동으로 1라운드 행동 불가");
    await expect(fight.getByRole("progressbar", { name: "태오 HP", exact: true })).toHaveAttribute("aria-valuenow", String(s.team[3].hp));
    const rested = await choose(/^방어/); expect(rested.team[3].hp).toBe(s.team[3].hp);
    let current = rested;
    for (let i = 0; i < 20 && current.status === "active"; i++) current = await choose(/^불씨 날리기/);
    expect(current.status).toBe("won"); await expect(fight.getByRole("heading", { name: "승리", exact: true })).toBeVisible();
    const after = (await (await page.request.get("/api/economy")).json()).wallet; expect(after.conch).toBe(wallet.conch + 20); expect(after.shell).toBe(wallet.shell + 250);
    await page.screenshot({ path: testInfo.outputPath("bloom-victory.png") });
    await fight.getByRole("button", { name: "탐험으로 돌아가기", exact: true }).click();
    await expect(page.getByRole("button", { name: "안뜰 꽃등지기와 전투", exact: true })).toBeVisible(); expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.delete({ where: { id: u.id } }); } finally { await db.$disconnect(); }
  }
});
