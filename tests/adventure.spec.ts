import { test, expect, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
test("solve bells with persisted progress, open sanctuary, walk across bridge and collect unique treasure", async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  const db = new PrismaClient(), errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const user = await db.user.create({ data: { username: `webTide_${Date.now()}`, nickname: "안뜰의 여행자", passwordHash: "fixture-unused", world: { create: { positionX: 1460, positionY: 800 } } }, include: { world: true } });
  await db.worldQuest.create({ data: { worldId: user.world!.id, questId: "first-gift", progress: 1, acceptedAt: new Date(Date.now() - 1000), claimedAt: new Date() } });
  const token = randomBytes(32).toString("hex");
  await db.session.create({ data: { userId: user.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
  await context.addCookies([{ name: "solara", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
  const puzzle = () => page.getByRole("dialog", { name: "세 파도의 종", exact: true });
  async function ring(name: string) {
    const response = page.waitForResponse((r) => r.url().endsWith("/api/adventure/rune") && r.request().method() === "POST");
    await puzzle().getByRole("button", { name: name + " 울리기", exact: true }).click(); expect((await response).status()).toBe(200);
  }
  async function eastUntil(target: Locator) {
    const client = testInfo.project.name === "mobile" ? await context.newCDPSession(page) : null;
    let touching = false;
    try {
      for (let i = 0; i < 45; i++) {
        if (await target.isVisible()) return;
        if (client) {
          const box = await page.locator("canvas").boundingBox(); if (!box) throw new Error("Missing canvas");
          await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width * 0.9, y: box.y + Math.min(box.height - 10, box.height / 2 + 100) }] }); touching = true;
          await page.waitForTimeout(100); await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); touching = false;
        } else await page.keyboard.press("ArrowRight", { delay: 100 });
        await page.waitForTimeout(100);
      }
      throw new Error("Sanctuary chest not reached");
    } finally { if (client) { if (touching) await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await client.detach(); } else await page.keyboard.up("ArrowRight"); }
  }
  try {
    await page.goto("/"); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await page.getByRole("button", { name: "지역 지도", exact: true }).click();
    const map = page.getByRole("dialog", { name: "지역 지도", exact: true });
    await expect(map).toContainText("물결의 안뜰 · 잠김"); await map.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "[E] 세 파도의 종 조사", exact: true }).click();
    await expect(puzzle()).toContainText("아침의 햇살");
    await ring("달빛"); await expect(puzzle()).toContainText("순서가 맞지 않아"); await expect(puzzle()).toContainText("울린 종 0/3");
    await ring("햇살"); await expect(puzzle()).toContainText("울린 종 1/3");
    await puzzle().getByRole("button", { name: "조사 마치기", exact: true }).click();
    await page.reload(); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await page.getByRole("button", { name: "[E] 세 파도의 종 조사", exact: true }).click(); await expect(puzzle()).toContainText("울린 종 1/3");
    await ring("잎사귀"); await expect(puzzle()).toContainText("울린 종 2/3"); await ring("밀물");
    await expect(puzzle()).toContainText("물결의 안뜰로 가는 길이 열렸습니다");
    await expect(page.getByLabel("보유 재화")).toContainText("3,360");
    await page.screenshot({ path: testInfo.outputPath("solved-bells.png") });
    await puzzle().getByRole("button", { name: "조사 마치기", exact: true }).click();
    const treasure = page.getByRole("button", { name: /안뜰의 오래된 선물 열기/ }); await eastUntil(treasure);
    await expect(page.getByText("물결의 안뜰 · 안뜰의 선물 0/1", { exact: true })).toBeVisible();
    const response = page.waitForResponse((r) => r.url().endsWith("/api/world/chest") && r.request().method() === "POST");
    await treasure.click(); expect((await response).status()).toBe(200);
    await expect(page.getByLabel("보유 재화")).toContainText("3,600");
    await expect(page.getByText("발견한 상자 0 / 3", { exact: true })).toBeVisible();
    await expect(page.getByText("물결의 안뜰 · 안뜰의 선물 1/1", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("sanctuary.png") });
    await page.reload(); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await expect(page.getByText("물결의 안뜰 · 안뜰의 선물 1/1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "지역 지도", exact: true }).click(); await expect(map).toContainText("물결의 안뜰 · 해금됨"); await expect(map).toContainText("수령 완료");
    await page.screenshot({ path: testInfo.outputPath("region-map.png") });
    expect(await db.worldRegion.count({ where: { worldId: user.world!.id } })).toBe(1);
    expect(await db.worldChest.count({ where: { worldId: user.world!.id, chestId: "sanctuary-cache" } })).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.delete({ where: { id: user.id } }); } finally { await db.$disconnect(); }
  }
});
