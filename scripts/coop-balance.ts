import { writeFileSync } from "node:fs";
import { createBattle, resolveBattle } from "../server/src/combat/engine.js";
import { resolveIfReady } from "../server/src/combat/coop.js";
import { type CoopState } from "../shared/coop.js";
import {
  CHARACTERS,
  SKILLS,
  blockedReason,
  skillUnavailable,
  hasStatus,
  type StatusId,
} from "../shared/combat.js";
let seed = 20261102;
function rng() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const rows: string[] = [];
for (const count of [2, 3, 4])
  for (const scenario of ["기본 보스", "장기 보스", "고공격 보스", "상태 면역"])
    for (let policy = 0; policy < 4; policy++) {
      let wins = 0,
        total = 0,
        defeated = 0;
      for (let sample = 0; sample < 100; sample++) {
        const id = "sim",
          members = Array.from({ length: count }, (_, i) => {
            const state = createBattle(id);
            state.activeSlot = i % 4;
            return {
              userId: "p" + i,
              nickname: "동료" + i,
              ready: true,
              left: false,
              state,
              choice: null,
            };
          });
        const enemy = createBattle(id).enemy;
        enemy.name = "산호 수호게";
        enemy.hp = enemy.maxHp =
          Math.round(220 * (1 + 0.8 * (count - 1))) *
          (scenario === "장기 보스" ? 2 : 1);
        enemy.attack = Math.round(
          36 *
            (1 + 0.15 * (count - 1)) *
            (scenario === "고공격 보스" ? 1.5 : 1),
        );
        enemy.statusImmunities =
          scenario === "상태 면역"
            ? (Object.keys({
                burn: 1,
                shock: 1,
                freeze: 1,
                slow: 1,
                bind: 1,
                attackDown: 1,
                defenseDown: 1,
                accuracyDown: 1,
              }) as StatusId[])
            : ["freeze"];
        enemy.statusResistance = { burn: 0.25, shock: 0.25 };
        const s: CoopState = {
          id,
          ownerId: "p0",
          worldId: "sim",
          version: 0,
          round: 1,
          status: "active",
          deadline: 0,
          enemy,
          members,
          log: [],
        };
        for (let round = 0; round < 60 && s.status === "active"; round++) {
          for (const m of s.members) {
            if (m.state.team.every((f) => f.hp <= 0)) continue;
            if (m.state.phase === "replacement") {
              m.state = resolveBattle(
                m.state,
                {
                  type: "switch",
                  slot: m.state.team.findIndex((f) => f.hp > 0),
                },
                rng,
              );
            }
            const f = m.state.team[m.state.activeSlot],
              preferred = SKILLS[f.skills[policy] ?? f.skills[0]];
            if (blockedReason(f, s.round)) m.choice = { type: "wait" };
            else if (f.preparing)
              m.choice = {
                type: f.preparing.readyRound > s.round ? "wait" : "continue",
              };
            else if (f.energy === 100) m.choice = { type: "ultimate" };
            else {
              const redundant =
                (preferred.category === "heal" && f.hp / f.maxHp > 0.7) ||
                (preferred.category === "shield" && f.shield > f.maxHp * 0.2) ||
                preferred.statuses.some(
                  (e) =>
                    hasStatus(enemy, e.id) ||
                    enemy.statusImmunities.includes(e.id),
                );
              m.choice = {
                type: "skill",
                skillId:
                  redundant || skillUnavailable(f, preferred, s.round)
                    ? f.skills[0]
                    : preferred.id,
              };
            }
          }
          const resolved = resolveIfReady(s, rng);
          if (!resolved && s.status === "active")
            throw new Error("Simulation failed to progress");
        }
        if (s.status === "won") wins++;
        total += s.round - 1;
        defeated += s.members.reduce(
          (n, m) => n + m.state.team.filter((f) => f.hp <= 0).length,
          0,
        );
      }
      rows.push(
        `|${count}|${scenario}|${["안정 기본기", "두 번째 기술", "상태/준비 기술", "지원/보조 기술"][policy]}|${wins}|${(total / 100).toFixed(2)}|${(defeated / 100).toFixed(2)}|`,
      );
    }
writeFileSync(
  "docs/COOP_BALANCE.md",
  [
    "# 협동 보스 초기 탐색 · 2026-11-02",
    "",
    "고정 시드20261102, 각 조합100회. 2/3/4인 × 4상황 × 4정책 = 48조합, 총4,800전투. 각 계정은 시작 동료4명을 보유하며 출전만 다르게 시작한다. 개인별 한 행동을 전역 정렬하고3라운드마다 단일 광역 공격, 상태 말단1회 처리 등 실제 협동 엔진을 사용한다. 제어/준비/강제 교체/궁극기 에너지 규칙을 지킨다.",
    "",
    "기술 정책은 지정 기술을 우선하지만 조건/쿨다운/이미 적용된 상태/면역/충분한 회복·보호막은 기본기로 대체한다. 신규 고레벨 기술·장비·현실 지연/이탈/사용자 전술은 이 시뮬레이션에 포함하지 않는다. 이탈·시간 만료·개인 보상·중복 방지는 별도 실제DB/API 테스트에서 검증한다. 장기/고공격/전체 면역은 시뮬레이션 변형이며 별도 맵 콘텐츠가 아니다.",
    "",
    "|인원|상황|정책|승리/100|평균 라운드|평균 쓰러진 캐릭터 수|",
    "|---:|---|---|---:|---:|---:|",
    ...rows,
    "",
    "승률뿐 아니라 소요 라운드와 소모 캐릭터 수를 함께 비교해야 한다. 최종 균형은 성장·장비·캐릭터 추가 후 다시 평가한다. 신규 캐릭터와 보상 경제의 완성을 뜻하지 않는다.",
    "",
  ].join("\n"),
);
console.log(
  "Saved docs/COOP_BALANCE.md: 48 configurations, 4800 cooperative battles.",
);
