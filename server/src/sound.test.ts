import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARACTERS, ELEMENTS } from "../../shared/combat.js";
import { battleSound, soundPattern } from "../../shared/sound.js";
import { createBattle, resolveBattle } from "./combat/engine.js";
const quiet = (slot = 0) => { const s = createBattle("sound"); s.activeSlot = slot; s.enemy.blockedUntilRound = 99; return s; };
test("original sound patterns are bounded, distinct and reject unknown event payloads", () => {
  const cues = ["battle", "victory", "treasure", "heal", "shield", "status", "miss", ...ELEMENTS.map(e => `skill:${e}`)];
  assert.equal(new Set(ELEMENTS.map(e => JSON.stringify(soundPattern(`skill:${e}`)))).size, 6);
  for (const cue of cues) {
    const p = soundPattern(cue)!; assert.ok(p); assert.ok(p.gain > 0 && p.gain <= .35);
    assert.ok(p.notes.length >= 1 && p.notes.length <= 3);
    for (const note of p.notes) {
      for (const n of [note.hz, note.to, note.delay, note.length]) assert.ok(Number.isFinite(n));
      assert.ok(note.hz > 0 && note.hz < 2000 && note.to > 0 && note.to < 2000);
      assert.ok(note.delay >= 0 && note.length >= .08 && note.delay + note.length < .5);
    }
  }
  for (const invalid of [null, {}, 9, "unknown", "constructor", "__proto__"]) assert.equal(soundPattern(invalid), null);
});
test("resolved attacks and support use actual elements and accuracy rather than inferred damage", () => {
  for (const element of ELEMENTS) {
    const hero = CHARACTERS.find(c => c.element === element)!;
    const s = createBattle("element", [hero]); s.enemy.blockedUntilRound = 99; s.enemy.hp = s.enemy.maxHp = 10000;
    assert.equal(battleSound(s, resolveBattle(s, { type: "skill", skillId: hero.skills[0] }, () => 0)), `skill:${element}`);
  }
  const s = quiet();
  assert.equal(battleSound(s, resolveBattle(s, { type: "skill", skillId: "brine" }, () => .999)), "miss");
  assert.equal(battleSound(s, resolveBattle(s, { type: "skill", skillId: "reef" }, () => 0)), "shield");
  s.team[0].energy = 100;
  assert.equal(battleSound(s, resolveBattle(s, { type: "ultimate" }, () => 0)), "heal");
  const wind = quiet(1);
  assert.equal(battleSound(wind, resolveBattle(wind, { type: "skill", skillId: "hush" }, () => 0)), "status");
});
test("initial, duplicate, lobby, stale, missed and old snapshots do not replay combat sounds", () => {
  const s = quiet(), n = resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0);
  assert.equal(battleSound(null, n), null); assert.equal(battleSound(n, n), null); assert.equal(battleSound(n, s), null);
  const lobby = structuredClone(n); lobby.version++; assert.equal(battleSound(n, lobby), null);
  assert.equal(battleSound(s, { ...n, id: "other" }), null);
  assert.equal(battleSound(s, { ...n, round: n.round + 1 }), null);
  const old = structuredClone(n); delete old.skillCues; assert.equal(battleSound(s, old), null);
  assert.equal(battleSound(s, resolveBattle(s, { type: "defend" }, () => 0)), null);
  const prepare = quiet(1);
  assert.equal(battleSound(prepare, resolveBattle(prepare, { type: "skill", skillId: "gale" }, () => 0)), null);
});
test("victory takes priority and cannot be replayed from a restored winning state", () => {
  const s = quiet(); s.enemy.hp = 1;
  const n = resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0);
  assert.equal(n.status, "won"); assert.equal(battleSound(s, n), "victory"); assert.equal(battleSound(null, n), null);
});
test("each cooperative perspective selects one own, incoming or partner pattern deterministically", () => {
  const s = quiet(), n = resolveBattle(s, { type: "skill", skillId: "tide" }, () => 0), base = n.skillCues![0];
  const partner = { ...base, actor: "visitor" as const, element: "번개" as const };
  const incoming = { ...base, actor: "enemy" as const, target: "ally" as const, targetId: "haerin" };
  const own = { ...base, category: "heal" as const, target: "ally" as const, targetId: "haerin" };
  n.skillCues = [partner, incoming, own]; assert.equal(battleSound(s, n), "heal");
  n.skillCues = [partner, incoming]; assert.equal(battleSound(s, n), "skill:물");
  n.skillCues = [partner]; assert.equal(battleSound(s, n), "skill:번개");
  const copy = structuredClone(n); assert.equal(battleSound(s, n), battleSound(s, n)); assert.deepEqual(n, copy);
});
