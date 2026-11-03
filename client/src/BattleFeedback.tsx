import { useEffect, useRef, useState } from "react";
import { battleFeedback, type BattleFeedback, type ResultChip } from "../../shared/presentation";
import { graphicsOptions } from "../../shared/settings";
import type { BattleState } from "../../shared/combat";
import { useSettings } from "./Settings";
import { Art } from "./Art";

export function useBattlePresentation(battle: BattleState | null) {
  const { settings } = useSettings();
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)"), update = () => setSystemReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const previous = useRef<BattleState | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [feedback, setFeedback] = useState<BattleFeedback | null>(null);
  useEffect(() => {
    const next = battleFeedback(previous.current, battle);
    previous.current = battle;
    if (!battle || next || feedback && !feedback.key.startsWith(`${battle.id}:`)) {
      clearTimeout(timer.current); setFeedback(next);
      if (next) timer.current = setTimeout(() => setFeedback(null), 2200);
    }
  }, [battle?.id, battle?.version]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { feedback, options: graphicsOptions(settings, systemReduced) };
}
export function ResultChips({ chips }: { chips: ResultChip[] }) {
  return <div className="result-chips" aria-hidden="true">{chips.map((chip, i) => <span key={i} data-result={chip.kind}>{chip.text}</span>)}</div>;
}
export function BurstCutIn({ burst }: { burst: NonNullable<BattleFeedback["burst"]> }) {
  return <div className="burst-cut-in" data-element={burst.element} aria-hidden="true">
    <Art id={burst.characterId} label="" className="burst-portrait" />
    <div><small>ULTIMATE · {burst.element}</small><strong>{burst.skillName}</strong><span>{burst.name}</span></div>
  </div>;
}
