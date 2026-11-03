import type { ResolvedSkillCue } from "../../shared/combat";
import { ArtIcon } from "./ArtIcon";
const LABELS = { attack: "공격 기술", heal: "회복 기술", shield: "보호막 기술", status: "기술 실행" };
/** Resolved-round summary, never a speculative projectile or a claim of status application. */
export function SkillEffects({ cues, side }: { cues: ResolvedSkillCue[]; side: "ally" | "enemy" }) {
  const visible = cues.filter(c => c.target === side);
  if (!visible.length) return null;
  return <div className="skill-effects" aria-hidden="true">
    {visible.slice(-2).map((cue, i) => <div key={i} className="skill-effect" data-element={cue.element} data-kind={cue.hit ? cue.category : "miss"}
      data-skill={cue.skillId} data-actor={cue.actor}>
      <span className="skill-aura"><ArtIcon id={cue.element} /></span>
      <span className="skill-caption"><b>{cue.actor === "visitor" ? "협동 · " : ""}{cue.actorName} · {cue.skillName}</b><small>{cue.hit ? LABELS[cue.category] : "빗나감"}</small></span>
    </div>)}
    {visible.length > 2 && <small className="skill-overflow">이번 라운드 +{visible.length - 2}개 기술 · 전투 기록</small>}
  </div>;
}
