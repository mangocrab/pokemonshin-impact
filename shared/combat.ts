import { SANCTUARY } from "./adventure.js";
import type { CoopView } from "./coop.js";
export const ENCOUNTER = {
  id: "coral-crab",
  name: "산호 집게게",
  x: 740,
  y: 560,
  radius: 64,
};
export const SANCTUARY_ENCOUNTER = {
  id: "sanctuary-bloom", name: "안뜰 꽃등지기", x: 1870, y: 720, radius: 64,
  regionId: SANCTUARY.id,
} as const;
export const ENCOUNTERS = [ENCOUNTER, SANCTUARY_ENCOUNTER] as const;
export type Encounter = (typeof ENCOUNTERS)[number];
export function nearbyEncounter(position: { x: number; y: number }, regions: readonly string[]) {
  return ENCOUNTERS.find((e) => (!("regionId" in e) || regions.includes(e.regionId)) && Math.hypot(position.x - e.x, position.y - e.y) <= e.radius);
}
export const ELEMENTS = ["불", "물", "바람", "번개", "얼음", "자연"] as const;
export type Element = (typeof ELEMENTS)[number];
// Only the listed relationships modify damage; all other pairs are neutral.
export const EFFECTIVENESS: Record<
  Element,
  Partial<Record<Element, number>>
> = {
  불: { 자연: 2, 물: 0.5 },
  물: { 불: 2, 자연: 0.5 },
  자연: { 물: 2, 불: 0.5 },
  바람: { 얼음: 2, 번개: 0.5 },
  얼음: { 번개: 2, 바람: 0.5 },
  번개: { 바람: 2, 얼음: 0.5 },
};
export type StatusId =
  | "burn"
  | "shock"
  | "freeze"
  | "slow"
  | "bind"
  | "attackDown"
  | "defenseDown"
  | "accuracyDown";
export const STATUS_NAMES: Record<StatusId, string> = {
  burn: "화상",
  shock: "감전",
  freeze: "빙결",
  slow: "둔화",
  bind: "속박",
  attackDown: "공격력 감소",
  defenseDown: "방어력 감소",
  accuracyDown: "명중률 감소",
};
export type StatusInstance = { id: StatusId; expiresAfterRound: number };
export type Penalty =
  | { type: "recharge"; duration: number }
  | { type: "cooldown"; duration: number }
  | { type: "prepare"; duration: number }
  | { type: "recoil"; fraction: number }
  | {
      type: "statDrop";
      stat: "attackDown" | "defenseDown" | "slow";
      duration: number;
    };
