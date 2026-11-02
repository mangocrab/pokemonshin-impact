// Reproducible exploration, not a passing test or final balance certification.
import { writeFileSync } from "node:fs";
import { createBattle, resolveBattle } from "../server/src/combat/engine.js";
import {
  CHARACTERS,
  SKILLS,
  ULTIMATES,
  EFFECTIVENESS,
  ELEMENTS,
  blockedReason,
  skillUnavailable,
  hasStatus,
  type BattleAction,
  type Element,
} from "../shared/combat.js";
let seed = 20261101;
function rng() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const scenarios = [
  "short",
  "long",
  "neutral",
  "advantage",
  "disadvantage",
  "offElement",
  "immune",
  "boss",
] as const;
const labels: Record<(typeof scenarios)[number], string> = {
  short: "단기 (HP110)",
  long: "장기 (HP440)",
  neutral: "중립",
  advantage: "속성 유리",
  disadvantage: "속성 불리",
  offElement: "자속 없음",
  immune: "상태 면역",
  boss: "보스 가정 (HP880)",
};
const result: {
  character: string;
  scenario: string;
  policy: string;
  wins: number;
  averageRounds: number;
  averageHp: number;
}[] = [];
for (const c of CHARACTERS)
  for (const scenario of scenarios)
    for (let policy = 0; policy < 4; policy++) {
      let wins = 0,
        totalRounds = 0,
        totalHp = 0;
      const altered = [
        ...c.skills.map((id) => SKILLS[id]),
        ULTIMATES[c.ultimateId],
        SKILLS.crabPinch,
        SKILLS.crabCrush,
        SKILLS.crabSand,
      ];
      const originalElements = altered.map((skill) => skill.element);
      for (let sample = 0; sample < 100; sample++) {
        let s = createBattle("sim", [c]);
        s.enemy.element = c.element;
        if (scenario === "short") s.enemy.hp = s.enemy.maxHp = 110;
        if (scenario === "long") {
          s.enemy.hp = s.enemy.maxHp = 440;
          s.enemy.attack = 20;
        }
        if (scenario === "advantage" || scenario === "disadvantage")
          s.enemy.element = Object.entries(EFFECTIVENESS[c.element]).find(
            ([, multiplier]) =>
              multiplier === (scenario === "advantage" ? 2 : 0.5),
          )![0] as Element;
        if (scenario === "offElement") {
          const foreign = ELEMENTS.find(
            (e) =>
              e !== c.element && (EFFECTIVENESS[e][s.enemy.element] ?? 1) === 1,
          )!;
          for (const skill of [
            ...c.skills.map((id) => SKILLS[id]),
            ULTIMATES[c.ultimateId],
          ])
            if (skill.category === "attack") skill.element = foreign;
        }
        // Each synthetic enemy uses its configured element, so "neutral" is neutral for both sides.
        for (const id of ["crabPinch", "crabCrush", "crabSand"])
          SKILLS[id].element = s.enemy.element;
        if (scenario === "immune")
          s.enemy.statusImmunities = [
            "burn",
            "freeze",
            "shock",
            "slow",
            "bind",
            "attackDown",
            "defenseDown",
            "accuracyDown",
          ];
        if (scenario === "boss") {
          s.enemy.hp = s.enemy.maxHp = 880;
          s.enemy.attack = 40;
          s.enemy.statusImmunities = ["freeze"];
          s.enemy.statusResistance = { burn: 0.5, shock: 0.5 };
        }
        for (let step = 0; step < 60 && s.status === "active"; step++) {
          const f = s.team[0],
            preferred = SKILLS[c.skills[policy]];
          let action: BattleAction;
          if (blockedReason(f, s.round)) action = { type: "wait" };
          else if (f.preparing)
            action = {
              type: f.preparing.readyRound > s.round ? "wait" : "continue",
            };
          else if (f.energy === 100) action = { type: "ultimate" };
          else {
            const redundant =
              (preferred.category === "heal" && f.hp / f.maxHp > 0.7) ||
              (preferred.category === "shield" && f.shield > f.maxHp * 0.2) ||
              preferred.statuses.some(
                (effect) =>
                  hasStatus(s.enemy, effect.id) ||
                  (effect.id === "freeze" &&
                    s.enemy.controlImmunityUntilRound >= s.round),
              );
            const id =
              skillUnavailable(f, preferred, s.round) || redundant
                ? c.skills[0]
                : preferred.id;
            action = { type: "skill", skillId: id };
          }
          s = resolveBattle(s, action, rng);
        }
        if (s.status === "won") wins++;
        totalRounds += s.round - 1;
        totalHp += s.team[0].hp;
      }
      altered.forEach((skill, i) => (skill.element = originalElements[i]));
      result.push({
        character: c.name,
        scenario: labels[scenario],
        policy: SKILLS[c.skills[policy]].name,
        wins,
        averageRounds: Number((totalRounds / 100).toFixed(2)),
        averageHp: Number((totalHp / 100).toFixed(2)),
      });
    }
