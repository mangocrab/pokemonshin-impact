import { NPCS } from "../../shared/story";
import { SANCTUARY_ENCOUNTER } from "../../shared/combat";
import { useCallback, useEffect, useRef, useState } from "react";
import { SANCTUARY, TIDE_PUZZLE, RUNES, type AdventureView } from "../../shared/adventure";
export function Adventure({ mapOpen, onCloseMap, onActiveChange, inBattle }: { mapOpen: boolean; onCloseMap: () => void; onActiveChange: (value: boolean) => void; inBattle: boolean }) {
  const [state, setState] = useState<AdventureView | null>(null), [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const epoch = useRef(0), requests = useRef(0), inspection = useRef(0), pending = useRef(false);
  const close = useCallback(() => { inspection.current++; setOpened(false); setNotice(""); setError(""); }, []);
  const reload = useCallback(async () => {
    const world = epoch.current, request = ++requests.current;
    try {
      const r = await fetch("/api/adventure"), data = await r.json(); if (!r.ok) throw new Error(data.error);
      if (world === epoch.current && request === requests.current) { setState(data); setError(""); }
    } catch (e) { if (world === epoch.current && request === requests.current) setError(e instanceof Error ? e.message : "탐험 기록을 불러오지 못했습니다."); }
  }, []);
  useEffect(() => {
    const update = () => { void reload(); };
    const world = () => { epoch.current++; setState(null); close(); void reload(); };
    const inspect = (event: Event) => {
      const body = (event as CustomEvent<{ worldId: string; puzzleId: string }>).detail;
      const world = epoch.current, request = ++inspection.current;
      setOpened(true); setState(null); setNotice(""); setError("");
      void fetch("/api/adventure/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => {
        const data = await r.json(); if (!r.ok) throw new Error(data.error);
        if (world === epoch.current && request === inspection.current) setState(data.state);
      }).catch((e) => { if (world === epoch.current && request === inspection.current) setError(e instanceof Error ? e.message : "조사할 수 없습니다."); });
    };
    window.addEventListener("story:world", world); window.addEventListener("puzzle:inspect", inspect);
    window.addEventListener("adventure:changed", update); window.addEventListener("world:loot", update);
    return () => { epoch.current++; inspection.current++; requests.current++; window.removeEventListener("story:world", world); window.removeEventListener("puzzle:inspect", inspect); window.removeEventListener("adventure:changed", update); window.removeEventListener("world:loot", update); };
  }, [close, reload]);
  useEffect(() => { onActiveChange(opened); return () => onActiveChange(false); }, [opened, onActiveChange]);
  useEffect(() => { if (mapOpen || inBattle) close(); if (mapOpen) void reload(); }, [mapOpen, inBattle, close, reload]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [close]);
  async function ring(rune: string) {
    if (!state || pending.current) return;
    const world = epoch.current, request = inspection.current;
    pending.current = true; setBusy(true); setNotice("");
    try {
      const r = await fetch("/api/adventure/rune", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worldId: state.worldId, puzzleId: TIDE_PUZZLE.id, expectedRevision: state.puzzle.revision, rune }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      if (world === epoch.current && request === inspection.current) {
        setState(data.state);
        setNotice(data.rewarded ? "길이 열렸습니다. 소라160·조개500·성장 결정3개를 받았습니다." : data.correct ? "맑은 울림이 이어집니다." : rune === "reset" ? "울림을 처음으로 되돌렸습니다." : "순서가 맞지 않아 울림이 처음으로 돌아갔습니다.");
        if (data.rewarded) { window.dispatchEvent(new Event("economy:changed")); window.dispatchEvent(new CustomEvent("audio:cue", { detail: "treasure" })); }
        void reload();
      }
    } catch (e) { if (world === epoch.current && request === inspection.current) { setNotice(e instanceof Error ? e.message : "울림을 기록하지 못했습니다."); void reload(); } }
    finally { pending.current = false; setBusy(false); }
  }
  return <>
    {mapOpen && <div className="modal story-overlay" role="dialog" aria-modal="true" aria-label="지역 지도"><article className="story-panel">
      <div className="story-title"><div><small>FOLLOW THE TIDE</small><h2>지역 지도</h2></div><button onClick={onCloseMap}>닫기</button></div>
      <svg className="region-map" viewBox="0 0 2000 1000" role="img" aria-label="산호 해안과 물결의 안뜰 주요 위치 지도">
        <rect width="2000" height="1000" fill="#72c5be"/><rect y="280" width="1570" height="720" rx="60" fill="#ecdbac"/><rect x="1660" y="650" width="340" height="350" rx="60" fill="#c6d4a0"/><rect x="1570" y="760" width="100" height="80" fill={state?.regions.includes(SANCTUARY.id) ? "#a1835a" : "#728b7c"}/>
        <text x="260" y="460">산호 해안</text><text x="1680" y="735">물결의 안뜰</text>
        <circle cx="845" cy="640" r="18" fill="#397b68"/><text x="820" y="720">다온</text><circle cx="1210" cy="700" r="18" fill="#916b48"/><text x="1150" y="640">모루</text>
        <circle cx="1460" cy="800" r="22" fill="#6f78a3"/><text x="1260" y="930">세 파도의 종</text>
        <circle cx="1740" cy="900" r="18" fill="#788a64"/><text x="1755" y="980">세린</text>
        <circle cx={SANCTUARY_ENCOUNTER.x} cy={SANCTUARY_ENCOUNTER.y} r="20" fill="#bc7950"/><text x="1720" y="630">꽃등지기</text>
      </svg>
      <p>주요 위치를 표시한 지도입니다. 제단은 항구 길 동쪽 (1460,800)에 있습니다.</p>
      {state ? <section className="quest-card"><h3>{SANCTUARY.name} · {state.regions.includes(SANCTUARY.id) ? "해금됨" : "잠김"}</h3><p>{TIDE_PUZZLE.clue}</p><p>해금 조건: {TIDE_PUZZLE.requirement} 후 제단의 순서를 완성하세요.</p><p>{SANCTUARY_ENCOUNTER.name} ({SANCTUARY_ENCOUNTER.x},{SANCTUARY_ENCOUNTER.y}) · 자연 속성 · 1인 또는 최대4인 협동 도전. 만개 예고를 보고 방어하거나 교체하세요.</p><p>{NPCS.find((n) => n.id === "serin")?.location} · 꽃의 리듬과 여름 편지를 기록하는 부탁을 받을 수 있습니다.</p><p>제단 진행 {state.puzzle.progress}/3 · 안뜰의 선물 {state.treasureOpened ? "수령 완료" : "미발견"}</p>{!state.isOwner && <p>방문한 월드의 기록입니다. 주인이 연 길은 함께 탐험할 수 있습니다.</p>}</section> : <p>{error || "탐험 기록을 불러오는 중…"}</p>}
      <button onClick={() => { void reload(); }}>지역 기록 새로고침</button>
    </article></div>}
    {opened && <div className="modal story-overlay" role="dialog" aria-modal="true" aria-label={TIDE_PUZZLE.name}><article className="story-panel">
      <div className="story-title"><div><small>A MEMORY IN THREE NOTES</small><h2>{TIDE_PUZZLE.name}</h2></div><button onClick={close}>조사 마치기</button></div>
      <p className="puzzle-clue">{TIDE_PUZZLE.clue}</p>
      {state ? <><p aria-live="polite">울린 종 {state.puzzle.progress}/3 · {state.puzzle.solved ? "길이 열렸습니다" : "문양을 차례로 울려 보세요"}</p>
        {state.puzzle.solved ? <section className="quest-card"><h3>물결의 안뜰로 가는 길이 열렸습니다.</h3><p>제단 동쪽 다리를 건너 안뜰의 오래된 선물을 찾아보세요. 함께 온 친구도 열린 길을 걸을 수 있습니다.</p></section> : !state.isOwner ? <p>방문자는 영구적인 퍼즐 상태를 바꿀 수 없습니다. 단서는 함께 살펴볼 수 있습니다.</p> : !state.eligible ? <p>먼저 {TIDE_PUZZLE.requirement}을 마치세요.</p> : <><div className="rune-buttons">{RUNES.map((r) => <button disabled={busy} key={r.id} onClick={() => { void ring(r.id); }}><span aria-hidden="true">{r.icon}</span>{r.name} 울리기</button>)}</div><button disabled={busy} onClick={() => { void ring("reset"); }}>울림 초기화</button><p>순서를 틀리면 처음으로 돌아갑니다. 맞춘 울림은 재접속해도 남습니다.</p></>}
      </> : <p>{error || "제단을 조사하는 중…"}</p>}
      <p aria-live="polite">{notice}</p>
    </article></div>}
  </>;
}
