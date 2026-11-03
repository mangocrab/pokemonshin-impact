import { test } from "node:test";
import assert from "node:assert/strict";
import { NPCS, QUESTS, nearbyNpc, questUnlocked, questMatchesVictory, questChestProgress } from "../../shared/story.js";
import { SANCTUARY, SANCTUARY_CHEST } from "../../shared/adventure.js";
import { ENCOUNTER, SANCTUARY_ENCOUNTER } from "../../shared/combat.js";
import { CHESTS } from "../../shared/world.js";
const song = QUESTS.find((q) => q.id === "sanctuary-song")!, letter = QUESTS.find((q) => q.id === "sanctuary-keepsake")!;
test("Serin discovery respects region and distance while established residents remain available", () => {
  const serin = NPCS.find((n) => n.id === "serin")!;
  assert.equal(nearbyNpc(serin), undefined);
  assert.equal(nearbyNpc({ x: serin.x + 65, y: serin.y }, [SANCTUARY.id]), undefined);
  assert.equal(nearbyNpc({ x: serin.x + 64, y: serin.y }, [SANCTUARY.id])?.id, "serin");
  for (const npc of NPCS.filter((n) => n.id !== "serin")) assert.equal(nearbyNpc(npc)?.id, npc.id);
});
test("sanctuary quest chain requires both region access and the claimed predecessor", () => {
  assert.equal(questUnlocked(song, ["first-gift"], []), false);
  assert.equal(questUnlocked(song, [], [SANCTUARY.id]), false);
  assert.equal(questUnlocked(song, ["first-gift"], [SANCTUARY.id]), true);
  assert.equal(questUnlocked(letter, ["first-gift"], [SANCTUARY.id]), false);
  assert.equal(questUnlocked(letter, [song.id], [SANCTUARY.id]), true);
});
test("targeted victory excludes unrelated enemies and missing encounter identity without changing general victories", () => {
  const general = QUESTS.find((q) => q.id === "coast-guardian")!;
  assert.equal(questMatchesVictory(song, ENCOUNTER.id), false); assert.equal(questMatchesVictory(song), false);
  assert.equal(questMatchesVictory(song, SANCTUARY_ENCOUNTER.id), true);
  assert.equal(questMatchesVictory(general, ENCOUNTER.id), true); assert.equal(questMatchesVictory(general, SANCTUARY_ENCOUNTER.id), true);
  assert.equal(questMatchesVictory(letter, SANCTUARY_ENCOUNTER.id), false);
});
test("targeted treasure deduplicates discoveries and never counts original coast chests or unknown loot", () => {
  assert.equal(questChestProgress(letter, CHESTS.map((c) => c.id)), 0);
  assert.equal(questChestProgress(letter, [SANCTUARY_CHEST.id, SANCTUARY_CHEST.id, "fake"]), 1);
  const map = QUESTS.find((q) => q.id === "coastal-map")!;
  assert.equal(questChestProgress(map, [SANCTUARY_CHEST.id]), 0);
  assert.equal(questChestProgress(map, [...CHESTS.map((c) => c.id), SANCTUARY_CHEST.id, "coast-1"]), 3);
});