export type Skill = {
  id: string;
  name: string;
  description: string;
  element: Element;
  category: "attack" | "heal" | "shield" | "status";
  target: "enemy" | "self";
  power: number;
  accuracy: number;
  priority: number;
  learnLevel: number;
  statuses: { id: StatusId; chance: number; duration: number }[];
  penalties: Penalty[];
  recovery?: number;
  cleanse?: boolean;
  condition?: { maxHpRatio: number };
  energyCost?: number;
};
function skill(
  id: string,
  name: string,
  element: Element,
  power: number,
  accuracy = 1,
  extra: Partial<Skill> = {},
): Skill {
  return {
    id,
    name,
    description: "직접 공격 피해를 줍니다.",
    element,
    power,
    accuracy,
    priority: 0,
    category: "attack",
    target: "enemy",
    learnLevel: 1,
    statuses: [],
    penalties: [],
    ...extra,
  };
}
export const SKILLS: Record<string, Skill> = {
  tide: skill("tide", "물결 쏘기", "물", 80),
  surge: skill("surge", "거센 파도", "물", 180, 1, {
    description:
      "큰 피해를 주지만 다음 라운드에는 모든 일반 행동이 제한됩니다.",
    penalties: [{ type: "recharge", duration: 1 }],
  }),
  brine: skill("brine", "소금물 안개", "물", 45, 0.9, {
    description: "명중 시 둔화 2라운드. 명중과 상태 부여는 별도로 판정합니다.",
    statuses: [{ id: "slow", chance: 1, duration: 2 }],
  }),
  reef: skill("reef", "산호 방벽", "물", 0, 1, {
    category: "shield",
    target: "self",
    recovery: 0.25,
    description:
      "최대 HP의 25% 보호막. 다음 2라운드 재사용 불가. 자속 보정 없음.",
    penalties: [{ type: "cooldown", duration: 2 }],
  }),
  breeze: skill("breeze", "바람 깃", "바람", 80),
  squall: skill("squall", "돌풍 가르기", "바람", 120, 0.8, {
    description: "높은 위력 대신 명중률이 80%입니다.",
  }),
  gale: skill("gale", "여름 태풍", "바람", 240, 1, {
    description:
      "이번 행동은 준비에 소비하고 다음 라운드에 발사합니다. 행동 제한에 걸리면 준비가 취소됩니다.",
    penalties: [{ type: "prepare", duration: 1 }],
  }),
  hush: skill("hush", "서리 자장가", "얼음", 0, 0.85, {
    category: "status",
    description:
      "명중 시 빙결로 행동 1회를 막습니다. 해제 후 2라운드 빙결 면역.",
    statuses: [{ id: "freeze", chance: 1, duration: 1 }],
    penalties: [{ type: "cooldown", duration: 3 }],
  }),
  leaf: skill("leaf", "잎새 타격", "자연", 80),
  thorn: skill("thorn", "가시 덩굴", "자연", 65, 0.95, {
    description: "명중 후 75% 확률로 2라운드 속박. 일반 교체를 제한합니다.",
    statuses: [{ id: "bind", chance: 0.75, duration: 2 }],
  }),
  spore: skill("spore", "여름 포자", "자연", 25, 0.9, {
    description:
      "명중 후 90% 확률로 화상 3라운드. 화상은 라운드 말 최대 HP의 6%, 자속·상성 보정 없음.",
    statuses: [{ id: "burn", chance: 0.9, duration: 3 }],
  }),
  renewal: skill("renewal", "초록 숨결", "자연", 0, 1, {
    category: "heal",
    target: "self",
    recovery: 0.25,
    cleanse: true,
    description:
      "최대 HP의 25% 회복 및 상태이상 해제. 기술 패널티는 해제하지 않습니다. 재사용 2라운드.",
    penalties: [{ type: "cooldown", duration: 2 }],
  }),
  ember: skill("ember", "불씨 날리기", "불", 80),
  flare: skill("flare", "불꽃 분출", "불", 140, 0.9, {
    description:
      "높은 위력, 명중률 90%. 실제 직접 피해의 25%를 반동으로 받습니다.",
    penalties: [{ type: "recoil", fraction: 0.25 }],
  }),
  heatwave: skill("heatwave", "한낮의 결의", "불", 180, 1, {
    description:
      "HP 50% 이하일 때만 사용. 사용 후 다음 2라운드 공격력·방어력 감소.",
    condition: { maxHpRatio: 0.5 },
    penalties: [
      { type: "statDrop", stat: "attackDown", duration: 2 },
      { type: "statDrop", stat: "defenseDown", duration: 2 },
    ],
  }),
  spark: skill("spark", "해변의 섬광", "번개", 65, 0.95, {
    description:
      "명중 후 75% 확률로 감전 2라운드. 감전 중 행동 시 25% 확률로 행동 실패.",
    statuses: [{ id: "shock", chance: 0.75, duration: 2 }],
  }),
  spritz: skill("spritz", "물보라 찌르기", "물", 65, 1, {
    priority: 1,
    learnLevel: 5,
    description: "낮은 위력 대신 일반 기술보다 먼저 행동합니다.",
  }),
  glacier: skill("glacier", "빙하의 편지", "얼음", 45, 0.9, {
    learnLevel: 10,
    statuses: [{ id: "freeze", chance: 0.75, duration: 1 }],
    penalties: [{ type: "cooldown", duration: 3 }],
    description: "명중 후75% 빙결1회. 재사용3라운드.",
  }),
  cascade: skill("cascade", "폭포 가르기", "물", 160, 0.9, {
    learnLevel: 15,
    penalties: [{ type: "recoil", fraction: 0.25 }],
    description: "높은 위력과90% 명중. 실제HP피해25% 반동.",
  }),
  monsoon: skill("monsoon", "여름 몬순", "물", 260, 1, {
    learnLevel: 20,
    penalties: [
      { type: "prepare", duration: 1 },
      { type: "statDrop", stat: "defenseDown", duration: 2 },
    ],
    description: "준비1행동 후 발사. 사용 후 방어력 감소2라운드.",
  }),
  slipstream: skill("slipstream", "바람길", "바람", 60, 1, {
    priority: 1,
    learnLevel: 4,
    description: "낮은 위력 대신 일반 기술보다 먼저 행동합니다.",
  }),
  static: skill("static", "정전기 리본", "번개", 45, 0.9, {
    learnLevel: 9,
    statuses: [{ id: "shock", chance: 1, duration: 2 }],
    description: "명중 시 감전2라운드. 직접 피해는 낮습니다.",
  }),
  crosswind: skill("crosswind", "엇갈린 바람", "바람", 140, 0.85, {
    learnLevel: 14,
    penalties: [{ type: "cooldown", duration: 1 }],
    description: "명중85%, 다음1라운드 재사용 불가.",
  }),
  cyclone: skill("cyclone", "회오리의 약속", "바람", 220, 1, {
    learnLevel: 20,
    penalties: [{ type: "recharge", duration: 1 }],
    description: "큰 피해 뒤 다음 라운드 행동 불가.",
  }),
  seedshot: skill("seedshot", "씨앗 튕기기", "자연", 60, 1, {
    priority: 1,
    learnLevel: 6,
    description: "낮은 위력 대신 일반 기술보다 먼저 행동합니다.",
  }),
  frostbud: skill("frostbud", "서리 꽃봉오리", "얼음", 45, 0.95, {
    learnLevel: 10,
    statuses: [{ id: "slow", chance: 1, duration: 3 }],
    description: "명중 시 둔화3라운드.",
  }),
  kindle: skill("kindle", "불꽃 씨앗", "불", 65, 0.95, {
    learnLevel: 16,
    statuses: [{ id: "burn", chance: 0.75, duration: 3 }],
    description: "명중 후75% 확률로 화상3라운드.",
  }),
  garden: skill("garden", "한여름의 정원", "자연", 170, 0.95, {
    learnLevel: 20,
    penalties: [{ type: "cooldown", duration: 2 }],
    description: "강한 직접 공격. 다음2라운드 재사용 불가.",
  }),
  flashfire: skill("flashfire", "번뜩이는 불씨", "불", 60, 1, {
    priority: 1,
    learnLevel: 5,
    description: "낮은 위력 대신 일반 기술보다 먼저 행동합니다.",
  }),
  thaw: skill("thaw", "해빙의 물결", "물", 50, 1, {
    learnLevel: 11,
    statuses: [{ id: "defenseDown", chance: 0.75, duration: 2 }],
    description: "명중 후75% 확률로 방어력 감소2라운드.",
  }),
  blaze: skill("blaze", "타오르는 모래", "불", 160, 0.9, {
    learnLevel: 15,
    penalties: [{ type: "statDrop", stat: "defenseDown", duration: 2 }],
    description: "명중90%, 사용 후 방어력 감소2라운드.",
  }),
  inferno: skill("inferno", "여름의 심장", "불", 260, 0.9, {
    learnLevel: 20,
    penalties: [
      { type: "recharge", duration: 1 },
      { type: "recoil", fraction: 0.15 },
    ],
    description: "명중90%, 다음 라운드 행동 불가 및 실제HP피해15% 반동.",
  }),
  bloomLeaf: skill("bloomLeaf", "잎새 바람", "자연", 80),
  bloomRoots: skill("bloomRoots", "휘감는 줄기", "자연", 45, 0.9, {
    statuses: [{ id: "slow", chance: 0.75, duration: 2 }],
    description: "명중90%, 명중 시75% 확률로 둔화2라운드. 교체를 막지 않습니다.",
  }),
  bloomBurst: skill("bloomBurst", "한여름의 만개", "자연", 180, 1, {
    penalties: [{ type: "recharge", duration: 1 }],
    description: "위력180, 명중100%. 사용 후 다음 라운드 행동 불가. 방어 또는 속성 교체로 대비하세요.",
  }),
  crabPinch: skill("crabPinch", "산호 집게", "물", 80),
  crabCrush: skill("crabCrush", "집게 내리꽂기", "물", 120, 0.8),
  crabSand: skill("crabSand", "모래 흩뿌리기", "자연", 45, 0.9, {
    statuses: [{ id: "accuracyDown", chance: 1, duration: 2 }],
    description: "명중 시 명중률 감소 2라운드.",
  }),
};
export const ENEMY_DEFINITIONS: Record<string, { element: Element; maxHp: number; attack: number; defense: number; speed: number; rotation: string[] }> = {
  [ENCOUNTER.id]: { element: "물", maxHp: 220, attack: 36, defense: 24, speed: 38, rotation: ["crabPinch", "crabPinch", "crabCrush", "crabSand", "crabPinch", "crabCrush", "crabPinch", "crabSand", "crabCrush", "crabPinch", "crabPinch", "crabSand"] },
  [SANCTUARY_ENCOUNTER.id]: { element: "자연", maxHp: 320, attack: 38, defense: 28, speed: 32, rotation: ["bloomLeaf", "bloomRoots", "bloomBurst"] },
};
export function enemySkillForRound(enemyId: string, round: number) {
  const pattern = (ENEMY_DEFINITIONS[enemyId] ?? ENEMY_DEFINITIONS[ENCOUNTER.id]).rotation;
  return SKILLS[pattern[(round - 1) % pattern.length]];
}
export const ULTIMATES: Record<string, Skill> = {
  seaHome: skill("seaHome", "바다가 품은 약속", "물", 0, 1, {
    category: "heal",
    target: "self",
    recovery: 0.4,
    cleanse: true,
    energyCost: 100,
    description: "에너지 100. 최대 HP 40% 회복 및 상태 해제. 자속 보정 없음.",
  }),
  skySong: skill("skySong", "푸른 하늘의 노래", "바람", 200, 1, {
    energyCost: 100,
    description: "에너지 100. 바람 직접 공격. 자속·상성 적용.",
  }),
  forestHome: skill("forestHome", "여름 숲의 안식", "자연", 0, 1, {
    category: "shield",
    target: "self",
    recovery: 0.45,
    energyCost: 100,
    description: "에너지 100. 최대 HP 45% 보호막. 자속 보정 없음.",
  }),
  sunset: skill("sunset", "마지막 노을", "불", 220, 1, {
    energyCost: 100,
    statuses: [{ id: "burn", chance: 0.75, duration: 2 }],
    penalties: [{ type: "recharge", duration: 1 }],
    description:
      "에너지 100. 강력한 불 공격과 75% 화상 2라운드. 다음 라운드 행동 불가.",
  }),
};
export const PASSIVES: Record<string, { name: string; description: string }> = {
  tideHeart: {
    name: "밀물의 마음",
    description: "HP 50% 이하에서 물 직접 피해 20% 증가.",
  },
  freeWind: {
    name: "자유로운 바람",
    description: "HP가 가득 차면 스피드 15% 증가.",
  },
  greenRest: {
    name: "초록 쉼표",
    description: "출전 중 라운드 말 최대 HP 4% 회복. 쓰러지면 발동하지 않음.",
  },
  emberHeart: {
    name: "꺼지지 않는 열정",
    description: "화상 상태의 적에게 직접 피해 20% 증가.",
  },
};
export type Stats = {
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
};
export type CharacterDefinition = Stats & {
  gender: "female" | "male";
  id: string;
  name: string;
  element: Element;
  rarity: 4 | 5;
  skills: string[];
  color: string;
  passiveId: string;
  ultimateId: string;
};
export const CHARACTERS: CharacterDefinition[] = [
  {
    id: "haerin",
    name: "해린",
    gender: "female",
    element: "물",
    rarity: 4,
    maxHp: 240,
    attack: 40,
    defense: 28,
    speed: 34,
    skills: ["tide", "surge", "brine", "reef"],
    color: "#62bfc6",
    passiveId: "tideHeart",
    ultimateId: "seaHome",
  },
  {
    id: "luna",
    name: "루나",
    gender: "female",
    element: "바람",
    rarity: 4,
    maxHp: 180,
    attack: 38,
    defense: 20,
    speed: 52,
    skills: ["breeze", "squall", "gale", "hush"],
    color: "#8abc86",
    passiveId: "freeWind",
    ultimateId: "skySong",
  },
  {
    id: "somi",
    name: "소미",
    gender: "female",
    element: "자연",
    rarity: 4,
    maxHp: 260,
    attack: 35,
    defense: 36,
    speed: 28,
    skills: ["leaf", "thorn", "spore", "renewal"],
    color: "#a7b871",
    passiveId: "greenRest",
    ultimateId: "forestHome",
  },
  {
    id: "taeo",
    name: "태오",
    gender: "male",
    element: "불",
    rarity: 4,
    maxHp: 210,
    attack: 46,
    defense: 24,
    speed: 40,
    skills: ["ember", "flare", "heatwave", "spark"],
    color: "#da9a71",
    passiveId: "emberHeart",
    ultimateId: "sunset",
  },
];
// Four additional original companions; only the first four are free starters.
const newcomers: CharacterDefinition[] = [
  {
    id: "mira",
    name: "미라",
    gender: "female",
    element: "번개",
    rarity: 5,
    maxHp: 205,
    attack: 48,
    defense: 24,
    speed: 47,
    skills: ["mira-1", "mira-2", "mira-3", "mira-4"],
    color: "#b39cce",
    passiveId: "sparkHeart",
    ultimateId: "stormPromise",
  },
  {
    id: "nari",
    name: "나리",
    gender: "female",
    element: "얼음",
    rarity: 5,
    maxHp: 250,
    attack: 39,
    defense: 35,
    speed: 30,
    skills: ["nari-1", "nari-2", "nari-3", "nari-4"],
    color: "#a7d6e0",
    passiveId: "frostHeart",
    ultimateId: "snowRest",
  },
  {
    id: "yeoha",
    name: "여하",
    gender: "female",
    element: "바람",
    rarity: 4,
    maxHp: 195,
    attack: 40,
    defense: 22,
    speed: 50,
    skills: ["yeoha-1", "yeoha-2", "yeoha-3", "yeoha-4"],
    color: "#93c8b3",
    passiveId: "swiftHeart",
    ultimateId: "cloudHome",
  },
  {
    id: "ijun",
    name: "이준",
    gender: "male",
    element: "자연",
    rarity: 5,
    maxHp: 275,
    attack: 42,
    defense: 38,
    speed: 26,
    skills: ["ijun-1", "ijun-2", "ijun-3", "ijun-4"],
    color: "#8aa978",
    passiveId: "rootHeart",
    ultimateId: "rootPromise",
  },
];
for (const c of newcomers) {
  const names: Record<string, string[]> = {
    mira: ["전광 조각", "번개 장막", "해안 감전", "빛의 쉼표"],
    nari: ["서리 조각", "설원의 파도", "차가운 숨", "빙하 방벽"],
    yeoha: ["바람실", "돌개 선율", "바람의 매듭", "구름 방벽"],
    ijun: ["뿌리 타격", "숲의 맹세", "덩굴 매듭", "뿌리 방벽"],
  };
  SKILLS[c.skills[0]] = skill(c.skills[0], names[c.id][0], c.element, 80);
  SKILLS[c.skills[1]] = skill(
    c.skills[1],
    names[c.id][1],
    c.element,
    160,
    0.9,
    {
      penalties: [{ type: "cooldown", duration: 1 }],
      description: "명중90%, 다음1라운드 재사용 불가.",
    },
  );
  SKILLS[c.skills[2]] = skill(c.skills[2], names[c.id][2], c.element, 45, 0.9, {
    statuses: [
      {
        id: c.id === "mira" ? "shock" : c.id === "nari" ? "slow" : "bind",
        chance: 1,
        duration: 2,
      },
    ],
    description: `명중 시 ${c.id === "mira" ? "감전" : c.id === "nari" ? "둔화" : "속박"}2라운드.`,
  });
  SKILLS[c.skills[3]] = skill(c.skills[3], names[c.id][3], c.element, 0, 1, {
    category: "shield",
    target: "self",
    recovery: 0.25,
    penalties: [{ type: "cooldown", duration: 2 }],
    description: "최대HP25% 보호막, 다음2라운드 재사용 불가.",
  });
  for (let i = 0; i < 4; i++) {
    const id = `${c.id}-learn${i}`;
    SKILLS[id] = skill(
      id,
      `${c.name}의 ${["선제술", "속성술", "집중술", "폭풍술"][i]}`,
      c.element,
      [60, 65, 180, 240][i],
      [1, 0.95, 1, 1][i],
      {
        learnLevel: [5, 10, 15, 20][i],
        priority: i === 0 ? 1 : 0,
        statuses: i === 1 ? [{ id: "attackDown", chance: 0.75, duration: 2 }] : [],
        penalties:
          i === 2
            ? [{ type: "recharge", duration: 1 }]
            : i === 3
              ? [{ type: "prepare", duration: 1 }]
              : [],
        description:
          i === 0
            ? "선공 저위력 기술."
            : i === 2
              ? "강한 피해 뒤 다음 라운드 행동 불가."
              : i === 3
                ? "준비1행동 뒤 발사."
                : "명중95%, 명중 시75% 확률로 공격력 감소2라운드.",
      },
    );
  }
}
CHARACTERS.push(...newcomers);
Object.assign(PASSIVES, {
  sparkHeart: {
    name: "전광의 마음",
    description: "감전 상태 적에게 직접 피해20% 증가.",
  },
  frostHeart: {
    name: "서리의 품",
    description: "HP50% 이하에서 방어력20% 증가.",
  },
  swiftHeart: {
    name: "바람의 걸음",
    description: "HP50% 이하에서 스피드20% 증가.",
  },
  rootHeart: {
    name: "깊은 뿌리",
    description: "방어 시 직접 피해를 추가20% 감소.",
  },
});
Object.assign(ULTIMATES, {
  stormPromise: skill("stormPromise", "번개가 남긴 약속", "번개", 210, 1, {
    energyCost: 100,
    statuses: [{ id: "shock", chance: 0.75, duration: 2 }],
    description: "에너지100. 번개 공격 및75% 감전2라운드.",
  }),
  snowRest: skill("snowRest", "눈꽃의 안식", "얼음", 0, 1, {
    energyCost: 100,
    category: "heal",
    target: "self",
    recovery: 0.4,
    cleanse: true,
    description: "에너지100. HP40% 회복 및 상태 해제.",
  }),
  cloudHome: skill("cloudHome", "구름이 머무는 곳", "바람", 0, 1, {
    energyCost: 100,
    category: "shield",
    target: "self",
    recovery: 0.45,
    description: "에너지100. HP45% 보호막.",
  }),
  rootPromise: skill("rootPromise", "뿌리 깊은 약속", "자연", 240, 1, {
    energyCost: 100,
    penalties: [{ type: "statDrop", stat: "defenseDown", duration: 2 }],
    description: "에너지100. 자연 공격 후 방어력 감소2라운드.",
  }),
});
for (const c of CHARACTERS)
  for (let i = 0; i < 4; i++) {
    const id = `${c.id}-master${i}`;
    SKILLS[id] = skill(
      id,
      `${c.name}의 ${["숙련술", "제어술", "극한술", "해방술"][i]}`,
      c.element,
      [140, 45, 320, 280][i],
      [0.9, 0.9, 1, 0.95][i],
      {
        learnLevel: [30, 40, 50, 60][i],
        priority: i === 0 ? 1 : 0,
        statuses: i === 1 ? [{ id: "attackDown", chance: 1, duration: 2 }] : [],
        penalties:
          i === 0
            ? [{ type: "cooldown", duration: 1 }]
            : i === 2
              ? [{ type: "recharge", duration: 2 }]
              : i === 3
                ? [
                    { type: "prepare", duration: 1 },
                    { type: "recoil", fraction: 0.2 },
                  ]
                : [],
        description:
          i === 0
            ? "선공 고위력, 명중90%, 재사용1라운드."
            : i === 1
              ? "명중 시 공격력 감소2라운드."
              : i === 2
                ? "초고위력 뒤 다음2라운드 행동 불가."
                : "준비1행동 뒤 강한 공격, 실제HP피해20% 반동.",
      },
    );
  }
