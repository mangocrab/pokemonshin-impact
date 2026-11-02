import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { io, type Socket } from "socket.io-client";
import type { BattleState } from "../../shared/combat.js";
const base = process.env.TEST_BASE_URL;
test(
  "battle API persists turns, rejects replay and foreign actions, restores after reconnect, and preserves co-op permissions",
  { skip: !base },
  async () => {
    const db = new PrismaClient(),
      prefix = "bt_" + Date.now();
    const sockets: Socket[] = [];
    const users: {
      id: string;
      worldId: string;
      username: string;
      cookie: string;
      socket: Socket;
    }[] = [];
    const tokenHash = (raw: string) =>
      createHash("sha256").update(raw).digest("hex");
    async function post(
      user: (typeof users)[number],
      path: string,
      body: unknown,
    ) {
      return fetch(base + path, {
        method: "POST",
        headers: { Cookie: user.cookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    async function get(user: (typeof users)[number], path: string) {
      return (
        await fetch(base + path, { headers: { Cookie: user.cookie } })
      ).json();
    }
    async function connect(user: (typeof users)[number]) {
      const s = io(base!, {
        autoConnect: false,
        extraHeaders: { Cookie: user.cookie },
      });
      sockets.push(s);
      user.socket = s;
      await new Promise<void>((resolve, reject) => {
        s.once("world:ready", () => resolve());
        s.once("connect_error", reject);
        s.connect();
        setTimeout(() => reject(new Error("world timeout")), 4000).unref();
      });
    }
    try {
      for (let i = 0; i < 2; i++) {
        const u = await db.user.create({
          data: {
            username: prefix + i,
            nickname: "전투검증" + i,
            passwordHash: "fixture-unused",
            world: {
              create: {
                positionX: i === 0 ? 800 : 1300,
                positionY: i === 0 ? 560 : 900,
              },
            },
          },
          include: { world: true },
        });
        const raw = randomBytes(32).toString("hex");
        await db.session.create({
          data: {
            id: tokenHash(raw),
            userId: u.id,
            expiresAt: new Date(Date.now() + 60000),
          },
        });
        const user = {
          id: u.id,
          worldId: u.world!.id,
          username: u.username,
          cookie: "solara=" + raw,
          socket: null as unknown as Socket,
        };
        users.push(user);
        await connect(user);
      }
      const [a, b] = users;
      assert.equal(
        (await post(b, "/api/battle/start", { encounterId: "coral-crab" }))
          .status,
        409,
      );
      assert.equal(
        (await post(a, "/api/battle/start", { encounterId: "unknown" })).status,
        400,
      );
      const starts = await Promise.all(
        [0, 1].map(() =>
          post(a, "/api/battle/start", { encounterId: "coral-crab" }),
        ),
      );
      const states = await Promise.all(starts.map((r) => r.json()));
      let battle = states[0].battle as BattleState;
      assert.equal(states[1].battle.id, battle.id);
      assert.equal(await db.battle.count({ where: { userId: a.id } }), 1);
      assert.equal(
        (await get(a, "/api/battle/characters")).characters.length,
        4,
      );
      assert.equal(
        (
          await post(b, "/api/battle/action", {
            battleId: battle.id,
            expectedVersion: 0,
            action: { type: "defend" },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await post(a, "/api/battle/action", {
            battleId: battle.id,
            expectedVersion: 0,
            action: { type: "skill", skillId: "flare" },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await post(a, "/api/world/chest", {
            worldId: a.worldId,
            chestId: "coast-1",
          })
        ).status,
        409,
      );
      let latestPosition: { x: number; y: number } | undefined;
      a.socket.on("world:position", (p) => (latestPosition = p));
      for (let i = 0; i < 3; i++) {
        a.socket.emit("world:move", { x: 1, y: 0 });
        await new Promise((r) => setTimeout(r, 55));
      }
      assert.equal(latestPosition, undefined);
      const actions = await Promise.all(
        [0, 1].map(() =>
          post(a, "/api/battle/action", {
            battleId: battle.id,
            expectedVersion: 0,
            action: { type: "switch", slot: 1 },
          }),
        ),
      );
      assert.deepEqual(actions.map((r) => r.status).sort(), [200, 409]);
      battle = (await actions.find((r) => r.status === 200)!.json()).battle;
      assert.equal(battle.activeSlot, 1);
      assert.equal(battle.round, 2);
      assert.equal(battle.version, 1);
      assert.equal(battle.enemy.hp, 220);
      assert.ok(battle.team[1].hp < 180);
      assert.equal(battle.team[0].hp, 240);
      assert.equal(
        await db.battleRound.count({ where: { battleId: battle.id } }),
        1,
      );
      a.socket.disconnect();
      await new Promise((r) => setTimeout(r, 150));
      await connect(a);
      assert.deepEqual((await get(a, "/api/battle")).battle, battle);
      // Battle sessions are private and block admitting a visitor during a solo battle.
      assert.equal(
        (await post(a, "/api/social/access", { access: "request" })).status,
        200,
      );
      assert.equal(
        (await post(b, "/api/social/request", { username: a.username })).status,
        200,
      );
      const entry = (await get(a, "/api/social")).entries.find(
        (e: any) => e.incoming,
      );
      assert.equal(
        (
          await post(a, "/api/social/entry-answer", {
            id: entry.id,
            decision: "accept",
          })
        ).status,
        409,
      );
      const flee = await post(a, "/api/battle/action", {
        battleId: battle.id,
        expectedVersion: battle.version,
        action: { type: "flee" },
      });
      assert.equal(flee.status, 200);
      assert.equal((await flee.json()).battle.status, "fled");
      assert.equal(
        (await db.battle.findUniqueOrThrow({ where: { id: battle.id } }))
          .activeUserId,
        null,
      );
      assert.equal(
        (
          await post(a, "/api/battle/action", {
            battleId: battle.id,
            expectedVersion: 2,
            action: { type: "defend" },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await post(a, "/api/social/entry-answer", {
            id: entry.id,
            decision: "accept",
          })
        ).status,
        200,
      );
      assert.equal(
        (await post(b, "/api/battle/start", { encounterId: "coral-crab" }))
          .status,
        403,
      );
      assert.equal(
        (await post(a, "/api/battle/start", { encounterId: "coral-crab" }))
          .status,
        409,
      );
      assert.equal((await post(b, "/api/social/leave", {})).status, 200);
      const start = await post(a, "/api/battle/start", {
        encounterId: "coral-crab",
      });
      battle = (await start.json()).battle;
      const burst = await post(a, "/api/battle/action", {
        battleId: battle.id,
        expectedVersion: battle.version,
        action: { type: "skill", skillId: "surge" },
      });
      assert.equal(burst.status, 200);
      battle = (await burst.json()).battle;
      assert.equal(battle.round, 2);
      assert.equal(battle.team[0].blockedUntilRound, 2);
      assert.equal(
        (
          await post(a, "/api/battle/action", {
            battleId: battle.id,
            expectedVersion: battle.version,
            action: { type: "switch", slot: 1 },
          })
        ).status,
        400,
      );
      a.socket.disconnect();
      await new Promise((r) => setTimeout(r, 150));
      await connect(a);
      assert.equal(
        (await get(a, "/api/battle")).battle.team[0].blockedUntilRound,
        2,
      );
      const rest = await post(a, "/api/battle/action", {
        battleId: battle.id,
        expectedVersion: battle.version,
        action: { type: "wait" },
      });
      assert.equal(rest.status, 200);
      battle = (await rest.json()).battle;
      assert.equal(battle.round, 3);
      assert.equal(
        (
          await post(a, "/api/battle/action", {
            battleId: battle.id,
            expectedVersion: battle.version,
            action: { type: "ultimate" },
          })
        ).status,
        400,
      );
      for (let turn = 0; turn < 16 && battle.status === "active"; turn++) {
        const active = battle.team[battle.activeSlot];
        const action =
          battle.phase === "replacement"
            ? {
                type: "switch",
                slot: battle.team.findIndex(
                  (c, i) => c.hp > 0 && i !== battle.activeSlot,
                ),
              }
            : { type: "skill", skillId: active.skills[0] };
        const r = await post(a, "/api/battle/action", {
          battleId: battle.id,
          expectedVersion: battle.version,
          action,
        });
        assert.equal(r.status, 200);
        battle = (await r.json()).battle;
      }
      assert.equal(battle.status, "won");
      assert.equal(
        (await db.battle.findUniqueOrThrow({ where: { id: battle.id } }))
          .status,
        "won",
      );
      assert.equal((await get(a, "/api/battle")).battle, null);
      const log = await db.battleRound.findMany({
        where: { battleId: battle.id },
        orderBy: { version: "asc" },
      });
      assert.equal(log.length, battle.version);
      assert.deepEqual(
        log.map((l) => l.version),
        Array.from({ length: battle.version }, (_, i) => i + 1),
      );
    } finally {
      for (const s of sockets) s.disconnect();
      await new Promise((r) => setTimeout(r, 250));
      await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
      await db.$disconnect();
    }
  },
);
