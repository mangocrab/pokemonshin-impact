import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import type { BattleState } from "../shared/combat";

test("server results drive battle effects without replay, blocking input or ignoring motion preferences", async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const db = new PrismaClient(), errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const u = await db.user.create({ data: { username: `webVfx_${testInfo.project.name}_${Date.now()}`, nickname: "별빛 여행자", passwordHash: "fixture-unused", world: { create: {} } } });
  try {
    const token = randomBytes(32).toString("hex");
    await db.session.create({ data: { userId: u.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
    await context.addCookies([{ name: "solara", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
    await page.goto("/"); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    const fight = page.getByRole("dialog", { name: "산호 해안 전투", exact: true });
    const field = fight.locator(".battle-field");
    const state = async (): Promise<BattleState> => (await (await page.request.get("/api/battle")).json()).battle;
    const act = async (name: RegExp): Promise<BattleState> => {
      const response = page.waitForResponse((r) => r.url().endsWith("/api/battle/action") && r.request().method() === "POST");
      await fight.getByRole("button", { name }).click();
      const r = await response; expect(r.status()).toBe(200);
      return (await r.json()).battle;
    };
    const start = async () => {
      await page.getByRole("button", { name: "산호 집게게와 전투", exact: true }).click();
      await expect(fight.getByRole("heading", { name: "1라운드 · 행동 선택", exact: true })).toBeVisible();
      await expect(field.locator(".result-chips")).toHaveCount(0);
    };
    await start();
    const before = await state(), after = await act(/^물결 쏘기/);
    const enemyChip = field.locator(".combatant").nth(1).locator('[data-result="damage"]');
    await expect(enemyChip).toHaveText(`HP −${before.enemy.hp - after.enemy.hp}`);
    await expect(field).toHaveAttribute("data-motion", "true");
    const water = field.locator('.skill-effect[data-skill="tide"]');
    await expect(water).toHaveAttribute("data-kind", "attack"); await expect(water).toHaveAttribute("data-element", "물");
    expect(after.skillCues?.find(c => c.skillId === "tide")).toMatchObject({ target: "enemy", hit: true });
    expect(await water.evaluate(node => getComputedStyle(node).pointerEvents)).toBe("none");
    expect(await water.evaluate(node => node.querySelector(".skill-caption")!.getBoundingClientRect().bottom
      <= node.closest(".combatant-art")!.getBoundingClientRect().bottom)).toBe(true);
    await field.screenshot({ path: testInfo.outputPath("resolved-water-skill.png") });
    await expect(field.locator(".result-chips")).toHaveCount(0, { timeout: 5000 });
    await expect(field.locator(".skill-effects")).toHaveCount(0);
    await page.evaluate((snapshot) => window.dispatchEvent(new CustomEvent("battle:state", { detail: snapshot })), after);
    await expect(field.locator(".result-chips")).toHaveCount(0); await expect(field.locator(".skill-effects")).toHaveCount(0);
    await page.reload(); await expect(fight).toBeVisible();
    await expect(field.locator(".result-chips")).toHaveCount(0); await expect(field.locator(".skill-effects")).toHaveCount(0);
    await act(/^도주/); await fight.getByRole("button", { name: "탐험으로 돌아가기", exact: true }).click();
    await start();
    let current = await state();
    for (let i = 0; i < 8 && current.team[0].energy < 100; i++) current = await act(/^방어/);
    await expect(fight.getByRole("button", { name: /^궁극기/ })).toBeEnabled();
    const ultimate = await act(/^궁극기/);
    const burst = field.locator(".burst-cut-in");
    await expect(burst).toContainText("바다가 품은 약속");
    await expect(burst).toHaveAttribute("data-character", "haerin");
    await expect(burst.locator(".burst-signature")).toHaveAttribute("data-signature", "tide");
    // Read transient presentation properties before a potentially slow software-rendered capture.
    expect(await burst.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
    expect(ultimate.team[0].energy).toBeLessThan(current.team[0].energy);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(field).toHaveAttribute("data-motion", "false");
    await expect(burst).toHaveCSS("animation-name", "none");
    await expect(burst.locator(".burst-core")).toHaveCSS("animation-name", "none");
    await field.screenshot({ path: testInfo.outputPath("celestial-ultimate.png") });
    // Presentation never locks the next action, even after the cut-in expires.
    await act(/^도주/); await fight.getByRole("button", { name: "탐험으로 돌아가기", exact: true }).click();
    const prefs = await (await page.request.get("/api/settings")).json();
    const { revision, ...values } = prefs;
    expect((await page.request.put("/api/settings", { data: { ...values, quality: "low", reducedMotion: true, expectedRevision: revision } })).status()).toBe(200);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload(); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await start(); await act(/^물결 쏘기/);
    await expect(field).toHaveAttribute("data-motion", "false");
    await expect(field).toHaveAttribute("data-effects", "false");
    await expect(enemyChip).toBeVisible();
    await expect(water.locator(".skill-aura")).toBeHidden();
    await expect(water.locator(".skill-caption")).toBeVisible(); await expect(water.locator(".skill-caption")).toHaveCSS("animation-name", "none");
    await expect(field.locator(".result-chips").first()).toHaveCSS("animation-name", "none");
    await expect(fight.locator(".health-track i").first()).toHaveCSS("transition-duration", "0s");
    await act(/^도주/);
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.delete({ where: { id: u.id } }); } finally { await db.$disconnect(); }
  }
});
