import { characterStats } from "./progression.js";
import { WEAPONS, liberationBonuses, type WeaponId, type WeaponDefinition } from "./economy.js";
/** One source for saved-roster combat bonuses and balance simulations. */
export function loadoutStats(characterId: string, level: number, liberation: number, skillLevel: number, equipped?: { weaponId: string; level: number } | null) {
  const base = characterStats(characterId, level), bonus = liberationBonuses(characterId, liberation);
  const weapon: WeaponDefinition | undefined = equipped ? WEAPONS[equipped.weaponId as WeaponId] : undefined;
  return {
    ...base,
    maxHp: Math.floor(base.maxHp * (1 + bonus.hp)) + (weapon?.hp ?? 0),
    attack: Math.floor(base.attack * (1 + bonus.attack)) + (weapon ? weapon.attack + 2 * (equipped!.level - 1) : 0),
    speed: base.speed + bonus.speed + (weapon?.speed ?? 0),
    elementDamageBonus: weapon?.elementBonus ?? {},
    elementResistance: weapon?.resistance ?? {},
    critRate: weapon?.critRate ?? 0,
    critDamage: 1.5,
    damageBonus: bonus.damage + (weapon?.damage ?? 0) + 0.04 * (skillLevel - 1),
    healingBonus: bonus.healing + (weapon?.healing ?? 0),
    ultimateBonus: bonus.ultimate,
    statusChanceBonus: bonus.status,
  };
}
