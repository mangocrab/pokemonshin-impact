import { useEffect, useRef } from "react";
import type { GameSettings } from "../../shared/settings";
/** Small original synthesized sounds. Audio is created only after a user gesture. */
export function Soundscape({ settings }: { settings: GameSettings }) {
  const current = useRef(settings), engine = useRef<{ sync: () => void } | null>(null);
  current.current = settings;
  useEffect(() => { engine.current?.sync(); }, [settings]);
  useEffect(() => {
    let context: AudioContext | undefined, master: GainNode | undefined;
    let noise: AudioBufferSourceNode | undefined, surf: GainNode | undefined;
    let lastCue = 0, closed = false;
    const voices = new Set<OscillatorNode>();
    const allowed = () => !current.current.muted && current.current.volume > 0 && !document.hidden;
    const sync = () => {
      if (!context || !master || !surf || closed) return;
      master.gain.setTargetAtTime(allowed() ? current.current.volume / 100 * 0.16 : 0, context.currentTime, 0.04);
      surf.gain.setTargetAtTime(current.current.ambientEffects ? 0.18 : 0, context.currentTime, 0.1);
      if (allowed()) void context.resume().catch(() => {});
      else {
        for (const voice of voices) voice.stop();
        voices.clear();
        void context.suspend().catch(() => {});
      }
    };
    const unlock = () => {
      if (closed || !allowed()) return;
      if (!context && typeof AudioContext !== "undefined") {
        try {
          context = new AudioContext(); master = context.createGain(); master.gain.value = 0;
          master.connect(context.destination);
          const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
          const samples = buffer.getChannelData(0);
          for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (0.5 + 0.25 * Math.sin(i / context.sampleRate * Math.PI / 2));
          noise = context.createBufferSource(); noise.buffer = buffer; noise.loop = true;
          const filter = context.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 650;
          surf = context.createGain(); noise.connect(filter); filter.connect(surf); surf.connect(master); noise.start();
        } catch { return; }
      }
      sync();
    };
    const cue = (event: Event) => {
      if (!allowed() || performance.now() - lastCue < 100) return;
      unlock();
      if (!context || !master || voices.size >= 6) return;
      lastCue = performance.now();
      const notes = (event as CustomEvent<string>).detail === "treasure" ? [523.25, 659.25, 783.99] : (event as CustomEvent<string>).detail === "victory" ? [392, 523.25, 783.99] : [220, 329.63];
      const start = context.currentTime;
      notes.forEach((frequency, i) => {
        const oscillator = context!.createOscillator(), gain = context!.createGain();
        oscillator.type = "sine"; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start + i * 0.065);
        gain.gain.linearRampToValueAtTime(0.35, start + i * 0.065 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, start + i * 0.065 + 0.28);
        oscillator.connect(gain); gain.connect(master!); voices.add(oscillator);
        oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start + i * 0.065); oscillator.stop(start + i * 0.065 + 0.3);
      });
    };
    engine.current = { sync };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("audio:cue", cue);
    document.addEventListener("visibilitychange", sync);
    return () => {
      closed = true; engine.current = null;
      window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock);
      window.removeEventListener("audio:cue", cue); document.removeEventListener("visibilitychange", sync);
      noise?.stop(); for (const voice of voices) voice.stop();
      if (context) void context.close().catch(() => {});
    };
  }, []);
  return null;
}
