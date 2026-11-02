import type { Position } from "./world.js";
export const SANCTUARY = { id: "tide-sanctuary", name: "물결의 안뜰", boundary: 1570, bridgeEnd: 1660, bridgeTop: 760, bridgeBottom: 840, top: 670 } as const;
export const TIDE_PUZZLE = { id: "tide-bells", name: "세 파도의 종", x: 1460, y: 800, radius: 64, clue: "아침의 햇살이 잎사귀를 깨우고, 마지막 밀물이 길을 잇는다.", requirement: "다온의 ‘여름의 첫 선물’ 보상 수령", reward: { conch: 160, shell: 500, growth: 3 } } as const;
export const RUNES = [{ id: "sun", name: "햇살", icon: "☀" }, { id: "leaf", name: "잎사귀", icon: "❧" }, { id: "wave", name: "밀물", icon: "≈" }, { id: "moon", name: "달빛", icon: "☾" }] as const;
export const SANCTUARY_CHEST = { id: "sanctuary-cache", name: "안뜰의 오래된 선물", x: 1780, y: 800 } as const;
export type AdventureView = { worldId: string; isOwner: boolean; eligible: boolean; regions: string[]; puzzle: { progress: number; revision: number; solved: boolean }; treasureOpened: boolean };
export function nearPuzzle(position: Position) { return Math.hypot(position.x - TIDE_PUZZLE.x, position.y - TIDE_PUZZLE.y) <= TIDE_PUZZLE.radius; }
export function nearSanctuaryChest(position: Position, opened: readonly string[], regions: readonly string[]) {
  return regions.includes(SANCTUARY.id) && !opened.includes(SANCTUARY_CHEST.id) && Math.hypot(position.x - SANCTUARY_CHEST.x, position.y - SANCTUARY_CHEST.y) <= 64 ? SANCTUARY_CHEST : undefined;
}
