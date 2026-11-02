import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
test("four real browsers consent, synchronize one round, auto-wait recharge and receive personal victory XP", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90000);
  const db = new PrismaClient(),
    prefix = "webcoop_" + Date.now(),
    contexts: BrowserContext[] = [],
    pages: Page[] = [],
    users: { id: string; username: string }[] = [],
    errors: string[] = [];
  const fight = (p: Page) => p.getByRole("dialog", { name: "산호 해안 전투" });
  try {
    for (let i = 0; i < 4; i++) {
      const u = await db.user.create({
        data: {
          username: prefix + i,
          nickname: "동료" + i,
          passwordHash: "fixture-unused",
          world: { create: {} },
        },
      });
      users.push(u);
      const token = randomBytes(32).toString("hex");
      await db.session.create({
        data: {
          userId: u.id,
          id: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + 180000),
        },
      });
      const c = await browser.newContext({
        baseURL: "http://127.0.0.1:5173",
        viewport:
          testInfo.project.name === "mobile"
            ? { width: 390, height: 844 }
            : { width: 1440, height: 1000 },
        hasTouch: testInfo.project.name === "mobile",
      });
      contexts.push(c);
      await c.addCookies([
        {
          name: "solara",
          value: token,
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      const p = await c.newPage();
      pages.push(p);
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto("/");
      // Four software-rendered WebGL contexts can take several seconds to warm up.
      await expect(p.getByRole("status")).toContainText("불러왔습니다", { timeout: 15000 });
    }
    const host = pages[0];
    await host.request.post("/api/social/access", {
      data: { access: "request" },
    });
    for (const p of pages.slice(1)) {
      const r = await p.request.post("/api/social/request", {
        data: { username: users[0].username },
      });
      expect(r.status()).toBe(200);
      const state = await (await host.request.get("/api/social")).json();
      const entry = state.entries.find((e: any) => e.incoming);
      expect(
        (
          await host.request.post("/api/social/entry-answer", {
            data: { id: entry.id, decision: "accept" },
          })
        ).status(),
      ).toBe(200);
    }
    await expect(host.getByText("내 월드 · 4/4")).toBeVisible();
    await host
      .getByRole("button", { name: "협동 보스전 모집", exact: true })
      .click();
    for (const p of pages)
      await expect(
        fight(p).getByRole("heading", {
          name: "협동 전투 참여 확인",
          exact: true,
        }),
      ).toBeVisible();
    for (const p of pages.slice(1))
      await fight(p)
        .getByRole("button", { name: "협동 전투 참여", exact: true })
        .click();
    for (const p of pages)
      await expect(
        fight(p).getByRole("heading", {
          name: "1라운드 · 행동 선택",
          exact: true,
        }),
      ).toBeVisible();
    const original = await fight(host)
      .getByRole("progressbar", { name: "산호 수호게 HP", exact: true })
      .getAttribute("aria-valuenow");
    await fight(host)
      .getByRole("button", { name: /^거센 파도/ })
      .click();
    await expect(
      fight(host).getByRole("note").filter({ hasText: "다른 참가자" }),
    ).toContainText("다른 참가자");
    await expect(
      fight(host).getByRole("button", { name: /^물결 쏘기/ }),
    ).toBeDisabled();
    await expect(
      fight(host).getByRole("progressbar", {
        name: "산호 수호게 HP",
        exact: true,
      }),
    ).toHaveAttribute("aria-valuenow", original!);
    await fight(pages[1]).getByRole("button", { name: /루나/ }).click();
    await fight(pages[2]).getByRole("button", { name: /^방어/ }).click();
    await fight(pages[3])
      .getByRole("button", { name: /^물결 쏘기/ })
      .click();
    for (const p of pages)
      await expect(
        fight(p).getByRole("heading", {
          name: "2라운드 · 행동 선택",
          exact: true,
        }),
      ).toBeVisible();
    await expect(
      fight(host).getByRole("button", { name: /^물결 쏘기/ }),
    ).toBeDisabled();
    await expect(
      fight(host).getByRole("note").filter({ hasText: "다른 참가자" }),
    ).toContainText("다른 참가자");
    await fight(pages[1])
      .getByRole("button", { name: /^바람 깃/ })
      .click();
    await fight(pages[2])
      .getByRole("button", { name: /^물결 쏘기/ })
      .click();
    await fight(pages[3])
      .getByRole("button", { name: /^물결 쏘기/ })
      .click();
    for (const p of pages)
      await expect(
        fight(p).getByRole("heading", {
          name: "3라운드 · 행동 선택",
          exact: true,
        }),
      ).toBeVisible();
    await expect(
      fight(host).getByRole("button", { name: /^물결 쏘기/ }),
    ).toBeEnabled();
    await host.screenshot({
      path: testInfo.outputPath("cooperative-round.png"),
    });
    for (let turns = 0; turns < 25; turns++) {
      const current = await (await host.request.get("/api/battle")).json();
      if (!current.battle) break;
      const round = current.battle.round;

      for (const p of pages) {
        const data = await (await p.request.get("/api/battle")).json();
        const s = data.battle;
        if (!s || s.round !== round) break;

        if (s.coop.submitted || s.coop.spectating) continue;
        const response = p.waitForResponse(
          (r) =>
            r.url().endsWith("/api/coop/action") &&
            r.request().method() === "POST",
        );
        if (s.phase === "replacement") {
          const next = s.team.find(
            (c: any, i: number) => c.hp > 0 && i !== s.activeSlot,
          );
          await fight(p)
            .getByRole("button", { name: new RegExp("^" + next.name) })
            .click();
        } else {
          const names: Record<string, string> = {
            haerin: "물결 쏘기",
            luna: "바람 깃",
            somi: "잎새 타격",
            taeo: "불씨 날리기",
          };
          await fight(p)
            .getByRole("button", {
              name: new RegExp("^" + names[s.team[s.activeSlot].id]),
            })
            .click();
        }
        expect((await response).status()).toBe(200);
      }
    }
    for (const p of pages) {
      await expect(
        fight(p).getByRole("heading", { name: "승리", exact: true }),
      ).toBeVisible();
      await expect(fight(p)).toContainText("경험치 +120");
      const training = await (await p.request.get("/api/training")).json();
      expect(training.characters[0].level).toBe(4);
    }
    expect(
      await db.coopReward.count({
        where: { userId: { in: users.map((u) => u.id) } },
      }),
    ).toBe(4);
    expect(errors).toEqual([]);
  } finally {
    for (const p of pages) await p.request.post("/api/logout").catch(() => {});
    for (const c of contexts) await c.close();
    await new Promise((r) => setTimeout(r, 300));
    await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
