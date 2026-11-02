import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { io, type Socket } from "socket.io-client";
import type { BattleState } from "../../shared/combat.js";
const base = process.env.TEST_BASE_URL;
test(
  "victory unlocks skills once; defer, four-slot swap, relearn, stale revisions and account isolation persist",
  { skip: !base },
  async () => {
    const db = new PrismaClient(),
      prefix = "learn_" + Date.now();
    const sockets: Socket[] = [];
    const clients: { id: string; cookie: string; socket?: Socket }[] = [];
    async function get(c: (typeof clients)[number], path = "/api/training") {
      return (
        await fetch(base + path, { headers: { Cookie: c.cookie } })
      ).json();
    }
    async function post(
      c: (typeof clients)[number],
      path: string,
      body: unknown,
    ) {
      return fetch(base + path, {
        method: "POST",
        headers: { Cookie: c.cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    try {
      for (let i = 0; i < 2; i++) {
        const u = await db.user.create({
          data: {
            username: prefix + i,
            passwordHash: "fixture-unused",
            nickname: "학습검증",
            world: { create: {} },
          },
        });
        const token = randomBytes(32).toString("hex");
        await db.session.create({
          data: {
            id: createHash("sha256").update(token).digest("hex"),
            userId: u.id,
            expiresAt: new Date(Date.now() + 60000),
          },
        });
        clients.push({ id: u.id, cookie: "solara=" + token });
      }
      const [a, b] = clients;
      const original = (await get(a)).characters.find(
        (c: any) => c.id === "haerin",
      );
      assert.deepEqual(original.skills, ["tide", "surge", "brine", "reef"]);
      assert.equal(original.unlocks.length, 4);
      const mutate = (
        c: typeof a,
        revision: number,
        skillId: string,
        action = "learn",
        replaceSlot?: number,
      ) =>
        post(c, "/api/training", {
          characterId: "haerin",
          expectedRevision: revision,
          skillId,
          action,
          ...(replaceSlot === undefined ? {} : { replaceSlot }),
        });
      assert.equal((await mutate(a, 0, "spritz", "learn", 0)).status, 403);
      assert.equal((await mutate(a, 0, "seaHome", "learn", 0)).status, 403);
      assert.equal((await mutate(b, 0, "spritz", "learn", 0)).status, 403);
      // Seed a nearly-levelled test character; only an actual server victory may grant the unlock.
      await db.userCharacter.update({
        where: { userId_characterId: { userId: a.id, characterId: "haerin" } },
        data: { level: 4, experience: 79 },
      });
      const s = io(base!, {
        autoConnect: false,
        extraHeaders: { Cookie: a.cookie },
      });
      sockets.push(s);
      a.socket = s;
      await new Promise<void>((resolve, reject) => {
        s.once("world:ready", () => resolve());
        s.once("connect_error", reject);
        s.connect();
        setTimeout(() => reject(new Error("world timeout")), 4000).unref();
      });
      let battle = (
        await (
          await post(a, "/api/battle/start", { encounterId: "coral-crab" })
        ).json()
      ).battle as BattleState;
      assert.equal((await mutate(a, 0, "tide", "defer")).status, 409);
      const starts = (await get(a, "/api/battle/characters")).characters;
      assert.equal(starts.find((c: any) => c.id === "haerin").maxHp, 276);
      for (let i = 0; i < 20 && battle.status === "active"; i++) {
        const action =
          battle.phase === "replacement"
            ? {
                type: "switch",
                slot: battle.team.findIndex(
                  (c, j) => c.hp > 0 && j !== battle.activeSlot,
                ),
              }
            : {
                type: "skill",
                skillId: battle.team[battle.activeSlot].skills[0],
              };
        const response = await post(a, "/api/battle/action", {
          battleId: battle.id,
          expectedVersion: battle.version,
          action,
        });
        assert.equal(response.status, 200);
        battle = (await response.json()).battle;
      }
      assert.equal(battle.status, "won");
      assert.equal(battle.reward?.experience, 80);
      let character = (await get(a)).characters.find(
        (c: any) => c.id === "haerin",
      );
      assert.equal(character.level, 5);
      assert.equal(character.experience, 79);
      assert.equal(character.maxHp, 288);
      assert.ok(
        character.unlocks.some(
          (u: any) => u.skillId === "spritz" && u.decision === "pending",
        ),
      );
      assert.deepEqual(character.skills, original.skills);
      const revision = character.revision;
      assert.equal(
        (
          await post(a, "/api/battle/action", {
            battleId: battle.id,
            expectedVersion: battle.version,
            action: { type: "defend" },
          })
        ).status,
        409,
      );
      assert.equal(
        await db.battleReward.count({ where: { battleId: battle.id } }),
        1,
      );
      assert.equal(
        (await get(a)).characters.find((c: any) => c.id === "haerin").revision,
        revision,
      );
      const deferred = await mutate(a, revision, "spritz", "defer");
      assert.equal(deferred.status, 200);
      character = (await deferred.json()).characters.find(
        (c: any) => c.id === "haerin",
      );
      assert.ok(
        character.unlocks.some(
          (u: any) => u.skillId === "spritz" && u.decision === "deferred",
        ),
      );
      assert.deepEqual(character.skills, original.skills);
      assert.equal((await mutate(a, character.revision, "spritz")).status, 409);
      assert.equal(
        (await mutate(a, character.revision, "spritz", "learn", 4)).status,
        400,
      );
      const responses = await Promise.all(
        [0, 1].map(() => mutate(a, character.revision, "spritz", "learn", 1)),
      );
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      character = (
        await responses.find((r) => r.status === 200)!.json()
      ).characters.find((c: any) => c.id === "haerin");
      assert.deepEqual(character.skills, ["tide", "spritz", "brine", "reef"]);
      assert.ok(character.unlocks.some((u: any) => u.skillId === "surge"));
      const restored = await mutate(a, character.revision, "surge", "learn", 1);
      assert.equal(restored.status, 200);
      character = (await restored.json()).characters.find(
        (c: any) => c.id === "haerin",
      );
      assert.deepEqual(character.skills, original.skills);
      assert.ok(character.unlocks.some((u: any) => u.skillId === "spritz"));
      const again = await mutate(a, character.revision, "spritz", "learn", 1);
      assert.equal(again.status, 200);
      const second = await get(b);
      assert.equal(
        second.characters.find((c: any) => c.id === "haerin").level,
        1,
      );
      assert.deepEqual(
        second.characters.find((c: any) => c.id === "haerin").skills,
        original.skills,
      );
      // The database itself rejects a fifth slot even if a future caller bypasses the route.
      await assert.rejects(
        db.characterEquippedSkill.update({
          where: {
            userId_characterId_slot: {
              userId: a.id,
              characterId: "haerin",
              slot: 3,
            },
          },
          data: { slot: 4 },
        }),
      );
      await db.characterEquippedSkill.delete({
        where: {
          userId_characterId_slot: {
            userId: a.id,
            characterId: "haerin",
            slot: 3,
          },
        },
      });
      const empty = (await get(a)).characters.find(
        (c: any) => c.id === "haerin",
      );
      assert.equal(empty.skills.length, 3);
      const fill = await mutate(a, empty.revision, "reef");
      assert.equal(fill.status, 200);
      const filled = (await fill.json()).characters.find(
        (c: any) => c.id === "haerin",
      );
      assert.equal(
        filled.equipped.find((s: any) => s.slot === 3).skillId,
        "reef",
      );
      s.disconnect();
      await new Promise((r) => setTimeout(r, 150));
      character = (await get(a)).characters.find((c: any) => c.id === "haerin");
      assert.deepEqual(character.skills, ["tide", "spritz", "brine", "reef"]);
      assert.equal(character.unlocks.length, 5);
      const resumed = io(base!, {
        autoConnect: false,
        extraHeaders: { Cookie: a.cookie },
      });
      sockets.push(resumed);
      await new Promise<void>((resolve, reject) => {
        resumed.once("world:ready", () => resolve());
        resumed.once("connect_error", reject);
        resumed.connect();
        setTimeout(() => reject(new Error("resume timeout")), 4000).unref();
      });
      const nextBattle = (
        await (
          await post(a, "/api/battle/start", { encounterId: "coral-crab" })
        ).json()
      ).battle;
      assert.deepEqual(nextBattle.team[0].skills, [
        "tide",
        "spritz",
        "brine",
        "reef",
      ]);
      assert.equal(nextBattle.team[0].maxHp, 288);
      const learnedAction = await post(a, "/api/battle/action", {
        battleId: nextBattle.id,
        expectedVersion: 0,
        action: { type: "skill", skillId: "spritz" },
      });
      assert.equal(learnedAction.status, 200);
      const used = (await learnedAction.json()).battle;
      assert.match(used.log[0], /해린 → 산호 집게게/);
      assert.ok(used.enemy.hp < 220);
      assert.equal(
        (await mutate(a, character.revision, "surge", "learn", 1)).status,
        409,
      );
    } finally {
      for (const s of sockets) s.disconnect();
      await new Promise((r) => setTimeout(r, 200));
      await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
      await db.$disconnect();
    }
  },
);
