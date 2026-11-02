import { test, expect, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { BANNER } from "../shared/economy";
test("actual pulls unlock a companion, party and weapon equip feed combat, upgrades persist", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(60000);
  const db = new PrismaClient(),
    username = "webEco_" + Date.now(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const u = await db.user.create({
    data: {
      username,
      nickname: "수집 여행자",
      passwordHash: "fixture-unused",
      world: { create: {} },
    },
  });
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      userId: u.id,
      id: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 180000),
    },
  });
  await context.addCookies([
    {
      name: "solara",
      value: token,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  async function data() {
    return await (await page.request.get("/api/economy")).json();
  }
  async function click(button: Locator) {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/economy/") && r.request().method() === "POST",
    );
    await button.click();
    expect((await response).status()).toBe(200);
  }
  async function menu(name: string) {
    await page.getByRole("button", { name, exact: true }).click();
    return page.getByRole("dialog", { name, exact: true });
  }
  try {
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("불러왔습니다");
    let panel = await menu("캐릭터 뽑기");
    await expect(panel).toContainText("3200");
    for (let i = 0; i < 2; i++) {
      await db.gachaPity.upsert({
        where: { userId_bannerId: { userId: u.id, bannerId: BANNER.id } },
        create: {
          userId: u.id,
          bannerId: BANNER.id,
          five: 89,
          guaranteed: true,
        },
        update: { five: 89, guaranteed: true },
      });
      await click(
        panel.getByRole("button", { name: "1회 뽑기 · 160소라", exact: true }),
      );
      await expect(panel.getByLabel("뽑기 결과")).toContainText("미라");
      await expect(panel.getByLabel("뽑기 결과")).toContainText(
        i === 0 ? "새 동료 해금" : "해방 재료 +1",
      );
    }
    await click(
      panel.getByRole("button", { name: "10회 뽑기 · 1,600소라", exact: true }),
    );
    await expect(panel.getByLabel("뽑기 결과").locator("section")).toHaveCount(
      10,
    );
    let s = await data();
    expect(s.wallet.conch).toBe(1280);
    expect(s.history.length).toBe(12);
    await page.screenshot({ path: testInfo.outputPath("gacha.png") });
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    panel = await menu("인벤토리");
    await panel.getByLabel("강화 대상 캐릭터").selectOption("mira");
    await click(
      panel.getByRole("button", { name: "선택 캐릭터 편성", exact: true }),
    );
    s = await data();
    const before = s.characters.find((c: any) => c.id === "mira").attack;
    const weaponCard = panel
      .locator(".weapon-list>section")
      .filter({ hasText: "소라 지팡이" })
      .first();
    await click(
      weaponCard.getByRole("button", {
        name: "선택 캐릭터에 장착",
        exact: true,
      }),
    );
    s = await data();
    expect(s.characters.find((c: any) => c.id === "mira").attack).toBe(
      before + 8,
    );
    const weapon = s.weapons.find((w: any) => w.equippedCharacterId === "mira");
    expect(weapon).toBeTruthy();
    expect(s.characters.filter((c: any) => c.slot !== null).length).toBe(4);
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    panel = await menu("강화");
    await panel.getByLabel("강화 대상 캐릭터").selectOption("mira");
    await click(
      panel.getByRole("button", { name: "경험치 훈련", exact: true }),
    );
    await expect(panel).toContainText("미라 · Lv.3");
    await click(
      panel.getByRole("button", { name: "캐릭터 해방", exact: true }),
    );
    await expect(panel).toContainText("해방 1/6");
    await click(panel.getByRole("button", { name: "기술 강화", exact: true }));
    s = await data();
    const index = s.weapons.findIndex((w: any) => w.id === weapon.id);
    await click(
      panel
        .locator(".weapon-list>section")
        .nth(index)
        .getByRole("button", { name: "무기 강화", exact: true }),
    );
    s = await data();
    expect(s.weapons.find((w: any) => w.id === weapon.id).level).toBe(2);
    expect(s.characters.find((c: any) => c.id === "mira").skillLevel).toBe(2);
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await page
      .getByRole("button", { name: "산호 집게게와 전투", exact: true })
      .click();
    const fight = page.getByRole("dialog", { name: "산호 해안 전투" });
    await expect(
      fight.getByRole("heading", { name: "미라", exact: true }),
    ).toBeVisible();
    const battle = (await (await page.request.get("/api/battle")).json())
      .battle;
    expect(battle.team.length).toBe(4);
    expect(battle.team[0].id).toBe("mira");
    expect(battle.team[0].attack).toBe(
      s.characters.find((c: any) => c.id === "mira").attack,
    );
    await fight.getByRole("button", { name: /^도주/ }).click();
    await fight
      .getByRole("button", { name: "탐험으로 돌아가기", exact: true })
      .click();
    await page.reload();
    await expect(page.getByRole("status")).toContainText("불러왔습니다");
    panel = await menu("강화");
    await panel.getByLabel("강화 대상 캐릭터").selectOption("mira");
    await expect(panel).toContainText("미라 · Lv.3");
    await expect(panel).toContainText("해방 1/6");
    await page.screenshot({ path: testInfo.outputPath("upgrades.png") });
    s = await data();
    expect(s.history.length).toBe(12);
    expect(s.wallet.conch).toBe(1280);
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout").catch(() => {});
    await page.close();
    await new Promise((r) => setTimeout(r, 250));
    await db.user.delete({ where: { id: u.id } });
    await db.$disconnect();
  }
});
