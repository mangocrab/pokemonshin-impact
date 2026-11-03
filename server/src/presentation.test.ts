import { test } from "node:test";
import { CHARACTERS, ULTIMATES } from "../../shared/combat.js";
import assert from "node:assert/strict";
import { createBattle, resolveBattle } from "./combat/engine.js";
import { battleFeedback, travelerStep, travelerFrame, TRAVELER_DIRECTIONS, type TravelerStep } from "../../shared/presentation.js";

test("presentation ignores initial loads, other battles, duplicate and stale versions", () => {
  const a = createBattle("visual"), b = resolveBattle(a, { type: "skill", skillId: "tide" }, () => 0);
  assert.equal(battleFeedback(null, b), null);
  assert.equal(battleFeedback(a, null), null);
  assert.equal(battleFeedback(b, b), null);
  assert.equal(battleFeedback(b, a), null);
  assert.equal(battleFeedback(a, { ...b, id: "another" }), null);
});
test("result chips report exact server net HP differences without mutating snapshots", () => {
  const a = createBattle("visual"), b = resolveBattle(a, { type: "skill", skillId: "tide" }, () => 0);
  const copy = structuredClone(b), f = battleFeedback(a, b)!;
  assert.deepEqual(f.enemy, [{ kind: "damage", text: `HP −${a.enemy.hp - b.enemy.hp}` }]);
  assert.deepEqual(f.ally, [{ kind: "damage", text: `HP −${a.team[0].hp - b.team[0].hp}` }]);
  assert.deepEqual(b, copy);
});
test("switch feedback compares the incoming fighter with its own previous HP", () => {
  const a = createBattle("visual"), b = resolveBattle(a, { type: "switch", slot: 1 }, () => 0);
  const f = battleFeedback(a, b)!;
  assert.equal(f.ally[0].text, "루나 출전");
  assert.equal(f.ally[1].text, `HP −${a.team[1].hp - b.team[1].hp}`);
  assert.equal(f.burst, undefined);
});
test("shield, healing and status addition/removal use final values and preserve durations", () => {
  const a = createBattle("visual"); a.team[0].hp -= 100;
  a.team[0].statuses = [{ id: "burn", expiresAfterRound: 3 }];
  const b = structuredClone(a); b.version++; b.round++;
  b.team[0].hp += 20; b.team[0].shield = 40;
  b.team[0].statuses = [{ id: "slow", expiresAfterRound: 4 }];
  assert.deepEqual(battleFeedback(a, b)!.ally, [
    { kind: "heal", text: "HP +20" }, { kind: "shield", text: "보호막 +40" },
    { kind: "status", text: "둔화" }, { kind: "status", text: "화상 해제" },
  ]);
});
test("ultimate cut-in requires an actual resolved energy spend, not selection or a blocked action", () => {
  const a = createBattle("visual"); a.team[0].energy = 100;
  const ready = structuredClone(a); ready.version++;
  assert.equal(battleFeedback(a, ready), null);
  const b = resolveBattle(a, { type: "ultimate" }, () => 0);
  assert.equal(battleFeedback(a, b)!.burst?.skillName, "바다가 품은 약속");
  a.team[0].blockedUntilRound = 1;
  const blocked = resolveBattle(a, { type: "wait" }, () => 0);
  assert.equal(battleFeedback(a, blocked)?.burst, undefined);
});
test("missed rounds never present accumulated changes as one round", () => {
  const a = createBattle("visual"), b = resolveBattle(a, { type: "defend" }, () => 0);
  const c = resolveBattle(b, { type: "defend" }, () => 0);
  assert.equal(battleFeedback(a, c), null);
});
test("traveler motion follows accepted displacement, stops at walls and respects reduced motion and teleports", () => {
  const idle: TravelerStep = { x: 100, y: 100, phase: 0, movingUntil: 0, direction: "south" };
  const scenePosition = { x: 95, y: 100, scene: { unrelated: "must not be copied" } };
  const walk = travelerStep(idle, scenePosition, 1000);
  assert.deepEqual(Object.keys(walk).sort(), ["direction", "movingUntil", "phase", "x", "y"]);
  assert.equal(walk.direction, "west");
  assert.equal(travelerFrame(walk, 1000, false), "west-0");
  const wall = travelerStep(walk, { x: 95, y: 100 }, 1200);
  assert.equal(travelerFrame(wall, 1200, true), "west-0");
  assert.equal(travelerStep(walk, { x: 100, y: 100 }, 1100).direction, "east");
  const teleport = travelerStep(walk, { x: 800, y: 560 }, 1100);
  assert.equal(travelerFrame(teleport, 1100, true), "west-0");
});
test("four-direction strides choose distinct frames, preserve facing on stop and freeze on the idle pose", () => {
  for (const [direction, dx, dy] of [["south", 0, 5], ["west", -5, 0], ["east", 5, 0], ["north", 0, -5]] as const) {
    let step: TravelerStep = { x: 100, y: 100, phase: 0, movingUntil: 0, direction: "south" };
    const frames = new Set<string>();
    for (let i = 0; i < 30; i++) {
      step = travelerStep(step, { x: step.x + dx, y: step.y + dy }, 1000 + i * 40);
      frames.add(travelerFrame(step, 1000 + i * 40, true));
      assert.equal(step.direction, direction);
      assert.equal(travelerFrame(step, 1000 + i * 40, false), `${direction}-0`);
    }
    assert.deepEqual([...frames].sort(), [0, 1, 2].map((i) => `${direction}-${i}`));
    assert.equal(travelerFrame(step, 3000, true), `${direction}-0`);
  }
  assert.equal(TRAVELER_DIRECTIONS.length, 4);
});

test("all eight resolved ultimates identify the correct portrait, element and skill for presentation", () => {
  for (const character of CHARACTERS) {
    const before = createBattle(`signature-${character.id}`, [character]); before.team[0].energy = 100;
    const original = structuredClone(before), after = resolveBattle(before, { type: "ultimate" }, () => 0);
    assert.deepEqual(battleFeedback(before, after)?.burst, { characterId: character.id, name: character.name,
      element: character.element, skillName: ULTIMATES[character.ultimateId].name });
    assert.deepEqual(before, original);
    assert.ok(after.team[0].energy < 100);
  }
});