const lines = [
  "# 전투 밸런스 탐색 · 2026-11-02",
  "",
  `고정 시드 20261101, 각 조합100회, 총${(result.length * 100).toLocaleString("en-US")}회, 최대60라운드. 각 캐릭터1명으로 서버 엔진을 실행한다. 정책은 지정 기술을 우선하되 대기/준비/조건/쿨다운을 지키고, 이미 걸린 상태/충분한 회복·보호막은 기본기로 대체하며 에너지100에서 궁극기를 사용한다. 승률이 높다는 사실만으로 기술 균형을 판정하지 않는다.`,
  "",
  "단기·장기·유리·불리·자속 유무·면역·보스 가정은 시뮬레이션용 적 설정이다. 이 가정이 실제 맵 보스와 같다는 뜻은 아니다. 시뮬레이션 적 기술은 설정된 적 속성을 따르며, 자속 없음 조건은 캐릭터 방어 속성을 유지하고 직접 공격 기술을 다른 중립 속성으로 변형한다(속성 조건 패시브 차이도 포함). 4인 협동 및 성장/장비는 별도 COOP_BALANCE.md/GROWTH_BALANCE.md에서 탐색한다. 반동/준비 중 제어/회복 타이밍/강제 교체는 개별 엔진 테스트에서도 검증한다.",
  "",
  "|캐릭터|상황|우선 기술|승리/100|평균 라운드|평균 잔여 HP|",
  "|---|---|---|---:|---:|---:|",
  ...result.map(
    (r) =>
      `|${r.character}|${r.scenario}|${r.policy}|${r.wins}|${r.averageRounds}|${r.averageHp}|`,
  ),
  "",
];
const value=(character:string,scenario:string,policy:string)=>result.find(r=>r.character===character&&r.scenario===scenario&&r.policy===policy)!;
lines.push('## 이번 설정에서 관찰한 점','',
 `- 해린 중립: 기본기 승리 ${value('해린','중립','물결 쏘기').wins}/100, 초고위력 ${value('해린','중립','거센 파도').wins}/100. 초고위력은 빠른 마무리에 유리하지만 속성 불리나 자속 없는 조건에서는 다른 결과가 나온다.`,
 `- 태오 장기: 기본기 승리 ${value('태오','장기 (HP440)','불씨 날리기').wins}/100, 반동 기술 ${value('태오','장기 (HP440)','불꽃 분출').wins}/100. 반동은 누적 생존 손실을 만든다.`,
 `- 소미 상태 면역: 기본기 승리 ${value('소미','상태 면역','잎새 타격').wins}/100, 지속 피해 우선 ${value('소미','상태 면역','여름 포자').wins}/100. 면역 적에게 상태 기술을 고집하면 손해가 크다.`,
 '- 회복/보호막 우선 정책은 일부 장기·보스 가정에서 매우 강한 지속력을 보인다. 소미 회복 정책의 보스 승률이 높으므로 실제 보스의 공격 패턴·해제·협동 환경에서 추가 조정해야 한다. 최종 콘텐츠나 균형이 완성되었다고 해석하지 않는다.',
 '- 빙결 지원의 협동 가치, 준비 기술의 적 제어에 따른 손실, 4인 협동 보스의 실제 균형은 추가 평가 대상이다. 각 조합100회는 초기 탐색 규모이며 최종 확률 추정이나 완성 판정이 아니다.','');
writeFileSync("docs/BALANCE.md", lines.join("\n"));
console.log(
  `Saved docs/BALANCE.md: ${result.length} configurations, ${result.length * 100} simulated battles; co-op evaluation not run.`,
);
