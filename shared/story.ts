import { SANCTUARY, SANCTUARY_CHEST } from "./adventure.js";
import { SANCTUARY_ENCOUNTER } from "./combat.js";
import { CHESTS, INTERACTION_RADIUS, type Position } from "./world.js";
export const NPCS = [
  {
    id: "daon", name: "다온", talkLabel: "다온과 대화", title: "해안 안내인", location: "시작 지점 남쪽 산책길", x: 845, y: 640, color: 0x4e8b91,
    dialogue: ["산호 해안에 온 걸 환영해! 나는 이곳의 안내인 다온이야.", "여름의 기억은 작은 발견에서 시작하지. 모래사장에 놓인 선물 상자를 찾아볼래?"],
  },
  {
    id: "moru", name: "모루", talkLabel: "모루와 대화", title: "항구의 지도 제작자", location: "쉼터 오른쪽 항구 길", x: 1210, y: 700, color: 0xbb845a,
    dialogue: ["바람이 지도 모서리를 자꾸 접어 버리네. 나는 항구의 길을 그리는 모루야.", "해안과 야자수 숲, 쉼터 뒤에 놓인 세 선물을 찾아봐. 네 발걸음으로 지도를 완성해 줘."],
  },
  {
    id: "serin", name: "세린", talkLabel: "세린과 대화", title: "안뜰의 식물 기록가", location: "물결의 안뜰 남쪽 (1740,900)", x: 1740, y: 900, color: 0x788a64, regionId: SANCTUARY.id,
    dialogue: ["세 파도의 종을 따라 여기까지 왔구나. 나는 안뜰의 꽃과 기억을 기록하는 세린이야.", "꽃등지기는 힘껏 피어난 뒤 한 차례 쉬어. 그 리듬을 살펴보고, 이곳에 남은 여름의 노래를 함께 기록해 줄래?"],
  },
] as const;
export type NpcId = (typeof NPCS)[number]["id"];
export type QuestDefinition = {
  id: string; npcId: NpcId; name: string; description: string; objective: "chest" | "victory";
  target: number; requires?: string; requiredRegion?: string; encounterId?: string; chestIds?: readonly string[]; requirementText?: string; objectiveText: string; completion: string;
  reward: { conch: number; shell: number; items: Record<string, number> };
};
export const QUESTS: QuestDefinition[] = [
  { id: "first-gift", npcId: "daon", name: "여름의 첫 선물", description: "다온의 안내를 따라 개인 월드의 선물 상자를 하나 열고 돌아오세요. 이미 열린 상자도 인정됩니다.", objective: "chest", target: 1, objectiveText: "개인 월드의 선물 상자 1개 발견", completion: "첫 선물을 찾았구나! 너만의 여름이 이제 시작이야.", reward: { conch: 160, shell: 500, items: { "training-book": 2 } } },
  { id: "coast-guardian", npcId: "daon", name: "해안의 작은 수호자", description: "부탁을 받은 뒤 자신의 월드에서 산호 집게게·안뜰 꽃등지기 또는 협동 수호게·만개지기를 물리치고 다온에게 돌아오세요. 방문 전투는 이 부탁을 진행하지 않습니다.", objective: "victory", target: 1, requires: "first-gift", objectiveText: "수락 후 자신의 월드에서 전투 승리", completion: "이제 모두 조금 더 안심하고 해변을 걸을 수 있겠네. 네가 해안의 작은 수호자야!", reward: { conch: 320, shell: 1200, items: { "weapon-ore": 4 } } },
  { id: "coastal-map", npcId: "moru", name: "발걸음으로 그린 지도", description: "다온의 첫 부탁을 마친 뒤 모루를 만나세요. 해안·야자수 숲·쉼터 뒤의 상자 3개를 모두 찾으면 지도를 완성할 수 있습니다. 이전 발견도 인정됩니다.", objective: "chest", target: 3, requires: "first-gift", objectiveText: "개인 월드의 선물 상자 3개 발견", completion: "세 곳의 이야기가 한 장의 지도로 이어졌어. 이 해안을 기억해 줘!", reward: { conch: 160, shell: 800, items: { "growth-stone": 3, "training-book": 2 } } },
  { id: "sanctuary-song", npcId: "serin", name: "안뜰의 잠든 노래", description: "세린의 부탁을 받은 뒤 자신의 안뜰에서 꽃등지기 또는 협동 만개지기에게 승리하고 돌아오세요. 수락 전 승리와 해안 집게게 전투는 인정하지 않습니다.", objective: "victory", target: 1, requires: "first-gift", requiredRegion: SANCTUARY.id, encounterId: SANCTUARY_ENCOUNTER.id, requirementText: "물결의 안뜰 해금 · ‘여름의 첫 선물’ 보상 수령", objectiveText: "수락 후 자기 안뜰의 꽃등지기 또는 만개지기에게 승리", completion: "쉼표가 있어야 노래도 이어지는구나. 네가 들려준 꽃의 리듬을 여기에 적어 둘게.", reward: { conch: 240, shell: 900, items: { "training-book": 3 } } },
  { id: "sanctuary-keepsake", npcId: "serin", name: "꽃잎 사이의 여름 편지", description: "안뜰의 잠든 노래를 마친 뒤 오래된 선물을 발견하고 세린에게 돌아오세요. 이미 안뜰 선물을 열었다면 바로 인정됩니다. 해안의 세 상자는 이 목표에 포함되지 않습니다.", objective: "chest", target: 1, requires: "sanctuary-song", requiredRegion: SANCTUARY.id, chestIds: [SANCTUARY_CHEST.id], requirementText: "물결의 안뜰 해금 · ‘안뜰의 잠든 노래’ 보상 수령", objectiveText: "안뜰의 오래된 선물 발견", completion: "이 편지에는 누군가의 여름이 고스란히 남아 있어. 다음 여행자에게도 이 기억을 전할게.", reward: { conch: 160, shell: 600, items: { "growth-stone": 3 } } },
];
export type QuestView = QuestDefinition & { state: "locked" | "available" | "active" | "ready" | "claimed"; progress: number };
export type StoryView = { worldId: string; isOwner: boolean; quests: QuestView[] };
export type DialogueView = { npcId: NpcId; worldId: string; isOwner: boolean; lines: string[]; story: StoryView };
export function nearbyNpc(position: Position, regions: readonly string[] = []) {
  return NPCS.find((npc) => (!("regionId" in npc) || regions.includes(npc.regionId)) && Math.hypot(position.x - npc.x, position.y - npc.y) <= INTERACTION_RADIUS);
}

export function questUnlocked(quest: QuestDefinition, claimedIds: readonly string[], regions: readonly string[]) {
  return (!quest.requires || claimedIds.includes(quest.requires)) && (!quest.requiredRegion || regions.includes(quest.requiredRegion));
}
export function questMatchesVictory(quest: QuestDefinition, encounterId?: string) {
  return quest.objective === "victory" && (!quest.encounterId || quest.encounterId === encounterId);
}
export function questChestProgress(quest: QuestDefinition, opened: readonly string[]) {
  const ids = new Set(opened), targets = new Set(quest.chestIds ?? CHESTS.map((c) => c.id));
  return Math.min(quest.target, [...targets].filter((id) => ids.has(id)).length);
}
