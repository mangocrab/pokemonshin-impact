import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
test("account quality and sound settings apply without reconnect and survive reload", async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const db = new PrismaClient(), errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    (window as any).__sounds = [];
    (window as any).AudioContext = class extends Original {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args); (window as any).__sounds.push(this);
      }
    };
  });
  const u = await db.user.create({ data: { username: `webPref_${Date.now()}`, nickname: "바닷바람", passwordHash: "fixture-unused", world: { create: {} } } });
  const token = randomBytes(32).toString("hex");
  await db.session.create({ data: { userId: u.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
  await context.addCookies([{ name: "solara", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
  const surface = page.locator(".game");
  async function open() {
    await page.getByRole("button", { name: "설정", exact: true }).click();
    return page.getByRole("dialog", { name: "설정", exact: true });
  }
  async function save() {
    const response = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT");
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(page.getByText("설정을 저장하고 적용했습니다.", { exact: true })).toBeVisible();
  }
  try {
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await expect(surface).toHaveAttribute("data-lighting", "true");
    expect(await page.evaluate(() => (window as any).__sounds.length)).toBe(0);
    await page.evaluate(() => { (window as any).__originalCanvas = document.querySelector("canvas"); });
    let panel = await open();
    await expect(panel.getByLabel("음소거", { exact: true })).toBeChecked();
    await panel.getByLabel("그래픽 품질", { exact: true }).selectOption("low");
    await panel.getByLabel("그림자", { exact: true }).uncheck();
    await panel.getByLabel("움직임 줄이기", { exact: true }).check();
    await panel.getByLabel("음소거", { exact: true }).uncheck();
    await panel.getByLabel("음량", { exact: true }).fill("23");
    await save();
    await expect(surface).toHaveAttribute("data-quality", "low");
    await expect(surface).toHaveAttribute("data-lighting", "false");
    await expect(surface).toHaveAttribute("data-shadows", "false");
    await expect(surface).toHaveAttribute("data-motion", "false");
    expect(await page.evaluate(() => document.querySelector("canvas") === (window as any).__originalCanvas)).toBe(true);
    await panel.getByRole("button", { name: "저장된 음량으로 소리 확인" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__sounds.at(-1)?.state)).toBe("running");
    await panel.getByLabel("음소거", { exact: true }).check(); await save();
    await expect.poll(() => page.evaluate(() => (window as any).__sounds.at(-1)?.state)).toBe("suspended");
    await page.screenshot({ path: testInfo.outputPath("settings.png") });
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await expect(surface).toHaveAttribute("data-quality", "low");
    await expect(surface).toHaveAttribute("data-motion", "false");
    panel = await open();
    await expect(panel.getByLabel("음량", { exact: true })).toHaveValue("23");
    await expect(panel.getByLabel("그림자", { exact: true })).not.toBeChecked();
    await panel.getByRole("button", { name: "기본값 선택", exact: true }).click(); await save();
    await expect(surface).toHaveAttribute("data-lighting", "true");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(surface).toHaveAttribute("data-motion", "false");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(surface).toHaveAttribute("data-motion", "true");
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("lit-coast.png") });
    // A stale edit cannot overwrite a newer tab's settings; explicit reload recovers.
    panel = await open();
    const latest = await (await page.request.get("/api/settings")).json();
    const { revision, ...values } = latest;
    expect((await page.request.put("/api/settings", { data: { ...values, volume: 71, expectedRevision: revision } })).status()).toBe(200);
    const stale = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT");
    await panel.getByRole("button", { name: "설정 저장", exact: true }).click();
    expect((await stale).status()).toBe(409);
    await expect(panel).toContainText("다른 창에서 설정이 변경되었습니다");
    await panel.getByRole("button", { name: "최신 설정 불러오기", exact: true }).click();
    await expect(panel.getByLabel("음량", { exact: true })).toHaveValue("71");
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.delete({ where: { id: u.id } }); } finally { await db.$disconnect(); }
  }
});
