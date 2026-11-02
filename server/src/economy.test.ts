import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rollPull,
  duplicateReward,
  levelCap,
  liberationBonuses,
  WEAPONS,
  type Pity,
} from "../../shared/economy.js";
import { CHARACTERS } from "../../shared/combat.js";
import {
  createBattle,
  resolveBattle,
  damage,
  effectiveSpeed,
} from "./combat/engine.js";
import { availableSkills } from "../../shared/progression.js";
function rng(...values: number[]) {
  let i = 0;
  return () => values[i++] ?? 0.5;
}
const empty: Pity = { five: 0, four: 0, guaranteed: false };
test("three-star pulls are always weapons and four-star pools contain both types", () => {
  assert.equal(rollPull(empty, rng(0.5)).pull.kind, "weapon");
  assert.equal(rollPull(empty, rng(0.02, 0.1)).pull.kind, "character");
  assert.equal(rollPull(empty, rng(0.02, 0.8)).pull.kind, "weapon");
});
test("hard pity enforces ten-pull four-star and ninety-pull five-star guarantees", () => {
  const four = rollPull(
    { five: 8, four: 9, guaranteed: false },
    rng(0.99, 0.8),
  );
  assert.equal(four.pull.rarity, 4);
  assert.equal(four.pity.four, 0);
  assert.equal(four.pity.five, 9);
  const five = rollPull(
    { five: 89, four: 9, guaranteed: false },
    rng(0.99, 0.1),
  );
  assert.equal(five.pull.rarity, 5);
  assert.equal(five.pity.five, 0);
  assert.equal(five.pity.four, 0);
});
test("losing a five-star to either a character or weapon guarantees the next featured character", () => {
  for (const second of [0.1, 0.9]) {
    const lost = rollPull(empty, rng(0, 0.9, second, 0));
    assert.equal(lost.pull.featured, false);
    assert.equal(lost.pity.guaranteed, true);
    const next = rollPull({ ...lost.pity, five: 89 }, rng(0.9));
    assert.equal(next.pull.id, "mira");
    assert.equal(next.pull.kind, "character");
    assert.equal(next.pity.guaranteed, false);
  }
});
test("four-star guarantees and ordinary pulls never erase a pending featured guarantee", () => {
  assert.equal(
    rollPull({ five: 5, four: 9, guaranteed: true }, rng(0.9, 0.8)).pity
      .guaranteed,
    true,
  );
  assert.equal(
    rollPull({ five: 5, four: 0, guaranteed: true }, rng(0.9)).pity.guaranteed,
    true,
  );
});
test("duplicate materials are granted for copies two through seven only, including after spending", () => {
  for (let copies = 1; copies <= 6; copies++)
    assert.deepEqual(duplicateReward(copies, copies - 1, 5), {
      tokens: 1,
      dust: 0,
    });
  assert.deepEqual(duplicateReward(7, 6, 5), { tokens: 0, dust: 50 });
  assert.deepEqual(duplicateReward(10, 6, 4), { tokens: 0, dust: 20 });
});
test("all eight original characters have legal rarity, unique passives/ultimates, and advanced unlocks", () => {
  assert.equal(CHARACTERS.length, 8);
  assert.equal(CHARACTERS.filter((c) => c.gender === "female").length, 6);
  assert.equal(CHARACTERS.filter((c) => c.gender === "male").length, 2);
  assert.ok(CHARACTERS.every((c) => c.rarity === 4 || c.rarity === 5));
  assert.equal(new Set(CHARACTERS.map((c) => c.passiveId)).size, 8);
  assert.equal(new Set(CHARACTERS.map((c) => c.ultimateId)).size, 8);
  for (const c of CHARACTERS) {
    assert.equal(availableSkills(c.id, 20).length, 8);
    assert.equal(availableSkills(c.id, 60).length, 12);
  }
});
test("ascension caps and liberation bonuses never require a stage above six", () => {
  assert.deepEqual([0, 1, 2, 3].map(levelCap), [20, 40, 60, 80]);
  assert.equal(liberationBonuses("mira", 6).damage, 0.15);
  assert.equal(liberationBonuses("haerin", 6).healing, 0.15);
  assert.equal(Object.values(WEAPONS).filter((w) => w.rarity === 3).length, 2);
});
test("weapon damage/critical modifiers apply to direct attacks and healing bonus does not create STAB", () => {
  const s = createBattle("gear");
  const a = s.team[0];
  a.damageBonus = 0.2;
  a.critRate = 1;
  a.critDamage = 1.5;
  s.enemy.blockedUntilRound = 99;
  const n = resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0);
  assert.equal(n.enemy.hp, 220 - damage(a, s.enemy, 80, false, "물", true));
  const h = createBattle("heal");
  h.enemy.blockedUntilRound = 99;
  h.team[0].hp = 40;
  h.team[0].energy = 100;
  h.team[0].healingBonus = 0.15;
  assert.equal(resolveBattle(h, { type: "ultimate" }, () => 0).team[0].hp, 150);
});
test("new passives change shock damage, low-HP defense/speed and guarded mitigation", () => {
  const s = createBattle("new", CHARACTERS.slice(4));
  s.enemy.blockedUntilRound = 99;
  const mira = s.team[0],
    nari = s.team[1],
    wind = s.team[2],
    root = s.team[3];
  const base = damage(mira, s.enemy, 80);
  s.enemy.statuses = [{ id: "shock", expiresAfterRound: 3 }];
  assert.ok(damage(mira, s.enemy, 80) > base);
  const incoming = damage(s.enemy, nari, 80);
  nari.hp = 80;
  assert.ok(damage(s.enemy, nari, 80) < incoming);
  wind.hp = 40;
  assert.ok(effectiveSpeed(wind) > wind.speed);
  assert.ok(
    damage(s.enemy, root, 80, true) <
      damage(s.enemy, { ...root, passiveId: "" }, 80, true),
  );
});

test("element equipment bonuses and resistance modify direct damage independently", () => {
  const s = createBattle("element-gear");
  const a = s.team[0],
    d = s.enemy;
  a.attack = 80;
  d.defense = 0;
  assert.equal(damage(a, d, 80), 120);
  a.elementDamageBonus = { 물: 0.1 };
  assert.equal(damage(a, d, 80), 132);
  d.elementResistance = { 물: 0.1 };
  assert.equal(damage(a, d, 80), 118);
});
