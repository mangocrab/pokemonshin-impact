// Deterministic engine exploration. No DB writes, payouts or changes to live enemies.
import { writeFileSync } from "node:fs";
import { createBattle, resolveBattle } from "../server/src/combat/engine.js";
import { resolveIfReady } from "../server/src/combat/coop.js";
import { CHARACTERS, SKILLS, EFFECTIVENESS, blockedReason, hasStatus, skillUnavailable, type BattleState, type BattleAction, type Element } from "../shared/combat.js";
import { type CoopState } from "../shared/coop.js";
import { availableSkills } from "../shared/progression.js";
import { loadoutStats } from "../shared/loadout.js";
let seed = 20261102;
function rng() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
const samples = 30, rows: string[] = [];
let battles = 0, timeouts = 0;
const situations = ["중립", "유리", "불리", "장기·면역"] as const;
const policies = ["안정형", "고위력", "재충전", "준비"] as const;
function setup(index: number, level: number, geared: boolean, policy: number) {
  const c = CHARACTERS[index], candidates = availableSkills(c.id, level);
  const selected = policy === 0 ? c.skills[0] : policy === 1 ? c.skills[1] : [...candidates].reverse().find((id) => SKILLS[id].penalties.some((p) => p.type === (policy === 2 ? "recharge" : "prepare"))) ?? c.skills[2];
  const data = loadoutStats(c.id, level, geared ? 6 : 0, geared ? 6 : 1, geared ? { weaponId: index % 2 ? "moonstaff" : "sunblade", level: 20 } : null);
  const state = createBattle("growth", [{ ...data, skills: [...new Set([c.skills[0], selected, c.skills[2], c.skills[3]])] }]);
  return { state, selected };
}
function enemy(state: BattleState, level: number, situation: string, count = 1) {
  const f = state.team[0], e = state.enemy;
  e.element = situation === "유리" || situation === "불리" ? Object.entries(EFFECTIVENESS[f.element]).find(([, value]) => value === (situation === "유리" ? 2 : 0.5))![0] as Element : f.element;
  e.hp = e.maxHp = Math.round(220 * (1 + 0.08 * (level - 1)) * (situation === "장기·면역" ? 2.5 : 1) * (1 + 0.8 * (count - 1)));
  e.attack = Math.round(36 * (1 + 0.045 * (level - 1)) * (1 + 0.15 * (count - 1)));
  e.defense = Math.round(24 * (1 + 0.05 * (level - 1)));
  if (situation === "장기·면역") e.statusImmunities = ["burn", "shock", "freeze", "slow", "bind", "attackDown", "defenseDown", "accuracyDown"];
  else if (count > 1) { e.statusImmunities = ["freeze"]; e.statusResistance = { burn: 0.25, shock: 0.25 }; }
  return e;
}
function action(s: BattleState, selected: string): BattleAction {
  const f = s.team[s.activeSlot];
  if (s.phase === "replacement") return { type: "switch", slot: s.team.findIndex((m) => m.hp > 0) };
  if (blockedReason(f, s.round)) return { type: "wait" };
  if (f.preparing) return { type: "continue" };
  if (f.energy === 100) return { type: "ultimate" };
  const skill = SKILLS[selected];
  const redundant = (skill.category === "heal" && f.hp / f.maxHp > 0.7) || (skill.category === "shield" && f.shield > f.maxHp * 0.2) || (skill.power === 0 && skill.statuses.some((e) => hasStatus(s.enemy, e.id) || s.enemy.statusImmunities.includes(e.id)));
  return { type: "skill", skillId: redundant || skillUnavailable(f, skill, s.round) ? f.skills[0] : selected };
}
for (const level of [1, 20, 60]) for (const geared of [false, true]) for (const situation of situations) for (let policy = 0; policy < policies.length; policy++) {
  let wins = 0, rounds = 0, solo = 0, coop = 0;
  for (let index = 0; index < CHARACTERS.length; index++) for (let n = 0; n < samples; n++) {
    const built = setup(index, level, geared, policy); let s = built.state;
    s.enemy = enemy(s, level, situation);
    while (s.status === "active" && s.round <= 60) s = resolveBattle(s, action(s, built.selected), rng);
    wins += Number(s.status === "won"); timeouts += Number(s.status === "active"); rounds += s.round - 1; solo++; battles++;
  }
  const soloRate = (wins / solo * 100).toFixed(1), soloRounds = (rounds / solo).toFixed(2);
  wins = 0; rounds = 0;
  // Both original and new companions act in four-account lineups.
  for (const offset of [0, 4]) for (let n = 0; n < samples; n++) {
    const builds = Array.from({ length: 4 }, (_, i) => setup(offset + i, level, geared, policy));
    const s: CoopState = { id: "growth-coop", ownerId: "p0", worldId: "sim", version: 0, round: 1, status: "active", deadline: 0, log: [], enemy: enemy(builds[0].state, level, situation, 4), members: builds.map((b, i) => ({ userId: `p${i}`, nickname: `p${i}`, ready: true, left: false, state: b.state, choice: null })) };
    while (s.status === "active" && s.round <= 60) {
      for (const [i, m] of s.members.entries()) if (m.state.team.some((f) => f.hp > 0) && !m.choice) {
        m.state.round = s.round; m.state.enemy = s.enemy;
        m.choice = action(m.state, builds[i].selected);
      }
      if (!resolveIfReady(s, rng) && s.status === "active") throw new Error("Co-op simulation stalled");
    }
    wins += Number(s.status === "won"); timeouts += Number(s.status === "active"); rounds += s.round - 1; coop++; battles++;
  }
  rows.push(`|${level}|${geared ? "해방6·기술6·5성무기Lv20" : "무장 없음"}|${situation}|${policies[policy]}|${soloRate}%|${soloRounds}|${(wins / coop * 100).toFixed(1)}%|${(rounds / coop).toFixed(2)}|`);
}
writeFileSync("docs/GROWTH_BALANCE.md", [
  "# 성장·장비·8캐릭터 전투 탐색 · 2026-11-02", "",
  `고정 시드20261102, 총${battles.toLocaleString("en-US")}전투. 8명×Lv1/20/60×장비2×상황4×정책4×각30회의1인 전투, 시작4명/추가4명 두 편성의4계정 협동전을 실행했다. 60라운드 미종료 ${timeouts}건. 승률은 정책별 독립 표본이며 각 기술의 우열을 확정하지 않는다.`, "",
  "실제 서버와 동일한 loadoutStats·resolveBattle·resolveIfReady를 사용한다. 성장/해방/기술/치명타/속성/무기 보정과 준비·재충전·궁극기를 계산한다. 각 계정1명 출전, 교체 자원 없음. 해당 레벨에서 재충전/준비 기술이 없으면 시작3번 기술로 대체한다. 장비 조건은5성 두 무기를 번갈아 장착한 극단 비교이며 정상 획득 속도를 뜻하지 않는다.", "",
  "중립/유리/불리는 첫 캐릭터 속성 기준이다. 적 HP/공격/방어는 레벨에 따라 실험용으로 성장시키며 실제 맵 적은 변경하지 않는다. 장기·면역은HP2.5배 및 모든 상태 면역이다. 협동은 인원 배율·3라운드 광역 등 공통 엔진을 쓴다. 적 기술은 실제 기술의 물 속성을 유지하므로 피격 상성도 결과에 포함된다.", "",
  "|Lv|장비|상황|우선 정책|1인 승률|평균 라운드|4인 승률|평균 라운드|", "|---:|---|---|---|---:|---:|---:|---:|", ...rows, "",
  "## 해석과 남은 검증", "",
  "- 기존 입문 보스는 성장에 따라 쉬워진다. 이 보고서의 성장 적은 조정용 가정이며 추가 지역/보스 콘텐츠가 아니다.",
  "- 무장·해방·레벨을 합친 극단값과 정책 차이를 확인하는 탐색이다. 개별 장비 기여도, 실제 획득 비용, 회복 지원·교체·사용자 판단을 포함한 최종 밸런스는 별도 검증이 필요하다.",
  "- 기술 패널티/상태 면역과 장비 실제 적용은 단위 및 DB/API 테스트도 실행한다. 무조건 한 정책을 상향/하향하거나 최종 균형 완료로 해석하지 않는다.", "",
].join("\n"));
console.log(`Saved docs/GROWTH_BALANCE.md: ${battles} battles, ${timeouts} timeouts.`);
