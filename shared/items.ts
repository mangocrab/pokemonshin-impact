import type { Fighter } from "./combat.js";
export const CONSUMABLES = {
  "summer-tonic": { id: "summer-tonic", name: "여름 과즙", price: 150, effect: "heal", description: "자신의 출전 캐릭터 최대HP50% 회복. 행동1회 소비, 우선도6. 회복 보너스·자속 미적용." },
  "cleansing-salt": { id: "cleansing-salt", name: "정화 소금", price: 250, effect: "cleanse", description: "행동 가능한 자신의 출전 캐릭터 상태이상 해제. 행동1회 소비, 우선도6. 준비·쿨다운·재충전은 해제하지 않음." },
} as const;
export type ConsumableId = keyof typeof CONSUMABLES;
export function consumable(id: string) { return Object.hasOwn(CONSUMABLES, id) ? CONSUMABLES[id as ConsumableId] : undefined; }
export function itemUnavailable(f: Fighter, id: string) {
  const item = consumable(id);
  if (!item) return "사용할 수 없는 전투 아이템입니다.";
  if (f.hp <= 0) return "쓰러진 캐릭터에게 사용할 수 없습니다.";
  if (item.effect === "heal" && f.hp >= f.maxHp) return "HP가 이미 가득 찼습니다.";
  if (item.effect === "cleanse" && !f.statuses.length) return "해제할 상태이상이 없습니다.";
  return "";
}
