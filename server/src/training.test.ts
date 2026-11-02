import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gainExperience,
  availableSkills,
  characterStats,
  LEARNSETS,
  LEVEL_CAP,
} from "../../shared/progression.js";
import { CHARACTERS, SKILLS, ULTIMATES } from "../../shared/combat.js";
test("experience carries over multiple levels and never exceeds level cap", () => {
  assert.deepEqual(gainExperience(1, 0, 80), { level: 3, experience: 20 });
  let p = { level: 1, experience: 0 };
  for (let i = 0; i < 3; i++) p = gainExperience(p.level, p.experience, 80);
  assert.deepEqual(p, { level: 5, experience: 40 });
  assert.deepEqual(gainExperience(20, 390, 80), { level: 20, experience: 400 });
  assert.equal(gainExperience(1, 0, 100000).level, LEVEL_CAP);
  assert.equal(gainExperience(25, 0, 80).level, 25);
  assert.throws(() => gainExperience(1, 0, -1));
});
test("learnsets retain all starting skills and independently gate character-specific moves", () => {
  for (const c of CHARACTERS) {
    assert.deepEqual(availableSkills(c.id, 1), c.skills);
    assert.equal(new Set(LEARNSETS[c.id]).size, 12);
    assert.equal(availableSkills(c.id, 20).length, 8);
    assert.ok(!LEARNSETS[c.id].some((id) => ULTIMATES[id]));
  }
  assert.ok(availableSkills("haerin", 5).includes("spritz"));
  assert.ok(!availableSkills("haerin", 4).includes("spritz"));
  assert.ok(availableSkills("luna", 4).includes("slipstream"));
  assert.ok(!availableSkills("somi", 5).includes("seedshot"));
});
test("growth uses different coefficients and keeps level-one stats unchanged", () => {
  for (const c of CHARACTERS) assert.deepEqual(characterStats(c.id, 1), c);
  const water = characterStats("haerin", 5),
    wind = characterStats("luna", 5);
  assert.equal(water.maxHp, 288);
  assert.equal(water.attack, 48);
  assert.notEqual(water.maxHp - 240, wind.maxHp - 180);
  assert.ok(wind.speed > CHARACTERS[1].speed);
});
test("advanced moves have tactical costs rather than replacing safe attacks in all contexts", () => {
  assert.equal(SKILLS.spritz.priority, 1);
  assert.ok(SKILLS.spritz.power < SKILLS.tide.power);
  assert.ok(SKILLS.monsoon.power > SKILLS.surge.power);
  assert.ok(SKILLS.monsoon.penalties.some((p) => p.type === "prepare"));
  assert.ok(SKILLS.inferno.penalties.some((p) => p.type === "recharge"));
  assert.ok(SKILLS.cascade.penalties.some((p) => p.type === "recoil"));
});
