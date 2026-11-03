import { test } from "node:test";
import assert from "node:assert/strict";
import { createBattle, resolveBattle, resolveRound, type RoundPlayer } from "./combat/engine.js";
import { battleFeedback } from "../../shared/presentation.js";
function solo(slot = 0) {
  const s = createBattle("cue"); s.activeSlot = slot; s.enemy.blockedUntilRound = 99; return s;
}
test("skill cues record actual accuracy results without guessing from HP or mutating the input", () => {
  const s = solo(), copy = structuredClone(s);
  const hit = resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0);
  assert.deepEqual(hit.skillCues?.map(c => [c.actor, c.target, c.skillId, c.element, c.hit]), [["ally", "enemy", "tide", "물", true]]);
  const miss = resolveBattle(s, { type: "skill", skillId: "brine" }, () => .999);
  assert.equal(miss.skillCues?.[0].hit, false); assert.equal(miss.enemy.hp, s.enemy.hp);
  assert.equal(battleFeedback(s, miss)?.skills[0].hit, false);
  assert.deepEqual(s, copy);
});
test("preparation, recharge and non-skill actions do not fabricate skill execution", () => {
  const s = solo(1), preparing = resolveBattle(s, { type: "skill", skillId: "gale" }, () => 0);
  assert.deepEqual(preparing.skillCues, []);
  const released = resolveBattle(preparing, { type: "continue" }, () => 0);
  assert.equal(released.skillCues?.[0].skillId, "gale");
  const blocked = solo(); blocked.team[0].blockedUntilRound = 1;
  assert.deepEqual(resolveBattle(blocked, { type: "wait" }, () => 0).skillCues, []);
  assert.deepEqual(resolveBattle(solo(), { type: "defend" }, () => 0).skillCues, []);
});
test("healing and shields target the caster and accuracy does not claim status application", () => {
  const heal = solo(); heal.team[0].energy = 100;
  const recovered = resolveBattle(heal, { type: "ultimate" }, () => 0);
  assert.equal(recovered.skillCues?.[0].target, "ally"); assert.equal(recovered.skillCues?.[0].category, "heal");
  const shield = solo(2); shield.team[2].energy = 100;
  assert.equal(resolveBattle(shield, { type: "ultimate" }, () => 0).skillCues?.[0].category, "shield");
  const immune = solo(); immune.enemy.statusImmunities = ["slow"];
  const n = resolveBattle(immune, { type: "skill", skillId: "brine" }, () => 0);
  assert.equal(n.skillCues?.[0].hit, true); assert.deepEqual(n.enemy.statuses, []);
  assert.equal("statuses" in n.skillCues![0], false);
});
function party(round = 1): RoundPlayer[] {
  const enemy = createBattle("coop-cue").enemy; enemy.hp = enemy.maxHp = 10000; enemy.speed = 1; enemy.attack = 1;
  return Array.from({ length: 4 }, (_, i) => {
    const state = createBattle("coop-cue"); state.enemy = enemy; state.round = round;
    return { key: `p${i}`, state, action: { type: "skill", skillId: "tide" } };
  });
}
test("four identical cooperative heroes keep every cast and only receive their own incoming hit", () => {
  const p = party(); resolveRound(p, p[0].state.enemy, 1, () => 0, true);
  for (const member of p) {
    const outgoing = member.state.skillCues!.filter(c => c.target === "enemy");
    assert.equal(outgoing.length, 4); assert.equal(outgoing.filter(c => c.actor === "ally").length, 1);
    assert.equal(outgoing.filter(c => c.actor === "visitor").length, 3);
  }
  assert.deepEqual(p.map(m => m.state.skillCues!.filter(c => c.actor === "enemy").length), [1, 0, 0, 0]);
});
test("cooperative self support stays private and area hits are projected to each own portrait", () => {
  const p = party(3); for (const member of p) member.action = { type: "defend" };
  p[0].state.team[0].energy = 100; p[0].action = { type: "ultimate" };
  resolveRound(p, p[0].state.enemy, 3, () => 0, true);
  assert.equal(p[0].state.skillCues!.filter(c => c.category === "heal").length, 1);
  for (const member of p.slice(1)) assert.equal(member.state.skillCues!.filter(c => c.category === "heal").length, 0);
  for (const member of p) assert.equal(member.state.skillCues!.filter(c => c.actor === "enemy" && c.target === "ally").length, 1);
});
test("old snapshots, duplicate versions and lobby or missed rounds cannot replay skill cues", () => {
  const s = solo(), n = resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0);
  assert.equal(battleFeedback(null, n), null); assert.equal(battleFeedback(n, n), null);
  const lobby = structuredClone(n); lobby.version++;
  assert.deepEqual(battleFeedback(n, lobby)?.skills ?? [], []);
  const missed = structuredClone(n); missed.round += 2;
  assert.equal(battleFeedback(s, missed), null);
  const old = structuredClone(n); delete old.skillCues;
  assert.deepEqual(battleFeedback(s, old)?.skills, []);
  n.skillCues![0].round = 88; assert.deepEqual(battleFeedback(s, n)?.skills, []);
});
test("replacement clears cues and mismatched target IDs never transfer to another portrait", () => {
  const s = createBattle("switch-cue"); s.enemy.speed = 200;
  const n = resolveBattle(s, { type: "switch", slot: 1 }, () => 0);
  assert.equal(n.skillCues?.[0].targetId, "luna"); // Switch priority beats the enemy's speed.
  assert.equal(battleFeedback(s, n)?.skills[0].targetId, "luna");
  const mismatched = structuredClone(n); mismatched.skillCues![0].targetId = "haerin";
  assert.deepEqual(battleFeedback(s, mismatched)?.skills, []);
  n.phase = "replacement"; n.team[1].hp = 0;
  const replaced = resolveBattle(n, { type: "switch", slot: 2 }, () => 0);
  assert.equal(replaced.skillCues, undefined);
});
