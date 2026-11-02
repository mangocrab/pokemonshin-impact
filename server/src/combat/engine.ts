import {
  type BattleState,
  type BattleAction,
  type Fighter,
  type Skill,
  type StatusId,
  CHARACTERS,
  SKILLS,
  ULTIMATES,
  ENCOUNTER,
  EFFECTIVENESS,
  STATUS_NAMES,
  hasStatus,
  blockedReason,
  skillUnavailable,
} from "../../../shared/combat.js";
export class BattleRuleError extends Error {}
function hydrate(
  f: Partial<Fighter> &
    Pick<
      Fighter,
      "id" | "name" | "maxHp" | "hp" | "attack" | "defense" | "speed" | "skills"
    >,
): Fighter {
  const template = CHARACTERS.find((c) => c.id === f.id);
  return {
    element: template?.element ?? "물",
    passiveId: template?.passiveId ?? "",
    ultimateId: template?.ultimateId ?? "",
    energy: 0,
    shield: 0,
    statuses: [],
    blockedUntilRound: 0,
    cooldowns: {},
    statusImmunities: [],
    statusResistance: {},
    controlImmunityUntilRound: 0,
    ...f,
  };
}
// Old saved battles retain HP, round and equipped moves. New fields receive safe defaults.
export function normalizeBattle(previous: BattleState): BattleState {
  const s = structuredClone(previous);
  s.rulesVersion = 2;
  s.team = s.team.map(hydrate);
  s.enemy = hydrate(s.enemy);
  return s;
}
export function createBattle(
  id: string,
  characters = CHARACTERS.slice(0, 4),
): BattleState {
  return {
    rulesVersion: 2,
    id,
    version: 0,
    round: 1,
    status: "active",
    phase: "choice",
    team: characters.map((c) =>
      hydrate({ ...c, hp: c.maxHp, skills: [...c.skills] }),
    ),
    activeSlot: 0,
    enemy: hydrate({
      id: ENCOUNTER.id,
      name: ENCOUNTER.name,
      maxHp: 220,
      hp: 220,
      attack: 36,
      defense: 24,
      speed: 38,
      skills: ["crabPinch", "crabCrush", "crabSand"],
    }),
    log: ["산호 집게게가 길을 막았습니다. 행동을 선택하세요."],
  };
}
export function effectiveSpeed(f: Fighter) {
  return (
    f.speed *
    (hasStatus(f, "slow") ? 0.5 : 1) *
    (f.passiveId === "freeWind" && f.hp === f.maxHp
      ? 1.15
      : f.passiveId === "swiftHeart" && f.hp / f.maxHp <= 0.5
        ? 1.2
        : 1)
  );
}
export function damage(
  attacker: Fighter,
  defender: Fighter,
  power: number,
  guarded = false,
  element = attacker.element,
  critical = false,
) {
  if (power <= 0) return 0;
  const stab = attacker.element === element ? 1.5 : 1;
  const affinity = EFFECTIVENESS[element][defender.element] ?? 1;
  const passive =
    (attacker.passiveId === "tideHeart" &&
      attacker.hp / attacker.maxHp <= 0.5 &&
      element === "물") ||
    (attacker.passiveId === "emberHeart" && hasStatus(defender, "burn")) ||
    (attacker.passiveId === "sparkHeart" && hasStatus(defender, "shock"))
      ? 1.2
      : 1;
  const attack =
      attacker.attack * (hasStatus(attacker, "attackDown") ? 0.75 : 1),
    defense =
      defender.defense *
      (hasStatus(defender, "defenseDown") ? 0.75 : 1) *
      (defender.passiveId === "frostHeart" &&
      defender.hp / defender.maxHp <= 0.5
        ? 1.2
        : 1);
  return Math.max(
    1,
    Math.floor(
      (((power / 80) * attack * 100) / (100 + defense)) *
        stab *
        affinity *
        passive *
        (1 +
          (attacker.damageBonus ?? 0) +
          (attacker.elementDamageBonus?.[element] ?? 0)) *
        (1 -
          Math.max(
            -0.5,
            Math.min(0.9, defender.elementResistance?.[element] ?? 0),
          )) *
        (critical ? (attacker.critDamage ?? 1.5) : 1) *
        (guarded ? (defender.passiveId === "rootHeart" ? 0.4 : 0.5) : 1),
    ),
  );
}
function statusEffect(
  target: Fighter,
  id: StatusId,
  duration: number,
  round: number,
  acted: boolean,
  log: string[],
) {
  if (target.hp <= 0) return;
  if (
    target.statusImmunities.includes(id) ||
    (id === "freeze" && target.controlImmunityUntilRound >= round)
  ) {
    log.push(`${target.name}: ${STATUS_NAMES[id]} 면역`);
    return;
  }
  const expiresAfterRound =
    round + duration - 1 + Number(acted && id !== "burn");
  const prior = target.statuses.find((s) => s.id === id);
  if (prior && id === "freeze") {
    log.push(`${target.name}: 이미 빙결 상태로 지속 시간을 연장하지 않습니다.`);
    return;
  }
  if (prior)
    prior.expiresAfterRound = Math.max(
      prior.expiresAfterRound,
      expiresAfterRound,
    );
  else target.statuses.push({ id, expiresAfterRound });
  log.push(`${target.name}: ${STATUS_NAMES[id]} ${duration}라운드`);
}
function removeStatuses(f: Fighter, round: number) {
  if (hasStatus(f, "freeze"))
    f.controlImmunityUntilRound = Math.max(
      f.controlImmunityUntilRound,
      round + 2,
    );
  f.statuses = [];
}
function takeHit(target: Fighter, amount: number) {
  const shieldDamage = Math.min(target.shield, amount);
  target.shield -= shieldDamage;
  const hpDamage = Math.min(target.hp, amount - shieldDamage);
  target.hp -= hpDamage;
  if (amount > 0) target.energy = Math.min(100, target.energy + 10);
  return hpDamage;
}
export function validateBattleAction(state: BattleState, action: BattleAction) {
  const active = state.team[state.activeSlot];
  if (action.type === "switch") {
    if (
      !Number.isInteger(action.slot) ||
      action.slot < 0 ||
      action.slot >= state.team.length ||
      action.slot === state.activeSlot ||
      state.team[action.slot].hp <= 0
    )
      throw new BattleRuleError("살아 있는 대기 캐릭터를 선택하세요.");
  }
  if (state.phase === "replacement") {
    if (action.type !== "switch")
      throw new BattleRuleError("쓰러진 캐릭터를 먼저 교체하세요.");
    return;
  }
  const blocked = blockedReason(active, state.round);
  if (blocked) {
    if (action.type !== "wait") throw new BattleRuleError(blocked);
    return;
  }
  if (active.preparing) {
    if (
      action.type !==
      (active.preparing.readyRound <= state.round ? "continue" : "wait")
    )
      throw new BattleRuleError("준비 중인 기술을 이어서 사용하세요.");
    return;
  }
  if (action.type === "wait" || action.type === "continue")
    throw new BattleRuleError(
      "현재는 대기 또는 준비 기술을 선택할 수 없습니다.",
    );
  if (action.type === "switch" && hasStatus(active, "bind"))
    throw new BattleRuleError("속박 중에는 일반 교체를 할 수 없습니다.");
  if (action.type === "skill") {
    if (!active.skills.includes(action.skillId) || !SKILLS[action.skillId])
      throw new BattleRuleError("장착하지 않은 기술입니다.");
    const reason = skillUnavailable(
      active,
      SKILLS[action.skillId],
      state.round,
    );
    if (reason) throw new BattleRuleError(reason);
  }
  if (action.type === "ultimate") {
    const skill = ULTIMATES[active.ultimateId];
    if (!skill) throw new BattleRuleError("궁극기가 없습니다.");
    const reason = skillUnavailable(active, skill, state.round);
    if (reason) throw new BattleRuleError(reason);
  }
}
function chosenSkill(f: Fighter, action: BattleAction) {
  if (action.type === "skill") return SKILLS[action.skillId];
  if (action.type === "ultimate") return ULTIMATES[f.ultimateId];
  if (action.type === "continue" && f.preparing)
    return SKILLS[f.preparing.skillId];
  return undefined;
}
function priority(action: BattleAction, skill?: Skill) {
  return action.type === "flee"
    ? 9
    : action.type === "switch" || action.type === "defend"
      ? 6
      : (skill?.priority ?? 0);
}
export function resolveBattle(
  previous: BattleState,
  action: BattleAction,
  rng: () => number = Math.random,
): BattleState {
  if (previous.status !== "active")
    throw new BattleRuleError("이미 종료된 전투입니다.");
  const state = normalizeBattle(previous),
    active = state.team[state.activeSlot];
  validateBattleAction(state, action);
  state.version++;
  const log: string[] = [];
  if (state.phase === "replacement") {
    delete active.preparing;
    state.activeSlot = (
      action as Extract<BattleAction, { type: "switch" }>
    ).slot;
    state.phase = "choice";
    state.log = [
      `${state.team[state.activeSlot].name}이(가) 강제로 출전했습니다. 다음 행동을 선택하세요.`,
    ];
    return state;
  }
  resolveRound(
    [{ key: "player", state, action }],
    state.enemy,
    state.round,
    rng,
  );
  return state;
}
export type RoundPlayer = {
  key: string;
  state: BattleState;
  action: BattleAction;
};
export function resolveRound(
  players: RoundPlayer[],
  enemy: Fighter,
  round: number,
  rng: () => number,
  cooperative = false,
) {
  const log: string[] = [];
  const root = players[0].state;
  const state = root;
  const enemySkill =
    round % 4 === 0 ? "crabSand" : round % 3 === 0 ? "crabCrush" : "crabPinch";
  const enemyAction: BattleAction = blockedReason(enemy, state.round)
    ? { type: "wait" }
    : enemy.preparing
      ? { type: "continue" }
      : { type: "skill", skillId: enemySkill };
  const order = [
    ...players
      .filter((p) => p.state.team.some((f) => f.hp > 0))
      .map((p) => ({
        side: p.key,
        fighter: p.state.team[p.state.activeSlot],
        action: p.action,
        skill: chosenSkill(p.state.team[p.state.activeSlot], p.action),
        player: p,
      })),
    {
      side: "enemy",
      fighter: enemy,
      action: enemyAction,
      skill: chosenSkill(enemy, enemyAction),
      player: undefined as RoundPlayer | undefined,
    },
  ].sort(
    (a, b) =>
      priority(b.action, b.skill) - priority(a.action, a.skill) ||
      effectiveSpeed(b.fighter) - effectiveSpeed(a.fighter) ||
      (a.side === b.side || (a.side !== "enemy" && b.side !== "enemy")
        ? 0
        : a.side === "enemy"
          ? round % 2 === 1
            ? 1
            : -1
          : round % 2 === 1
            ? -1
            : 1),
  );
  const acted = new Set<Fighter>(),
    guarding = new Set<Fighter>();
  function judge() {
    if (players.every((p) => p.state.team.every((f) => f.hp <= 0))) {
      for (const p of players) p.state.status = "lost";
      log.push("모두 쓰러졌습니다. 해변에서 다시 준비하세요.");
    } else if (enemy.hp <= 0) {
      for (const p of players) p.state.status = "won";
      log.push("승리했습니다! 해안이 다시 조용해졌습니다.");
    }
  }
  log.push(
    `${state.round}라운드 · ${order.map((t) => t.fighter.name).join(" → ")}`,
  );
  for (const turn of order) {
    if (root.status !== "active") break;
    const state = turn.player?.state ?? root;
    const livePlayers = players.filter(
      (p) => p.state.status === "active" && p.state.team.some((f) => f.hp > 0),
    );
    if (!livePlayers.length) break;
    const user = turn.fighter;
    if (user.hp <= 0) {
      log.push(`${user.name}은(는) 쓰러져 행동할 수 없습니다.`);
      acted.add(user);
      continue;
    }
    const blocked = blockedReason(user, state.round);
    if (blocked || (hasStatus(user, "shock") && rng() < 0.25)) {
      log.push(`${user.name}: ${blocked || "감전으로 행동 실패"}`);
      if (user.preparing) {
        delete user.preparing;
        log.push("행동 제한으로 준비가 취소되었습니다.");
      }
      acted.add(user);
      continue;
    }
    acted.add(user);
    if (turn.action.type === "wait") {
      log.push(`${user.name}이(가) 기다립니다.`);
      continue;
    }
    if (turn.action.type === "flee") {
      state.status = "fled";
      log.push("안전하게 전투에서 벗어났습니다.");
      break;
    }
    if (turn.action.type === "switch") {
      // A faster status move may bind the user after action selection.
      if (hasStatus(user, "bind")) {
        log.push(`${user.name}: 속박으로 교체 실패`);
        continue;
      }
      state.activeSlot = turn.action.slot;
      log.push(
        `${state.team[state.activeSlot].name}이(가) 출전했습니다. 교체로 행동을 소비합니다.`,
      );
      continue;
    }
    if (turn.action.type === "defend") {
      guarding.add(user);
      user.energy = Math.min(100, user.energy + 15);
      log.push(
        `${user.name}이(가) 방어합니다. 이번 라운드 받는 피해가 절반입니다.`,
      );
      continue;
    }
    const skill = turn.skill!;
    const prepare = skill.penalties.find((p) => p.type === "prepare");
    if (prepare && turn.action.type !== "continue") {
      user.preparing = {
        skillId: skill.id,
        readyRound: state.round + prepare.duration,
      };
      log.push(
        `${user.name}: ${skill.name} 준비 · ${prepare.duration}라운드 뒤 사용`,
      );
      continue;
    }
    delete user.preparing;
    if (skill.energyCost) user.energy -= skill.energyCost;
    else user.energy = Math.min(100, user.energy + 10);
    const target =
      skill.target === "self"
        ? user
        : turn.side !== "enemy"
          ? enemy
          : livePlayers[(round - 1) % livePlayers.length].state.team[
              livePlayers[(round - 1) % livePlayers.length].state.activeSlot
            ];
    const targets =
      cooperative && turn.side === "enemy" && round % 3 === 0
        ? livePlayers.map((p) => p.state.team[p.state.activeSlot])
        : [target];
    let dealt = 0;
    for (const target of targets) {
      const hit =
        skill.target === "self" ||
        rng() < skill.accuracy * (hasStatus(user, "accuracyDown") ? 0.8 : 1);
      if (!hit) log.push(`${user.name}의 ${skill.name}이(가) 빗나갔습니다.`);
      else {
        if (skill.category === "attack") {
          const critical =
            (user.critRate ?? 0) > 0 && rng() < (user.critRate ?? 0);
          const amount = damage(
            user,
            target,
            skill.power *
              (skill.energyCost ? 1 + (user.ultimateBonus ?? 0) : 1),
            guarding.has(target),
            skill.element,
            critical,
          );
          dealt += takeHit(target, amount);
          log.push(
            `${user.name} · ${skill.name}: ${amount} 피해${critical ? " · 치명타" : ""}${user.element === skill.element ? " · 자속 ×1.5" : ""}${(EFFECTIVENESS[skill.element][target.element] ?? 1) !== 1 ? ` · 상성 ×${EFFECTIVENESS[skill.element][target.element]}` : ""}`,
          );
        } else if (skill.category === "heal") {
          const amount = Math.min(
            user.maxHp - user.hp,
            Math.floor(
              user.maxHp *
                (skill.recovery ?? 0) *
                (1 + (user.healingBonus ?? 0)),
            ),
          );
          user.hp += amount;
          log.push(`${user.name} · ${skill.name}: HP ${amount} 회복`);
        } else if (skill.category === "shield") {
          user.shield = Math.max(
            user.shield,
            Math.floor(
              user.maxHp *
                (skill.recovery ?? 0) *
                (1 + (user.healingBonus ?? 0)),
            ),
          );
          log.push(`${user.name} · ${skill.name}: 보호막 ${user.shield}`);
        } else log.push(`${user.name} · ${skill.name}`);
        if (skill.cleanse) {
          removeStatuses(user, state.round);
          log.push(`${user.name}: 상태이상 해제`);
        }
        if (target.hp > 0)
          for (const effect of skill.statuses) {
            const chance =
              Math.min(1, effect.chance + (user.statusChanceBonus ?? 0)) *
              (1 -
                Math.max(
                  0,
                  Math.min(1, target.statusResistance[effect.id] ?? 0),
                ));
            // Distinct RNG call: status chance is never the accuracy roll.
            if (rng() < chance)
              statusEffect(
                target,
                effect.id,
                effect.duration,
                state.round,
                acted.has(target),
                log,
              );
          }
      }
    }
    for (const penalty of skill.penalties) {
      if (penalty.type === "recharge") {
        user.blockedUntilRound = state.round + penalty.duration;
        log.push(`${user.name}: 다음 ${penalty.duration}라운드 행동 불가`);
      }
      if (penalty.type === "cooldown")
        user.cooldowns[skill.id] = state.round + penalty.duration;
      if (penalty.type === "recoil" && dealt > 0) {
        const amount = Math.max(1, Math.floor(dealt * penalty.fraction));
        user.hp = Math.max(0, user.hp - amount);
        log.push(`${user.name}: 반동 ${amount} 피해`);
      }
      if (penalty.type === "statDrop")
        statusEffect(
          user,
          penalty.stat,
          penalty.duration,
          state.round,
          true,
          log,
        );
    }
    if (target.hp === 0) log.push(`${target.name}이(가) 쓰러졌습니다.`);
    judge();
  }
  if (root.status === "active") {
    // DOT has its own fixed HP rule, ignores direct-damage bonuses and shields, and also ticks on standby.
    for (const f of [...players.flatMap((p) => p.state.team), enemy]) {
      if (f.hp > 0 && hasStatus(f, "burn")) {
        const amount = Math.max(1, Math.floor(f.maxHp * 0.06));
        f.hp = Math.max(0, f.hp - amount);
        log.push(`${f.name}: 화상 ${amount} 피해`);
      }
    }
    for (const participant of players) {
      const current = participant.state.team[participant.state.activeSlot];
      if (current.hp > 0 && current.passiveId === "greenRest") {
        const amount = Math.min(
          current.maxHp - current.hp,
          Math.floor(current.maxHp * 0.04),
        );
        current.hp += amount;
        if (amount) log.push(`${current.name}: 초록 쉼표 HP ${amount} 회복`);
      }
    }
    for (const f of [...players.flatMap((p) => p.state.team), enemy]) {
      for (const status of f.statuses)
        if (status.expiresAfterRound <= state.round) {
          if (status.id === "freeze")
            f.controlImmunityUntilRound = Math.max(
              f.controlImmunityUntilRound,
              state.round + 2,
            );
          log.push(`${f.name}: ${STATUS_NAMES[status.id]} 해제`);
        }
      f.statuses = f.statuses.filter((s) => s.expiresAfterRound > state.round);
    }
    judge();
  }
  for (const p of players) {
    p.state.round = round + 1;
    p.state.phase =
      p.state.status !== "active"
        ? "ended"
        : p.state.team[p.state.activeSlot].hp <= 0
          ? "replacement"
          : "choice";
    p.state.log = log;
  }
  return log;
}
