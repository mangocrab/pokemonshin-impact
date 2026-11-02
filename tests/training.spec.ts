import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
test("win experience, defer a new move, confirm a four-slot swap, relearn and persist", async ({
  page,
  context,
}, testInfo) => {
  const db = new PrismaClient(),
    username = "webLearn_" + Date.now(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const user = await db.user.create({
    data: {
      username,
      passwordHash: "fixture-unused",
      nickname: "배우는 여행자",
      world: { create: {} },
    },
  });
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      id: createHash("sha256").update(token).digest("hex"),
      userId: user.id,
      expiresAt: new Date(Date.now() + 120000),
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
  try {
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("불러왔습니다");
    for (let win = 0; win < 3; win++) {
      await page
        .getByRole("button", { name: "산호 집게게와 전투", exact: true })
        .click();
      const battle = page.getByRole("dialog", { name: "산호 해안 전투" });
      await expect(battle).toBeVisible();
      let current = (await (await page.request.get("/api/battle")).json())
        .battle;
      for (let turn = 0; turn < 24 && current?.status === "active"; turn++) {
        const version = current.version;
        if (current.phase === "replacement") {
          const next = current.team.find(
            (c: any, i: number) => c.hp > 0 && i !== current.activeSlot,
          );
          await battle
            .getByRole("button", { name: new RegExp("^" + next.name) })
            .click();
        } else {
          const names: Record<string, string> = {
            haerin: "물결 쏘기",
            luna: "바람 깃",
            somi: "잎새 타격",
            taeo: "불씨 날리기",
          };
          await battle
            .getByRole("button", {
              name: new RegExp(
                "^" + names[current.team[current.activeSlot].id],
              ),
            })
            .click();
        }
        await expect
          .poll(async () => {
            const s = (await (await page.request.get("/api/battle")).json())
              .battle;
            return s?.version ?? version + 1;
          })
          .toBeGreaterThan(version);
        current = (await (await page.request.get("/api/battle")).json()).battle;
      }
      await expect(
        battle.getByRole("heading", { name: "승리", exact: true }),
      ).toBeVisible();
      await expect(battle).toContainText("경험치 +80");
      if (win === 2)
        await battle
          .getByRole("button", { name: "새 기술 배우기", exact: true })
          .click();
      else
        await battle
          .getByRole("button", { name: "탐험으로 돌아가기", exact: true })
          .click();
    }
    const panel = page.getByRole("dialog", { name: "캐릭터", exact: true });
    await expect(panel.getByTestId("character-level")).toContainText("Lv.5");
    const skill = panel.getByRole("region", {
      name: "물보라 찌르기 기술 정보",
    });
    // Sections with aria-label have implicit region semantics.
    await skill
      .getByRole("button", { name: "나중에 배우기", exact: true })
      .click();
    await expect(skill).toContainText("학습 보류");
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("status")).toContainText("불러왔습니다");
    await page.getByRole("button", { name: "캐릭터", exact: true }).click();
    await expect(skill).toContainText("학습 보류");
    const old = (
      await (await page.request.get("/api/training")).json()
    ).characters.find((c: any) => c.id === "haerin");
    await skill.getByRole("button", { name: "배우기", exact: true }).click();
    const confirm = panel.getByRole("region", { name: "기술 교체 확인" });
    await expect(
      confirm.getByRole("button", { name: "교체 확인" }),
    ).toBeDisabled();
    await confirm.getByLabel("거센 파도 교체 선택").check();
    await expect(confirm).toContainText("거센 파도 → 물보라 찌르기");
    await confirm
      .getByRole("button", { name: "교체 확인", exact: true })
      .click();
    await expect(panel.getByRole("status")).toContainText("배웠습니다");
    let updated = (
      await (await page.request.get("/api/training")).json()
    ).characters.find((c: any) => c.id === "haerin");
    expect(updated.skills).toEqual(["tide", "spritz", "brine", "reef"]);
    expect(updated.unlocks.some((u: any) => u.skillId === "surge")).toBe(true);
    const oldSkill = panel.getByRole("region", { name: "거센 파도 기술 정보" });
    await oldSkill
      .getByRole("button", { name: "다시 배우기", exact: true })
      .click();
    await confirm.getByLabel("물보라 찌르기 교체 선택").check();
    await confirm
      .getByRole("button", { name: "교체 확인", exact: true })
      .click();
    await expect(panel.getByRole("status")).toContainText("거센 파도");
    updated = (
      await (await page.request.get("/api/training")).json()
    ).characters.find((c: any) => c.id === "haerin");
    expect(updated.skills).toEqual(old.skills);
    expect(updated.unlocks.some((u: any) => u.skillId === "spritz")).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "캐릭터", exact: true }).click();
    await expect(
      skill.getByRole("button", { name: "다시 배우기", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("learning.png") });
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/logout");
    await page.close();
    await new Promise((r) => setTimeout(r, 250));
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
