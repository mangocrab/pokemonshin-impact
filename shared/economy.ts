import type { Element } from "./combat.js";
export type WeaponDefinition = {
  id: string;
  name: string;
  rarity: 3 | 4 | 5;
  attack: number;
  hp: number;
  speed: number;
  critRate: number;
  damage: number;
  healing: number;
  description: string;
  elementBonus?: Partial<Record<Element, number>>;
  resistance?: Partial<Record<Element, number>>;
};
export const BANNER = {
  id: "summer-tide",
  name: "파도빛의 약속",
  featured: "mira",
  cost: 160,
  fiveRate: 0.006,
  fourRate: 0.051,
  fivePity: 90,
  fourPity: 10,
  offCharacterShare: 0.5,
};
export const WEAPONS = {
  shellWand: {
    id: "shellWand",
    name: "소라 지팡이",
    rarity: 3,
    attack: 8,
    hp: 20,
    speed: 0,
    critRate: 0,
    damage: 0,
    healing: 0,
    description: "HP +20",
  },
  driftSpear: {
    id: "driftSpear",
    name: "유목 창",
    rarity: 3,
    attack: 10,
    hp: 0,
    speed: 2,
    critRate: 0,
    damage: 0,
    healing: 0,
    description: "스피드 +2",
  },
  coralFlute: {
    id: "coralFlute",
    name: "산호 피리",
    rarity: 4,
    attack: 14,
    hp: 0,
    speed: 0,
    critRate: 0.05,
    damage: 0.05,
    healing: 0,
    description: "치명타 확률 +5%, 직접 피해 +5%, 물 피해 +10%",
    elementBonus: { 물: 0.1 },
  },
  palmBow: {
    id: "palmBow",
    name: "야자수 활",
    rarity: 4,
    attack: 16,
    hp: 30,
    speed: 2,
    critRate: 0,
    damage: 0,
    healing: 0,
    description: "HP +30, 스피드 +2",
  },
  sunblade: {
    id: "sunblade",
    name: "한낮의 검",
    rarity: 5,
    attack: 24,
    hp: 0,
    speed: 0,
    critRate: 0.1,
    damage: 0.15,
    healing: 0,
    description: "치명타 확률 +10%, 직접 피해 +15%",
  },
  moonstaff: {
    id: "moonstaff",
    name: "달맞이 지팡이",
    rarity: 5,
    attack: 22,
    hp: 60,
    speed: 0,
    critRate: 0,
    damage: 0,
    healing: 0.15,
    description: "HP +60, 회복·보호막 기술 +15%, 물 저항 +10%",
    resistance: { 물: 0.1 },
  },
} as const satisfies Record<string, WeaponDefinition>;
export type WeaponId = keyof typeof WEAPONS;
export const MATERIAL_NAMES: Record<string, string> = {
  "growth-stone": "성장 결정",
  "weapon-ore": "무기 광석",
  "training-book": "여름 기록",
  haerin: "해린의 산호",
  luna: "루나의 깃",
  somi: "소미의 꽃",
  taeo: "태오의 불씨",
  mira: "미라의 전광석",
  nari: "나리의 서리꽃",
  yeoha: "여하의 바람실",
  ijun: "이준의 뿌리",
};
export function materialId(id: string) {
  return "ascension-" + id;
}
export function materialName(id: string) {
  return id.startsWith("ascension-")
    ? (MATERIAL_NAMES[id.slice(10)] ?? id)
    : (MATERIAL_NAMES[id] ?? id);
}
export const ASCENSION_CAPS = [20, 40, 60, 80];
export function levelCap(ascension: number) {
  return ASCENSION_CAPS[ascension] ?? 80;
}
export type Pity = { five: number; four: number; guaranteed: boolean };
export type Pull = {
  kind: "character" | "weapon";
  id: string;
  rarity: 3 | 4 | 5;
  featured: boolean;
};
const fourCharacters = ["haerin", "luna", "somi", "taeo", "yeoha"];
function pick<T>(items: T[], rng: () => number) {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}
export function rollPull(
  pity: Pity,
  rng: () => number,
): { pull: Pull; pity: Pity } {
  const r = rng();
  const rarity: 3 | 4 | 5 =
    pity.five >= 89 || r < BANNER.fiveRate
      ? 5
      : pity.four >= 9 || r < BANNER.fiveRate + BANNER.fourRate
        ? 4
        : 3;
  let pull: Pull;
  if (rarity === 5) {
    if (pity.guaranteed || rng() < 0.5)
      pull = { kind: "character", id: BANNER.featured, rarity, featured: true };
    else if (rng() < BANNER.offCharacterShare)
      pull = {
        kind: "character",
        id: pick(["nari", "ijun"], rng),
        rarity,
        featured: false,
      };
    else
      pull = {
        kind: "weapon",
        id: pick(["sunblade", "moonstaff"], rng),
        rarity,
        featured: false,
      };
  } else if (rarity === 4) {
    pull =
      rng() < 0.5
        ? {
            kind: "character",
            id: pick(fourCharacters, rng),
            rarity,
            featured: false,
          }
        : {
            kind: "weapon",
            id: pick(["coralFlute", "palmBow"], rng),
            rarity,
            featured: false,
          };
  } else
    pull = {
      kind: "weapon",
      id: pick(["shellWand", "driftSpear"], rng),
      rarity,
      featured: false,
    };
  return {
    pull,
    pity: {
      five: rarity === 5 ? 0 : pity.five + 1,
      four: rarity >= 4 ? 0 : pity.four + 1,
      guaranteed: rarity === 5 ? !pull.featured : pity.guaranteed,
    },
  };
}
export function duplicateReward(
  copies: number,
  granted: number,
  rarity: number,
) {
  return copies < 7 && granted < 6
    ? { tokens: 1, dust: 0 }
    : { tokens: 0, dust: rarity === 5 ? 50 : 20 };
}
export function liberationBonuses(id: string, stage: number) {
  const role = ["haerin", "somi", "nari", "ijun"].includes(id)
    ? "support"
    : "attack";
  return {
    hp: stage >= 1 ? 0.05 : 0,
    attack: stage >= 2 ? 0.05 : 0,
    ultimate: stage >= 3 ? 0.1 : 0,
    status: stage >= 4 ? 0.1 : 0,
    speed: stage >= 5 ? (role === "support" ? 3 : 5) : 0,
    damage: stage >= 6 ? (role === "attack" ? 0.15 : 0.08) : 0,
    healing: stage >= 6 && role === "support" ? 0.15 : 0,
  };
}
