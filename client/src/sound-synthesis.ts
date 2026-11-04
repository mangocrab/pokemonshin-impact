import type { SoundPattern } from "../../shared/sound";
/** The same finite oscillator envelope is used for live playback and offline audition. */
export function synthesizePattern(context: BaseAudioContext, destination: AudioNode, pattern: SoundPattern,
  options: { start?: number; onVoice?: (voice: OscillatorNode) => void; onEnded?: (voice: OscillatorNode) => void } = {}) {
  const start = options.start ?? context.currentTime;
  for (const note of pattern.notes) {
    const voice = context.createOscillator(), gain = context.createGain(), onset = start + note.delay;
    voice.type = pattern.wave; voice.frequency.setValueAtTime(note.hz, onset);
    voice.frequency.exponentialRampToValueAtTime(note.to, onset + note.length);
    gain.gain.setValueAtTime(0, onset);
    gain.gain.linearRampToValueAtTime(pattern.gain, onset + .015);
    gain.gain.exponentialRampToValueAtTime(0.001, onset + note.length);
    voice.connect(gain); gain.connect(destination); options.onVoice?.(voice);
    voice.onended = () => { options.onEnded?.(voice); voice.disconnect(); gain.disconnect(); };
    voice.start(onset); voice.stop(onset + note.length + .02);
  }
}
