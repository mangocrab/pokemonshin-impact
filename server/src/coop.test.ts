import { test } from "node:test";
import assert from "node:assert/strict";
import { createBattle, resolveRound, resolveBattle } from "./combat/engine.js";
import { resolveIfReady } from "./combat/coop.js";
import { type CoopState, coopView } from "../../shared/coop.js";
import { CHARACTERS } from "../../shared/combat.js";
function party(count = 2): CoopState {
  const members = Array.from({ length: count }, (_, i) => {
    const state = createBattle("coop", [CHARACTERS[0], CHARACTERS[1]]);
    state.team[0].name = "동료" + i;
    return {
      userId: "p" + i,
      nickname: "플레이어" + i,
      ready: true,
      left: false,
      state,
      choice: null,
    };
  });
  const enemy = createBattle("coop").enemy;
  enemy.hp = enemy.maxHp = 2000;
  return {
    id: "coop",
    ownerId: "p0",
    worldId: "world",
    version: 0,
    round: 1,
    status: "active",
    deadline: Date.now() + 60000,
    enemy,
    members,
    log: [],
  };
}
test("four allies each act once while a single enemy acts once", () => {
  const s = party(4);
  s.enemy.speed = 1;
  s.enemy.attack = 1;
  for (const m of s.members) m.choice = { type: "skill", skillId: "tide" };
  const result = resolveIfReady(s, () => 0);
  assert.equal(result?.round, 1);
  assert.equal(s.round, 2);
  assert.equal(s.enemy.hp, 2000 - 4 * 48);
  assert.equal(s.members.filter((m) => m.state.team[0].hp < 240).length, 1);
  assert.ok(s.members.every((m) => m.choice === null && m.state.round === 2));
});
test("enemy DOT and expiry run once per shared round, not once per player", () => {
  const s = party(4);
  s.enemy.statuses = [{ id: "burn", expiresAfterRound: 1 }];
  for (const m of s.members) m.choice = { type: "defend" };
  resolveIfReady(s, () => 0);
  assert.equal(s.enemy.hp, 1880);
  assert.equal(s.enemy.statuses.length, 0);
});
test("every third round has one enemy area action that can damage all active allies", () => {
  const s = party(4);
  s.round = 3;
  for (const m of s.members) {
    m.state.round = 3;
    m.choice = { type: "defend" };
  }
  resolveIfReady(s, () => 0);
  assert.ok(s.members.every((m) => m.state.team[0].hp < 240));
  assert.equal(s.round, 4);
  assert.equal(s.log.filter((l) => l.includes("집게 내리꽂기:")).length, 4);
});
test("recharge auto-waits without blocking other participant selection or advancing early", () => {
  const s = party();
  s.round = 2;
  for (const m of s.members) m.state.round = 2;
  s.members[0].state.team[0].blockedUntilRound = 2;
  assert.equal(
    resolveIfReady(s, () => 0),
    undefined,
  );
  assert.deepEqual(s.members[0].choice, { type: "wait" });
  assert.equal(s.round, 2);
  s.members[1].choice = { type: "skill", skillId: "tide" };
  resolveIfReady(s, () => 0);
  assert.equal(s.round, 3);
  assert.equal(s.enemy.hp, 1952);
});
test("forced replacement is free but requires that participant to choose an action afterward", () => {
  const s = party();
  s.members[0].state.team[0].hp = 0;
  s.members[0].state.phase = "replacement";
  s.members[1].choice = { type: "defend" };
  assert.equal(
    resolveIfReady(s, () => 0),
    undefined,
  );
  s.members[0].state = resolveBattle(
    s.members[0].state,
    { type: "switch", slot: 1 },
    () => 0,
  );
  assert.equal(s.members[0].state.round, 1);
  assert.equal(
    resolveIfReady(s, () => 0),
    undefined,
  );
  s.members[0].choice = { type: "skill", skillId: "breeze" };
  resolveIfReady(s, () => 0);
  assert.equal(s.round, 2);
});
test("fully defeated allies spectate while surviving allies can finish and everyone receives victory state", () => {
  const s = party();
  for (const f of s.members[0].state.team) f.hp = 0;
  s.enemy.hp = 1;
  s.members[1].state.team[0].speed = 100;
  s.members[1].choice = { type: "skill", skillId: "tide" };
  resolveIfReady(s, () => 0);
  assert.equal(s.status, "won");
  assert.ok(s.members.every((m) => m.state.status === "won"));
});
test("cooperative public view does not reveal another member deck or selected action", () => {
  const s = party();
  s.members[1].choice = { type: "skill", skillId: "surge" };
  const view = coopView(s, "p0");
  assert.equal(view.team, s.members[0].state.team);
  assert.equal(view.coop?.party[1].submitted, true);
  assert.equal("choice" in view.coop!.party[1], false);
  assert.equal("team" in view.coop!.party[1], false);
});
test("priority and speed are globally sorted rather than resolving separate solo rounds", () => {
  const s = party(3);
  s.members[0].state.team[0].speed = 10;
  s.members[1].state.team[0].speed = 70;
  s.members[2].state.team[0].speed = 40;
  for (const m of s.members) m.choice = { type: "skill", skillId: "tide" };
  s.members[0].choice = { type: "defend" };
  resolveIfReady(s, () => 0);
  assert.match(s.log[0], /동료0 → 동료1 → 동료2 → 산호 집게게/);
});
