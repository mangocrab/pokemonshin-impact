import {
  type BattleState,
  type BattleAction,
  type Fighter,
  blockedReason,
} from "./combat.js";
export type CoopMemberState = {
  userId: string;
  nickname: string;
  ready: boolean;
  left: boolean;
  state: BattleState;
  choice: BattleAction | null;
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
  party: {
    userId: string;
    nickname: string;
    activeName: string;
    hp: number;
    maxHp: number;
    ready: boolean;
    submitted: boolean;
    left: boolean;
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
    status: member.left
      ? "fled"
      : state.status === "lobby" || state.status === "active"
        ? "active"
        : state.status === "abandoned"
          ? "abandoned"
          : state.status,
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
      party: state.members.map((m) => ({
        userId: m.userId,
        nickname: m.nickname,
        activeName: m.state.team[m.state.activeSlot].name,
        hp: m.state.team[m.state.activeSlot].hp,
        maxHp: m.state.team[m.state.activeSlot].maxHp,
        ready: m.ready,
        submitted: m.choice !== null,
        left: m.left,
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
