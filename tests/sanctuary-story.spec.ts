import { test, expect, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { SANCTUARY, SANCTUARY_CHEST } from "../shared/adventure";
test("Serin's targeted quest chain accepts a real victory and previously discovered treasure, then restores both claims", async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  const db = new PrismaClient(), errors: string[] = [];
  let observer: Socket | undefined, position = { x: 1740, y: 900 };
  const user = await db.user.create({ data: { username: "webSerin_" + Date.now().toString(36), nickname: "여름 기록자", passwordHash: "fixture-unused", world: { create: { positionX: 1740, positionY: 900 } } }, include: { world: true } });
  page.on("pageerror", (e) => errors.push(e.message));
  const dialog = () => page.getByRole("dialog", { name: "세린과 대화", exact: true });
  const song = () => dialog().getByRole("region", { name: "안뜰의 잠든 노래", exact: true });
  const letter = () => dialog().getByRole("region", { name: "꽃잎 사이의 여름 편지", exact: true });
  async function act(button: Locator) { const response = page.waitForResponse((r) => /\/api\/story\/(accept|claim)$/.test(r.url()) && r.request().method() === "POST"); await button.click(); expect((await response).status()).toBe(200); }
  async function walk(x: number, y: number) {
    const until = Date.now() + 12000;
    while (Date.now() < until) { const dx = x - position.x, dy = y - position.y, d = Math.hypot(dx, dy); observer!.emit("world:move", d < 8 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d }); if (d < 8) return; await new Promise((r) => setTimeout(r, 16)); }
    throw new Error("Approach blocked at " + JSON.stringify(position));
  }
  try {
    await db.worldRegion.create({ data: { worldId: user.world!.id, regionId: SANCTUARY.id } });
    await db.worldQuest.create({ data: { worldId: user.world!.id, questId: "first-gift", progress: 1, acceptedAt: new Date(Date.now() - 1000), claimedAt: new Date() } });
    // A legitimate previous discovery must remain useful after accepting the later quest.
    await db.worldChest.create({ data: { worldId: user.world!.id, chestId: SANCTUARY_CHEST.id } });
    const token = randomBytes(32).toString("hex"); await db.session.create({ data: { userId: user.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
    await context.addCookies([{ name: "solara", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
    await page.goto("/"); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    observer = io("http://127.0.0.1:3001", { autoConnect: false, extraHeaders: { Cookie: "solara=" + token } }); observer.on("world:position", (p) => { position = p; });
    await new Promise<void>((resolve, reject) => { observer!.once("world:ready", (r) => { position = r.position; resolve(); }); observer!.once("connect_error", reject); observer!.connect(); });
    await page.getByRole("button", { name: "지역 지도", exact: true }).click();
    const map = page.getByRole("dialog", { name: "지역 지도", exact: true }); await expect(map).toContainText("세린"); await map.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "[E] 세린과 대화", exact: true }).click();
    await expect(dialog()).toContainText("꽃과 기억을 기록하는 세린"); await expect(letter()).toContainText("선행 조건 미충족");
    await act(song().getByRole("button", { name: "부탁 받기", exact: true })); await expect(song()).toContainText("진행 중");
    await dialog().getByRole("button", { name: "대화 마치기", exact: true }).click();
    await walk(1870, 900); await walk(1870, 720);
    await page.getByRole("button", { name: "안뜰 꽃등지기와 전투", exact: true }).click();
    const fight = page.getByRole("dialog", { name: "산호 해안 전투", exact: true });
    async function choose(name: RegExp) { const response = page.waitForResponse((r) => r.url().endsWith("/api/battle/action") && r.request().method() === "POST"); await fight.getByRole("button", { name }).click(); const r = await response; expect(r.status()).toBe(200); return (await r.json()).battle; }
    let s = await choose(/태오/);
    for (let n = 0; n < 20 && s.status === "active"; n++) s = await choose(/^불씨 날리기/);
    expect(s.status).toBe("won"); await fight.getByRole("button", { name: "탐험으로 돌아가기", exact: true }).click();
    await walk(1870, 900); await walk(1740, 900); observer.disconnect();
    await page.getByRole("button", { name: "[E] 세린과 대화", exact: true }).click(); await expect(song()).toContainText("목표 달성");
    const before = (await (await page.request.get("/api/economy")).json()).wallet;
    await act(song().getByRole("button", { name: "보상 받기", exact: true })); await expect(song()).toContainText("완료 · 보상 수령");
    await act(letter().getByRole("button", { name: "부탁 받기", exact: true })); await expect(letter()).toContainText("목표 달성");
    await act(letter().getByRole("button", { name: "보상 받기", exact: true })); await expect(letter()).toContainText("완료 · 보상 수령");
    const after = (await (await page.request.get("/api/economy")).json()).wallet; expect(after.conch).toBe(before.conch + 400); expect(after.shell).toBe(before.shell + 1500);
    await page.screenshot({ path: testInfo.outputPath("serin-completed.png") });
    await dialog().getByRole("button", { name: "대화 마치기", exact: true }).click();
    await page.reload(); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await page.getByRole("button", { name: "모험 일지", exact: true }).click(); const journal = page.getByRole("dialog", { name: "모험 일지", exact: true });
    for (const name of ["안뜰의 잠든 노래", "꽃잎 사이의 여름 편지"]) await expect(journal.getByRole("region", { name, exact: true })).toContainText("완료 · 보상 수령");
    await expect(journal).toContainText("물결의 안뜰 남쪽 (1740,900)");
    expect((await (await page.request.get("/api/economy")).json()).wallet).toEqual(after);
    await page.screenshot({ path: testInfo.outputPath("serin-journal.png") }); expect(errors).toEqual([]);
  } finally {
    observer?.disconnect(); await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.delete({ where: { id: user.id } }); } finally { await db.$disconnect(); }
  }
});