export type Fighter = Stats & {
  elementDamageBonus?: Partial<Record<Element, number>>;
  elementResistance?: Partial<Record<Element, number>>;
  critRate?: number;
  critDamage?: number;
  damageBonus?: number;
  healingBonus?: number;
  ultimateBonus?: number;
  statusChanceBonus?: number;
  id: string;
  name: string;
  hp: number;
  skills: string[];
  element: Element;
  passiveId: string;
  ultimateId: string;
  energy: number;
  shield: number;
  statuses: StatusInstance[];
  blockedUntilRound: number;
  cooldowns: Record<string, number>;
  preparing?: { skillId: string; readyRound: number };
  statusImmunities: StatusId[];
  statusResistance: Partial<Record<StatusId, number>>;
  controlImmunityUntilRound: number;
};
export type BattleAction =
  | { type: "skill"; skillId: string }
  | { type: "ultimate" }
  | { type: "item"; itemId: string }
  | { type: "switch"; slot: number }
  | { type: "defend" }
  | { type: "flee" }
  | { type: "wait" }
  | { type: "continue" };
export type BattleStatus = "active" | "won" | "lost" | "fled" | "abandoned";
/** Last resolved round's visual facts; hit means accuracy only, not status application. */
export type ResolvedSkillCue = {
  round: number;
  actor: "ally" | "enemy" | "visitor";
  actorId: string;
  actorName: string;
  target: "ally" | "enemy";
  targetId: string;
  skillId: string;
  skillName: string;
  element: Element;
  category: Skill["category"];
  hit: boolean;
};
export type BattleState = {
  skillCues?: ResolvedSkillCue[];
  /** Transient resolution events, drained before persistence/publication. */
  itemUses?: string[];
  coop?: CoopView;
  reward?: {
    experience: number;
    progress: {
      characterId: string;
      oldLevel: number;
      level: number;
      newSkills: string[];
    }[];
  };
  rulesVersion: 2;
  id: string;
  version: number;
  round: number;
  status: BattleStatus;
  phase: "choice" | "replacement" | "ended";
  team: Fighter[];
  activeSlot: number;
  enemy: Fighter;
  log: string[];
};
export function hasStatus(f: Fighter, id: StatusId) {
  return f.statuses.some((s) => s.id === id);
}
export function blockedReason(f: Fighter, round: number) {
  if (f.blockedUntilRound >= round)
    return `기술 반동으로 ${f.blockedUntilRound - round + 1}라운드 행동 불가`;
  if (hasStatus(f, "freeze")) return "빙결로 행동 불가";
  return "";
}
export function skillUnavailable(f: Fighter, skill: Skill, round: number) {
  if ((f.cooldowns[skill.id] ?? 0) >= round)
    return `재사용까지 ${f.cooldowns[skill.id] - round + 1}라운드`;
  if (skill.condition && f.hp / f.maxHp > skill.condition.maxHpRatio)
    return `HP ${skill.condition.maxHpRatio * 100}% 이하 필요`;
  if (skill.energyCost && f.energy < skill.energyCost)
    return `에너지 ${skill.energyCost} 필요`;
  return "";
}
