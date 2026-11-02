import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
test("explore, approach chest, open, and restore progress and position", async ({
  page,
}, testInfo) => {
  const username = `e2e_${Date.now()}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "처음 오셨나요? 회원가입" }).click();
    await page.getByLabel("아이디", { exact: true }).fill(username);
    await page.getByLabel("닉네임", { exact: true }).fill("해안 여행자");
    await page
      .getByLabel("비밀번호", { exact: true })
      .fill("summer-test-password");
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await expect(
      page.getByRole("button", { name: /해안의 작은 선물 열기/ }),
    ).toHaveCount(0);
    if (testInfo.project.name === "mobile") {
      // Tap-and-hold to the right of the avatar, exercising Phaser touch movement.
      const canvas = await page.locator("canvas").boundingBox();
      const client = await page.context().newCDPSession(page);
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          {
            x: canvas!.x + canvas!.width * 0.78,
            y: canvas!.y + canvas!.height * 0.7,
          },
        ],
      });
      await expect(
        page.getByRole("button", { name: /해안의 작은 선물 열기/ }),
      ).toBeVisible();
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      await page.keyboard.down("ArrowRight");
      await expect(
        page.getByRole("button", { name: /해안의 작은 선물 열기/ }),
      ).toBeVisible();
      await page.keyboard.up("ArrowRight");
    }
    await page.getByRole("button", { name: /해안의 작은 선물 열기/ }).click();
    await expect(page.getByRole("status")).toContainText("열었습니다");
    await expect(page.getByText("발견한 상자 1 / 3")).toBeVisible();
    // A save made while moving may already be >820. Wait for the stopped position
    // to remain stable through a full 2-second autosave cycle before comparing reload.
    let before = await (await page.request.get("/api/me")).json();
    let stableSince = Date.now();
    await expect.poll(async () => {
      const current = await (await page.request.get("/api/me")).json();
      if (current.world.positionX !== before.world.positionX || current.world.positionY !== before.world.positionY) {
        before = current;
        stableSince = Date.now();
      }
      return Date.now() - stableSince;
    }, { timeout: 8000, intervals: [100, 250] }).toBeGreaterThanOrEqual(2100);
    expect(before.world.positionX).toBeGreaterThan(820);
    await page.reload();
    await expect(page.getByText("발견한 상자 1 / 3")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("불러왔습니다");
    const after = await (await page.request.get("/api/me")).json();
    expect(after.world.positionX).toBeCloseTo(before.world.positionX, 0);
    await page.screenshot({ path: testInfo.outputPath("exploration.png") });
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout");
    await page.close();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const db = new PrismaClient();
    await db.user.deleteMany({ where: { username } });
    await db.$disconnect();
  }
});
