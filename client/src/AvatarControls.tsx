import { useEffect, useState } from "react";
import type { AvatarId, AvatarState } from "../../shared/avatars";
export function AvatarControls() {
  const [state, setState] = useState<AvatarState | null>(null), [selected, setSelected] = useState<AvatarId>("traveler");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function load() {
    try { const response = await fetch("/api/avatar"), data = await response.json();
      if (!response.ok) throw new Error(data.error); setState(data); setSelected(data.avatarId);
    } catch (e) { setMessage(e instanceof Error ? e.message : "모습을 불러오지 못했습니다."); }
  }
  useEffect(() => { void load(); }, []);
  async function save() {
    if (!state) return; setBusy(true); setMessage("");
    try { const response = await fetch("/api/avatar", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarId: selected, expectedRevision: state.revision }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setState(data); setSelected(data.avatarId); setMessage("탐험 모습을 저장했습니다.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className="avatar-controls" aria-label="탐험 모습 설정">
    <label>탐험 모습 <select aria-label="탐험 모습" value={selected} disabled={busy || !state} onChange={e => setSelected(e.target.value as AvatarId)}>
      <option value="traveler">공통 여행자</option>{state?.available.includes("haerin") && <option value="haerin">해린</option>}
    </select></label>
    <button disabled={busy || !state} onClick={() => void save()}>탐험 모습 저장</button>
    <button disabled={busy} onClick={() => void load()}>모습 다시 불러오기</button>
    <p aria-live="polite">{message}</p>
  </section>;
}
