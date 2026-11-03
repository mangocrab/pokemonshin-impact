import type { Prisma } from "@prisma/client";
import { CHESTS } from "../../shared/world.js";
import { QUESTS, questUnlocked, questMatchesVictory, questChestProgress, type QuestDefinition, type StoryView } from "../../shared/story.js";
type Tx = Prisma.TransactionClient;
export async function chestCount(tx: Tx, worldId: string, quest?: QuestDefinition) {
  const world = await tx.world.findUniqueOrThrow({ where: { id: worldId }, include: { openedChests: true } });
  const old = (world.progress as { chests?: unknown })?.chests;
  const ids = new Set([...(Array.isArray(old) ? old : []), ...world.openedChests.map((c) => c.chestId)]);
  return quest ? questChestProgress(quest, [...ids].filter((id): id is string => typeof id === "string")) : CHESTS.filter((c) => ids.has(c.id)).length;
}
export async function recordChestDiscovery(tx: Tx, worldId: string) {
  for (const quest of QUESTS.filter((q) => q.objective === "chest")) {
    const count = await chestCount(tx, worldId, quest);
    await tx.worldQuest.updateMany({
      where: { worldId, questId: quest.id, claimedAt: null, progress: { lt: Math.min(count, quest.target) } },
      data: { progress: Math.min(count, quest.target) },
    });
  }
}
export async function recordWorldVictory(tx: Tx, worldId: string, encounterId?: string) {
  // Called only inside authoritative victory transactions. Visitors' own worlds are never touched.
  for (const quest of QUESTS.filter((q) => questMatchesVictory(q, encounterId))) {
    await tx.worldQuest.updateMany({ where: { worldId, questId: quest.id, claimedAt: null, progress: { lt: quest.target } }, data: { progress: quest.target } });
  }
}
export async function storyView(tx: Tx, worldId: string, isOwner: boolean): Promise<StoryView> {
  const [rows, regions] = await Promise.all([tx.worldQuest.findMany({ where: { worldId } }), tx.worldRegion.findMany({ where: { worldId } })]);
  return { worldId, isOwner, quests: QUESTS.map((quest) => {
    const row = rows.find((r) => r.questId === quest.id);
    const unlocked = questUnlocked(quest, rows.filter((r) => r.claimedAt).map((r) => r.questId), regions.map((r) => r.regionId));
    return { ...quest, progress: row?.progress ?? 0, state: row?.claimedAt ? "claimed" : quest.requiredRegion && !unlocked ? "locked" : row ? row.progress >= quest.target ? "ready" : "active" : unlocked ? "available" : "locked" };
  }) };
}
