import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { BANNER, materialId } from "../../shared/economy.js";
const base = process.env.TEST_BASE_URL;
test(
  "collection transactions preserve money, pity, duplicate caps, ownership, gear, ascension and actual combat stats",
  { skip: !base },
  async () => {
    const db = new PrismaClient(),
      prefix = "eco_" + Date.now();
    const users: { id: string; cookie: string }[] = [];
    let socket: Socket | undefined;
    async function state(u = users[0]) {
      const r = await fetch(base + "/api/economy", {
        headers: { Cookie: u.cookie },
      });
      assert.equal(r.status, 200);
      return r.json();
    }
    async function post(
      u: (typeof users)[number],
      path: string,
      body: unknown,
    ) {
      return fetch(base + path, {
        method: "POST",
        headers: { Cookie: u.cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    async function action(
      operation: string,
      payload: unknown,
      options?: { user?: (typeof users)[number]; body?: any },
    ) {
      const u = options?.user ?? users[0],
        s = await state(u);
      return post(
        u,
        "/api/economy/" + operation,
        options?.body ?? {
          ...(payload as object),
          expectedRevision: s.wallet.revision,
          requestId: randomUUID(),
        },
      );
    }
    try {
      for (let i = 0; i < 2; i++) {
        const u = await db.user.create({
          data: {
            username: prefix + i,
            nickname: "수집검증",
            passwordHash: "fixture-unused",
            world: { create: {} },
          },
        });
        const raw = randomBytes(32).toString("hex");
        await db.session.create({
          data: {
            id: createHash("sha256").update(raw).digest("hex"),
            userId: u.id,
            expiresAt: new Date(Date.now() + 120000),
          },
        });
        users.push({ id: u.id, cookie: "solara=" + raw });
      }
      const [a, b] = users;
      let s = await state();
      assert.equal(s.characters.length, 4);
      assert.equal(s.wallet.conch, 3200);
      assert.equal(s.weapons.length, 1);
      await state();
      assert.equal((await state()).wallet.shell, 10000);
      for (let copy = 1; copy <= 9; copy++) {
        await db.gachaPity.upsert({
          where: { userId_bannerId: { userId: a.id, bannerId: BANNER.id } },
          create: {
            userId: a.id,
            bannerId: BANNER.id,
            five: 89,
            guaranteed: true,
          },
          update: { five: 89, guaranteed: true },
        });
        const r = await action("pull", { bannerId: BANNER.id, count: 1 });
        assert.equal(r.status, 200);
        const p = (await r.json()).receipt.pulls[0];
        assert.equal(p.id, "mira");
        assert.equal(p.rarity, 5);
        assert.equal(p.tokens, copy >= 2 && copy <= 7 ? 1 : 0);
        assert.equal(p.duplicate, copy > 1);
        if (copy >= 8) assert.equal(p.dust, 50);
      }
      s = await state();
      const mira = s.characters.find((c: any) => c.id === "mira");
      assert.equal(mira.slot, null);
      assert.equal(mira.copies, 9);
      assert.equal(mira.liberationGranted, 6);
      assert.equal(mira.liberationTokens, 6);
      assert.equal(s.wallet.dust, 100);
      assert.equal(s.characters.length, 5);
      for (let i = 0; i < 6; i++)
        assert.equal(
          (await action("liberate", { characterId: "mira" })).status,
          200,
        );
      assert.equal(
        (await action("liberate", { characterId: "mira" })).status,
        409,
      );
      s = await state();
      assert.equal(
        s.characters.find((c: any) => c.id === "mira").liberation,
        6,
      );
      assert.equal(
        s.characters.find((c: any) => c.id === "mira").liberationTokens,
        0,
      );
      const body = {
        requestId: randomUUID(),
        expectedRevision: s.wallet.revision,
        bannerId: BANNER.id,
        count: 10,
      };
      const draws = await Promise.all(
        [0, 1].map(() => action("pull", {}, { body })),
      );
      assert.ok(draws.every((r) => r.status === 200));
      const receipts = await Promise.all(draws.map((r) => r.json()));
      assert.deepEqual(receipts[0], receipts[1]);
      assert.equal(receipts[0].receipt.pulls.length, 10);
      assert.ok(receipts[0].receipt.pulls.some((p: any) => p.rarity >= 4));
      assert.ok(
        receipts[0].receipt.pulls
          .filter((p: any) => p.rarity === 3)
          .every((p: any) => p.kind === "weapon"),
      );
      s = await state();
      assert.equal(s.wallet.conch, 160);
      assert.equal(s.history.length, 19);
      assert.equal(
        (await action("pull", {}, { body: { ...body, count: 1 } })).status,
        409,
      );
      assert.equal(
        (await action("pull", { bannerId: BANNER.id, count: 10 })).status,
        409,
      );
      assert.equal((await state()).history.length, 19);
      assert.equal(
        (await action("pull", { bannerId: BANNER.id, count: -1 })).status,
        400,
      );
      const foreign = (await state(b)).weapons[0];
      assert.equal(
        (await action("equip", { characterId: "mira", weaponId: foreign.id }))
          .status,
        404,
      );
      assert.equal(
        (await action("team", { characterId: "nari", slot: 0 }, { user: b }))
          .status,
        404,
      );
      s = await state();
      const w = s.weapons.find((w: any) => w.weaponId === "shellWand");
      const before = s.characters.find((c: any) => c.id === "mira").attack;
      assert.equal(
        (await action("equip", { characterId: "mira", weaponId: w.id })).status,
        200,
      );
      assert.equal(
        (await state()).characters.find((c: any) => c.id === "mira").attack,
        before + 8,
      );
      const oldShell = (await state()).wallet.shell;
      assert.equal((await action("weapon", { weaponId: w.id })).status, 200);
      assert.equal((await state()).wallet.shell, oldShell - 100);
      assert.equal(
        (await state()).characters.find((c: any) => c.id === "mira").attack,
        before + 10,
      );
      assert.equal(
        (await action("skill", { characterId: "mira" })).status,
        200,
      );
      assert.equal(
        (await state()).characters.find((c: any) => c.id === "mira").skillLevel,
        2,
      );
      assert.equal(
        (await action("team", { characterId: "mira", slot: 0 })).status,
        200,
      );
      s = await state();
      assert.equal(s.characters.find((c: any) => c.id === "haerin").slot, null);
      assert.equal(s.characters.filter((c: any) => c.slot !== null).length, 4);
      socket = io(base!, {
        autoConnect: false,
        extraHeaders: { Cookie: a.cookie },
      });
      await new Promise<void>((resolve, reject) => {
        socket!.once("world:ready", () => resolve());
        socket!.once("connect_error", reject);
        socket!.connect();
        setTimeout(() => reject(new Error("connect timeout")), 4000).unref();
      });
      let fight = (
        await (
          await post(a, "/api/battle/start", { encounterId: "coral-crab" })
        ).json()
      ).battle;
      assert.equal(fight.team.length, 4);
      assert.equal(fight.team[0].id, "mira");
      assert.equal(fight.team[0].attack, before + 10);
      assert.ok(fight.team[0].damageBonus > 0.15);
      assert.equal((await action("weapon", { weaponId: w.id })).status, 409);
      assert.equal(
        (await action("pull", { bannerId: BANNER.id, count: 1 })).status,
        409,
      );
      const attack = await post(a, "/api/battle/action", {
        battleId: fight.id,
        expectedVersion: fight.version,
        action: { type: "skill", skillId: "mira-1" },
      });
      assert.equal(attack.status, 200);
      fight = (await attack.json()).battle;
      assert.ok(fight.enemy.hp < 220);
      assert.match(fight.log[0], /미라 → 산호 집게게/);
      assert.equal(
        (
          await post(a, "/api/battle/action", {
            battleId: fight.id,
            expectedVersion: fight.version,
            action: { type: "flee" },
          })
        ).status,
        200,
      );
      const trainingBefore = await state();
      const trainer = await action("train", { characterId: "mira", count: 1 });
      assert.equal(trainer.status, 200);
      const trained = await state();
      assert.equal(trained.wallet.shell, trainingBefore.wallet.shell - 100);
      assert.equal(
        trained.characters.find((c: any) => c.id === "mira").level,
        3,
      );
      await db.userCharacter.update({
        where: { userId_characterId: { userId: a.id, characterId: "mira" } },
        data: { level: 20, experience: 0 },
      });
      await db.inventory.updateMany({
        where: { userId: a.id, itemId: materialId("mira") },
        data: { quantity: 0 },
      });
      const snapshot = await state();
      assert.equal(
        (await action("ascend", { characterId: "mira" })).status,
        409,
      );
      assert.equal((await state()).wallet.shell, snapshot.wallet.shell);
      for (const itemId of ["growth-stone", materialId("mira")])
        await db.inventory.upsert({
          where: { userId_itemId: { userId: a.id, itemId } },
          create: { userId: a.id, itemId, quantity: 100 },
          update: { quantity: 100 },
        });
      for (const [level, cap] of [
        [20, 40],
        [40, 60],
        [60, 80],
      ]) {
        await db.userCharacter.update({
          where: { userId_characterId: { userId: a.id, characterId: "mira" } },
          data: { level },
        });
        assert.equal(
          (await action("ascend", { characterId: "mira" })).status,
          200,
        );
        assert.equal(
          (await state()).characters.find((c: any) => c.id === "mira").levelCap,
          cap,
        );
      }
      await db.userCharacter.update({
        where: { userId_characterId: { userId: a.id, characterId: "mira" } },
        data: { level: 80 },
      });
      assert.equal(
        (await action("ascend", { characterId: "mira" })).status,
        409,
      );
      assert.equal(
        (await action("train", { characterId: "mira", count: 1 })).status,
        409,
      );
      const fresh = await state();
      const revision = fresh.wallet.revision;
      await db.wallet.update({ where: { userId: a.id }, data: { shell: 0 } });
      assert.equal((await action("weapon", { weaponId: w.id })).status, 409);
      assert.equal(
        (await state()).weapons.find((x: any) => x.id === w.id).level,
        2,
      );
      assert.equal((await state()).wallet.revision, revision);
      const beforeBook = (await state()).inventory.find(
        (i: any) => i.itemId === "training-book",
      ).quantity;
      const beforeHero = (await state()).characters.find(
        (c: any) => c.id === "haerin",
      );
      assert.equal(
        (await action("train", { characterId: "haerin", count: 1 })).status,
        409,
      );
      assert.equal(
        (await state()).inventory.find((i: any) => i.itemId === "training-book")
          .quantity,
        beforeBook,
      );
      assert.equal(
        (await state()).characters.find((c: any) => c.id === "haerin").level,
        beforeHero.level,
      );

      assert.equal((await action("pull", {}, { body })).status, 200);
      assert.equal((await state()).history.length, 19);
      assert.equal((await state(b)).wallet.conch, 3200);
      assert.equal((await state(b)).history.length, 0);
      await assert.rejects(
        db.wallet.update({ where: { userId: a.id }, data: { conch: -1 } }),
      );
      await assert.rejects(
        db.userCharacter.update({
          where: { userId_characterId: { userId: a.id, characterId: "mira" } },
          data: { liberation: 7 },
        }),
      );
    } finally {
      socket?.disconnect();
      await new Promise((r) => setTimeout(r, 250));
      await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
      await db.$disconnect();
    }
  },
);
