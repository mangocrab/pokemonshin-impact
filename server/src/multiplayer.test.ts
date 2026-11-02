import { test } from "node:test";
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
const base = process.env.TEST_BASE_URL;
type Client = {
  username: string;
  cookie: string;
  id: string;
  worldId: string;
  socket: Socket;
  ready: any;
  players: any[];
};
async function eventually(check: () => boolean | Promise<boolean>) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.fail("Timed out waiting for multiplayer state");
}
test(
  "friend consent, invitations, concurrent capacity, visitor isolation and host departure",
  { skip: !base },
  async () => {
    const db = new PrismaClient(),
      prefix = "mp_" + Date.now(),
      clients: Client[] = [],
      extra: Socket[] = [];
    async function post(c: Client, path: string, body: unknown) {
      return fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: c.cookie },
        body: JSON.stringify(body),
      });
    }
    async function act(c: Client, action: string, body: unknown) {
      return post(c, "/api/social/" + action, body);
    }
    async function state(c: Client) {
      const r = await fetch(base + "/api/social", {
        headers: { Cookie: c.cookie },
      });
      assert.equal(r.status, 200);
      return r.json();
    }
    async function entry(c: Client) {
      const s = await state(c);
      return s.entries.find((e: any) => e.incoming);
    }
    async function attach(c: Client) {
      await new Promise<void>((resolve, reject) => {
        c.socket.on("world:ready", (r) => {
          c.ready = r;
          resolve();
        });
        c.socket.on("world:players", (p) => (c.players = p));
        c.socket.once("connect_error", reject);
        c.socket.connect();
        setTimeout(() => reject(new Error("connect timeout")), 4000).unref();
      });
    }
    try {
      for (let i = 0; i < 5; i++) {
        const username = prefix + i;
        const r = await fetch(base + "/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            password: "multiplayer-test-password",
            nickname: "여행자" + i,
          }),
        });
        assert.equal(r.status, 200);
        const cookie = r.headers.get("set-cookie")!.split(";")[0];
        const me = await (
          await fetch(base + "/api/me", { headers: { Cookie: cookie } })
        ).json();
        const c = {
          username,
          cookie,
          id: me.id,
          worldId: me.world.id,
          socket: io(base!, {
            extraHeaders: { Cookie: cookie },
            autoConnect: false,
          }),
          ready: null,
          players: [],
        };
        clients.push(c);
        await attach(c);
      }
      const [host, a, b, c, d] = clients;
      assert.equal(
        (await act(a, "request", { username: host.username })).status,
        403,
      );
      assert.equal(
        (await act(host, "invite", { username: a.username })).status,
        403,
      );
      assert.equal(
        (await act(a, "friend", { username: host.username })).status,
        200,
      );
      const f = (await state(host)).friends.find((f: any) => f.incoming);
      assert.equal(
        (await act(b, "friend-answer", { id: f.id, decision: "accept" }))
          .status,
        403,
      );
      assert.equal(
        (await act(host, "friend-answer", { id: f.id, decision: "accept" }))
          .status,
        200,
      );
      assert.equal(
        (await act(host, "invite", { username: a.username })).status,
        200,
      );
      let e = await entry(a);
      assert.equal(
        (await act(b, "entry-answer", { id: e.id, decision: "accept" })).status,
        403,
      );
      assert.equal(
        (await act(a, "entry-answer", { id: e.id, decision: "reject" })).status,
        200,
      );
      assert.equal(a.ready.worldId, a.worldId);
      assert.equal(
        (await act(host, "invite", { username: a.username })).status,
        200,
      );
      e = await entry(a);
      assert.equal(
        (await act(a, "entry-answer", { id: e.id, decision: "accept" })).status,
        200,
      );
      await eventually(
        () => a.ready.worldId === host.worldId && host.players.length === 2,
      );
      assert.equal(a.ready.isOwner, false);
      assert.equal(
        (await act(a, "entry-answer", { id: e.id, decision: "accept" })).status,
        403,
      );
      assert.equal(
        (await act(host, "access", { access: "request" })).status,
        200,
      );
      const pending = [];
      for (const visitor of [b, c, d]) {
        assert.equal(
          (await act(visitor, "request", { username: host.username })).status,
          200,
        );
        const st = await state(host);
        pending.push(
          st.entries.find(
            (e: any) =>
              e.incoming && e.sender === "여행자" + clients.indexOf(visitor),
          ),
        );
      }
      const answers = await Promise.all(
        pending.map((e) =>
          act(host, "entry-answer", { id: e.id, decision: "accept" }),
        ),
      );
      assert.deepEqual(answers.map((r) => r.status).sort(), [200, 200, 409]);
      await eventually(() => host.players.length === 4);
      assert.equal(new Set(host.players.map((p) => p.userId)).size, 4);
      const remaining = clients
        .slice(2)
        .find((v) => v.ready.worldId !== host.worldId)!;
      const visiting = clients.filter(
        (v) => v !== host && v.ready.worldId === host.worldId,
      );
      for (const target of [host.worldId, a.worldId])
        assert.equal(
          (
            await post(a, "/api/world/chest", {
              worldId: target,
              chestId: "coast-1",
            })
          ).status,
          403,
        );
      const ownBefore = await db.world.findUniqueOrThrow({
        where: { id: a.worldId },
      });
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 55));
        a.socket.emit("world:move", { x: 1, y: 0, worldId: a.worldId });
      }
      await eventually(() =>
        host.players.some((p) => p.userId === a.id && p.position.x > 815),
      );
      const saved = await a.socket.timeout(4000).emitWithAck("world:save");
      assert.equal(saved.ok, true);
      const ownAfter = await db.world.findUniqueOrThrow({
        where: { id: a.worldId },
      });
      assert.equal(ownBefore.positionX, ownAfter.positionX);
      assert.equal(ownBefore.positionY, ownAfter.positionY);
      assert.equal((await act(a, "leave", {})).status, 200);
      await eventually(() => a.ready.worldId === a.worldId);
      const remainingEntry = (await state(host)).entries.find(
        (e: any) =>
          e.incoming && e.sender === "여행자" + clients.indexOf(remaining),
      );
      assert.equal(
        (
          await act(host, "entry-answer", {
            id: remainingEntry.id,
            decision: "accept",
          })
        ).status,
        200,
      );
      await eventually(() => host.players.length === 4);
      assert.equal(
        (await act(host, "access", { access: "blocked" })).status,
        200,
      );
      await eventually(
        () =>
          clients.slice(1).every((v) => v.ready.worldId === v.worldId) &&
          host.players.length === 1,
      );
      assert.equal(
        (await act(a, "request", { username: host.username })).status,
        403,
      );
      assert.equal(
        (await act(host, "access", { access: "invite" })).status,
        200,
      );
      assert.equal(
        (await act(host, "invite", { username: a.username })).status,
        200,
      );
      e = await entry(a);
      assert.equal(
        (await act(a, "entry-answer", { id: e.id, decision: "accept" })).status,
        200,
      );
      await eventually(() => a.ready.worldId === host.worldId);
      // Host access changes and expired consent cannot be bypassed with old IDs.
      assert.equal((await act(a, "leave", {})).status, 200);
      assert.equal(
        (await act(host, "invite", { username: a.username })).status,
        200,
      );
      const stale = await entry(a);
      await db.worldEntry.update({
        where: { id: stale.id },
        data: { createdAt: new Date(Date.now() - 6 * 60000) },
      });
      assert.equal(
        (await act(a, "entry-answer", { id: stale.id, decision: "accept" }))
          .status,
        403,
      );
      assert.equal(
        (await act(host, "invite", { username: a.username })).status,
        200,
      );
      const blocked = await entry(a);
      assert.equal(
        (await act(host, "access", { access: "blocked" })).status,
        200,
      );
      assert.equal(
        (await act(a, "entry-answer", { id: blocked.id, decision: "accept" }))
          .status,
        403,
      );
      assert.equal(
        (await act(a, "entry-answer", { id: blocked.id, decision: "reject" }))
          .status,
        403,
      );
      assert.equal(
        (await act(host, "access", { access: "request" })).status,
        200,
      );
      assert.equal(
        (await act(b, "request", { username: host.username })).status,
        200,
      );
      const request = (await state(host)).entries.find((e: any) => e.incoming);
      assert.equal(
        (
          await act(host, "entry-answer", {
            id: request.id,
            decision: "reject",
          })
        ).status,
        200,
      );
      assert.equal(b.ready.worldId, b.worldId);
      assert.equal(
        (await act(host, "invite", { username: a.username })).status,
        200,
      );
      const latest = await entry(a);
      assert.equal(
        (await act(a, "entry-answer", { id: latest.id, decision: "accept" }))
          .status,
        200,
      );
      await eventually(() => a.ready.worldId === host.worldId);
      // A second tab is one player, and closing one owner tab must not eject guests.
      const tab = io(base!, {
        extraHeaders: { Cookie: host.cookie },
        autoConnect: false,
      });
      extra.push(tab);
      await new Promise<void>((resolve, reject) => {
        tab.once("world:ready", () => resolve());
        tab.once("connect_error", reject);
        tab.connect();
        setTimeout(() => reject(new Error("tab timeout")), 4000).unref();
      });
      host.socket.disconnect();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(a.ready.worldId, host.worldId);
      assert.equal((await state(a)).players.length, 2);
      assert.equal((await post(host, "/api/logout", {})).status, 200);
      await eventually(() => a.ready.worldId === a.worldId);
      assert.equal(a.ready.isOwner, true);
      assert.equal(
        await db.worldChest.count({ where: { worldId: host.worldId } }),
        0,
      );
    } finally {
      for (const c of clients) c.socket.disconnect();
      for (const s of extra) s.disconnect();
      await new Promise((r) => setTimeout(r, 350));
      await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
      await db.$disconnect();
    }
  },
);
