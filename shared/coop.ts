import {
  type BattleState,
  type BattleAction,
  type Fighter,
  blockedReason,
  ENCOUNTER,
  SANCTUARY_ENCOUNTER,
  ENEMY_DEFINITIONS,
} from "./combat.js";
export type CoopMemberState = {
  userId: string;
  nickname: string;
  ready: boolean;
  left: boolean;
  state: BattleState;
  choice: BattleAction | null;
  reconnectUntil?: number;
};
export type CoopState = {
  id: string;
  ownerId: string;
  worldId: string;
  version: number;
  round: number;
  status: "lobby" | "active" | "won" | "lost" | "abandoned";
  deadline: number;
  enemy: Fighter;
  members: CoopMemberState[];
  log: string[];
};
export type CoopView = {
  userId: string;
  ownerId: string;
  lobby: boolean;
  submitted: boolean;
  spectating: boolean;
  deadline: number;
  paused: boolean;
  resumeRequired: boolean;
  reconnectUntil?: number;
  ownerAvailable: boolean;
  party: {
    userId: string;
    nickname: string;
    activeName: string;
    hp: number;
    maxHp: number;
    ready: boolean;
    submitted: boolean;
    left: boolean;
    reconnectUntil?: number;
  }[];
};
export function coopView(state: CoopState, userId: string): BattleState {
  const member = state.members.find((m) => m.userId === userId);
  if (!member) throw new Error("Not a battle participant");
  return {
    ...member.state,
    id: state.id,
    version: state.version,
    round: state.round,
    enemy: state.enemy,
    log: state.log,
    status: state.status === "abandoned" ? "abandoned" : member.left ? "fled" : state.status === "lobby" || state.status === "active" ? "active" : state.status,
    phase:
      state.status !== "active" && state.status !== "lobby"
        ? "ended"
        : member.state.phase,
    coop: {
      userId,
      ownerId: state.ownerId,
      lobby: state.status === "lobby",
      submitted: member.choice !== null,
      spectating: member.state.team.every((f) => f.hp <= 0),
      deadline: state.deadline,
      paused: coopPaused(state),
      resumeRequired: Boolean(member.reconnectUntil),
      reconnectUntil: coopPaused(state) ? nextCoopDeadline(state) : undefined,
      ownerAvailable: !state.members.find((m) => m.userId === state.ownerId)?.reconnectUntil,
      party: state.members.map((m) => ({
        userId: m.userId,
        nickname: m.nickname,
        activeName: m.state.team[m.state.activeSlot].name,
        hp: m.state.team[m.state.activeSlot].hp,
        maxHp: m.state.team[m.state.activeSlot].maxHp,
        ready: m.ready,
        submitted: m.choice !== null,
        left: m.left,
        reconnectUntil: m.reconnectUntil,
      })),
    },
  };
}
export function livingMembers(s: CoopState) {
  return s.members.filter(
    (m) => m.ready && !m.left && m.state.team.some((f) => f.hp > 0),
  );
}
export function autoChoices(s: CoopState) {
  for (const m of livingMembers(s))
    if (
      m.state.phase !== "replacement" &&
      !m.choice &&
      blockedReason(m.state.team[m.state.activeSlot], s.round)
    )
      m.choice = { type: "wait" };
}

export const COOP_RECONNECT_MS = 30000;
export function coopPaused(s: CoopState) {
  return (s.status === "active" || s.status === "lobby") && s.members.some((m) => !m.left && m.reconnectUntil !== undefined);
}
export function nextCoopDeadline(s: CoopState) {
  return coopPaused(s) ? Math.min(...s.members.filter((m) => !m.left && m.reconnectUntil !== undefined).map((m) => m.reconnectUntil!)) : s.deadline;
}

export const COOP_BOSSES: Record<string, string> = {
  [ENCOUNTER.id]: "산호 수호게",
  [SANCTUARY_ENCOUNTER.id]: "안뜰 만개지기",
};
export function cooperativeEnemy(enemy: Fighter, count: number): Fighter {
  if (!Number.isInteger(count) || count < 2 || count > 4) throw new Error("Co-op requires 2-4 members");
  const base = ENEMY_DEFINITIONS[enemy.id];
  if (!base || !COOP_BOSSES[enemy.id]) throw new Error("Unknown cooperative encounter");
  const maxHp = Math.round(base.maxHp * (1 + 0.8 * (count - 1)));
  return { ...enemy, maxHp, hp: maxHp, attack: Math.round(base.attack * (1 + 0.15 * (count - 1))), name: COOP_BOSSES[enemy.id], statusImmunities: ["freeze"], statusResistance: { burn: 0.25, shock: 0.25 } };
}
