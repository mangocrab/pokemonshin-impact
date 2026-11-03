import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

test("four-direction traveler frames follow real movement, idle at walls and respect motion preferences", async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const db = new PrismaClient(), errors: string[] = [], missing: string[] = [];
  const u = await db.user.create({ data: { username: `webStride_${testInfo.project.name}_${Date.now()}`, nickname: "바람길 여행자", passwordHash: "fixture-unused", world: { create: {} } } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.url().includes("/art/traveler") && r.status() >= 400) missing.push(r.url()); });
  try {
    const token = randomBytes(32).toString("hex");
    await db.session.create({ data: { userId: u.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
    await context.addCookies([{ name: "solara", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
    await page.goto("/"); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    const surface = page.locator(".game");
    await expect(surface).toHaveAttribute("data-traveler-frame", "south-0");
    expect(await page.evaluate(async () => { const im = new Image(); im.src = "/art/traveler.webp"; await im.decode(); return im.naturalWidth > 1000; })).toBe(true);
    for (const [key, direction] of [["ArrowRight", "east"], ["ArrowDown", "south"], ["ArrowLeft", "west"], ["ArrowUp", "north"]]) {
      // Observe actual frame changes through a full stride, including slow shader warm-up.
      const observed = surface.evaluate((el, direction) => new Promise<string[]>((resolve) => {
        const frames = new Set<string>(), observer = new MutationObserver(() => read());
        const finish = () => { observer.disconnect(); clearTimeout(timer); resolve([...frames]); };
        const read = () => {
          frames.add((el as HTMLElement).dataset.travelerFrame!);
          if (frames.has(`${direction}-1`) && frames.has(`${direction}-2`)) finish();
        };
        const timer = setTimeout(finish, 3500);
        observer.observe(el, { attributes: true, attributeFilter: ["data-traveler-frame"] }); read();
      }), direction);
      await page.keyboard.down(key);
      const frames = await observed;
      await page.keyboard.up(key);
      expect(frames).toContain(`${direction}-1`); expect(frames).toContain(`${direction}-2`);
      await expect(surface).toHaveAttribute("data-traveler-frame", `${direction}-0`);
      await page.locator("canvas").screenshot({ path: testInfo.outputPath(`traveler-${direction}.png`) });
    }
    // A held input against the authoritative map boundary must settle on idle.
    await page.keyboard.down("ArrowLeft");
    await expect.poll(async () => (await (await page.request.get("/api/me")).json()).world.positionX, { timeout: 10000 }).toBeLessThanOrEqual(40);
    await expect(surface).toHaveAttribute("data-traveler-frame", "west-0");
    await page.waitForTimeout(250); // More than the accepted-movement grace period while the key stays held.
    await expect(surface).toHaveAttribute("data-traveler-frame", "west-0");
    await page.keyboard.up("ArrowLeft");
    if (testInfo.project.name === "mobile") {
      const box = (await page.locator("canvas").boundingBox())!;
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width * .9, y: box.y + box.height / 2 - 100 }] });
      await expect(surface).toHaveAttribute("data-traveler-frame", /east-[12]/);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(surface).toHaveAttribute("data-traveler-frame", "east-0");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.keyboard.down("ArrowRight");
    await expect(surface).toHaveAttribute("data-traveler-frame", "east-0");
    await page.waitForTimeout(250);
    await expect(surface).toHaveAttribute("data-traveler-frame", "east-0");
    await page.keyboard.up("ArrowRight");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "설정", exact: true }).click();
    const prefs = page.getByRole("dialog", { name: "설정", exact: true });
    await prefs.getByLabel("그래픽 품질", { exact: true }).selectOption("low");
    await prefs.getByLabel("움직임 줄이기", { exact: true }).check();
    await prefs.getByRole("button", { name: "설정 저장", exact: true }).click();
    await expect(prefs).toContainText("설정을 저장하고 적용했습니다.");
    await prefs.getByRole("button", { name: "닫기", exact: true }).click();
    await page.reload(); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await expect(surface).toHaveAttribute("data-traveler-frame", "south-0");
    await page.keyboard.down("ArrowRight");
    await expect(surface).toHaveAttribute("data-traveler-frame", "east-0");
    await page.waitForTimeout(250); await expect(surface).toHaveAttribute("data-traveler-frame", "east-0");
    await page.keyboard.up("ArrowRight");
    expect(missing).toEqual([]); expect(errors).toEqual([]);
  } finally {
    await page.keyboard.up("ArrowLeft").catch(() => {}); await page.keyboard.up("ArrowRight").catch(() => {});
    await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.delete({ where: { id: u.id } }); } finally { await db.$disconnect(); }
  }
});
