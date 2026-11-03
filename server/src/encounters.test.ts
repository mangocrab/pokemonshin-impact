import { test } from "node:test";
import assert from "node:assert/strict";
import { SANCTUARY } from "../../shared/adventure.js";
import { ENCOUNTER, SANCTUARY_ENCOUNTER, ENEMY_DEFINITIONS, SKILLS, blockedReason, enemySkillForRound, nearbyEncounter } from "../../shared/combat.js";
import { createBattle, normalizeBattle, resolveBattle, damage } from "./combat/engine.js";
test("sanctuary discovery requires its own region and proximity, without hiding the coast encounter", () => {
  assert.equal(nearbyEncounter(SANCTUARY_ENCOUNTER, []), undefined);
  assert.equal(nearbyEncounter(SANCTUARY_ENCOUNTER, ["another-region"]), undefined);
  assert.equal(nearbyEncounter({ x: 1870 + 65, y: 720 }, [SANCTUARY.id]), undefined);
  assert.equal(nearbyEncounter({ x: 1870 + 64, y: 720 }, [SANCTUARY.id])?.id, SANCTUARY_ENCOUNTER.id);
  assert.equal(nearbyEncounter(ENCOUNTER, [])?.id, ENCOUNTER.id);
});
test("data-driven enemies retain the original crab priority pattern and have valid moves", () => {
  for (let round = 1; round <= 36; round++) assert.equal(enemySkillForRound(ENCOUNTER.id, round).id, round % 4 === 0 ? "crabSand" : round % 3 === 0 ? "crabCrush" : "crabPinch");
  for (const enemy of Object.values(ENEMY_DEFINITIONS)) for (const id of enemy.rotation) assert.ok(SKILLS[id]);
});
test("bloom uses explicit nature attacks, recharges only the next round and resumes after snapshot restoration", () => {
  let s = createBattle("bloom", undefined, SANCTUARY_ENCOUNTER);
  s.team[0].hp = s.team[0].maxHp = 5000;
  for (let round = 1; round <= 3; round++) {
    const move = enemySkillForRound(s.enemy.id, round);
    s = resolveBattle(s, { type: "defend" }, () => 0.1);
    assert.ok(s.log.some((line) => line.includes(move.name)), s.log.join("\n"));
  }
  assert.equal(s.round, 4); assert.ok(blockedReason(s.enemy, 4));
  const restored = normalizeBattle(JSON.parse(JSON.stringify(s)));
  assert.equal(restored.enemy.id, SANCTUARY_ENCOUNTER.id); assert.equal(restored.enemy.element, "자연");
  const hp = restored.team[0].hp;
  s = resolveBattle(restored, { type: "defend" }, () => 0.1);
  assert.equal(s.team[0].hp, hp); assert.equal(blockedReason(s.enemy, s.round), "");
  s = resolveBattle(s, { type: "defend" }, () => 0.1);
  assert.ok(s.log.some((line) => line.includes("휘감는 줄기")));
});
test("nature opponent rewards elemental preparation rather than increasing every attack's effects", () => {
  const s = createBattle("affinity", undefined, SANCTUARY_ENCOUNTER);
  const water = { ...s.team[0], element: "물" as const }, fire = { ...water, element: "불" as const };
  assert.ok(damage(s.enemy, water, 80) > damage(s.enemy, fire, 80) * 3);
  assert.equal(SKILLS.bloomLeaf.statuses.length, 0);
  assert.equal(SKILLS.bloomRoots.accuracy, 0.9); assert.equal(SKILLS.bloomRoots.statuses[0].chance, 0.75);
});
