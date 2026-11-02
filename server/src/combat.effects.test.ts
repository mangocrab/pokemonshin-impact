import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBattle,
  resolveBattle,
  damage,
  effectiveSpeed,
  normalizeBattle,
} from "./combat/engine.js";
import {
  SKILLS,
  ULTIMATES,
  CHARACTERS,
  skillUnavailable,
  hasStatus,
  type BattleState,
} from "../../shared/combat.js";
function initial(slot = 0) {
  const s = createBattle("effects");
  s.activeSlot = slot;
  s.enemy.blockedUntilRound = 99;
  return s;
}
function sequence(...numbers: number[]) {
  let i = 0;
  return () => numbers[i++] ?? 0;
}
function hugeEnemy(s: BattleState) {
  s.enemy.hp = s.enemy.maxHp = 2000;
  return s;
}
test("STAB is exactly 1.5 before rounding and effectiveness is separate", () => {
  const s = initial();
  const a = s.team[0],
    d = s.enemy;
  a.attack = 80;
  d.defense = 0;
  d.element = "바람";
  assert.equal(damage(a, d, 80, false, "물"), 120);
  assert.equal(damage(a, d, 80, false, "불"), 80);
  d.element = "불";
  assert.equal(damage(a, d, 80, false, "물"), 240);
  d.element = "자연";
  assert.equal(damage(a, d, 80, false, "물"), 60);
  assert.equal(damage(a, d, 0), 0);
});
test("elements never implicitly cause status effects", () => {
  const s = initial(3);
  const n = resolveBattle(s, { type: "skill", skillId: "ember" }, () => 0);
  assert.deepEqual(n.enemy.statuses, []);
});
test("a miss makes no status roll, while successful hits roll status independently", () => {
  const s = initial(2);
  let count = 0;
  const miss = resolveBattle(s, { type: "skill", skillId: "thorn" }, () => {
    count++;
    return 0.99;
  });
  assert.equal(count, 1);
  assert.equal(miss.enemy.hp, s.enemy.hp);
  const failed = resolveBattle(
    s,
    { type: "skill", skillId: "thorn" },
    sequence(0.1, 0.9),
  );
  assert.ok(failed.enemy.hp < s.enemy.hp);
  assert.equal(hasStatus(failed.enemy, "bind"), false);
  const success = resolveBattle(
    s,
    { type: "skill", skillId: "thorn" },
    sequence(0.1, 0.7),
  );
  assert.equal(hasStatus(success.enemy, "bind"), true);
});
test("burn DOT is fixed HP damage, independent of STAB, shielding and resistance", () => {
  const s = initial(2);
  s.enemy.shield = 100;
  s.enemy.statuses = [{ id: "burn", expiresAfterRound: 3 }];
  const n = resolveBattle(s, { type: "defend" }, () => 0);
  assert.equal(n.enemy.hp, 207);
  assert.equal(n.enemy.shield, 100);
  assert.equal(n.enemy.statuses[0].expiresAfterRound, 3);
  let m = n;
  m = resolveBattle(m, { type: "defend" }, () => 0);
  m = resolveBattle(m, { type: "defend" }, () => 0);
  assert.equal(m.enemy.hp, 181);
  assert.equal(hasStatus(m.enemy, "burn"), false);
});
test("burn also ticks on standby and cannot revive a fainted character through passive", () => {
  const s = initial();
  s.team[2].hp = 5;
  s.team[2].statuses = [{ id: "burn", expiresAfterRound: 2 }];
  const n = resolveBattle(s, { type: "defend" }, () => 0);
  assert.equal(n.team[2].hp, 0);
});
test("guaranteed freeze stops one action and then grants two rounds of freeze immunity", () => {
  const s = initial(1);
  s.enemy.blockedUntilRound = 0;
  const n = resolveBattle(s, { type: "skill", skillId: "hush" }, () => 0);
  assert.equal(n.team[1].hp, 180);
  assert.equal(hasStatus(n.enemy, "freeze"), false);
  assert.equal(n.enemy.controlImmunityUntilRound, 3);
  n.team[1].cooldowns = {};
  const m = resolveBattle(n, { type: "skill", skillId: "hush" }, () => 0);
  assert.ok(m.log.some((l) => l.includes("빙결 면역")));
  assert.ok(m.team[1].hp < 180);
});
test("freeze applied after target acts persists to its next opportunity", () => {
  const s = initial(1);
  s.team[1].speed = 10;
  s.team[1].passiveId = "";
  s.enemy.blockedUntilRound = 0;
  const n = resolveBattle(s, { type: "skill", skillId: "hush" }, () => 0);
  assert.equal(hasStatus(n.enemy, "freeze"), true);
  assert.equal(n.enemy.statuses[0].expiresAfterRound, 2);
  const m = resolveBattle(n, { type: "defend" }, () => 0);
  assert.equal(m.team[1].hp, n.team[1].hp);
  assert.equal(hasStatus(m.enemy, "freeze"), false);
});
test("status immunities and probability resistance are enforced", () => {
  const s = initial(2);
  s.enemy.statusImmunities = ["burn"];
  let n = resolveBattle(s, { type: "skill", skillId: "spore" }, () => 0);
  assert.equal(hasStatus(n.enemy, "burn"), false);
  s.enemy.statusImmunities = [];
  s.enemy.statusResistance.burn = 1;
  n = resolveBattle(s, { type: "skill", skillId: "spore" }, () => 0);
  assert.equal(hasStatus(n.enemy, "burn"), false);
  s.enemy.statusResistance.burn = 0.5;
  n = resolveBattle(s, { type: "skill", skillId: "spore" }, sequence(0, 0.5));
  assert.equal(hasStatus(n.enemy, "burn"), false);
});
test("shock independently cancels actions and slow changes ordering", () => {
  const s = initial(1);
  s.team[1].statuses = [{ id: "shock", expiresAfterRound: 2 }];
  const n = resolveBattle(s, { type: "skill", skillId: "breeze" }, () => 0.1);
  assert.equal(n.enemy.hp, s.enemy.hp);
  assert.ok(n.log.some((l) => l.includes("감전으로 행동 실패")));
  s.team[1].statuses = [{ id: "slow", expiresAfterRound: 2 }];
  assert.ok(effectiveSpeed(s.team[1]) < s.enemy.speed);
  assert.match(
    resolveBattle(s, { type: "skill", skillId: "breeze" }, () => 0).log[0],
    /산호 집게게 → 루나/,
  );
});
test("bind restricts normal switching, while forced replacement remains allowed", () => {
  const s = initial();
  s.team[0].statuses = [{ id: "bind", expiresAfterRound: 3 }];
  assert.throws(() => resolveBattle(s, { type: "switch", slot: 1 }), /속박/);
  s.team[0].hp = 0;
  s.phase = "replacement";
  assert.equal(resolveBattle(s, { type: "switch", slot: 1 }).activeSlot, 1);
});
test("accuracy debuff lowers hit probability independently of skill data", () => {
  const s = initial(1);
  const hit = resolveBattle(
    s,
    { type: "skill", skillId: "breeze" },
    () => 0.85,
  );
  assert.ok(hit.enemy.hp < 220);
  s.team[1].statuses = [{ id: "accuracyDown", expiresAfterRound: 3 }];
  const miss = resolveBattle(
    s,
    { type: "skill", skillId: "breeze" },
    () => 0.85,
  );
  assert.equal(miss.enemy.hp, 220);
});
test("recharge blocks exactly next round, including switches, and resumes the following round", () => {
  const s = hugeEnemy(initial());
  const n = resolveBattle(s, { type: "skill", skillId: "surge" }, () => 0);
  assert.equal(n.round, 2);
  assert.equal(n.team[0].blockedUntilRound, 2);
  for (const action of [
    { type: "skill", skillId: "tide" },
    { type: "switch", slot: 1 },
    { type: "defend" },
    { type: "flee" },
    { type: "ultimate" },
  ] as const)
    assert.throws(() => resolveBattle(n, action), /행동 불가/);
  const m = resolveBattle(n, { type: "wait" }, () => 0);
  assert.equal(m.enemy.hp, n.enemy.hp);
  assert.equal(m.round, 3);
  assert.ok(
    resolveBattle(m, { type: "skill", skillId: "tide" }, () => 0).enemy.hp <
      m.enemy.hp,
  );
});
test("recharge does not suppress the enemy turn", () => {
  const s = hugeEnemy(initial());
  s.enemy.blockedUntilRound = 0;
  const n = resolveBattle(s, { type: "skill", skillId: "surge" }, () => 0);
  const m = resolveBattle(n, { type: "wait" }, () => 0);
  assert.ok(m.team[0].hp < n.team[0].hp);
});
test("prepare consumes an action, releases on next action, and is cancelled by control", () => {
  const s = initial(1);
  const n = resolveBattle(s, { type: "skill", skillId: "gale" }, () => 0);
  assert.equal(n.enemy.hp, 220);
  assert.equal(n.team[1].preparing?.readyRound, 2);
  assert.throws(() => resolveBattle(n, { type: "switch", slot: 0 }), /준비/);
  const m = resolveBattle(n, { type: "continue" }, () => 0);
  assert.ok(m.enemy.hp < 220);
  assert.equal(m.team[1].preparing, undefined);
  n.team[1].statuses = [{ id: "freeze", expiresAfterRound: 2 }];
  const stopped = resolveBattle(n, { type: "wait" }, () => 0);
  assert.equal(stopped.team[1].preparing, undefined);
  assert.equal(stopped.enemy.hp, 220);
});
test("cooldown prevents use during exactly the configured future rounds", () => {
  const n = resolveBattle(
    initial(),
    { type: "skill", skillId: "reef" },
    () => 0,
  );
  assert.equal(n.team[0].shield, 60);
  for (const r of [2, 3])
    assert.ok(skillUnavailable(n.team[0], SKILLS.reef, r));
  assert.equal(skillUnavailable(n.team[0], SKILLS.reef, 4), "");
  assert.throws(
    () => resolveBattle(n, { type: "skill", skillId: "reef" }),
    /재사용/,
  );
});
test("recoil uses actual HP damage once and does not receive another STAB multiplier", () => {
  const s = initial(3);
  const expected = damage(s.team[3], s.enemy, SKILLS.flare.power, false, "불");
  const n = resolveBattle(s, { type: "skill", skillId: "flare" }, () => 0);
  assert.equal(n.team[3].hp, 210 - Math.floor(expected * 0.25));
  const miss = resolveBattle(
    s,
    { type: "skill", skillId: "flare" },
    () => 0.99,
  );
  assert.equal(miss.team[3].hp, 210);
});
test("condition and temporary stat drop are verified server side", () => {
  const s = hugeEnemy(initial(3));
  assert.throws(
    () => resolveBattle(s, { type: "skill", skillId: "heatwave" }),
    /HP 50%/,
  );
  s.team[3].hp = 100;
  const n = resolveBattle(s, { type: "skill", skillId: "heatwave" }, () => 0);
  assert.equal(hasStatus(n.team[3], "attackDown"), true);
  assert.equal(hasStatus(n.team[3], "defenseDown"), true);
  assert.equal(n.team[3].statuses[0].expiresAfterRound, 3);
  assert.ok(damage(n.team[3], n.enemy, 80) < damage(s.team[3], s.enemy, 80));
  assert.ok(damage(n.enemy, n.team[3], 80) > damage(s.enemy, s.team[3], 80));
  let m = resolveBattle(n, { type: "defend" }, () => 0);
  m = resolveBattle(m, { type: "defend" }, () => 0);
  assert.equal(m.team[3].statuses.length, 0);
});
test("healing and cleanse do not receive STAB and do not remove recharge penalties", () => {
  const s = initial(2);
  s.team[2].hp = 100;
  s.team[2].statuses = [
    { id: "burn", expiresAfterRound: 5 },
    { id: "slow", expiresAfterRound: 5 },
  ];
  const n = resolveBattle(s, { type: "skill", skillId: "renewal" }, () => 0);
  assert.equal(n.team[2].hp, 175);
  assert.equal(n.team[2].statuses.length, 0);
  assert.ok(n.log.some((l) => l.includes("HP 65 회복")));
  s.team[2].blockedUntilRound = 2;
  assert.throws(
    () => resolveBattle(s, { type: "skill", skillId: "renewal" }),
    /행동 불가/,
  );
});
test("shield absorbs direct damage but not DOT and never stacks above the stronger shield", () => {
  const s = initial();
  s.team[0].speed = 100;
  s.enemy.blockedUntilRound = 0;
  const n = resolveBattle(s, { type: "skill", skillId: "reef" }, () => 0);
  assert.equal(n.team[0].hp, 240);
  assert.equal(n.team[0].shield, 18);
  s.team[0].shield = 100;
  const m = resolveBattle(s, { type: "skill", skillId: "reef" }, () => 0);
  assert.equal(m.team[0].shield, 58);
});
test("each passive has a distinct mechanical effect", () => {
  const s = initial();
  const a = s.team[0],
    d = s.enemy;
  a.attack = 80;
  d.defense = 0;
  d.element = "바람";
  assert.equal(damage(a, d, 80), 120);
  a.hp = 100;
  assert.equal(damage(a, d, 80), 144);
  assert.equal(effectiveSpeed(s.team[1]), 52 * 1.15);
  s.team[1].hp--;
  assert.equal(effectiveSpeed(s.team[1]), 52);
  const t = s.team[3];
  t.attack = 80;
  assert.equal(damage(t, d, 80), 120);
  d.statuses = [{ id: "burn", expiresAfterRound: 3 }];
  assert.equal(damage(t, d, 80), 144);
  const g = initial(2);
  g.team[2].hp = 200;
  assert.equal(resolveBattle(g, { type: "defend" }, () => 0).team[2].hp, 210);
});
test("ultimate energy is required, spent once, and attacks use STAB while heals and shields do not", () => {
  const s = initial();
  assert.throws(() => resolveBattle(s, { type: "ultimate" }), /에너지/);
  s.team[0].energy = 100;
  s.team[0].hp = 40;
  s.team[0].statuses = [{ id: "burn", expiresAfterRound: 3 }];
  const healed = resolveBattle(s, { type: "ultimate" }, () => 0);
  assert.equal(healed.team[0].hp, 136);
  assert.equal(healed.team[0].energy, 0);
  assert.equal(healed.team[0].statuses.length, 0);
  const w = initial(1);
  w.team[1].energy = 100;
  const attacked = resolveBattle(w, { type: "ultimate" }, () => 0);
  assert.equal(attacked.enemy.hp, 220 - damage(w.team[1], w.enemy, 200));
  assert.equal(attacked.team[1].energy, 0);
  const g = initial(2);
  g.team[2].energy = 100;
  assert.equal(
    resolveBattle(g, { type: "ultimate" }, () => 0).team[2].shield,
    117,
  );
  const f = hugeEnemy(initial(3));
  f.team[3].energy = 100;
  const fired = resolveBattle(f, { type: "ultimate" }, () => 0);
  assert.equal(fired.team[3].blockedUntilRound, 2);
});
test("energy is bounded and ordinary moves never consume the four-slot ultimate space", () => {
  const s = hugeEnemy(initial());
  s.team[0].energy = 95;
  assert.equal(
    resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0).team[0]
      .energy,
    100,
  );
  assert.ok(
    CHARACTERS.every(
      (c) =>
        c.skills.length <= 4 &&
        !c.skills.includes(c.ultimateId) &&
        ULTIMATES[c.ultimateId],
    ),
  );
});
test("legacy snapshots gain safe defaults without resetting progress or changing equipped moves", () => {
  const raw = JSON.parse(JSON.stringify(initial()));
  delete raw.rulesVersion;
  for (const f of [...raw.team, raw.enemy])
    for (const field of [
      "element",
      "energy",
      "shield",
      "statuses",
      "blockedUntilRound",
      "cooldowns",
      "passiveId",
      "ultimateId",
      "statusImmunities",
      "statusResistance",
      "controlImmunityUntilRound",
    ])
      delete f[field];
  raw.round = 7;
  raw.version = 5;
  raw.team[0].hp = 43;
  raw.team[0].skills = ["tide", "surge"];
  const n = normalizeBattle(raw);
  assert.equal(n.rulesVersion, 2);
  assert.equal(n.round, 7);
  assert.equal(n.version, 5);
  assert.equal(n.team[0].hp, 43);
  assert.deepEqual(n.team[0].skills, ["tide", "surge"]);
  assert.equal(n.team[0].energy, 0);
  assert.deepEqual(n.team[0].statuses, []);
});

