import { STATUS_NAMES, ULTIMATES, type BattleState, type Element, type Fighter } from "./combat.js";

export type ResultChip = { kind: "damage" | "heal" | "shield" | "status" | "switch"; text: string };
export type BattleFeedback = {
  key: string;
  ally: ResultChip[];
  enemy: ResultChip[];
  burst?: { characterId: string; name: string; skillName: string; element: Element };
};
function fighterChanges(before: Fighter, after: Fighter): ResultChip[] {
  const chips: ResultChip[] = [];
  const hp = after.hp - before.hp, shield = after.shield - before.shield;
  // These are net snapshot changes, never individual damage or critical-hit claims.
  if (hp) chips.push({ kind: hp < 0 ? "damage" : "heal", text: `HP ${hp > 0 ? "+" : "−"}${Math.abs(hp)}` });
  if (shield) chips.push({ kind: "shield", text: `보호막 ${shield > 0 ? "+" : "−"}${Math.abs(shield)}` });
  for (const status of after.statuses) if (!before.statuses.some((s) => s.id === status.id)) chips.push({ kind: "status", text: STATUS_NAMES[status.id] });
  for (const status of before.statuses) if (!after.statuses.some((s) => s.id === status.id)) chips.push({ kind: "status", text: `${STATUS_NAMES[status.id]} 해제` });
  return chips;
}
/** Presentation only. Initial loads, duplicated/stale updates and missed rounds never replay effects. */
export function battleFeedback(before: BattleState | null, after: BattleState | null): BattleFeedback | null {
  if (!before || !after || before.id !== after.id || after.version <= before.version || after.round < before.round || after.round > before.round + 1) return null;
  const current = after.team[after.activeSlot], old = before.team.find((f) => f.id === current.id);
  const ally = old ? fighterChanges(old, current) : [];
  if (before.team[before.activeSlot].id !== current.id) ally.unshift({ kind: "switch", text: `${current.name} 출전` });
  const enemy = before.enemy.id === after.enemy.id ? fighterChanges(before.enemy, after.enemy) : [];
  const caster = before.team[before.activeSlot], nextCaster = after.team.find((f) => f.id === caster.id);
  const ultimate = ULTIMATES[caster.ultimateId];
  // Energy is only spent by resolved ultimates. Selection/lobby updates cannot trigger a cut-in.
  const burst = after.round === before.round + 1 && ultimate?.energyCost && caster.energy >= ultimate.energyCost && nextCaster && nextCaster.energy < caster.energy
    ? { characterId: caster.id, name: caster.name, skillName: ultimate.name, element: ultimate.element } : undefined;
  return ally.length || enemy.length || burst ? { key: `${after.id}:${after.version}`, ally, enemy, burst } : null;
}

export const TRAVELER_DIRECTIONS = ["south", "west", "east", "north"] as const;
export type TravelerDirection = typeof TRAVELER_DIRECTIONS[number];
export type TravelerFrame = `${TravelerDirection}-${0 | 1 | 2}`;
export type TravelerStep = { x: number; y: number; phase: number; movingUntil: number; direction: TravelerDirection };
export function travelerStep(previous: TravelerStep, position: { x: number; y: number }, time: number): TravelerStep {
  const dx = position.x - previous.x, dy = position.y - previous.y, distance = Math.hypot(dx, dy);
  // Teleports/world changes must not look like running across the intervening terrain.
  const walking = distance > 0.05 && distance < 32;
  const direction = !walking ? previous.direction : Math.abs(dx) > Math.abs(dy) ? dx < 0 ? "west" : "east" : dy < 0 ? "north" : "south";
  return { x: position.x, y: position.y, phase: walking ? previous.phase + distance * 0.10 : previous.phase,
    movingUntil: walking ? time + 130 : distance >= 32 ? 0 : previous.movingUntil,
    direction };
}
export function travelerFrame(step: TravelerStep, time: number, motion: boolean): TravelerFrame {
  const stride = [0, 1, 0, 2] as const;
  const frame = motion && time < step.movingUntil ? stride[Math.floor(step.phase / (Math.PI / 2)) % stride.length] : 0;
  return `${step.direction}-${frame}`;
}
