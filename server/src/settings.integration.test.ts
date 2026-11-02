import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
import { DEFAULT_SETTINGS } from "../../shared/settings.js";
const base = process.env.TEST_BASE_URL;
test("settings persist per account, validate fields and reject simultaneous stale writes", { skip: !base }, async () => {
  const db = new PrismaClient(), users: { id: string; cookie: string }[] = [];
  async function get(cookie = users[0].cookie) {
    return fetch(base + "/api/settings", { headers: { Cookie: cookie } });
  }
  async function put(body: unknown, cookie = users[0].cookie) {
    return fetch(base + "/api/settings", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  try {
    assert.equal((await fetch(base + "/api/settings")).status, 401);
    for (let i = 0; i < 2; i++) {
      const user = await db.user.create({ data: { username: `settings_${Date.now()}_${i}`, nickname: "설정 검증", passwordHash: "fixture-unused", world: { create: {} } } });
      const token = randomBytes(32).toString("hex");
      await db.session.create({ data: { userId: user.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 180000) } });
      users.push({ id: user.id, cookie: `solara=${token}` });
    }
    const initial = await (await get()).json();
    assert.deepEqual(initial, { ...DEFAULT_SETTINGS, revision: 0 });
    const draft = { ...DEFAULT_SETTINGS, quality: "low", shadows: false, reducedMotion: true, muted: false, volume: 17, expectedRevision: 0 };
    for (const invalid of [{ ...draft, volume: 101 }, { ...draft, volume: 1.5 }, { ...draft, quality: "ultra" }, { ...draft, muted: "false" }, { ...draft, userId: users[1].id }, { ...draft, expectedRevision: -1 }]) {
      assert.equal((await put(invalid)).status, 400);
    }
    const simultaneous = await Promise.all([put(draft), put({ ...draft, volume: 29 })]);
    assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 409]);
    const saved = await (await get()).json();
    assert.equal(saved.revision, 1); assert.equal(saved.quality, "low");
    assert.equal(saved.shadows, false); assert.equal(saved.reducedMotion, true);
    assert.ok([17, 29].includes(saved.volume)); assert.equal(saved.muted, false);
    assert.equal((await put(draft)).status, 409);
    assert.deepEqual(await (await get(users[1].cookie)).json(), initial);
    assert.equal((await db.userSettings.findUniqueOrThrow({ where: { userId: users[0].id } })).volume, saved.volume);
    await assert.rejects(db.userSettings.update({ where: { userId: users[0].id }, data: { volume: -1 } }));
    await assert.rejects(db.userSettings.update({ where: { userId: users[0].id }, data: { quality: "bad" } }));
    assert.deepEqual(await (await get()).json(), saved);
    const reset = await put({ ...DEFAULT_SETTINGS, expectedRevision: 1 });
    assert.equal(reset.status, 200); assert.deepEqual(await reset.json(), { ...DEFAULT_SETTINGS, revision: 2 });
  } finally {
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }); await db.$disconnect();
  }
});
