import { test, expect, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { SKILLS } from "../shared/combat";
test("meet Daon, accept and finish exploration and victory quests, claim once and restore journal", async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  const db = new PrismaClient(), errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const user = await db.user.create({ data: { username: `webStory_${Date.now()}`, nickname: "여름의 이야기꾼", passwordHash: "fixture-unused", world: { create: { positionX: 845, positionY: 640 } } } });
  const token = randomBytes(32).toString("hex");
  await db.session.create({ data: { userId: user.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
  await context.addCookies([{ name: "solara", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" }]);
  const dialog = () => page.getByRole("dialog", { name: "다온과 대화", exact: true });
  async function action(button: Locator) {
    const response = page.waitForResponse((r) => /\/api\/story\/(accept|claim)$/.test(r.url()) && r.request().method() === "POST");
    await button.click(); expect((await response).status()).toBe(200);
  }
  async function move(direction: "up" | "left" | "right", target: Locator) {
    // Release each input before checking proximity, so polling cannot walk past an NPC.
    const mobile = testInfo.project.name === "mobile";
    const client = mobile ? await context.newCDPSession(page) : null;
    let touching = false;
    const key = { up: "ArrowUp", left: "ArrowLeft", right: "ArrowRight" }[direction];
    try {
      for (let step = 0; step < 40; step++) {
        if (await target.isVisible()) return;
        if (client) {
          const box = await page.locator("canvas").boundingBox();
          if (!box) throw new Error("Missing coast canvas");
          const point = { x: box.x + box.width * (direction === "left" ? 0.15 : direction === "right" ? 0.85 : 0.5), y: box.y + (direction === "up" ? 20 : Math.min(box.height - 10, box.height / 2 + 100)) };
          await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
          touching = true;
          await page.waitForTimeout(90);
          await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          touching = false;
        } else { await page.keyboard.press(key, { delay: 90 }); }
        await page.waitForTimeout(100);
      }
      const position = (await (await page.request.get("/api/me")).json()).world;
      throw new Error(`No target after moving ${direction}; saved position ${position.positionX},${position.positionY}`);
    } finally {
      if (client) { if (touching) await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await client.detach(); }
      else await page.keyboard.up(key);
    }
  }
  try {
    await page.goto("/"); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await page.getByRole("button", { name: "[E] 다온과 대화", exact: true }).click();
    let panel = dialog(); await expect(panel).toContainText("산호 해안에 온 걸 환영해");
    let gift = panel.getByRole("region", { name: "여름의 첫 선물", exact: true });
    await action(gift.getByRole("button", { name: "부탁 받기", exact: true }));
    await expect(gift).toContainText("진행 중");
    await expect(gift.getByRole("button", { name: "보상 받기", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "대화 마치기", exact: true }).click();
    const chest = page.getByRole("button", { name: /해안의 작은 선물 열기/ });
    await move("up", chest);
    const opened = page.waitForResponse((r) => r.url().endsWith("/api/world/chest") && r.request().method() === "POST");
    await chest.click(); expect((await opened).status()).toBe(200);
    await expect(page.getByRole("region", { name: "현재 부탁" })).toContainText("1/1");
    await page.getByRole("button", { name: "[E] 다온과 대화", exact: true }).click();
    panel = dialog(); gift = panel.getByRole("region", { name: "여름의 첫 선물", exact: true });
    await action(gift.getByRole("button", { name: "보상 받기", exact: true }));
    await expect(gift).toContainText("완료 · 보상 수령");
    await expect(page.getByLabel("보유 재화")).toContainText("3,400");
    const guard = panel.getByRole("region", { name: "해안의 작은 수호자", exact: true });
    await action(guard.getByRole("button", { name: "부탁 받기", exact: true }));
    await panel.getByRole("button", { name: "대화 마치기", exact: true }).click();
    const start = page.getByRole("button", { name: "산호 집게게와 전투", exact: true });
    await move("left", start); await start.click();
    const fight = page.getByRole("dialog", { name: "산호 해안 전투", exact: true }); await expect(fight).toBeVisible();
    let battle = (await (await page.request.get("/api/battle")).json()).battle;
    for (let n = 0; n < 30 && battle.status === "active"; n++) {
      await expect(fight.getByRole("heading", { level: 2 })).toHaveText(`${battle.round}라운드 · ${battle.phase === "replacement" ? "강제 교체" : "행동 선택"}`);
      const response = page.waitForResponse((r) => r.url().endsWith("/api/battle/action") && r.request().method() === "POST");
      if (battle.phase === "replacement") {
        const next = battle.team.find((f: any, i: number) => f.hp > 0 && i !== battle.activeSlot);
        await fight.getByRole("button", { name: new RegExp("^" + next.name) }).click();
      } else {
        const skill = SKILLS[battle.team[battle.activeSlot].skills[0]];
        await fight.getByRole("button", { name: new RegExp("^" + skill.name) }).click();
      }
      const r = await response; expect(r.status()).toBe(200); battle = (await r.json()).battle;
    }
    expect(battle.status).toBe("won");
    await fight.getByRole("button", { name: "탐험으로 돌아가기", exact: true }).click();
    const npc = page.getByRole("button", { name: "[E] 다온과 대화", exact: true });
    if (!(await npc.isVisible())) await move("right", npc);
    await npc.click(); panel = dialog();
    const before = (await (await page.request.get("/api/economy")).json()).wallet.conch;
    await action(panel.getByRole("region", { name: "해안의 작은 수호자", exact: true }).getByRole("button", { name: "보상 받기", exact: true }));
    await expect(panel).toContainText("네가 해안의 작은 수호자야");
    await expect(page.getByLabel("보유 재화")).toContainText((before + 320).toLocaleString());
    await page.screenshot({ path: testInfo.outputPath("daon-completed.png") });
    await panel.getByRole("button", { name: "대화 마치기", exact: true }).click();
    await page.reload(); await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await page.getByRole("button", { name: "모험 일지", exact: true }).click();
    const journal = page.getByRole("dialog", { name: "모험 일지", exact: true });
    for (const name of ["여름의 첫 선물", "해안의 작은 수호자"]) await expect(journal.getByRole("region", { name, exact: true })).toContainText("완료 · 보상 수령");
    await expect(journal.getByRole("region", { name: "발걸음으로 그린 지도", exact: true })).toContainText("받을 수 있는 부탁");
    await page.screenshot({ path: testInfo.outputPath("journal.png") });
    expect(await db.worldQuest.count({ where: { worldId: (await db.world.findUniqueOrThrow({ where: { ownerId: user.id } })).id, claimedAt: { not: null } } })).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout").catch(() => {}); await page.close().catch(() => {});
    try { await db.user.delete({ where: { id: user.id } }); } finally { await db.$disconnect(); }
  }
});
