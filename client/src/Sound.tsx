import { useEffect, useRef } from "react";
import type { GameSettings } from "../../shared/settings";
import { MAX_SOUND_VOICES, soundPattern } from "../../shared/sound";
import { synthesizePattern } from "./sound-synthesis";
/** Small original synthesized sounds. Audio is created only after a user gesture. */
export function Soundscape({ settings }: { settings: GameSettings }) {
  const current = useRef(settings), engine = useRef<{ sync: () => void } | null>(null);
  current.current = settings;
  useEffect(() => { engine.current?.sync(); }, [settings]);
  useEffect(() => {
    let context: AudioContext | undefined, master: GainNode | undefined;
    let noise: AudioBufferSourceNode | undefined, surf: GainNode | undefined;
    let lastCue = -Infinity, closed = false, gestureUnlocked = false;
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
      if (closed || !gestureUnlocked || !allowed()) return;
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
    const gesture = (event: Event) => {
      if (!event.isTrusted) return;
      gestureUnlocked = true; unlock();
    };
    const cue = (event: Event) => {
      const pattern = soundPattern((event as CustomEvent<unknown>).detail);
      if (!pattern || !gestureUnlocked || !allowed() || performance.now() - lastCue < 100) return;
      unlock();
      if (!context || !master || voices.size + pattern.notes.length > MAX_SOUND_VOICES) return;
      lastCue = performance.now();
      synthesizePattern(context, master, pattern, { onVoice: voice => { voices.add(voice); }, onEnded: voice => { voices.delete(voice); } });
    };
    engine.current = { sync };
    window.addEventListener("pointerdown", gesture);
    window.addEventListener("keydown", gesture);
    window.addEventListener("audio:cue", cue);
    document.addEventListener("visibilitychange", sync);
    return () => {
      closed = true; engine.current = null;
      window.removeEventListener("pointerdown", gesture); window.removeEventListener("keydown", gesture);
      window.removeEventListener("audio:cue", cue); document.removeEventListener("visibilitychange", sync);
      noise?.stop(); for (const voice of voices) voice.stop();
      if (context) void context.close().catch(() => {});
    };
  }, []);
  return null;
}
