import { CONSUMABLES, consumable } from "../../shared/items";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHARACTERS } from "../../shared/combat";
import {
  BANNER,
  WEAPONS,
  materialId,
  materialName,
  liberationBonuses,
  type WeaponId,
  type Pull,
} from "../../shared/economy";
import type { CharacterProgress } from "../../shared/progression";
type Owned = CharacterProgress & {
  copies: number;
  liberation: number;
  liberationTokens: number;
  liberationGranted: number;
  ascension: number;
  skillLevel: number;
};
type CollectionState = {
  wallet: { conch: number; shell: number; dust: number; revision: number };
  characters: Owned[];
  inventory: { itemId: string; quantity: number }[];
  weapons: {
    id: string;
    weaponId: WeaponId;
    level: number;
    equippedCharacterId: string | null;
  }[];
  pity: { five: number; four: number; guaranteed: boolean };
  history: {
    id: string;
    itemId: string;
    kind: string;
    rarity: number;
    featured: boolean;
    createdAt: string;
  }[];
};
function itemName(id: string) {
  return (
    CHARACTERS.find((c) => c.id === id)?.name ??
    WEAPONS[id as WeaponId]?.name ??
    id
  );
}
export function WalletBar() {
  const [wallet, setWallet] = useState<CollectionState["wallet"] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/economy")
        .then(async (r) => {
          if (r.ok) {
            const s = await r.json();
            if (alive) setWallet(s.wallet);
          }
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("characters:changed", load);
    window.addEventListener("economy:changed", load);
    window.addEventListener("world:loot", load);
    return () => {
      alive = false;
      window.removeEventListener("characters:changed", load);
      window.removeEventListener("economy:changed", load);
      window.removeEventListener("world:loot", load);
    };
  }, []);
  return wallet ? (
    <span className="wallet-bar" aria-label="보유 재화">
      소라 {wallet.conch.toLocaleString()} · 조개{" "}
      {wallet.shell.toLocaleString()}
    </span>
  ) : null;
}
export function Collection({
  menu,
  onClose,
}: {
  menu: "강화" | "캐릭터 뽑기" | "인벤토리";
  onClose: () => void;
}) {
  const [state, setState] = useState<CollectionState | null>(null),
    [selected, setSelected] = useState("haerin"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [pulls, setPulls] = useState<
      (Pull & {
        duplicate: boolean;
        tokens: number;
        dust: number;
        historyId: string;
      })[]
    >([]),
    [teamSlot, setTeamSlot] = useState(0);
  const retry = useRef<{ operation: string; body: any } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/economy");
    const value = await r.json();
    if (!r.ok) throw new Error(value.error);
    setState(value);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  const current =
    state?.characters.find((c) => c.id === selected) ?? state?.characters[0];
  async function send(operation: string, payload: unknown, reuse = false) {
    if (!state || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    const request =
      reuse && retry.current
        ? retry.current
        : {
            operation,
            body: {
              ...(payload as object),
              requestId: crypto.randomUUID(),
              expectedRevision: state.wallet.revision,
            },
          };
    retry.current = request;
    try {
      const r = await fetch("/api/economy/" + request.operation, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });
      const data = await r.json();
      if (!r.ok) {
        retry.current = null;
        throw new Error(data.error);
      }
      if (data.receipt.pulls) setPulls(data.receipt.pulls);
      setMessage(
        data.receipt.pulls
          ? `${data.receipt.pulls.length}회 뽑기 결과를 저장했습니다.`
          : "변경을 저장했습니다.",
      );
      retry.current = null;
      await load();
      window.dispatchEvent(new Event("economy:changed"));
      window.dispatchEvent(new Event("characters:changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const quantity = (id: string) =>
    state?.inventory.find((i) => i.itemId === id)?.quantity ?? 0;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={menu}>
      <article className="collection-panel">
        <div className="battle-title">
          <div>
            <small>YOUR SUMMER COLLECTION</small>
            <h2>{menu}</h2>
          </div>
          <button onClick={onClose}>닫기</button>
        </div>
        <p role="alert">{error}</p>
        <p role="status">{message}</p>
        {retry.current && !busy && (
          <button onClick={() => send("", {}, true)}>
            같은 요청 다시 시도
          </button>
        )}
        {state && (
          <>
            <div className="collection-wallet">
              소라 <b>{state.wallet.conch}</b> · 조개{" "}
              <b>{state.wallet.shell}</b> · 중복 별가루{" "}
              <b>{state.wallet.dust}</b>
            </div>
            {menu === "캐릭터 뽑기" ? (
              <>
                <section className="banner">
                  <small>SUMMER TIDE · LIMITED CHARACTER WISH</small>
                  <h2>전광이 머무는 여름</h2>
                  <h3>★★★★★ 미라 · 번개</h3>
                  <p>여름 항구의 신호를 지키는 여행자.</p>
                  <p>1회160소라 · 10회1,600소라</p>
                  <div className="draw-buttons">
                    <button
                      disabled={busy || state.wallet.conch < 160}
                      onClick={() =>
                        send("pull", { bannerId: BANNER.id, count: 1 })
                      }
                    >
                      1회 뽑기 · 160소라
                    </button>
                    <button
                      disabled={busy || state.wallet.conch < 1600}
                      onClick={() =>
                        send("pull", { bannerId: BANNER.id, count: 10 })
                      }
                    >
                      10회 뽑기 · 1,600소라
                    </button>
                  </div>
                  <p>
                    5성 천장 {state.pity.five}/90 · 4성 이상 보장{" "}
                    {state.pity.four}/10
                  </p>
                  <p>
                    {state.pity.guaranteed
                      ? "다음 5성은 픽업 미라 확정"
                      : "5성 획득 시 픽업 미라50% · 비픽업 후 다음5성 픽업 확정"}
                  </p>
                </section>
                <details>
                  <summary>확률과 중복 규칙</summary>
                  <p>
                    기본5성0.6%, 4성5.1%, 3성94.3%. 10회 안에4성 이상, 90회
                    안에5성 보장. 3성은 무기만 등장합니다. 비픽업5성은
                    캐릭터/무기 각50%입니다.
                  </p>
                  <p>
                    첫 획득은 캐릭터 해금만, 2~7번째 획득은 전용 해방
                    재료각1개(평생최대6개). 8번째부터 별가루로 전환합니다. 현금
                    결제는 없습니다.
                  </p>
                  <p>
                    시작 선물 소라3,200·조개10,000은 계정당 한 번 지급합니다.
                    이후 전투·탐험 상자에서 재화와 재료를 얻습니다.
                  </p>
                </details>
                <div className="pull-grid" aria-label="뽑기 결과">
                  {pulls.map((p, i) => (
                    <section
                      key={p.historyId ?? i}
                      className={"rarity-" + p.rarity}
                    >
                      <small>
                        {"★".repeat(p.rarity)} ·{" "}
                        {p.kind === "character" ? "캐릭터" : "무기"}
                      </small>
                      <h3>{itemName(p.id)}</h3>
                      <p>
                        {p.duplicate
                          ? p.tokens
                            ? "전용 해방 재료 +1"
                            : `별가루 +${p.dust}`
                          : p.kind === "character"
                            ? "새 동료 해금"
                            : "무기 획득"}
                      </p>
                    </section>
                  ))}
                </div>
                <h3>뽑기 기록 · 최근100개</h3>
                <div className="gacha-history">
                  {state.history.map((h) => (
                    <p key={h.id}>
                      {"★".repeat(h.rarity)} {itemName(h.itemId)}{" "}
                      {h.featured ? "· 픽업" : ""}
                    </p>
                  ))}
                </div>
              </>
            ) : (
              <>
                <label className="collection-character">
                  대상 캐릭터{" "}
                  <select
                    aria-label="강화 대상 캐릭터"
                    value={current?.id}
                    disabled={busy}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {state.characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · Lv.{c.level}
                        {c.slot === null ? " · 대기" : ` · 편성${c.slot + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                {current && (
                  <section className="collection-character-info">
                    <h3>
                      {current.name} · Lv.{current.level}/{current.levelCap} ·
                      해방 {current.liberation}/6
                    </h3>
                    <p>
                      HP {current.maxHp} · 공격 {current.attack} · 방어{" "}
                      {current.defense} · 스피드 {current.speed}
                    </p>
                    <p>
                      경험치 {current.experience}/{current.nextExperience} ·
                      기술 강화 {current.skillLevel}/6 · 해방 재료{" "}
                      {current.liberationTokens}개 (누적{" "}
                      {current.liberationGranted}/6)
                    </p>
                  </section>
                )}
                {menu === "강화" && current ? (
                  <>
                    <div className="upgrade-grid">
                      <section>
                        <h3>경험치 훈련</h3>
                        <p>여름 기록1개 + 조개100 → 경험치80</p>
                        <p>보유 기록 {quantity("training-book")}개</p>
                        <button
                          disabled={
                            busy ||
                            quantity("training-book") < 1 ||
                            state.wallet.shell < 100 ||
                            current.level >= current.levelCap
                          }
                          onClick={() =>
                            send("train", { characterId: current.id, count: 1 })
                          }
                        >
                          경험치 훈련
                        </button>
                      </section>
                      <section>
                        <h3>돌파 · {current.ascension}/3</h3>
                        <p>상한20→40→60→80</p>
                        <p>
                          조개 {1000 * (current.ascension + 1)}, 성장 결정{" "}
                          {3 * (current.ascension + 1)},{" "}
                          {materialName(materialId(current.id))}{" "}
                          {2 * (current.ascension + 1)}
                        </p>
                        <p>전용 재료 보유 {quantity(materialId(current.id))}</p>
                        <button
                          disabled={
                            busy ||
                            current.ascension >= 3 ||
                            current.level < current.levelCap
                          }
                          onClick={() =>
                            send("ascend", { characterId: current.id })
                          }
                        >
                          캐릭터 돌파
                        </button>
                      </section>
                      <section>
                        <h3>해방 · {current.liberation}/6</h3>
                        <p>해당 캐릭터 전용 해방 재료1개 소비</p>
                        <p>
                          1단계 HP+5%, 2단계 공격+5%, 3단계 궁극기+10%, 4단계
                          상태 확률+10%p, 5단계 스피드 증가, 6단계 피해/회복
                          강화.
                        </p>
                        <button
                          disabled={
                            busy ||
                            current.liberation >= 6 ||
                            current.liberationTokens < 1
                          }
                          onClick={() =>
                            send("liberate", { characterId: current.id })
                          }
                        >
                          캐릭터 해방
                        </button>
                      </section>
                      <section>
                        <h3>기술 강화 · {current.skillLevel}/6</h3>
                        <p>
                          단계당 직접 피해+4% · 조개 {300 * current.skillLevel}{" "}
                          · 성장 결정 {current.skillLevel}
                        </p>
                        <button
                          disabled={busy || current.skillLevel >= 6}
                          onClick={() =>
                            send("skill", { characterId: current.id })
                          }
                        >
                          기술 강화
                        </button>
                      </section>
                    </div>
                    <h3>무기 강화</h3>
                    <div className="weapon-list">
                      {state.weapons.map((w) => (
                        <section key={w.id}>
                          <b>
                            {WEAPONS[w.weaponId].name} · Lv.{w.level}/40
                          </b>
                          <p>
                            공격 +
                            {WEAPONS[w.weaponId].attack + 2 * (w.level - 1)} ·{" "}
                            {WEAPONS[w.weaponId].description}
                          </p>
                          <p>광석1개 + 조개 {100 * w.level}</p>
                          <button
                            disabled={busy || w.level >= 40}
                            onClick={() => send("weapon", { weaponId: w.id })}
                          >
                            무기 강화
                          </button>
                        </section>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h3>
                      보유 캐릭터 {state.characters.length}/8 · 전투 편성
                      최대4명
                    </h3>
                    {current && (
                      <div className="team-control">
                        <label>
                          교체할 편성 칸{" "}
                          <select
                            aria-label="전투 편성 칸"
                            value={teamSlot}
                            onChange={(e) =>
                              setTeamSlot(Number(e.target.value))
                            }
                          >
                            {[0, 1, 2, 3].map((slot) => (
                              <option key={slot} value={slot}>
                                {slot + 1}.{" "}
                                {state.characters.find((c) => c.slot === slot)
                                  ?.name ?? "빈칸"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          disabled={busy || current.slot === teamSlot}
                          onClick={() =>
                            send("team", {
                              characterId: current.id,
                              slot: teamSlot,
                            })
                          }
                        >
                          선택 캐릭터 편성
                        </button>
                        <p>
                          기존 편성 캐릭터끼리는 자리를 교환합니다. 새 캐릭터를
                          넣으면 해당 칸의 동료는 대기로 이동합니다.
                        </p>
                      </div>
                    )}
                    <h3>무기 장착</h3>
                    {current && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          send("equip", {
                            characterId: current.id,
                            weaponId: null,
                          })
                        }
                      >
                        선택 캐릭터 무기 해제
                      </button>
                    )}
                    <div className="weapon-list">
                      {state.weapons.map((w) => (
                        <section key={w.id}>
                          <b>
                            {"★".repeat(WEAPONS[w.weaponId].rarity)}{" "}
                            {WEAPONS[w.weaponId].name} · Lv.{w.level}
                          </b>
                          <p>
                            공격 +
                            {WEAPONS[w.weaponId].attack + 2 * (w.level - 1)} ·{" "}
                            {WEAPONS[w.weaponId].description}
                          </p>
                          <p>
                            장착:{" "}
                            {state.characters.find(
                              (c) => c.id === w.equippedCharacterId,
                            )?.name ?? "미장착"}
                          </p>
                          <button
                            disabled={
                              busy ||
                              !current ||
                              w.equippedCharacterId === current.id
                            }
                            onClick={() =>
                              send("equip", {
                                characterId: current!.id,
                                weaponId: w.id,
                              })
                            }
                          >
                            선택 캐릭터에 장착
                          </button>
                        </section>
                      ))}
                    </div>
                    <section className="supply-shop" aria-label="전투 소모품 보급">
                      <h3>전투 소모품 보급</h3><p>조개로 보급합니다. 전투·협동 모집 중에는 구입할 수 없습니다.</p>
                      <div className="weapon-list">{Object.values(CONSUMABLES).map((item) => <section key={item.id}>
                        <b>{item.name} · 보유 {quantity(item.id)}개</b><p>{item.description}</p><p>1개 조개 {item.price}</p>
                        {[1, 5].map((count) => <button key={count} disabled={busy || state.wallet.shell < item.price * count} onClick={() => send("supplies", { itemId: item.id, count })}>{item.name} {count}개 구입</button>)}
                      </section>)}</div>
                    </section>
                    <h3>성장 재료</h3>
                    <div className="inventory-grid">
                      {state.inventory.filter((i) => !consumable(i.itemId)).map((i) => (
                        <div key={i.itemId}>
                          {materialName(i.itemId)} <b>{i.quantity}</b>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </article>
    </div>
  );
}
