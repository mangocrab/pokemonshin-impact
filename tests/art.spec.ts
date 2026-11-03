import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { CHARACTERS } from "../shared/combat";
test("painted atlases render every owned hero, world and enemy with working battle controls", async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const db = new PrismaClient(), errors: string[] = [], missing: string[] = [];
  const u = await db.user.create({ data: { username: "webArt_" + Date.now().toString(36), nickname: "파도빛 여행자", passwordHash: "fixture-unused", world: { create: {} } } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.url().includes("/art/") && r.status() >= 400) missing.push(r.url()); });
  try {
    const token = randomBytes(32).toString("hex"); await db.session.create({ data: { userId: u.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
    await context.addCookies([{ name: "solara", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
    await page.request.get("/api/training");
    await db.userCharacter.createMany({ data: CHARACTERS.slice(4).map((c) => ({ userId: u.id, characterId: c.id })), skipDuplicates: true });
    await page.goto("/"); await expect(page.getByRole("status")).toContainText("불러왔습니다", { timeout: 15000 });
    expect(await page.evaluate(async () => {
      return Promise.all(["heroes", "world", "terrain"].map((id) => new Promise<boolean>((resolve) => { const img = new Image(); img.onload = () => resolve(img.naturalWidth > 1000); img.onerror = () => resolve(false); img.src = `/art/${id}.webp`; })));
    })).toEqual([true, true, true]);
    await page.screenshot({ path: testInfo.outputPath("painted-coast.png") });
    await page.getByRole("button", { name: "캐릭터", exact: true }).click();
    const characters = page.getByRole("dialog", { name: "캐릭터", exact: true });
    const frames = new Set<string>();
    for (const c of CHARACTERS) {
      await characters.getByRole("button", { name: new RegExp(`^${c.name} · Lv`) }).click();
      const art = characters.getByRole("img", { name: `${c.name} 일러스트`, exact: true });
      await expect(art).toBeVisible(); frames.add((await art.getAttribute("viewBox"))!);
      await expect(art.locator("image")).toHaveAttribute("href", "/art/heroes.webp");
    }
    expect(frames.size).toBe(8);
    await page.screenshot({ path: testInfo.outputPath("painted-character.png") });
    await characters.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "캐릭터 뽑기", exact: true }).click();
    const banner = page.getByRole("dialog", { name: "캐릭터 뽑기", exact: true });
    await expect(banner.getByRole("img", { name: "미라 픽업 일러스트", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("painted-banner.png") });
    await banner.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "산호 집게게와 전투", exact: true }).click();
    const battle = page.getByRole("dialog", { name: "산호 해안 전투", exact: true });
    await expect(battle.getByRole("img", { name: "해린 일러스트", exact: true })).toBeVisible();
    await expect(battle.getByRole("img", { name: "산호 집게게 일러스트", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("painted-battle.png") });
    const response = page.waitForResponse((r) => r.url().endsWith("/api/battle/action") && r.request().method() === "POST");
    await battle.getByRole("button", { name: /^도주/ }).click(); expect((await response).status()).toBe(200);
    await expect(battle.getByRole("heading", { name: "도주 완료", exact: true })).toBeVisible();
    expect(missing).toEqual([]); expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.delete({ where: { id: u.id } }); } finally { await db.$disconnect(); }
  }
});
