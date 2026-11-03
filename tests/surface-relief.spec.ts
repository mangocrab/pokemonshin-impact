import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

test("individual normals and projected shadows follow frames and quality switches without rebuilding the world", async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  const db = new PrismaClient(), errors: string[] = [];
  const u = await db.user.create({ data: { username: `webRelief_${testInfo.project.name}_${Date.now()}`, nickname: "햇살 여행자", passwordHash: "fixture-unused", world: { create: {} } } });
  page.on("pageerror", (e) => errors.push(e.message));
  const surface = page.locator(".game");
  const state = () => surface.evaluate((el) => JSON.parse((el as HTMLElement).dataset.objectRelief!));
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
    await expect.poll(async () => (await state()).atlases).toBe(2);
    const initial = await state();
    expect(initial.objects).toBeGreaterThanOrEqual(18); expect(initial.normalFrames).toBe(24);
    expect(initial.litObjects).toBe(initial.objects); expect(initial.projectedShadows).toBe(initial.objects);
    let panel = await open();
    await panel.getByLabel("움직임 줄이기", { exact: true }).check(); await panel.getByLabel("환경 효과", { exact: true }).uncheck(); await save();
    await surface.screenshot({ path: testInfo.outputPath("normals-and-shadows.png") });
    panel = await open(); await panel.getByLabel("그림자", { exact: true }).uncheck(); await save();
    await expect.poll(async () => (await state()).projectedShadows).toBe(0);
    expect((await state()).litObjects).toBe(initial.objects);
    await surface.screenshot({ path: testInfo.outputPath("normals-without-shadows.png") });
    panel = await open(); await panel.getByLabel("동적 조명", { exact: true }).uncheck(); await save();
    await expect.poll(async () => (await state()).litObjects).toBe(0);
    await surface.screenshot({ path: testInfo.outputPath("unlit-without-shadows.png") });
    panel = await open(); await panel.getByLabel("그림자", { exact: true }).check(); await save();
    await expect.poll(async () => (await state()).projectedShadows).toBe(initial.objects);
    expect((await state()).litObjects).toBe(0);
    panel = await open(); await panel.getByLabel("동적 조명", { exact: true }).check();
    await panel.getByLabel("그래픽 품질", { exact: true }).selectOption("low"); await save();
    await page.reload(); await expect(page.getByRole("status")).toContainText("불러왔습니다", { timeout: 15000 });
    await expect.poll(async () => (await state()).objects).toBe(initial.objects);
    expect((await state()).atlases).toBe(0); expect((await state()).litObjects).toBe(0);
    await expect.poll(async () => (await state()).projectedShadows).toBe(initial.objects);
    await page.evaluate(() => { (window as any).__reliefCanvas = document.querySelector("canvas"); });
    panel = await open(); await panel.getByLabel("그래픽 품질", { exact: true }).selectOption("high");
    await panel.getByLabel("움직임 줄이기", { exact: true }).uncheck(); await save();
    await expect.poll(async () => (await state()).normalFrames).toBe(24);
    expect(await page.evaluate(() => (window as any).__reliefCanvas === document.querySelector("canvas"))).toBe(true);
    await expect(surface).toHaveAttribute("data-motion", "true");
    const observed = surface.evaluate((el) => new Promise<{ frames: string[]; mismatches: number }>((resolve) => {
      const element = el as HTMLElement, frames = new Set<string>(); let mismatches = 0;
      const observer = new MutationObserver(() => read());
      const finish = () => { observer.disconnect(); clearTimeout(timer); resolve({ frames: [...frames], mismatches }); };
      const read = () => {
        const frame = element.dataset.travelerFrame!; frames.add(frame);
        if (element.dataset.travelerShadow !== `cast-traveler-${frame}`) mismatches++;
        if (frames.has("east-1") && frames.has("east-2")) finish();
      };
      const timer = setTimeout(finish, 3500);
      observer.observe(element, { attributes: true, attributeFilter: ["data-traveler-frame", "data-traveler-shadow"] }); read();
    }));
    await page.keyboard.down("ArrowRight");
    const frames = await observed;
    await page.keyboard.up("ArrowRight");
    expect(frames.frames, JSON.stringify(frames)).toEqual(expect.arrayContaining(["east-1", "east-2"])); expect(frames.mismatches).toBe(0);
    expect((await state()).cachedShadows).toBeLessThanOrEqual(24);
    expect(errors).toEqual([]);
  } finally {
    await page.keyboard.up("ArrowRight").catch(() => {}); await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.delete({ where: { id: u.id } }); } finally { await db.$disconnect(); }
  }
});
