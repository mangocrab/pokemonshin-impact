import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
test("celestial opening art keeps registration, logout and login usable on desktop and mobile", async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const db = new PrismaClient(), username = "webCel_" + Date.now().toString(36), password = "celestial-summer-password", errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/");
    const login = page.getByRole("dialog", { name: "로그인", exact: true });
    await expect(login).toBeVisible();
    const key = login.getByRole("img", { name: "별빛 해안의 해린과 미라", exact: true });
    await expect(key).toBeVisible();
    await expect.poll(() => key.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(1000);
    const field = login.getByLabel("아이디", { exact: true }), box = await field.boundingBox(), viewport = page.viewportSize()!;
    expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    await expect(field).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("celestial-login.png") });
    await login.getByRole("button", { name: "처음 오셨나요? 회원가입", exact: true }).click();
    const register = page.getByRole("dialog", { name: "회원가입", exact: true });
    await register.getByLabel("아이디", { exact: true }).fill(username);
    await register.getByLabel("닉네임", { exact: true }).fill("별빛 여행자");
    await register.getByLabel("비밀번호", { exact: true }).fill(password);
    await register.getByRole("button", { name: "회원가입", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("불러왔습니다", { timeout: 15000 });
    await expect(page.locator("main")).toHaveAttribute("data-theme", "celestial-anime");
    await page.screenshot({ path: testInfo.outputPath("celestial-world.png") });
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(login).toBeVisible();
    await login.getByLabel("아이디", { exact: true }).fill(username);
    await login.getByLabel("비밀번호", { exact: true }).fill(password);
    await login.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("불러왔습니다", { timeout: 15000 });
    expect((await (await page.request.get("/api/me")).json()).nickname).toBe("별빛 여행자");
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.deleteMany({ where: { username } }); } finally { await db.$disconnect(); }
  }
});
