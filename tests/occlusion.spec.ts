import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

test("height-aware receiving shadows follow the player, independent settings and low-quality fallback", async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  const db = new PrismaClient(), errors: string[] = [];
  const u = await db.user.create({ data: { username: `webShade_${testInfo.project.name}_${Date.now()}`, nickname: "그늘 산책자", passwordHash: "fixture-unused", world: { create: { positionX: 1190, positionY: 700 } } } });
  page.on("pageerror", (e) => errors.push(e.message));
  const surface = page.locator(".game");
  const receiving = () => surface.evaluate((el) => JSON.parse((el as HTMLElement).dataset.travelerOcclusion!));
  const relief = () => surface.evaluate((el) => JSON.parse((el as HTMLElement).dataset.objectRelief!));
  async function open() { await page.getByRole("button", { name: "설정", exact: true }).click(); return page.getByRole("dialog", { name: "설정", exact: true }); }
  async function save() {
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    await expect(page.getByText("설정을 저장하고 적용했습니다.", { exact: true })).toBeVisible();
    await page.getByRole("dialog", { name: "설정", exact: true }).getByRole("button", { name: "닫기", exact: true }).click();
  }
  try {
    const token = randomBytes(32).toString("hex");
    await db.session.create({ data: { userId: u.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 240000) } });
    await context.addCookies([{ name: "solara", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
    await page.goto("/"); await expect(page.getByRole("status")).toContainText("불러왔습니다", { timeout: 15000 });
    await expect.poll(async () => (await receiving()).coverage).toBeGreaterThan(.05);
    expect((await receiving()).coverage).toBeLessThan(.95);
    expect((await relief()).occlusion.volumes).toBe(18);
    let panel = await open(); await panel.getByLabel("움직임 줄이기", { exact: true }).check(); await panel.getByLabel("환경 효과", { exact: true }).uncheck(); await save();
    const cached = (await relief()).occlusion;
    expect(cached.screenReceivers).toBeGreaterThan(0); expect(cached.screenReceivers).toBeLessThan((await relief()).objects);
    // Saving unchanged settings must not regenerate settled receiving masks.
    panel = await open(); await save();
    expect((await relief()).occlusion.maskBuilds).toBe(cached.maskBuilds);
    panel = await open(); await panel.getByLabel("그림자", { exact: true }).uncheck(); await save();
    await expect.poll(async () => (await receiving()).active).toBe(false);
    panel = await open(); await panel.getByLabel("그림자", { exact: true }).check(); await panel.getByLabel("동적 조명", { exact: true }).uncheck(); await save();
    await expect.poll(async () => (await receiving()).coverage).toBeGreaterThan(.05);
    expect((await relief()).litObjects).toBe(0);
    panel = await open(); await panel.getByLabel("그래픽 품질", { exact: true }).selectOption("low"); await save();
    await expect.poll(async () => (await relief()).occlusion.enabled).toBe(false);
    expect((await receiving()).active).toBe(false);
    expect((await relief()).projectedShadows).toBeGreaterThan(0);
    await page.reload(); await expect(page.getByRole("status")).toContainText("불러왔습니다", { timeout: 15000 });
    expect((await relief()).occlusion.masks).toBe(0); expect((await relief()).occlusion.alphaFrames).toBe(0);
    await page.evaluate(() => { (window as any).__shadeCanvas = document.querySelector("canvas"); });
    panel = await open(); await panel.getByLabel("그래픽 품질", { exact: true }).selectOption("high");
    await panel.getByLabel("동적 조명", { exact: true }).check(); await save();
    await expect.poll(async () => (await receiving()).coverage).toBeGreaterThan(.05);
    expect(await page.evaluate(() => (window as any).__shadeCanvas === document.querySelector("canvas"))).toBe(true);
    // Capture after the restored world's camera has settled, at the same world position and pose.
    await surface.screenshot({ path: testInfo.outputPath("occlusion-edge.png") });
    panel = await open(); await panel.getByLabel("그림자", { exact: true }).uncheck(); await save();
    await surface.screenshot({ path: testInfo.outputPath("occlusion-off.png") });
    panel = await open(); await panel.getByLabel("그림자", { exact: true }).check(); await panel.getByLabel("움직임 줄이기", { exact: true }).uncheck(); await save();
    await expect.poll(async () => (await receiving()).coverage).toBeGreaterThan(.05);
    await page.keyboard.down("ArrowRight");
    await expect.poll(async () => (await receiving()).coverage).toBe(0);
    await page.keyboard.up("ArrowRight");
    expect((await relief()).occlusion.masks).toBeLessThanOrEqual((await relief()).objects);
    expect(errors).toEqual([]);
  } finally {
    await page.keyboard.up("ArrowRight").catch(() => {}); await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.delete({ where: { id: u.id } }); } finally { await db.$disconnect(); }
  }
});
