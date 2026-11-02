import { test } from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
const base = process.env.TEST_BASE_URL;
test(
  "accounts, sessions, world isolation, duplicate protection and server movement",
  { skip: !base },
  async () => {
    const db = new PrismaClient();
    const prefix = "test_" + Date.now();
    const sockets: ReturnType<typeof io>[] = [];
    async function post(path: string, body: unknown, cookie = "") {
      return fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
    }
    try {
      const a = await post("/api/register", {
        username: prefix + "a",
        password: "test-password-123",
        nickname: "바다",
      });
      assert.equal(a.status, 200);
      const cookie = a.headers.get("set-cookie")!.split(";")[0];
      assert.match(a.headers.get("set-cookie")!, /HttpOnly/i);
      assert.match(a.headers.get("set-cookie")!, /SameSite=Strict/i);
      const b = await post("/api/register", {
        username: prefix + "b",
        password: "test-password-123",
        nickname: "산호",
      });
      assert.equal(b.status, 200);
      const cb = b.headers.get("set-cookie")!.split(";")[0];
      const me = await (
        await fetch(base + "/api/me", { headers: { Cookie: cookie } })
      ).json();
      const other = await (
        await fetch(base + "/api/me", { headers: { Cookie: cb } })
      ).json();
      assert.notEqual(me.world.id, other.world.id);
      assert.equal(me.nickname, "바다");
      assert.equal(
        (
          await post("/api/login", {
            username: prefix + "a",
            password: "wrong-password",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await post(
            "/api/world/chest",
            { worldId: me.world.id, chestId: "coast-1" },
            cb,
          )
        ).status,
        403,
      );
      const s = io(base!, {
        extraHeaders: { Cookie: cookie },
        autoConnect: false,
      });
      sockets.push(s);
      await new Promise<void>((resolve, reject) => {
        s.on("world:ready", (ready) => {
          assert.equal(ready.worldId, me.world.id);
          s.emit("world:move", { x: 9999, y: 9999 });
        });
        s.once("world:position", (p) => {
          assert.ok(Math.hypot(p.x - 800, p.y - 560) <= 18.001);
          resolve();
        });
        s.on("connect_error", reject);
        s.connect();
        setTimeout(() => reject(new Error("socket timeout")), 4000).unref();
      });

      // Idle acknowledgements remain available without rebroadcasting an unchanged party.
      await new Promise((resolve) => setTimeout(resolve, 60));
      let idleBroadcasts = 0;
      const idleListener = () => { idleBroadcasts++; };
      s.on("world:players", idleListener);
      for (let i = 0; i < 5; i++) {
        await new Promise<void>((resolve) => {
          s.once("world:position", () => resolve());
          s.emit("world:move", { x: 0, y: 0 });
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
      s.off("world:players", idleListener);
      assert.equal(idleBroadcasts, 0);

      // A remote chest cannot be opened, even by the owner.
      assert.equal(
        (
          await post(
            "/api/world/chest",
            { worldId: me.world.id, chestId: "harbor-1" },
            cookie,
          )
        ).status,
        409,
      );
      let position = { x: 800, y: 560 };
      s.on("world:position", (p) => (position = p));
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 55));
        s.emit("world:move", { x: 1, y: 0 });
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.ok(position.x > 830);
      const results = await Promise.all(
        [0, 1].map(() =>
          post(
            "/api/world/chest",
            { worldId: me.world.id, chestId: "coast-1" },
            cookie,
          ).then((r) => r.json()),
        ),
      );
      assert.equal(results.filter((x) => x.opened).length, 1);
      const restored = await (
        await fetch(base + "/api/me", { headers: { Cookie: cookie } })
      ).json();
      assert.deepEqual(restored.world.progress.chests, ["coast-1"]);
      const untouched = await (
        await fetch(base + "/api/me", { headers: { Cookie: cb } })
      ).json();
      assert.deepEqual(untouched.world.progress, {});
      const saved = await s.timeout(4000).emitWithAck("world:save");
      assert.equal(saved.ok, true);
      const row = await db.world.findUniqueOrThrow({
        where: { id: me.world.id },
      });
      assert.ok(Math.abs(row.positionX - position.x) < 0.001);
      s.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const again = io(base!, {
        extraHeaders: { Cookie: cookie },
        autoConnect: false,
      });
      sockets.push(again);
      const ready = await new Promise<{
        position: { x: number; y: number };
        opened: string[];
      }>((resolve, reject) => {
        again.once("world:ready", resolve);
        again.once("connect_error", reject);
        again.connect();
        setTimeout(() => reject(new Error("reconnect timeout")), 4000).unref();
      });
      assert.deepEqual(ready.position, position);
      assert.deepEqual(ready.opened, ["coast-1"]);
      // A second chest must not overwrite unrelated progress or legacy opened chests.
      again.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await db.world.update({
        where: { id: me.world.id },
        data: {
          positionX: 1260,
          positionY: 850,
          progress: { quest: "intro-started", chests: ["grove-1"] },
        },
      });
      const harbor = io(base!, {
        extraHeaders: { Cookie: cookie },
        autoConnect: false,
      });
      sockets.push(harbor);
      await new Promise<void>((resolve, reject) => {
        harbor.once("world:ready", () => resolve());
        harbor.once("connect_error", reject);
        harbor.connect();
        setTimeout(() => reject(new Error("harbor timeout")), 4000).unref();
      });
      const second = await post(
        "/api/world/chest",
        { worldId: me.world.id, chestId: "harbor-1" },
        cookie,
      );
      assert.equal(second.status, 200);
      assert.equal((await second.json()).opened, true);
      const finalWorld = await (
        await fetch(base + "/api/me", { headers: { Cookie: cookie } })
      ).json();
      assert.equal(finalWorld.world.progress.quest, "intro-started");
      assert.deepEqual([...finalWorld.world.progress.chests].sort(), [
        "coast-1",
        "grove-1",
        "harbor-1",
      ]);
      const logout = await post("/api/logout", {}, cookie);
      assert.equal(logout.status, 200);
      assert.equal(
        (await fetch(base + "/api/me", { headers: { Cookie: cookie } })).status,
        401,
      );
    } finally {
      for (const s of sockets) s.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
      await db.$disconnect();
    }
  },
);
