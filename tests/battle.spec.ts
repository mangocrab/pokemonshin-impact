import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
test("persistent roster, switching, defense, reload, flee, and a complete victory", async ({
  page,
}, testInfo) => {
  const username = "webbt_" + Date.now();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "처음 오셨나요? 회원가입" }).click();
    await page.getByLabel("아이디", { exact: true }).fill(username);
    await page.getByLabel("닉네임", { exact: true }).fill("전투 여행자");
    await page
      .getByLabel("비밀번호", { exact: true })
      .fill("summer-battle-password");
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await page.getByRole("button", { name: "캐릭터", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "나의 캐릭터 · 4명", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "캐릭터", exact: true })
      .getByRole("button", { name: "닫기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "산호 집게게와 전투", exact: true })
      .click();
    let fight = page.getByRole("dialog", { name: "산호 해안 전투" });
    await expect(
      fight.getByRole("heading", { name: "1라운드 · 행동 선택", exact: true }),
    ).toBeVisible();
    await fight.getByRole("button", { name: /루나/ }).click();
    await expect(
      fight.getByRole("heading", { name: "2라운드 · 행동 선택", exact: true }),
    ).toBeVisible();
    await expect(
      fight.getByRole("progressbar", { name: "루나 HP", exact: true }),
    ).toBeVisible();
    await fight.getByRole("button", { name: /^방어/ }).click();
    await expect(
      fight.getByRole("heading", { name: "3라운드 · 행동 선택", exact: true }),
    ).toBeVisible();
    const before = (await (await page.request.get("/api/battle")).json())
      .battle;
    await page.reload();
    fight = page.getByRole("dialog", { name: "산호 해안 전투" });
    await expect(
      fight.getByRole("heading", { name: "3라운드 · 행동 선택", exact: true }),
    ).toBeVisible();
    await expect(
      fight.getByRole("progressbar", { name: "루나 HP", exact: true }),
    ).toHaveAttribute("aria-valuenow", String(before.team[1].hp));
    await page.screenshot({ path: testInfo.outputPath("battle.png") });
    await fight.getByRole("button", { name: /^도주/ }).click();
    await expect(
      fight.getByRole("heading", { name: "도주 완료", exact: true }),
    ).toBeVisible();
    await fight
      .getByRole("button", { name: "탐험으로 돌아가기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "산호 집게게와 전투", exact: true })
      .click();
    await expect(
      fight.getByRole("heading", { name: "1라운드 · 행동 선택", exact: true }),
    ).toBeVisible();
    await expect(fight.getByRole("button", { name: /^궁극기/ })).toBeDisabled();
    await fight.getByRole("button", { name: /^거센 파도/ }).click();
    await expect(
      fight.getByRole("button", { name: /^행동 불가/ }),
    ).toBeVisible();
    await expect(
      fight.getByRole("button", { name: /^물결 쏘기/ }),
    ).toBeDisabled();
    await expect(fight.getByRole("button", { name: /루나/ })).toBeDisabled();
    await page.reload();
    fight = page.getByRole("dialog", { name: "산호 해안 전투" });
    await expect(
      fight.getByRole("button", { name: /^행동 불가/ }),
    ).toBeVisible();
    await fight.getByRole("button", { name: /^행동 불가/ }).click();
    await expect(
      fight.getByRole("heading", { name: "3라운드 · 행동 선택", exact: true }),
    ).toBeVisible();
    await expect(
      fight.getByRole("button", { name: /^물결 쏘기/ }),
    ).toBeEnabled();
    await fight.getByRole("button", { name: /^도주/ }).click();
    await fight
      .getByRole("button", { name: "탐험으로 돌아가기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "산호 집게게와 전투", exact: true })
      .click();
    await expect(
      fight.getByRole("heading", { name: "1라운드 · 행동 선택", exact: true }),
    ).toBeVisible();
    let energyState = (await (await page.request.get("/api/battle")).json())
      .battle;
    for (let turn = 0; turn < 8 && energyState.team[0].energy < 100; turn++) {
      const version = energyState.version;
      await fight.getByRole("button", { name: /^방어/ }).click();
      await expect
        .poll(
          async () =>
            (await (await page.request.get("/api/battle")).json()).battle
              ?.version ?? 0,
        )
        .toBeGreaterThan(version);
      energyState = (await (await page.request.get("/api/battle")).json())
        .battle;
    }
    await expect(fight.getByRole("button", { name: /^궁극기/ })).toBeEnabled();
    await fight.getByRole("button", { name: /^궁극기/ }).click();
    await expect(fight.getByLabel("전투 기록")).toContainText("HP");
    await expect(fight.getByLabel("전투 기록")).toContainText("회복");
    await expect(fight.getByRole("button", { name: /^궁극기/ })).toBeDisabled();
    await fight.getByRole("button", { name: /^도주/ }).click();
    await fight
      .getByRole("button", { name: "탐험으로 돌아가기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "산호 집게게와 전투", exact: true })
      .click();
    await expect(
      fight.getByRole("heading", { name: "1라운드 · 행동 선택", exact: true }),
    ).toBeVisible();
    let current = (await (await page.request.get("/api/battle")).json()).battle;
    for (let turn = 0; turn < 24 && current?.status === "active"; turn++) {
      const version = current.version;
      if (current.phase === "replacement") {
        const next = current.team.find(
          (c: any, i: number) => c.hp > 0 && i !== current.activeSlot,
        );
        await fight
          .getByRole("button", { name: new RegExp("^" + next.name) })
          .click();
      } else {
        const names: Record<string, string> = {
          haerin: "물결 쏘기",
          luna: "바람 깃",
          somi: "잎새 타격",
          taeo: "불씨 날리기",
        };
        await fight
          .getByRole("button", {
            name: new RegExp("^" + names[current.team[current.activeSlot].id]),
          })
          .click();
      }
      await expect
        .poll(async () => {
          const r = (await (await page.request.get("/api/battle")).json())
            .battle;
          return r?.version ?? version + 1;
        })
        .toBeGreaterThan(version);
      current = (await (await page.request.get("/api/battle")).json()).battle;
    }
    await expect(
      fight.getByRole("heading", { name: "승리", exact: true }),
    ).toBeVisible();
    await expect(
      fight.getByRole("progressbar", { name: "산호 집게게 HP", exact: true }),
    ).toHaveAttribute("aria-valuenow", "0");
    await fight
      .getByRole("button", { name: "탐험으로 돌아가기", exact: true })
      .click();
    await expect(fight).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout");
    await page.close();
    await new Promise((r) => setTimeout(r, 250));
    const db = new PrismaClient();
    await db.user.deleteMany({ where: { username } });
    await db.$disconnect();
  }
});
