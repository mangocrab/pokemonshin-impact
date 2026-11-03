import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, type GameSettings, type SettingsState } from "../../shared/settings";
import { Soundscape } from "./Sound";
type Preferences = {
  settings: SettingsState; ready: boolean; error: string;
  save: (draft: GameSettings) => Promise<void>; reload: () => Promise<void>;
};
const Context = createContext<Preferences | null>(null);
export function SettingsProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [settings, setSettings] = useState<SettingsState>({ ...DEFAULT_SETTINGS, revision: 0 });
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const generation = useRef(0);
  async function reload() {
    const version = ++generation.current;
    try {
      const r = await fetch("/api/settings");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (generation.current === version) { setSettings(data); setReady(true); setError(""); }
    } catch (e) {
      if (generation.current === version) setError(e instanceof Error ? e.message : "설정을 불러오지 못했습니다.");
    }
  }
  useEffect(() => {
    if (enabled) void reload();
    return () => { generation.current++; };
  }, [enabled]);
  async function save(draft: GameSettings) {
    const r = await fetch("/api/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, expectedRevision: settings.revision }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    generation.current++;
    setSettings(data); setError("");
  }
  return <Context.Provider value={{ settings, ready, error, save, reload }}>
    {enabled && <Soundscape settings={settings} />}{children}
  </Context.Provider>;
}
export function useSettings() {
  const value = useContext(Context);
  if (!value) throw new Error("SettingsProvider missing");
  return value;
}
export function Settings({ onClose }: { onClose: () => void }) {
  const { settings, ready, error, save, reload } = useSettings();
  const [draft, setDraft] = useState<GameSettings>(settings), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const { revision: _, ...values } = settings;
    setDraft(values);
  }, [settings]);
  const change = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    setDraft((v) => ({ ...v, [key]: value })); setNotice("");
  };
  async function submit() {
    if (busy || !ready) return;
    setBusy(true); setNotice("");
    try { await save(draft); setNotice("설정을 저장하고 적용했습니다."); }
    catch (e) { setNotice(e instanceof Error ? e.message : "저장하지 못했습니다. 다시 시도하세요."); }
    finally { setBusy(false); }
  }
  return <div className="modal" role="dialog" aria-modal="true" aria-label="설정">
    <article className="settings-panel">
      <div className="settings-title"><div><small>MAKE YOURSELF AT HOME</small><h2>설정</h2></div><button onClick={onClose}>닫기</button></div>
      <p>저장하면 바로 적용되며 다음 접속에도 유지됩니다.</p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={!ready || busy}>
        <legend>화면과 움직임</legend>
        <label className="setting-row">그래픽 품질<select aria-label="그래픽 품질" value={draft.quality} onChange={(e) => change("quality", e.target.value as GameSettings["quality"])}><option value="high">높음</option><option value="low">낮음 · 저사양</option></select></label>
        <p className="setting-help">낮음에서는 동적 조명과 환경 입자를 끄고 배경 움직임 갱신을 줄입니다.</p>
        {([ ["lighting", "동적 조명"], ["shadows", "그림자"], ["ambientEffects", "환경 효과"], ["reducedMotion", "움직임 줄이기"] ] as const).map(([key, label]) => <label className="setting-row" key={key}>{label}<input type="checkbox" checked={draft[key]} onChange={(e) => change(key, e.target.checked)} /></label>)}
        <p className="setting-help">움직임 줄이기는 파도·식물·입자·걷기·전투 연출을 멈춥니다. 전투 결과는 정지된 표시와 기록으로 확인할 수 있습니다. 기기의 움직임 감소 설정도 따릅니다.</p>
      </fieldset>
      <fieldset disabled={!ready || busy}>
        <legend>소리</legend>
        <label className="setting-row">음소거<input type="checkbox" checked={draft.muted} onChange={(e) => change("muted", e.target.checked)} /></label>
        <label className="setting-row">음량 · {draft.volume}%<input aria-label="음량" type="range" min="0" max="100" step="1" value={draft.volume} onChange={(e) => change("volume", Number(e.target.value))} /></label>
        <p className="setting-help">파도 환경음과 상자·전투 효과음을 제공합니다. 처음에는 음소거입니다. 소리는 화면을 누른 뒤 재생되며 다른 탭으로 이동하면 멈춥니다.</p>
        <button type="button" disabled={settings.muted || settings.volume === 0} onClick={() => window.dispatchEvent(new CustomEvent("audio:cue", { detail: "treasure" }))}>저장된 음량으로 소리 확인</button>
      </fieldset>
      <p aria-live="polite">{notice || (!ready ? "설정을 불러오는 중입니다." : "")}</p>
      <div className="settings-actions">
        <button disabled={!ready || busy} onClick={submit}>{busy ? "저장 중…" : "설정 저장"}</button>
        <button disabled={busy} onClick={() => { setDraft({ ...DEFAULT_SETTINGS }); setNotice("기본값을 선택했습니다. 저장하면 적용됩니다."); }}>기본값 선택</button>
        <button disabled={busy} onClick={() => { void reload(); setNotice(""); }}>최신 설정 불러오기</button>
      </div>
    </article>
  </div>;
}
