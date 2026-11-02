import { CHARACTERS, SKILLS, type CharacterDefinition } from "./combat.js";
export const LEVEL_CAP = 20;
export const VICTORY_EXPERIENCE = 80;
export const LEARNSETS: Record<string, string[]> = {
  haerin: [
    "tide",
    "surge",
    "brine",
    "reef",
    "spritz",
    "glacier",
    "cascade",
    "monsoon",
  ],
  luna: [
    "breeze",
    "squall",
    "gale",
    "hush",
    "slipstream",
    "static",
    "crosswind",
    "cyclone",
  ],
  somi: [
    "leaf",
    "thorn",
    "spore",
    "renewal",
    "seedshot",
    "frostbud",
    "kindle",
    "garden",
  ],
  taeo: [
    "ember",
    "flare",
    "heatwave",
    "spark",
    "flashfire",
    "thaw",
    "blaze",
    "inferno",
  ],
};
for (const c of CHARACTERS) {
  if (!LEARNSETS[c.id])
    LEARNSETS[c.id] = [
      ...c.skills,
      ...[0, 1, 2, 3].map((i) => `${c.id}-learn${i}`),
    ];
  LEARNSETS[c.id].push(...[0, 1, 2, 3].map((i) => `${c.id}-master${i}`));
}
export const GROWTH: Record<
  string,
  { hp: number; attack: number; defense: number; speed: number }
> = {
  haerin: { hp: 12, attack: 2, defense: 1.6, speed: 0.2 },
  luna: { hp: 8, attack: 2.1, defense: 1, speed: 0.6 },
  somi: { hp: 14, attack: 1.6, defense: 2.1, speed: 0.1 },
  taeo: { hp: 10, attack: 2.6, defense: 1.1, speed: 0.3 },
};
Object.assign(GROWTH, {
  mira: { hp: 9, attack: 2.8, defense: 1.2, speed: 0.4 },
  nari: { hp: 13, attack: 1.9, defense: 2.2, speed: 0.1 },
  yeoha: { hp: 9, attack: 2, defense: 1.1, speed: 0.5 },
  ijun: { hp: 15, attack: 2.2, defense: 2.3, speed: 0.1 },
});
export function experienceToNext(level: number) {
  return 20 * level;
}
export function gainExperience(
  level: number,
  experience: number,
  amount: number,
  cap = LEVEL_CAP,
) {
  if (
    ![level, experience, amount, cap].every(Number.isSafeInteger) ||
    level < 1 ||
    experience < 0 ||
    amount < 0 ||
    cap < 1
  )
    throw new Error("Invalid experience progression");
  let nextLevel = level,
    xp = experience + amount;
  const limit = Math.max(level, cap);
  while (nextLevel < limit && xp >= experienceToNext(nextLevel)) {
    xp -= experienceToNext(nextLevel);
    nextLevel++;
  }
  return {
    level: nextLevel,
    experience: Math.min(xp, experienceToNext(nextLevel)),
  };
}
export function availableSkills(characterId: string, level: number) {
  return (LEARNSETS[characterId] ?? []).filter(
    (id) => SKILLS[id].learnLevel <= level,
  );
}
export function characterStats(
  characterId: string,
  level: number,
): CharacterDefinition {
  const c = CHARACTERS.find((c) => c.id === characterId);
  if (!c) throw new Error("Unknown character");
  const g = GROWTH[characterId],
    n = level - 1;
  return {
    ...c,
    maxHp: c.maxHp + Math.floor(g.hp * n),
    attack: c.attack + Math.floor(g.attack * n),
    defense: c.defense + Math.floor(g.defense * n),
    speed: c.speed + Math.floor(g.speed * n),
  };
}
export type CharacterProgress = CharacterDefinition & {
  critRate?: number;
  critDamage?: number;
  damageBonus?: number;
  elementDamageBonus?: Partial<Record<import("./combat.js").Element, number>>;
  elementResistance?: Partial<Record<import("./combat.js").Element, number>>;
  level: number;
  slot: number | null;
  experience: number;
  nextExperience: number;
  levelCap: number;
  revision: number;
  equipped: { slot: number; skillId: string }[];
  unlocks: { skillId: string; decision: string }[];
  learnset: { skillId: string; level: number }[];
};
