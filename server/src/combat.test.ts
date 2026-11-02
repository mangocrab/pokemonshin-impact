import { test } from "node:test";
import assert from "node:assert/strict";
import { createBattle, resolveBattle, damage } from "./combat/engine.js";
const initial = () => createBattle("test");
test("each side acts once, faster enemy first, then exactly one round advances", () => {
  const s = initial(),
    n = resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0);
  assert.match(n.log[0], /산호 집게게 → 해린/);
  assert.equal(n.round, 2);
  assert.equal(n.version, 1);
  assert.equal(n.enemy.hp, s.enemy.hp - damage(s.team[0], s.enemy, 80));
  assert.equal(n.team[0].hp, s.team[0].hp - damage(s.enemy, s.team[0], 80));
  assert.equal(s.round, 1);
  assert.equal(s.enemy.hp, 220);
});
test("faster character acts first and equal speed alternates by round", () => {
  const s = initial();
  s.activeSlot = 1;
  assert.match(
    resolveBattle(s, { type: "skill", skillId: "breeze" }, () => 0).log[0],
    /루나 → 산호/,
  );
  s.activeSlot = 0;
  s.team[0].speed = s.enemy.speed;
  assert.match(
    resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0).log[0],
    /해린 → 산호/,
  );
  s.round = 2;
  assert.match(
    resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0).log[0],
    /산호 집게게 → 해린/,
  );
});
test("switch priority precedes speed and costs the player action", () => {
  const s = initial();
  const n = resolveBattle(s, { type: "switch", slot: 1 }, () => 0);
  assert.equal(n.activeSlot, 1);
  assert.equal(n.enemy.hp, s.enemy.hp);
  assert.equal(n.team[0].hp, s.team[0].hp);
  assert.ok(n.team[1].hp < s.team[1].hp);
  assert.equal(n.round, 2);
});
test("defense has priority and halves this round damage only", () => {
  const s = initial();
  const n = resolveBattle(s, { type: "defend" }, () => 0);
  assert.equal(
    s.team[0].hp - n.team[0].hp,
    damage(s.enemy, s.team[0], 80, true),
  );
  const m = resolveBattle(n, { type: "skill", skillId: "tide" }, () => 0);
  assert.equal(n.team[0].hp - m.team[0].hp, damage(n.enemy, n.team[0], 80));
});
test("accuracy and per-skill power are evaluated by the engine", () => {
  const s = initial();
  s.activeSlot = 1;
  const hit = resolveBattle(s, { type: "skill", skillId: "squall" }, () => 0);
  const miss = resolveBattle(
    s,
    { type: "skill", skillId: "squall" },
    () => 0.99,
  );
  assert.equal(miss.enemy.hp, s.enemy.hp);
  assert.ok(
    hit.enemy.hp <
      resolveBattle(s, { type: "skill", skillId: "breeze" }, () => 0).enemy.hp,
  );
  assert.ok(miss.log.some((x) => x.includes("빗나갔습니다")));
});
test("lethal faster attack stops the defeated enemy action", () => {
  const s = initial();
  s.activeSlot = 1;
  s.enemy.hp = 1;
  const n = resolveBattle(s, { type: "skill", skillId: "breeze" }, () => 0);
  assert.equal(n.status, "won");
  assert.equal(n.enemy.hp, 0);
  assert.equal(n.team[1].hp, s.team[1].hp);
  assert.equal(n.phase, "ended");
});
test("fainted active character cannot act and must be replaced before next round", () => {
  const s = initial();
  s.team[0].hp = 1;
  const n = resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0);
  assert.equal(n.team[0].hp, 0);
  assert.equal(n.enemy.hp, s.enemy.hp);
  assert.equal(n.phase, "replacement");
  assert.throws(() => resolveBattle(n, { type: "defend" }));
  const m = resolveBattle(n, { type: "switch", slot: 1 });
  assert.equal(m.round, n.round);
  assert.equal(m.version, n.version + 1);
  assert.equal(m.team[1].hp, n.team[1].hp);
  assert.equal(m.phase, "choice");
});
test("all characters fainted produces defeat", () => {
  const s = initial();
  for (const c of s.team) c.hp = 0;
  s.team[0].hp = 1;
  assert.equal(resolveBattle(s, { type: "defend" }, () => 0).status, "lost");
});
test("invalid swaps and unequipped skills are rejected without mutation", () => {
  const s = initial();
  s.team[2].hp = 0;
  for (const slot of [-1, 0, 2, 4, 1.5])
    assert.throws(() => resolveBattle(s, { type: "switch", slot }));
  assert.throws(() => resolveBattle(s, { type: "skill", skillId: "flare" }));
  assert.equal(s.version, 0);
});
test("flee ends battle before enemy attacks and ended battles reject actions", () => {
  const s = initial(),
    n = resolveBattle(s, { type: "flee" });
  assert.equal(n.status, "fled");
  assert.equal(n.team[0].hp, s.team[0].hp);
  assert.throws(() => resolveBattle(n, { type: "defend" }));
});
test("basic battle can reach victory without fabricated damage or rewards", () => {
  let s = initial();
  for (let i = 0; i < 12 && s.status === "active"; i++)
    s = resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0);
  assert.equal(s.status, "won");
  assert.equal(s.round, 6); // STAB and low-HP passive shorten the original 7-round encounter.
  assert.ok(s.team[0].hp > 0);
});
