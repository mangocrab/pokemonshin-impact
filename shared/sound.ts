import type { BattleState, Element } from "./combat.js";
import { battleFeedback } from "./presentation.js";
export type SoundCue = "treasure" | "victory" | "battle" | "heal" | "shield" | "status" | "miss" | `skill:${Element}`;
export type SoundNote = { hz: number; to: number; delay: number; length: number };
export type SoundPattern = { wave: "sine" | "triangle"; gain: number; notes: readonly SoundNote[] };
export const MAX_SOUND_VOICES = 6;
const phrase = (wave: SoundPattern["wave"], gain: number, tones: readonly number[], length = .22): SoundPattern => ({
  wave, gain, notes: tones.map((hz, i) => ({ hz, to: hz, delay: i * .065, length })),
});
const sweep = (wave: SoundPattern["wave"], gain: number, from: number, to: number, length: number, second?: [number, number]): SoundPattern => ({
  wave, gain, notes: [{ hz: from, to, delay: 0, length }, ...(second ? [{ hz: second[0], to: second[1], delay: .065, length }] : [])],
});
const PATTERNS: Record<SoundCue, SoundPattern> = {
  treasure: phrase("sine", .35, [523.25, 659.25, 783.99], .28),
  victory: phrase("sine", .35, [392, 523.25, 783.99], .28),
  battle: phrase("sine", .3, [220, 329.63]),
  "skill:물": sweep("sine", .24, 392, 523.25, .18, [659.25, 783.99]),
  "skill:불": sweep("triangle", .23, 196, 110, .16, [294, 147]),
  "skill:바람": sweep("sine", .2, 329.63, 659.25, .23, [493.88, 880]),
  "skill:번개": sweep("triangle", .18, 880, 220, .09, [1318.51, 440]),
  "skill:얼음": sweep("sine", .18, 1046.5, 1174.66, .2, [1567.98, 1760]),
  "skill:자연": sweep("triangle", .22, 329.63, 392, .2, [523.25, 493.88]),
  heal: phrase("sine", .25, [392, 523.25, 659.25]),
  shield: phrase("triangle", .22, [261.63, 392], .26),
  status: phrase("sine", .18, [440, 466.16], .13),
  miss: sweep("sine", .14, 196, 98, .12),
};
export function soundPattern(cue: unknown): SoundPattern | null {
  return typeof cue === "string" && Object.hasOwn(PATTERNS, cue) ? PATTERNS[cue as SoundCue] : null;
}
/** One resolved-round pattern: own cast, own incoming hit, then a partner. Victory takes priority. */
export function battleSound(before: BattleState | null, after: BattleState | null): SoundCue | null {
  if (!before || !after || after.round !== before.round + 1) return null;
  const feedback = battleFeedback(before, after);
  if (!feedback) return null;
  if (after.status === "won" && before.status !== "won") return "victory";
  const cue = feedback.skills.find(c => c.actor === "ally") ?? feedback.skills.find(c => c.actor === "enemy") ?? feedback.skills[0];
  if (!cue) return null;
  return !cue.hit ? "miss" : cue.category === "attack" ? `skill:${cue.element}` : cue.category;
}