test("existing freeze is not refreshed after a slower caster acts", () => {
  const s = initial(1);
  s.team[1].speed = 10;
  s.team[1].passiveId = "";
  s.enemy.blockedUntilRound = 0;
  s.enemy.statuses = [{ id: "freeze", expiresAfterRound: 1 }];
  const n = resolveBattle(s, { type: "skill", skillId: "hush" }, () => 0);
  assert.equal(hasStatus(n.enemy, "freeze"), false);
  assert.equal(n.enemy.controlImmunityUntilRound, 3);
  assert.ok(n.log.some((l) => l.includes("지속 시간을 연장하지 않습니다")));
});
test("missing a recharge attack still pays its cost and cannot cleanse away unrelated cooldowns", () => {
  const s = initial();
  s.team[0].statuses = [{ id: "accuracyDown", expiresAfterRound: 3 }];
  const n = resolveBattle(s, { type: "skill", skillId: "surge" }, () => 0.99);
  assert.equal(n.enemy.hp, 220);
  assert.equal(n.team[0].blockedUntilRound, 2);
  const g = initial(2);
  g.team[2].hp = 100;
  g.team[2].cooldowns = { leaf: 99 };
  g.team[2].statuses = [{ id: "burn", expiresAfterRound: 4 }];
  const m = resolveBattle(g, { type: "skill", skillId: "renewal" }, () => 0);
  assert.equal(m.team[2].cooldowns.leaf, 99);
  assert.equal(m.team[2].statuses.length, 0);
});
