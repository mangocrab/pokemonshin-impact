import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
test("two players become friends, accept invitation and return on owner logout", async ({
  browser,
}, testInfo) => {
  const prefix = "webmp_" + Date.now();
  const contexts = [];
  const pages: Page[] = [];
  const errors: string[] = [];
  async function menu(p: Page) {
    await p.getByRole("button", { name: /친구 및 멀티플레이/ }).click();
    await expect(
      p.getByRole("dialog", { name: "친구 및 멀티플레이" }),
    ).toBeVisible();
  }
  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({
        baseURL: "http://127.0.0.1:5173",
        viewport:
          testInfo.project.name === "mobile"
            ? { width: 390, height: 844 }
            : { width: 1440, height: 1000 },
        hasTouch: testInfo.project.name === "mobile",
      });
      contexts.push(context);
      const p = await context.newPage();
      pages.push(p);
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto("/");
      await p.getByRole("button", { name: "처음 오셨나요? 회원가입" }).click();
      await p.getByLabel("아이디", { exact: true }).fill(prefix + i);
      await p
        .getByLabel("닉네임", { exact: true })
        .fill(i === 0 ? "여름 소유자" : "산호 방문자");
      await p
        .getByLabel("비밀번호", { exact: true })
        .fill("summer-coop-test-password");
      await p.getByRole("button", { name: "회원가입", exact: true }).click();
      // Four software-rendered WebGL contexts can take several seconds to warm up.
      await expect(p.getByRole("status")).toContainText("불러왔습니다", { timeout: 15000 });
    }
    const [host, guest] = pages;
    const rendering = (p: Page) => p.locator(".game").evaluate(el => JSON.parse((el as HTMLElement).dataset.objectRelief!));
    await expect.poll(async () => (await rendering(host)).groundContacts.objects).toBeGreaterThan(0);
    const baseline = await rendering(host);
    await menu(host);
    await host.getByLabel("친구 아이디", { exact: true }).fill(prefix + "1");
    await host
      .getByRole("button", { name: "친구 요청 보내기", exact: true })
      .click();
    await guest.getByRole("button", { name: /초대·친구 요청 1개/ }).click();
    await guest.getByRole("button", { name: "친구 수락", exact: true }).click();
    await host
      .getByRole("button", { name: "내 월드에 초대", exact: true })
      .click();
    await guest.getByRole("button", { name: "초대 수락", exact: true }).click();
    await expect(
      guest
        .getByRole("dialog")
        .getByRole("heading", { name: /여름 소유자의 월드 · 2\/4/ }),
    ).toBeVisible();
    await guest.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(
      guest.getByText("방문 중 · 상자 개봉 제한 · 2/4"),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: /작은 선물 열기/ }),
    ).toHaveCount(0);
    await host.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(host.getByText("내 월드 · 2/4")).toBeVisible();
    for (const p of [host, guest]) {
      await expect.poll(async () => (await rendering(p)).objects).toBe(baseline.objects + 1);
      await expect.poll(async () => (await rendering(p)).groundContacts.objects).toBe(baseline.groundContacts.objects + 1);
    }
    const observeFrames = (p: Page, attribute: string) => p.locator(".game").evaluate((el, name) => new Promise<string[]>((resolve) => {
      const seen = new Set<string>(), read = () => seen.add(el.getAttribute(name) ?? "");
      read();
      const observer = new MutationObserver(read);
      observer.observe(el, { attributes: true, attributeFilter: [name] });
      setTimeout(() => { observer.disconnect(); resolve([...seen]); }, 900);
    }), attribute);
    // Polling can alias short idle/walk phases; observe every actual frame change instead.
    const observed = Promise.all([observeFrames(guest, "data-traveler-frame"), observeFrames(host, "data-visitor-frames")]);
    await guest.keyboard.down("ArrowRight");
    const [ownFrames, visitorFrames] = await observed;
    expect(ownFrames.some((f) => /east-[12]/.test(f)), JSON.stringify(ownFrames)).toBe(true);
    expect(visitorFrames.some((f) => /east-[12]/.test(f)), JSON.stringify(visitorFrames)).toBe(true);
    await guest.keyboard.up("ArrowRight");
    await expect(host.locator(".game")).toHaveAttribute("data-visitor-frames", '["east-0"]');
    await guest.screenshot({ path: testInfo.outputPath("visiting-world.png") });
    await host.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(guest.getByRole("status")).toContainText("소유자가 떠나");
    await expect(guest.getByText("내 월드 · 1/4")).toBeVisible();
    await expect.poll(async () => (await rendering(guest)).objects).toBe(baseline.objects);
    await expect.poll(async () => (await rendering(guest)).groundContacts.objects).toBe(baseline.groundContacts.objects);
    expect(errors).toEqual([]);
  } finally {
    for (const p of pages) await p.request.post("/api/logout").catch(() => {});
    for (const c of contexts) await c.close();
    await new Promise((r) => setTimeout(r, 300));
    const db = new PrismaClient();
    await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
