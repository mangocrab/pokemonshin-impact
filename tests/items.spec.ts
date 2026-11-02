import { test, expect, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
test("buy supplies, use healing and cleanse, enforce recharge and restore consumed quantities", async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  const db = new PrismaClient(), errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const user = await db.user.create({ data: { username: `webItem_${Date.now()}`, nickname: "보급 여행자", passwordHash: "fixture-unused", world: { create: {} } } });
  const token = randomBytes(32).toString("hex"); await db.session.create({ data: { userId: user.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
  await context.addCookies([{ name: "solara", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
  const battle = page.getByRole("dialog", { name: "산호 해안 전투", exact: true });
  async function action(button: Locator) {
    const response = page.waitForResponse((r) => r.url().endsWith("/api/battle/action") && r.request().method() === "POST");
    await button.click(); const r = await response; expect(r.status()).toBe(200); return (await r.json()).battle;
  }
  const tonic = () => battle.getByRole("region", { name: "전투 아이템", exact: true }).getByRole("button", { name: /^여름 과즙/ });
  const salt = () => battle.getByRole("region", { name: "전투 아이템", exact: true }).getByRole("button", { name: /^정화 소금/ });
  try {
    await page.goto("/"); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await page.getByRole("button", { name: "인벤토리", exact: true }).click();
    let inventory = page.getByRole("dialog", { name: "인벤토리", exact: true });
    let shop = inventory.getByRole("region", { name: "전투 소모품 보급", exact: true }); await expect(shop).toContainText("여름 과즙 · 보유 4개");
    const buy = page.waitForResponse((r) => r.url().endsWith("/api/economy/supplies") && r.request().method() === "POST");
    await shop.getByRole("button", { name: "여름 과즙 1개 구입", exact: true }).click(); expect((await buy).status()).toBe(200);
    await expect(shop).toContainText("여름 과즙 · 보유 5개"); await expect(page.getByLabel("보유 재화")).toContainText("9,850");
    await inventory.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "산호 집게게와 전투", exact: true }).click();
    await expect(tonic()).toContainText("5개"); await expect(tonic()).toBeDisabled(); await expect(salt()).toBeDisabled();
    await action(battle.getByRole("button", { name: /^방어/ }));
    await expect(tonic()).toBeEnabled(); let current = await action(tonic());
    await expect(tonic()).toContainText("4개"); expect(current.log.join(" ")).toContain("여름 과즙"); expect(current.log.join(" ")).toContain("아이템1개 소비"); expect(current.round).toBe(3);
    await action(battle.getByRole("button", { name: /^거센 파도/ }));
    await expect(tonic()).toBeDisabled(); await expect(salt()).toBeDisabled();
    await page.reload(); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await expect(tonic()).toContainText("4개"); await expect(tonic()).toBeDisabled();
    current = await action(battle.getByRole("button", { name: /^행동 불가/ }));
    // Seed deterministic statuses to exercise cleanse UI without depending on enemy RNG.
    current.team[current.activeSlot].hp = 100;
    current.team[current.activeSlot].statuses = [{ id: "burn", expiresAfterRound: current.round + 3 }, { id: "slow", expiresAfterRound: current.round + 3 }];
    current.enemy.blockedUntilRound = current.round;
    await db.battle.update({ where: { id: current.id }, data: { state: current } });
    await page.reload(); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await expect(salt()).toBeEnabled(); current = await action(salt());
    expect(current.team[current.activeSlot].statuses).toEqual([]); expect(current.team[current.activeSlot].hp).toBe(100);
    await expect(salt()).toContainText("1개"); await expect(salt()).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("battle-items.png") });
    await action(battle.getByRole("button", { name: /^도주/ }));
    await battle.getByRole("button", { name: "탐험으로 돌아가기", exact: true }).click();
    await page.getByRole("button", { name: "인벤토리", exact: true }).click();
    inventory = page.getByRole("dialog", { name: "인벤토리", exact: true }); shop = inventory.getByRole("region", { name: "전투 소모품 보급", exact: true });
    await expect(shop).toContainText("여름 과즙 · 보유 4개"); await expect(shop).toContainText("정화 소금 · 보유 1개");
    await page.screenshot({ path: testInfo.outputPath("supply-shop.png") });
    expect((await db.inventory.findUniqueOrThrow({ where: { userId_itemId: { userId: user.id, itemId: "summer-tonic" } } })).quantity).toBe(4);
    expect((await db.inventory.findUniqueOrThrow({ where: { userId_itemId: { userId: user.id, itemId: "cleansing-salt" } } })).quantity).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.delete({ where: { id: user.id } }); } finally { await db.$disconnect(); }
  }
});
