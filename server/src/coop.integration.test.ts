import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import type { CoopState } from "../../shared/coop.js";
const base = process.env.TEST_BASE_URL;
async function eventually(fn: () => boolean | Promise<boolean>) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.fail("Timed out waiting for cooperative state");
}
test(
  "four-account consent, one shared round, recharge, withdrawals, personal rewards and host disconnect",
  { skip: !base },
  async () => {
    const db = new PrismaClient(),
      prefix = "coop_" + Date.now();
    const users: {
      id: string;
      username: string;
      worldId: string;
      cookie: string;
      socket: Socket;
      world: string;
    }[] = [];
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
    async function get(u: (typeof users)[number], path: string) {
      const r = await fetch(base + path, { headers: { Cookie: u.cookie } });
      assert.equal(r.status, 200);
      return r.json();
    }
    async function command(
      u: (typeof users)[number],
      operation: string,
      body: unknown,
    ) {
      return post(u, "/api/coop/" + operation, body);
    }
    async function state(id: string) {
      return (await db.coopBattle.findUniqueOrThrow({ where: { id } }))
        .state as unknown as CoopState;
    }
    try {
      for (let i = 0; i < 5; i++) {
        const user = await db.user.create({
          data: {
            username: prefix + i,
            nickname: "협동" + i,
            passwordHash: "fixture-unused",
            world: { create: {} },
          },
          include: { world: true },
        });
        const token = randomBytes(32).toString("hex");
        await db.session.create({
          data: {
            id: createHash("sha256").update(token).digest("hex"),
            userId: user.id,
            expiresAt: new Date(Date.now() + 120000),
          },
        });
        const u = {
          id: user.id,
          username: user.username,
          worldId: user.world!.id,
          cookie: "solara=" + token,
          socket: io(base!, {
            autoConnect: false,
            extraHeaders: { Cookie: "solara=" + token },
          }),
          world: "",
        };
        users.push(u);
        await new Promise<void>((resolve, reject) => {
          u.socket.on("world:ready", (r) => {
            u.world = r.worldId;
            resolve();
          });
          u.socket.once("connect_error", reject);
          u.socket.connect();
          setTimeout(() => reject(new Error("connect timeout")), 4000).unref();
        });
      }
      const [host, a, b, c, outside] = users;
      await db.worldQuest.createMany({ data: [host, a].flatMap((u) => [
        { worldId: u.worldId, questId: "first-gift", progress: 1, acceptedAt: new Date(Date.now() - 1000), claimedAt: new Date() },
        { worldId: u.worldId, questId: "coast-guardian", progress: 0, acceptedAt: new Date(), claimedAt: null },
      ]) });
      await post(host, "/api/social/access", { access: "request" });
      for (const u of [a, b, c]) {
        assert.equal(
          (await post(u, "/api/social/request", { username: host.username }))
            .status,
          200,
        );
        const request = (await get(host, "/api/social")).entries.find(
          (e: any) => e.incoming,
        );
        assert.equal(
          (
            await post(host, "/api/social/entry-answer", {
              id: request.id,
              decision: "accept",
            })
          ).status,
          200,
        );
      }
      assert.equal(
        (await command(a, "start", { encounterId: "coral-crab" })).status,
        403,
      );
      const start = await command(host, "start", { encounterId: "coral-crab" });
      assert.equal(start.status, 200);
      const first = (await start.json()).battle;
      const id = first.id;
      assert.equal(first.coop.lobby, true);
      assert.equal(first.coop.party.length, 4);
      assert.equal(
        (await command(outside, "ready", { battleId: id })).status,
        403,
      );
      assert.equal(
        (await post(host, "/api/battle/start", { encounterId: "coral-crab" }))
          .status,
        409,
      );
      assert.equal(
        (
          await post(host, "/api/training", {
            characterId: "haerin",
            skillId: "spritz",
            expectedRevision: 0,
            action: "learn",
            replaceSlot: 0,
          })
        ).status,
        409,
      );
      for (const u of [a, b, c])
        assert.equal((await command(u, "ready", { battleId: id })).status, 200);
      let s = await state(id);
      assert.equal(s.status, "active");
      assert.equal(s.enemy.maxHp, 748);
      assert.ok(s.enemy.statusImmunities.includes("freeze"));
      assert.equal(
        (
          await command(host, "action", {
            battleId: id,
            expectedRound: 1,
            action: { type: "skill", skillId: "spritz" },
          })
        ).status,
        400,
      );
      const firstChoice = await command(host, "action", {
        battleId: id,
        expectedRound: 1,
        action: { type: "skill", skillId: "surge" },
      });
      assert.equal(firstChoice.status, 200);
      assert.equal(
        (
          await command(host, "action", {
            battleId: id,
            expectedRound: 1,
            action: { type: "defend" },
          })
        ).status,
        409,
      );
      assert.equal((await state(id)).enemy.hp, 748);
      assert.equal((await state(id)).round, 1);
      assert.equal(await db.coopRound.count({ where: { battleId: id } }), 0);
      const privateView = (await get(a, "/api/battle")).battle;
      assert.equal("choice" in privateView.coop.party[0], false);
      assert.equal("team" in privateView.coop.party[0], false);
      // An extra userId field cannot redirect a request to another player's team.
      assert.equal(
        (
          await command(a, "action", {
            battleId: id,
            expectedRound: 1,
            userId: b.id,
            action: { type: "switch", slot: 1 },
          })
        ).status,
        200,
      );
      assert.equal(
        (await state(id)).members.find((m) => m.userId === b.id)!.choice,
        null,
      );
      await command(b, "action", {
        battleId: id,
        expectedRound: 1,
        action: { type: "defend" },
      });
      await command(c, "action", {
        battleId: id,
        expectedRound: 1,
        action: { type: "skill", skillId: "tide" },
      });
      s = await state(id);
      assert.equal(s.round, 2);
      assert.equal(await db.coopRound.count({ where: { battleId: id } }), 1);
      assert.ok(s.enemy.hp < 748);
      assert.equal(
        s.members.find((m) => m.userId === a.id)!.state.activeSlot,
        1,
      );
      assert.equal(
        s.members.find((m) => m.userId === b.id)!.state.activeSlot,
        0,
      );
      assert.deepEqual(s.members.find((m) => m.userId === host.id)!.choice, {
        type: "wait",
      });
      for (const u of [a, b, c])
        assert.equal(
          (
            await command(u, "action", {
              battleId: id,
              expectedRound: 2,
              action: { type: "skill", skillId: u === a ? "breeze" : "tide" },
            })
          ).status,
          200,
        );
      s = await state(id);
      assert.equal(s.round, 3);
      assert.equal(
        (
          await command(host, "action", {
            battleId: id,
            expectedRound: 1,
            action: { type: "defend" },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await post(a, "/api/world/chest", {
            worldId: host.worldId,
            chestId: "coast-1",
          })
        ).status,
        403,
      );
      assert.equal((await command(c, "leave", { battleId: id })).status, 200);
      assert.equal(
        await db.coopMember.findUnique({ where: { activeUserId: c.id } }),
        null,
      );
      await command(b, "leave", { battleId: id });
      b.socket.disconnect();
      await eventually(
        async () =>
          !(await db.coopMember.findUnique({ where: { activeUserId: b.id } })),
      );
      for (let step = 0; step < 45; step++) {
        s = await state(id);
        if (s.status !== "active") break;
        const round = s.round;
        for (const u of [host, a]) {
          s = await state(id);
          if (s.status !== "active" || s.round !== round) break;
          const member = s.members.find((m) => m.userId === u.id)!;
          if (member.choice || member.state.team.every((f) => f.hp <= 0))
            continue;
          const action =
            member.state.phase === "replacement"
              ? {
                  type: "switch",
                  slot: member.state.team.findIndex((f) => f.hp > 0),
                }
              : {
                  type: "skill",
                  skillId: member.state.team[member.state.activeSlot].skills[0],
                };
          const r = await command(u, "action", {
            battleId: id,
            expectedRound: s.round,
            action,
          });
          assert.equal(r.status, 200);
        }
      }
      s = await state(id);
      assert.equal(s.status, "won");
      assert.equal((await db.worldQuest.findUniqueOrThrow({ where: { worldId_questId: { worldId: host.worldId, questId: "coast-guardian" } } })).progress, 1);
      assert.equal((await db.worldQuest.findUniqueOrThrow({ where: { worldId_questId: { worldId: a.worldId, questId: "coast-guardian" } } })).progress, 0);
      assert.equal(await db.coopReward.count({ where: { battleId: id } }), 2);
      for (const u of [host, a]) {
        assert.equal(
          (
            await db.coopReward.findUniqueOrThrow({
              where: { battleId_userId: { battleId: id, userId: u.id } },
            })
          ).experience,
          120,
        );
        assert.equal((await get(u, "/api/training")).characters[0].level, 4);
      }
      for (const u of [b, c, outside]) {
        assert.equal(
          await db.coopReward.count({ where: { battleId: id, userId: u.id } }),
          0,
        );
        assert.equal((await get(u, "/api/training")).characters[0].level, 1);
      }
      assert.equal(
        (
          await command(a, "action", {
            battleId: id,
            expectedRound: s.round,
            action: { type: "defend" },
          })
        ).status,
        403,
      );
      assert.equal(await db.coopReward.count({ where: { battleId: id } }), 2);
      assert.equal(
        await db.worldChest.count({ where: { worldId: host.worldId } }),
        0,
      );
      assert.deepEqual(
        (await db.world.findUniqueOrThrow({ where: { id: host.worldId } }))
          .progress,
        {},
      );
      // Explicit host cancellation followed by disconnect still returns guests immediately.
      const second = await command(host, "start", {
        encounterId: "coral-crab",
      });
      assert.equal(second.status, 200);
      const id2 = (await second.json()).battle.id;
      assert.equal((await command(c, "leave", { battleId: id2 })).status, 200);
      assert.equal((await command(a, "ready", { battleId: id2 })).status, 200);
      assert.equal((await state(id2)).status, "active");
      await db.coopBattle.update({
        where: { id: id2 },
        data: { deadline: new Date(Date.now() - 1000) },
      });
      await eventually(async () => (await state(id2)).round === 2);
      assert.equal(await db.coopRound.count({ where: { battleId: id2 } }), 1);
      assert.equal((await state(id2)).enemy.hp, (await state(id2)).enemy.maxHp);
      await command(host, "leave", { battleId: id2 });
      host.socket.disconnect();
      await eventually(async () => (await state(id2)).status === "abandoned");
      await eventually(() => a.world === a.worldId && c.world === c.worldId);
      assert.equal(
        await db.coopMember.count({
          where: { battleId: id2, activeUserId: { not: null } },
        }),
        0,
      );
      assert.equal(await db.coopReward.count({ where: { battleId: id2 } }), 0);
      await new Promise<void>((resolve, reject) => {
        host.socket.once("world:ready", () => resolve());
        host.socket.once("connect_error", reject);
        host.socket.connect();
        setTimeout(
          () => reject(new Error("host reconnect timeout")),
          4000,
        ).unref();
      });
      await post(a, "/api/social/request", { username: host.username });
      const again = (await get(host, "/api/social")).entries.find(
        (e: any) => e.incoming,
      );
      await post(host, "/api/social/entry-answer", {
        id: again.id,
        decision: "accept",
      });
      const expiring = await command(host, "start", {
        encounterId: "coral-crab",
      });
      assert.equal(expiring.status, 200);
      const id3 = (await expiring.json()).battle.id;
      await db.coopBattle.update({
        where: { id: id3 },
        data: { deadline: new Date(Date.now() - 1000) },
      });
      await eventually(async () => (await state(id3)).status === "abandoned");
      assert.equal(
        await db.coopMember.count({
          where: { battleId: id3, activeUserId: { not: null } },
        }),
        0,
      );
      const blocking = await command(host, "start", {
        encounterId: "coral-crab",
      });
      assert.equal(blocking.status, 200);
      const id4 = (await blocking.json()).battle.id;
      await command(a, "ready", { battleId: id4 });
      assert.equal((await state(id4)).status, "active");
      assert.equal(
        (await post(host, "/api/social/access", { access: "blocked" })).status,
        200,
      );
      await eventually(
        async () =>
          (await state(id4)).status === "abandoned" && a.world === a.worldId,
      );
      assert.equal(
        await db.coopMember.count({
          where: { battleId: id4, activeUserId: { not: null } },
        }),
        0,
      );
      assert.equal(await db.coopReward.count({ where: { battleId: id4 } }), 0);
    } finally {
      for (const u of users) u.socket.disconnect();
      await new Promise((r) => setTimeout(r, 300));
      await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
      await db.$disconnect();
    }
  },
);
