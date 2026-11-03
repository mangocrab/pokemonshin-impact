import { Art } from "./Art";
import { useCallback, useEffect, useRef, useState } from "react";
import { NPCS, QUESTS, type DialogueView, type NpcId, type QuestView, type StoryView } from "../../shared/story";
import { materialName } from "../../shared/economy";
const stateNames = { locked: "선행 조건 미충족", available: "받을 수 있는 부탁", active: "진행 중", ready: "목표 달성 · 주민에게 돌아가기", claimed: "완료 · 보상 수령" };
function Reward({ quest }: { quest: QuestView }) {
  return <p className="quest-reward">소라 {quest.reward.conch} · 조개 {quest.reward.shell} · {Object.entries(quest.reward.items).map(([id, n]) => `${materialName(id)} ${n}개`).join(" · ")}</p>;
}
export function Story({ inBattle, journalOpen, onCloseJournal, onOpenJournal, onActiveChange }: {
  inBattle: boolean; journalOpen: boolean; onCloseJournal: () => void; onOpenJournal: () => void; onActiveChange: (active: boolean) => void;
}) {
  const [story, setStory] = useState<StoryView | null>(null), [npcId, setNpcId] = useState<NpcId | null>(null);
  const [dialogue, setDialogue] = useState<DialogueView | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const epoch = useRef(0), reads = useRef(0), dialogueSequence = useRef(0), pending = useRef(false);
  const closeDialogue = useCallback(() => { dialogueSequence.current++; setNpcId(null); setDialogue(null); setError(""); setNotice(""); }, []);
  const reload = useCallback(async () => {
    const request = ++reads.current, world = epoch.current;
    try {
      const r = await fetch("/api/story"), data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (world === epoch.current && request === reads.current) { setStory(data); setError(""); }
    } catch (e) {
      if (world === epoch.current && request === reads.current) setError(e instanceof Error ? e.message : "모험을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    void reload();
    const update = () => { void reload(); };
    const world = () => { epoch.current++; setStory(null); closeDialogue(); void reload(); };
    const talk = (event: Event) => {
      const input = (event as CustomEvent<{ npcId: NpcId; worldId: string }>).detail;
      const request = ++dialogueSequence.current, world = epoch.current;
      setNpcId(input.npcId); setDialogue(null); setError(""); setNotice("");
      void fetch("/api/story/talk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then(async (r) => {
        const data = await r.json(); if (!r.ok) throw new Error(data.error);
        if (request === dialogueSequence.current && world === epoch.current) { setDialogue(data); setStory(data.story); }
      }).catch((e) => { if (request === dialogueSequence.current && world === epoch.current) setError(e instanceof Error ? e.message : "대화할 수 없습니다."); });
    };
    window.addEventListener("npc:talk", talk);
    window.addEventListener("story:world", world);
    for (const name of ["story:changed", "world:loot", "characters:changed", "adventure:changed"]) window.addEventListener(name, update);
    return () => {
      epoch.current++; reads.current++; dialogueSequence.current++;
      window.removeEventListener("npc:talk", talk); window.removeEventListener("story:world", world);
      for (const name of ["story:changed", "world:loot", "characters:changed", "adventure:changed"]) window.removeEventListener(name, update);
    };
  }, [reload, closeDialogue]);
  useEffect(() => { if (inBattle || journalOpen) closeDialogue(); }, [inBattle, journalOpen, closeDialogue]);
  useEffect(() => { onActiveChange(Boolean(npcId)); return () => onActiveChange(false); }, [Boolean(npcId), onActiveChange]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && npcId) closeDialogue(); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [npcId, closeDialogue]);
  async function act(operation: "accept" | "claim", questId: string) {
    if (!dialogue || pending.current) return;
    const world = epoch.current, request = dialogueSequence.current;
    pending.current = true; setBusy(true); setError(""); setNotice(""); reads.current++;
    try {
      const r = await fetch(`/api/story/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worldId: dialogue.worldId, questId }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      if (world === epoch.current && request === dialogueSequence.current) {
        setStory(data.story);
        setNotice(operation === "accept" ? "부탁을 받았습니다. 모험 일지에서 목표를 확인하세요." : data.claimed ? `${QUESTS.find((q) => q.id === questId)?.completion} 보상을 받았습니다.` : "이미 받은 보상입니다.");
        if (data.claimed) { window.dispatchEvent(new Event("economy:changed")); window.dispatchEvent(new CustomEvent("audio:cue", { detail: "treasure" })); }
        void reload();
      }
    } catch (e) { if (world === epoch.current && request === dialogueSequence.current) setError(e instanceof Error ? e.message : "부탁을 처리하지 못했습니다."); }
    finally { pending.current = false; setBusy(false); }
  }
  const npc = NPCS.find((n) => n.id === npcId), active = story?.quests.find((q) => q.state === "ready" || q.state === "active");
  return <>
    {story && <section className="quest-tracker" aria-label="현재 부탁">
      <div><small>{story.isOwner ? "나의 모험" : "방문한 월드의 모험"}</small><b>{active?.name ?? (story.quests.every((q) => q.state === "claimed") ? "해안의 부탁을 모두 마쳤습니다" : "주민들과 여름 이야기를 나눠 보세요")}</b>{active && <span>{active.objectiveText} · {active.progress}/{active.target}</span>}</div>
      <button onClick={onOpenJournal}>부탁 자세히 보기</button>
    </section>}
    {journalOpen && <div className="modal story-overlay" role="dialog" aria-modal="true" aria-label="모험 일지"><article className="story-panel">
      <div className="story-title"><div><small>STORIES OF THE COAST</small><h2>모험 일지</h2></div><button onClick={onCloseJournal}>닫기</button></div>
      {!story ? <p>{error || "월드의 모험을 불러오는 중…"}</p> : <>
        {!story.isOwner && <p className="visitor-note">친구의 월드입니다. 대화와 목표 확인은 가능하지만 부탁 수락·완료·보상 수령은 주인만 할 수 있습니다.</p>}
        {story.quests.map((q) => <section className="quest-card" key={q.id} aria-label={q.name}><small>{stateNames[q.state]}</small><h3>{q.name}</h3><p>{q.description}</p>{q.requirementText && <p>선행 조건: {q.requirementText}</p>}<p>{q.objectiveText} · {q.progress}/{q.target}</p><p>의뢰인: {NPCS.find((n) => n.id === q.npcId)?.name} · {NPCS.find((n) => n.id === q.npcId)?.location}</p><Reward quest={q} /></section>)}
      </>}
      <button onClick={() => { void reload(); }}>모험 새로고침</button>
    </article></div>}
    {npc && <div className="modal story-overlay" role="dialog" aria-modal="true" aria-label={npc.talkLabel}><article className="story-panel">
      <div className="story-title"><div><small>{npc.title}</small><h2>{npc.name}</h2></div><button onClick={closeDialogue}>대화 마치기</button></div>
      {!dialogue && !error && <p>이야기를 듣는 중…</p>}
      <Art set="world" id={npc.id} label={`${npc.name} 일러스트`} className="npc-illustration" />
      {dialogue?.lines.map((line, i) => <p className="npc-line" key={i}>{line}</p>)}
      {dialogue && story?.worldId === dialogue.worldId && story.quests.filter((q) => q.npcId === npc.id).map((q) => <section className="quest-card" key={q.id} aria-label={q.name}>
        <small>{stateNames[q.state]}</small><h3>{q.name}</h3><p>{q.description}</p>{q.requirementText && <p>선행 조건: {q.requirementText}</p>}<p>{q.objectiveText} · {q.progress}/{q.target}</p><Reward quest={q} />
        {dialogue.isOwner && q.state === "available" && <button disabled={busy} onClick={() => { void act("accept", q.id); }}>부탁 받기</button>}
        {dialogue.isOwner && q.state === "ready" && <button disabled={busy} onClick={() => { void act("claim", q.id); }}>보상 받기</button>}
        {q.state === "claimed" && <p>{q.completion}</p>}
      </section>)}
      {error && <p role="alert">{error}</p>}<p aria-live="polite">{notice}</p>
    </article></div>}
  </>;
}
