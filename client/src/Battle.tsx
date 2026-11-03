import { CONSUMABLES, itemUnavailable } from "../../shared/items";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHARACTERS,
  SKILLS,
  ULTIMATES,
  PASSIVES,
  STATUS_NAMES,
  blockedReason,
  skillUnavailable,
  hasStatus,
  type Fighter,
  ENCOUNTER,
  SANCTUARY_ENCOUNTER,
  enemySkillForRound,
  type BattleState,
  type BattleAction,
} from "../../shared/combat";
function Statuses({ fighter, round }: { fighter: Fighter; round: number }) {
  return (
    <div className="status-list">
      {fighter.statuses.map((s) => (
        <span key={s.id}>
          {STATUS_NAMES[s.id]} · {Math.max(0, s.expiresAfterRound - round + 1)}R
        </span>
      ))}
    </div>
  );
}
export function Battle({
  onActiveChange,
  connected,
}: {
  onActiveChange: (active: boolean) => void;
  connected: boolean;
}) {
  const [battle, setBattle] = useState<BattleState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const audibleVersion = useRef("");
  useEffect(() => {
    const key = battle ? `${battle.id}:${battle.version}` : "";
    if (key && key !== audibleVersion.current) {
      window.dispatchEvent(new CustomEvent("audio:cue", { detail: battle?.status === "won" ? "victory" : "battle" }));
    }
    audibleVersion.current = key;
  }, [battle?.id, battle?.version]);
  const [items, setItems] = useState<Record<string, number> | null>(null), [itemError, setItemError] = useState("");
  const itemReads = useRef(0);
  const loadItems = useCallback(async () => {
    const revision = ++itemReads.current;
    try {
      const r = await fetch("/api/battle/items"), data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (revision === itemReads.current) { setItems(Object.fromEntries(data.items.map((i: { itemId: string; quantity: number }) => [i.itemId, i.quantity]))); setItemError(""); }
    } catch (e) { if (revision === itemReads.current) setItemError(e instanceof Error ? e.message : "소지품을 불러오지 못했습니다."); }
  }, []);
  useEffect(() => {
    if (battle) void loadItems(); else { itemReads.current++; setItems(null); }
  }, [battle?.id, battle?.version, loadItems]);
  useEffect(() => {
    if (!battle) return;
    const update = () => { void loadItems(); };
    window.addEventListener("economy:changed", update);
    return () => { itemReads.current++; window.removeEventListener("economy:changed", update); };
  }, [battle?.id, loadItems]);
  const pending = useRef(false);
  const changes = useRef(0);
  const apply = useCallback((value: BattleState | null) => {
    changes.current++;
    setBattle((previous) =>
      previous &&
      value &&
      previous.id === value.id &&
      previous.version > value.version
        ? previous
        : value,
    );
  }, []);
  const reload = useCallback(async () => {
    const revision = changes.current;
    try {
      const r = await fetch("/api/battle");
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      if (changes.current === revision) apply(value.battle);
    } catch (e) {
      setError(e instanceof Error ? e.message : "전투를 불러오지 못했습니다.");
    }
  }, [apply]);
  useEffect(() => {
    void reload();
    const update = (event: Event) =>
      apply((event as CustomEvent<BattleState>).detail);
    const refresh = () => {
      void reload();
    };
    window.addEventListener("battle:state", update);
    window.addEventListener("battle:refresh", refresh);
    return () => {
      window.removeEventListener("battle:state", update);
      window.removeEventListener("battle:refresh", refresh);
    };
  }, [reload, apply]);
  useEffect(() => {
    onActiveChange(Boolean(battle));
    return () => onActiveChange(false);
  }, [Boolean(battle), onActiveChange]);
  async function request(operation: string, body: unknown) {
    if (pending.current || !connected) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        operation.startsWith("coop/")
          ? "/api/" + operation
          : "/api/battle/" + operation,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const value = await r.json();
      if (!r.ok) {
        if (r.status === 409) await reload();
        throw new Error(value.error);
      }
      apply(value.battle);
    } catch (e) {
      setError(e instanceof Error ? e.message : "전투 요청에 실패했습니다.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const start = (event: Event) => {
      void request("start", { encounterId: (event as CustomEvent<{ encounterId: string }>).detail?.encounterId ?? ENCOUNTER.id });
    };
    const coopStart = (event: Event) => {
      void request("coop/start", { encounterId: (event as CustomEvent<{ encounterId: string }>).detail?.encounterId ?? ENCOUNTER.id });
    };
    window.addEventListener("battle:start", start);
    window.addEventListener("coop:start", coopStart);
    return () => {
      window.removeEventListener("battle:start", start);
      window.removeEventListener("coop:start", coopStart);
    };
  });
  if (!battle)
    return error ? (
      <div className="battle-error" role="alert">
        {error}
        <button onClick={() => setError("")}>닫기</button>
      </div>
    ) : null;
  const active = battle.team[battle.activeSlot],
    ended = battle.status !== "active",
    replacement = battle.phase === "replacement";
  const blocked = blockedReason(active, battle.round),
    preparing = active.preparing;
  const restricted = Boolean(blocked || preparing);
  const ultimate = ULTIMATES[active.ultimateId],
    passive = PASSIVES[active.passiveId];
  const coop = battle.coop,
    coopLocked = Boolean(coop?.paused || coop?.lobby || coop?.submitted || coop?.spectating);
  const act = (action: BattleAction) =>
    request(coop ? "coop/action" : "action", {
      battleId: battle.id,
      expectedVersion: battle.version,
      expectedRound: battle.round,
      action,
    });
  return (
    <div
      className="modal battle-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="산호 해안 전투"
    >
      <article className="battle-panel">
        {!connected && <p aria-live="polite">월드에 다시 접속하는 중입니다. 연결 후 행동할 수 있습니다.</p>}
        <fieldset className="battle-controls" disabled={!connected}>
        <div className="battle-title">
          <div>
            <small>CORAL COAST ENCOUNTER</small>
            <h2>
              {ended
                ? (
                    {
                      won: "승리",
                      lost: "패배",
                      fled: "도주 완료",
                      abandoned: "전투 종료",
                    } as Record<string, string>
                  )[battle.status]
                : coop?.paused
                  ? `${battle.round}라운드 · 재접속 대기`
                  : coop?.lobby
                  ? "협동 전투 참여 확인"
                  : coop?.spectating
                    ? `${battle.round}라운드 · 관전`
                    : `${battle.round}라운드 · ${replacement ? "강제 교체" : "행동 선택"}`}
            </h2>
          </div>
          <span>
            {coop ? "협동 보스 전투 · 최대 4인" : "서버 라운드 전투 · 1인"}
          </span>
        </div>
        {!ended && !coop?.lobby && battle.enemy.id === SANCTUARY_ENCOUNTER.id && <section className="enemy-intent reconnect-notice" aria-label="적 행동 예고">
          <strong>다음 행동: {blockedReason(battle.enemy, battle.round) ? blockedReason(battle.enemy, battle.round) : enemySkillForRound(battle.enemy.id, battle.round).name}</strong>
          <p>{blockedReason(battle.enemy, battle.round) ? `이 라운드에는 ${battle.enemy.name}가 행동할 수 없습니다. 공격하거나 회복할 기회입니다.` : `위력 ${enemySkillForRound(battle.enemy.id, battle.round).power} · 기본 명중률 ${Math.round(enemySkillForRound(battle.enemy.id, battle.round).accuracy * 100)}%. ${enemySkillForRound(battle.enemy.id, battle.round).description}`}</p>
          <small>자연 속성 · 잎새 바람 → 휘감는 줄기 → 한여름의 만개 순환. 만개 후 다음 라운드는 쉽니다.{coop && " 협동 만개는 생존한 출전 캐릭터 모두를 공격합니다."}</small>
        </section>}
        <div className="battle-field">
          <div className="combatant">
            <div
              className="character-art"
              style={{
                background: CHARACTERS.find((c) => c.id === active.id)?.color,
              }}
              key={`ally-${battle.version}`}
            >
              ✦
            </div>
            <h3>{active.name}</h3>
            <div
              className="health-track"
              role="progressbar"
              aria-label={`${active.name} HP`}
              aria-valuemin={0}
              aria-valuemax={active.maxHp}
              aria-valuenow={active.hp}
            >
              <i style={{ width: `${(active.hp / active.maxHp) * 100}%` }} />
            </div>
            <p>
              HP {active.hp} / {active.maxHp} · {active.element} · 스피드{" "}
              {active.speed}
            </p>
            <p>
              에너지 {active.energy}/100 · 보호막 {active.shield}
            </p>
            <Statuses fighter={active} round={battle.round} />
          </div>
          <span className="versus">VS</span>
          <div className="combatant">
            <div className="enemy-art" key={`enemy-${battle.version}`}>
              {battle.enemy.id === SANCTUARY_ENCOUNTER.id ? "❀" : "♋"}
            </div>
            <h3>{battle.enemy.name}</h3>
            <div
              className="health-track enemy-health"
              role="progressbar"
              aria-label={`${battle.enemy.name} HP`}
              aria-valuemin={0}
              aria-valuemax={battle.enemy.maxHp}
              aria-valuenow={battle.enemy.hp}
            >
              <i
                style={{
                  width: `${(battle.enemy.hp / battle.enemy.maxHp) * 100}%`,
                }}
              />
            </div>
            <p>
              HP {battle.enemy.hp} / {battle.enemy.maxHp} · 스피드{" "}
              {battle.enemy.speed} · {battle.enemy.element}
            </p>
            <p>보호막 {battle.enemy.shield}</p>
            <Statuses fighter={battle.enemy} round={battle.round} />
          </div>
        </div>
        <div className="battle-log" aria-label="전투 기록" aria-live="polite">
          {battle.log.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <p role="alert">{error}</p>
        {coop && (
          <section className="coop-party" aria-label="협동 참가자">
            <h3>
              함께하는 여행자 · {coop.party.filter((p) => !p.left).length}/4
            </h3>
            {coop.party.map((p) => (
              <div key={p.userId}>
                <b>
                  {p.nickname} · {p.activeName}
                </b>
                <span>
                  HP {p.hp}/{p.maxHp} ·{" "}
                  {p.left
                    ? "이탈"
                    : p.reconnectUntil
                      ? "복귀 대기"
                      : coop.lobby
                      ? p.ready
                        ? "참여 확인 완료"
                        : "참여 확인 대기"
                      : p.submitted
                        ? "행동 선택 완료"
                        : p.hp <= 0
                          ? "교체 또는 관전"
                          : "행동 선택 중"}
                </span>
              </div>
            ))}
            {coop.paused && <section className="reconnect-notice" aria-label="협동 재접속">
              <b>연결 복구 대기 · 전투 일시정지</b>
              <p>남은 {Math.max(0, Math.ceil(((coop.reconnectUntil ?? now) - now) / 1000))}초 안에 복귀하세요. 라운드·선택한 행동·아이템 수량은 보존됩니다.</p>
              {coop.resumeRequired && <button disabled={busy || (!coop.ownerAvailable && coop.ownerId !== coop.userId)} onClick={() => request("coop/resume", { battleId: battle.id })}>협동 전투 복귀</button>}
              {!coop.ownerAvailable && <p>소유자의 재접속을 기다리는 중입니다. 방문자는 개인 월드로 안전하게 돌아갑니다.</p>}
            </section>}
            <p>
              남은 {Math.max(0, Math.ceil((coop.deadline - now) / 1000))}초 ·
              미선택은 자동 방어/대기 처리합니다. 전투 중에는 본인의 캐릭터만
              조작합니다.
            </p>
            {coop.submitted && !coop.lobby && (
              <p role="note">행동 선택 완료 · 다른 참가자를 기다립니다.</p>
            )}
            {!ended && (
              <button
                disabled={busy}
                onClick={() => request("coop/leave", { battleId: battle.id })}
              >
                {coop.ownerId === coop.userId
                  ? "협동 전투 취소"
                  : "협동 전투 나가기"}
              </button>
            )}
          </section>
        )}
        {coop?.lobby && !ended && (
          <section className="coop-lobby">
            <p>
              소유자의 모집입니다. 참여할 준비가 되면 수락하세요. 원치 않으면
              전투 나가기로 거절할 수 있습니다.
            </p>
            <button
              disabled={
                busy || coop.paused || coop.party.find((p) => p.userId === coop.userId)?.ready
              }
              onClick={() => request("coop/ready", { battleId: battle.id })}
            >
              협동 전투 참여
            </button>
          </section>
        )}
        {!ended && !coop?.lobby && (
          <>
            {passive && (
              <p className="battle-passive">
                <b>패시브 · {passive.name}</b> {passive.description}
              </p>
            )}
            {blocked && (
              <p className="action-restriction" role="note">
                {blocked}. 일반 기술·궁극기·교체를 선택할 수 없습니다.
              </p>
            )}
            {preparing && (
              <p className="action-restriction">
                {SKILLS[preparing.skillId].name} 준비 중 · 남은{" "}
                {Math.max(0, preparing.readyRound - battle.round)}라운드
              </p>
            )}
            {!replacement && restricted && (
              <button
                className="battle-wait"
                disabled={busy || coopLocked}
                onClick={() =>
                  act({
                    type:
                      blocked || preparing!.readyRound > battle.round
                        ? "wait"
                        : "continue",
                  })
                }
              >
                {blocked
                  ? "행동 불가 · 다음 라운드"
                  : preparing!.readyRound > battle.round
                    ? "준비 대기 · 다음 라운드"
                    : "준비한 기술 발사"}
              </button>
            )}
            <div className="battle-actions">
              {active.skills.map((id) => (
                <button
                  disabled={
                    busy ||
                    coopLocked ||
                    replacement ||
                    restricted ||
                    Boolean(skillUnavailable(active, SKILLS[id], battle.round))
                  }
                  key={id}
                  onClick={() => act({ type: "skill", skillId: id })}
                >
                  <b>{SKILLS[id].name}</b>
                  <small>
                    위력 {SKILLS[id].power} · 명중{" "}
                    {Math.round(SKILLS[id].accuracy * 100)}%
                  </small>
                  <small>
                    {SKILLS[id].element} · {SKILLS[id].description}
                  </small>
                  <small>
                    {skillUnavailable(active, SKILLS[id], battle.round)}
                  </small>
                </button>
              ))}
              <button
                disabled={busy || coopLocked || replacement || restricted}
                onClick={() => act({ type: "defend" })}
              >
                방어<small>행동 우선 · 이번 라운드 피해 절반</small>
              </button>
              {!coop && (
                <button
                  disabled={busy || coopLocked || replacement || restricted}
                  onClick={() => act({ type: "flee" })}
                >
                  도주<small>안전하게 탐험으로 돌아가기</small>
                </button>
              )}
            </div>
            <section className="battle-items" aria-label="전투 아이템">
              <h3>전투 아이템 · 자기 출전 캐릭터 · 행동1회 소비</h3>
              <div className="item-actions">{Object.values(CONSUMABLES).map((item) => <button key={item.id}
                disabled={busy || coopLocked || replacement || restricted || !items || (items[item.id] ?? 0) < 1 || Boolean(itemUnavailable(active, item.id))}
                onClick={() => act({ type: "item", itemId: item.id })}>
                <b>{item.name} · {items ? items[item.id] ?? 0 : "…"}개</b><small>{item.description}</small>
                <small>{itemUnavailable(active, item.id) || (items && !(items[item.id] ?? 0) ? "보유 수량이 없습니다." : "")}</small>
              </button>)}</div>
              <p>감전 등으로 행동하지 못하면 소비하지 않습니다. 협동전 선택 대기/이탈/취소도 효과가 실행되기 전에는 소비하지 않습니다.</p>
              {itemError && <p>{itemError}<button onClick={() => { void loadItems(); }}>소지품 다시 불러오기</button></p>}
            </section>
            {ultimate && (
              <button
                className="ultimate-button"
                disabled={
                  busy ||
                  coopLocked ||
                  replacement ||
                  restricted ||
                  Boolean(skillUnavailable(active, ultimate, battle.round))
                }
                onClick={() => act({ type: "ultimate" })}
              >
                궁극기 · {ultimate.name}
                <small>
                  에너지 {active.energy}/100 · {ultimate.description}
                </small>
                <small>
                  {skillUnavailable(active, ultimate, battle.round)}
                </small>
              </button>
            )}
            <h3>
              {replacement
                ? "출전 캐릭터가 쓰러졌습니다. 생존한 캐릭터를 선택하세요."
                : "캐릭터 교체 · 행동 1회 소비"}
            </h3>
            <div className="battle-team">
              {battle.team.map((c, slot) => (
                <button
                  key={c.id}
                  disabled={
                    busy ||
                    coopLocked ||
                    slot === battle.activeSlot ||
                    c.hp <= 0 ||
                    (!replacement && (restricted || hasStatus(active, "bind")))
                  }
                  onClick={() => act({ type: "switch", slot })}
                >
                  <b>
                    {c.name} {slot === battle.activeSlot ? "· 출전" : ""}
                  </b>
                  <small>
                    HP {c.hp}/{c.maxHp} · 스피드 {c.speed}
                  </small>
                  {c.hp <= 0 && <small>쓰러짐</small>}
                </button>
              ))}
            </div>
            <p>
              기술·교체·방어 중 한 행동을 선택합니다. 같은 스피드에서는 홀수
              라운드에 아군, 짝수 라운드에 적이 먼저 행동합니다.
            </p>
          </>
        )}
        {ended && (
          <>
            {battle.reward ? (
              <div className="battle-reward">
                <b>승리 · 편성 캐릭터당 경험치 +{battle.reward.experience}</b>
                {battle.reward.progress
                  .filter((p) => p.level > p.oldLevel)
                  .map((p) => (
                    <p key={p.characterId}>
                      {CHARACTERS.find((c) => c.id === p.characterId)?.name} Lv.
                      {p.oldLevel} → Lv.{p.level}
                      {p.newSkills.length
                        ? ` · 새 기술 ${p.newSkills.map((id) => SKILLS[id].name).join(", ")}`
                        : ""}
                    </p>
                  ))}
                {battle.reward.progress.some((p) => p.newSkills.length > 0) && (
                  <button
                    onClick={() => {
                      apply(null);
                      window.dispatchEvent(new Event("training:open"));
                    }}
                  >
                    새 기술 배우기
                  </button>
                )}
              </div>
            ) : (
              <p>
                승리 시 편성 캐릭터가 경험치와 개인 재화·성장 재료를 얻습니다.
              </p>
            )}
            <button
              className="battle-exit"
              onClick={() => {
                apply(null);
                setError("");
              }}
            >
              탐험으로 돌아가기
            </button>
          </>
        )}
        </fieldset>
      </article>
    </div>
  );
}
