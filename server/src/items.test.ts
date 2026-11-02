import { test } from "node:test";
import assert from "node:assert/strict";
import { createBattle, resolveBattle, validateBattleAction } from "./combat/engine.js";
import { resolveIfReady } from "./combat/coop.js";
import type { CoopState } from "../../shared/coop.js";
function battle() { const s = createBattle("items"); s.enemy.blockedUntilRound = 1; return s; }
test("tonic is fixed half-maxHP healing with no STAB/gear scaling and no overheal", () => {
  const s = battle(); s.team[0].hp = 10; s.team[0].healingBonus = 10; s.team[0].energy = 17;
  const next = resolveBattle(s, { type: "item", itemId: "summer-tonic" }, () => 0.9);
  assert.equal(next.team[0].hp, 130); assert.equal(next.team[0].energy, 17); assert.equal(next.round, 2);
  assert.deepEqual(next.itemUses, ["summer-tonic"]); assert.equal(s.team[0].hp, 10);
  s.team[0].hp = 230; assert.equal(resolveBattle(s, { type: "item", itemId: "summer-tonic" }).team[0].hp, 240);
});
test("cleansing removes statuses without healing, adding energy or resetting cooldowns", () => {
  const s = battle(), f = s.team[0]; f.hp = 100; f.statuses = [{ id: "burn", expiresAfterRound: 8 }, { id: "slow", expiresAfterRound: 8 }, { id: "bind", expiresAfterRound: 8 }]; f.cooldowns.reef = 5;
  const next = resolveBattle(s, { type: "item", itemId: "cleansing-salt" }, () => 0.9);
  assert.deepEqual(next.team[0].statuses, []); assert.equal(next.team[0].hp, 100); assert.equal(next.team[0].energy, 0); assert.equal(next.team[0].cooldowns.reef, 5);
  assert.deepEqual(next.itemUses, ["cleansing-salt"]);
});
test("items reject full HP, absent status, invalid/prototype IDs and forced replacement", () => {
  const s = battle();
  for (const itemId of ["summer-tonic", "cleansing-salt", "toString", "training-book"])
    assert.throws(() => validateBattleAction(s, { type: "item", itemId }));
  s.team[0].hp = 0; s.phase = "replacement";
  assert.throws(() => validateBattleAction(s, { type: "item", itemId: "summer-tonic" }));
});
test("items cannot bypass recharge, freeze or prepared moves", () => {
  const s = battle(); s.team[0].hp = 100; s.team[0].blockedUntilRound = 1;
  assert.throws(() => validateBattleAction(s, { type: "item", itemId: "summer-tonic" }));
  s.team[0].blockedUntilRound = 0; s.team[0].statuses = [{ id: "freeze", expiresAfterRound: 1 }];
  assert.throws(() => validateBattleAction(s, { type: "item", itemId: "cleansing-salt" }));
  s.team[0].statuses = []; s.team[0].preparing = { skillId: "monsoon", readyRound: 2 };
  assert.throws(() => validateBattleAction(s, { type: "item", itemId: "summer-tonic" }));
});
test("shock action failure advances round but produces no consumable charge", () => {
  const s = battle(); s.team[0].hp = 100; s.team[0].statuses = [{ id: "shock", expiresAfterRound: 5 }];
  const next = resolveBattle(s, { type: "item", itemId: "summer-tonic" }, () => 0);
  assert.equal(next.round, 2); assert.equal(next.team[0].hp, 100); assert.equal(next.itemUses, undefined); assert.match(next.log.join(" "), /감전으로 행동 실패/);
});
test("co-op produces only the executing owner's use once and drains transient events", () => {
  const a = battle(), b = battle(); a.team[0].hp = b.team[0].hp = 100;
  const s: CoopState = { id: "items", ownerId: "a", worldId: "world", version: 0, round: 1, status: "active", deadline: 0, enemy: a.enemy, log: [], members: [
    { userId: "a", nickname: "a", ready: true, left: false, state: a, choice: { type: "item", itemId: "summer-tonic" } },
    { userId: "b", nickname: "b", ready: true, left: false, state: b, choice: null },
  ] };
  assert.equal(resolveIfReady(s, () => 0.9), undefined);
  s.members[1].choice = { type: "defend" };
  const resolved = resolveIfReady(s, () => 0.9);
  assert.deepEqual(resolved?.itemUses, [{ userId: "a", itemId: "summer-tonic" }]);
  assert.equal(a.team[0].hp, 220); assert.equal(b.team[0].hp, 100); assert.ok(s.members.every((m) => !m.state.itemUses));
  for (const m of s.members) m.choice = { type: "defend" };
  assert.deepEqual(resolveIfReady(s, () => 0.9)?.itemUses, []);
});
test("four co-op item users heal independently while the enemy still acts only once", () => {
  const members = Array.from({ length: 4 }, (_, i) => { const state = createBattle("four-items"); state.team[0].hp = 100; return { userId: "p" + i, nickname: "p" + i, ready: true, left: false, state, choice: { type: "item" as const, itemId: "summer-tonic" } }; });
  const s: CoopState = { id: "four-items", ownerId: "p0", worldId: "world", version: 0, round: 1, status: "active", deadline: 0, enemy: createBattle("enemy").enemy, log: [], members };
  const result = resolveIfReady(s, () => 0.9);
  assert.equal(result?.itemUses.length, 4);
  assert.equal(new Set(result?.itemUses.map((u) => u.userId)).size, 4);
  assert.equal(s.members.filter((m) => m.state.team[0].hp < 220).length, 1);
  assert.ok(s.members.every((m) => m.state.team[0].hp > 100 && m.choice === null && !m.state.itemUses));
});
