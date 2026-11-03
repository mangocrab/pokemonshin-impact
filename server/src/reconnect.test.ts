import { test } from "node:test";
import assert from "node:assert/strict";
import { createBattle } from "./combat/engine.js";
import { resolveIfReady } from "./combat/coop.js";
import { coopPaused, nextCoopDeadline, coopView, type CoopState } from "../../shared/coop.js";
function state(): CoopState {
  const a = createBattle("resume"), b = createBattle("resume"); a.team[0].hp = 100;
  return { id: "resume", ownerId: "a", worldId: "world", version: 4, round: 1, status: "active", deadline: 1000, enemy: a.enemy, log: [], members: [
    { userId: "a", nickname: "a", ready: true, left: false, state: a, choice: { type: "item", itemId: "summer-tonic" } },
    { userId: "b", nickname: "b", ready: true, left: false, state: b, choice: { type: "defend" }, reconnectUntil: 2000 },
  ] };
}
test("a disconnected member freezes ready rounds without healing or consuming items", () => {
  const s = state(); assert.equal(resolveIfReady(s, () => 0.9), undefined);
  assert.equal(s.round, 1); assert.equal(s.members[0].state.team[0].hp, 100); assert.equal(s.members[0].state.itemUses, undefined);
  delete s.members[1].reconnectUntil;
  const round = resolveIfReady(s, () => 0.9); assert.equal(round?.itemUses.length, 1); assert.equal(s.round, 2);
});
test("recovery deadline replaces the round timer until all members resume", () => {
  const s = state(); s.members[0].reconnectUntil = 1500;
  assert.equal(nextCoopDeadline(s), 1500); delete s.members[0].reconnectUntil; assert.equal(nextCoopDeadline(s), 2000);
  delete s.members[1].reconnectUntil; assert.equal(nextCoopDeadline(s), 1000); assert.equal(coopPaused(s), false);
  s.status = "abandoned"; s.members[0].reconnectUntil = 1500; assert.equal(coopPaused(s), false);
});
test("public co-op view reports recovery without exposing another member's choice", () => {
  const s = state(), view = coopView(s, "b");
  assert.equal(view.coop?.paused, true); assert.equal(view.coop?.resumeRequired, true); assert.equal(view.coop?.ownerAvailable, true);
  assert.equal(view.coop?.party[0].submitted, true); assert.equal("choice" in view.coop!.party[0], false);
});
