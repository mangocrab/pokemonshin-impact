import { AvatarControls } from "./AvatarControls";
import { ArtIcon } from "./ArtIcon";
import { Art } from "./Art";
import { useCallback, useEffect, useState } from "react";
import { SKILLS, PASSIVES, ULTIMATES } from "../../shared/combat";
import type { CharacterProgress } from "../../shared/progression";
export function LearningNotice({
  hidden,
  onOpen,
}: {
  hidden: boolean;
  onOpen: () => void;
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/training")
        .then(async (r) => {
          if (!r.ok) return;
          const data = await r.json();
          if (alive)
            setCount(
              data.characters.reduce(
                (sum: number, c: CharacterProgress) =>
                  sum +
                  c.unlocks.filter((u) => u.decision === "pending").length,
                0,
              ),
            );
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("characters:changed", load);
    return () => {
      alive = false;
      window.removeEventListener("characters:changed", load);
    };
  }, []);
  return !hidden && count > 0 ? (
    <button className="learning-notification" onClick={onOpen}>
      ✦ 새 기술 {count}개 · 배우기 또는 나중에
    </button>
  ) : null;
}
export function Characters({ onClose }: { onClose: () => void }) {
  const [characters, setCharacters] = useState<CharacterProgress[]>([]),
    [selected, setSelected] = useState("haerin"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [candidate, setCandidate] = useState<string | null>(null),
    [slot, setSlot] = useState<number | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/training");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    setCharacters(data.characters);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  const character = characters.find((c) => c.id === selected) ?? characters[0];
  async function change(action: "learn" | "defer", skillId: string) {
    if (!character || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: character.id,
          skillId,
          expectedRevision: character.revision,
          action,
          ...(action === "learn" && slot !== null ? { replaceSlot: slot } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 409) {
          setCandidate(null);
          await load();
        }
        throw new Error(data.error);
      }
      setCharacters(data.characters);
      setCandidate(null);
      setSlot(null);
      setMessage(
        action === "learn"
          ? `${SKILLS[skillId].name}을(를) 배웠습니다.`
          : "나중에 배울 수 있도록 목록에 남겨 두었습니다.",
      );
      window.dispatchEvent(new Event("characters:changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "기술 변경에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="캐릭터">
      <article className="battle-panel training-panel">
        <div className="battle-title">
          <div>
            <small>YOUR GROWING COMPANIONS</small>
            <h2>나의 캐릭터 · {characters.length}명</h2>
          </div>
          <button onClick={onClose}>닫기</button>
        </div>
        <p role="alert">{error}</p>
        <p className="training-message" role="status">
          {message}
        </p>
        {characters.length > 0 && <AvatarControls />}
        <div className="character-tabs">
          {characters.map((c) => (
            <button
              aria-pressed={c.id === character?.id}
              disabled={busy}
              key={c.id}
              onClick={() => {
                setSelected(c.id);
                setCandidate(null);
                setSlot(null);
                setMessage("");
              }}
            >
              {c.name} · Lv.{c.level}
              {c.unlocks.some((u) => u.decision === "pending") ? " ✦" : ""}
            </button>
          ))}
        </div>
        {character && (
          <>
            <section className="training-summary">
              <Art id={character.id} label={`${character.name} 일러스트`} className="training-illustration" />
              <div>
                <h3>
                  <ArtIcon id={character.element} />{character.name} · {"★".repeat(character.rarity)} ·{" "}
                  {character.element}
                </h3>
                <p data-testid="character-level">
                  Lv.{character.level} / {character.levelCap} · EXP{" "}
                  {character.experience} / {character.nextExperience}
                </p>
                <progress
                  aria-label="다음 레벨 경험치"
                  value={character.experience}
                  max={character.nextExperience}
                />
                <p>
                  HP {character.maxHp} · 공격 {character.attack} · 방어{" "}
                  {character.defense} · 스피드 {character.speed}
                </p>
              </div>
            </section>
            <p>
              승리 시 편성 캐릭터당 경험치80. 캐릭터마다 성장 수치와 기술 해금
              레벨이 다릅니다. 돌파 단계에 따라 레벨 상한이20/40/60/80으로
              증가합니다.
            </p>
            <p>
              치명타 {Math.round((character.critRate ?? 0) * 100)}% · 치명타
              배율 ×{character.critDamage ?? 1.5} · 직접 피해 보너스{" "}
              {Math.round((character.damageBonus ?? 0) * 100)}%
            </p>
            <p>
              속성 피해{" "}
              {Object.entries(character.elementDamageBonus ?? {})
                .map(([name, value]) => `${name} +${Math.round(value! * 100)}%`)
                .join(", ") || "보너스 없음"}{" "}
              · 속성 저항{" "}
              {Object.entries(character.elementResistance ?? {})
                .map(([name, value]) => `${name} ${Math.round(value! * 100)}%`)
                .join(", ") || "추가 없음"}
            </p>
            <details>
              <summary>패시브와 궁극기</summary>
              <p>
                <b>{PASSIVES[character.passiveId]?.name}</b> ·{" "}
                {PASSIVES[character.passiveId]?.description}
              </p>
              <p>
                <b>{ULTIMATES[character.ultimateId]?.name}</b> ·{" "}
                {ULTIMATES[character.ultimateId]?.description}
              </p>
            </details>
            <h3>현재 장착 기술 · {character.skills.length} / 4</h3>
            <ol className="equipped-list">
              {[0, 1, 2, 3].map((index) => (
                <li key={index}>
                  {index + 1}.{" "}
                  {character.equipped.find((s) => s.slot === index)
                    ? SKILLS[
                        character.equipped.find((s) => s.slot === index)!
                          .skillId
                      ].name
                    : "빈 슬롯"}
                </li>
              ))}
            </ol>
            {candidate && (
              <section className="learn-confirm" aria-label="기술 교체 확인">
                <h3>{SKILLS[candidate].name} 배우기</h3>
                {character.skills.length >= 4 ? (
                  <>
                    <p>
                      교체할 기술 하나를 고르세요. 나머지 기술과 기존 해금
                      기록은 유지됩니다.
                    </p>
                    <div className="replace-options">
                      {character.equipped.map(
                        ({ skillId: id, slot: index }) => (
                          <label key={id}>
                            <input
                              type="radio"
                              name="replace"
                              checked={slot === index}
                              onChange={() => setSlot(index)}
                              aria-label={`${SKILLS[id].name} 교체 선택`}
                            />
                            {SKILLS[id].name}
                          </label>
                        ),
                      )}
                    </div>
                    {slot !== null && (
                      <p>
                        {
                          SKILLS[
                            character.equipped.find((s) => s.slot === slot)!
                              .skillId
                          ].name
                        }{" "}
                        → {SKILLS[candidate].name}
                      </p>
                    )}
                  </>
                ) : (
                  <p>빈 슬롯에 새 기술을 배웁니다.</p>
                )}
                <button
                  disabled={
                    busy || (character.skills.length >= 4 && slot === null)
                  }
                  onClick={() => change("learn", candidate)}
                >
                  {character.skills.length >= 4 ? "교체 확인" : "습득 확인"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setCandidate(null);
                    setSlot(null);
                  }}
                >
                  취소
                </button>
              </section>
            )}
            <h3>해금·재습득 목록</h3>
            <p>
              배우지 않았거나 교체한 기술도 해금 목록에서 사라지지 않습니다.
            </p>
            <div className="learnset">
              {character.learnset.map(({ skillId, level }) => {
                const skill = SKILLS[skillId],
                  unlock = character.unlocks.find((u) => u.skillId === skillId),
                  equipped = character.skills.includes(skillId),
                  available = Boolean(unlock) && character.level >= level;
                return (
                  <section key={skillId} aria-label={`${skill.name} 기술 정보`}>
                    <div>
                      <h4>
                        {skill.name}{" "}
                        <small>
                          Lv.{level} · {skill.element}
                        </small>
                      </h4>
                      <p>
                        위력 {skill.power} · 명중{" "}
                        {Math.round(skill.accuracy * 100)}% · 우선도{" "}
                        {skill.priority}
                      </p>
                      <p>{skill.description}</p>
                    </div>
                    <div>
                      {equipped ? (
                        <span>장착 중</span>
                      ) : available ? (
                        <>
                          <small>
                            {unlock!.decision === "pending"
                              ? "새 기술"
                              : unlock!.decision === "deferred"
                                ? "학습 보류"
                                : "재습득 가능"}
                          </small>
                          <button
                            disabled={busy}
                            onClick={() => {
                              setCandidate(skillId);
                              setSlot(null);
                              setError("");
                            }}
                          >
                            {unlock!.decision === "learned"
                              ? "다시 배우기"
                              : "배우기"}
                          </button>
                          {unlock!.decision !== "deferred" && (
                            <button
                              disabled={busy}
                              onClick={() => change("defer", skillId)}
                            >
                              나중에 배우기
                            </button>
                          )}
                        </>
                      ) : (
                        <span>Lv.{level}에 해금</span>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </article>
    </div>
  );
}
