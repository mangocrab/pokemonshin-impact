import { test } from "node:test";
import assert from "node:assert/strict";
import { createBattle } from "./combat/engine.js";
import { resolveIfReady } from "./combat/coop.js";
import { SANCTUARY_ENCOUNTER, blockedReason } from "../../shared/combat.js";
import { cooperativeEnemy, type CoopState } from "../../shared/coop.js";
function party(count = 4): CoopState {
  const members = Array.from({ length: count }, (_, i) => {
    const state = createBattle("bloom-coop", undefined, SANCTUARY_ENCOUNTER);
    state.activeSlot = 3;
    state.team[3].hp = state.team[3].maxHp = 2000;
    return { userId: "p" + i, nickname: "동료" + i, ready: true, left: false, state, choice: null };
  });
  return { id: "bloom-coop", ownerId: "p0", worldId: "world", version: 0, round: 1, status: "active", deadline: Date.now() + 60000, enemy: cooperativeEnemy(createBattle("bloom-coop", undefined, SANCTUARY_ENCOUNTER).enemy, count), members, log: [] };
}
test("co-op scales each encounter from base stats once and preserves the original guardian", () => {
  for (const n of [2, 3, 4]) {
    const bloom = cooperativeEnemy(createBattle("b", undefined, SANCTUARY_ENCOUNTER).enemy, n);
    assert.equal(bloom.name, "안뜰 만개지기"); assert.equal(bloom.element, "자연");
    assert.equal(bloom.maxHp, Math.round(320 * (1 + 0.8 * (n - 1))));
    assert.equal(bloom.attack, Math.round(38 * (1 + 0.15 * (n - 1))));
    assert.deepEqual(cooperativeEnemy(bloom, n), bloom);
    const crab = cooperativeEnemy(createBattle("c").enemy, n);
    assert.equal(crab.name, "산호 수호게"); assert.equal(crab.maxHp, Math.round(220 * (1 + 0.8 * (n - 1))));
    assert.equal(crab.attack, Math.round(36 * (1 + 0.15 * (n - 1))));
  }
  for (const n of [1, 5, 2.5]) assert.throws(() => cooperativeEnemy(createBattle("b").enemy, n));
});
test("four players receive one shared bloom burst, one recharge penalty and a genuine next-round recovery window", () => {
  const s = party(); s.round = 3;
  for (const m of s.members) { m.state.round = 3; m.choice = { type: "defend" }; }
  resolveIfReady(s, () => 0.1);
  assert.equal(s.round, 4); assert.equal(s.enemy.blockedUntilRound, 4);
  assert.equal(s.log.filter((l) => l.includes("한여름의 만개:")).length, 4);
  assert.equal(s.log.filter((l) => l.includes("다음 1라운드 행동 불가")).length, 1);
  assert.ok(s.members.every((m) => m.state.team[3].hp < 2000));
  const hp = s.members.map((m) => m.state.team[3].hp);
  for (const m of s.members) m.choice = { type: "defend" };
  resolveIfReady(s, () => 0.1);
  assert.deepEqual(s.members.map((m) => m.state.team[3].hp), hp); assert.equal(blockedReason(s.enemy, 5), "");
  for (const m of s.members) m.choice = { type: "defend" };
  resolveIfReady(s, () => 0.1);
  assert.equal(s.members.filter((m, i) => m.state.team[3].hp < hp[i]).length, 1);
  assert.equal(s.log.filter((l) => l.includes("휘감는 줄기:")).length, 1);
});
test("pending bloom choices wait for every member and a reconnect pause cannot execute area attacks", () => {
  const s = party(); s.round = 3;
  for (const m of s.members) m.state.round = 3;
  for (const m of s.members.slice(0, 3)) m.choice = { type: "defend" };
  assert.equal(resolveIfReady(s), undefined); assert.equal(s.round, 3);
  s.members[3].choice = { type: "defend" }; s.members[3].reconnectUntil = Date.now() + 30000;
  assert.equal(resolveIfReady(s), undefined); assert.equal(s.enemy.blockedUntilRound, 0);
  delete s.members[3].reconnectUntil;
  assert.equal(resolveIfReady(s, () => 0.1)?.round, 3); assert.equal(s.round, 4);
});
