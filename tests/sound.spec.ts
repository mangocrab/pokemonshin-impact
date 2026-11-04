import { writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../shared/settings";

test("native audio requires a trusted gesture, obeys preferences and visibility, bounds voices and closes on disposal", async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => {
    const Native = window.AudioContext, w = window as any;
    w.__audioSessions = []; w.__audioNotes = []; w.__audioGains = [];
    w.AudioContext = class extends Native {
      constructor(...args: ConstructorParameters<typeof AudioContext>) { super(...args); w.__audioSessions.push(this); }
      createGain() {
        const gain = super.createGain(), record = { node: gain, target: 0 }; w.__audioGains.push(record);
        const set = gain.gain.setTargetAtTime.bind(gain.gain);
        gain.gain.setTargetAtTime = (value, time, constant) => { record.target = value; return set(value, time, constant); };
        return gain;
      }
      createOscillator() {
        const node = super.createOscillator(), record = { hz: 0, to: 0, wave: "", stops: 0, ended: false }; w.__audioNotes.push(record);
        const set = node.frequency.setValueAtTime.bind(node.frequency), ramp = node.frequency.exponentialRampToValueAtTime.bind(node.frequency);
        node.frequency.setValueAtTime = (value, time) => { record.hz = value; return set(value, time); };
        node.frequency.exponentialRampToValueAtTime = (value, time) => { record.to = value; return ramp(value, time); };
        const start = node.start.bind(node), stop = node.stop.bind(node);
        node.start = when => { record.wave = node.type; start(when); };
        node.stop = when => { record.stops++; stop(when); };
        node.addEventListener("ended", () => { record.ended = true; }); return node;
      }
    };
  });
  await page.goto("/");
  await page.evaluate(async settings => {
    const source = await (await fetch("/src/main.tsx")).text();
    const r = source.match(/from "([^"]*\/react\.js[^"]*)"/)?.[1], d = source.match(/from "([^"]*\/react-dom_client\.js[^"]*)"/)?.[1];
    if (!r || !d) throw new Error("React dependencies missing");
    const component = "/src/Sound.tsx";
    const [{ default: React }, dom, { Soundscape }] = await Promise.all([import(r), import(d), import(component)]);
    const mount = document.createElement("div"); document.getElementById("root")!.style.display = "none"; document.body.append(mount);
    const root = (dom.createRoot ?? dom.default.createRoot)(mount), w = window as any;
    function Harness({ settings }: { settings: typeof DEFAULT_SETTINGS }) {
      React.useEffect(() => { w.__soundReady = true; }, []);
      return React.createElement(React.Fragment, null, React.createElement(Soundscape, { settings }), React.createElement("button", null, "오디오 시작"));
    }
    let prefs = settings;
    w.__setSoundSettings = (patch: Partial<typeof settings>) => { prefs = { ...prefs, ...patch }; root.render(React.createElement(Harness, { settings: prefs })); };
    w.__disposeSound = () => root.unmount(); w.__setSoundSettings({});
  }, { ...DEFAULT_SETTINGS, muted: false });
  const sessions = () => page.evaluate(() => (window as any).__audioSessions.length);
  const notes = () => page.evaluate(() => (window as any).__audioNotes.length);
  const state = () => page.evaluate(() => (window as any).__audioSessions[0]?.state);
  const cue = (id: string) => page.evaluate(id => window.dispatchEvent(new CustomEvent("audio:cue", { detail: id })), id);
  await expect.poll(() => page.evaluate(() => (window as any).__soundReady)).toBe(true);
  await cue("skill:물");
  await page.evaluate(() => { window.dispatchEvent(new PointerEvent("pointerdown")); window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); });
  await cue("treasure"); expect(await sessions()).toBe(0);
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect.poll(state).toBe("running"); expect(await sessions()).toBe(1); expect(await notes()).toBe(0);
  await cue("skill:물"); await expect.poll(notes).toBe(2);
  expect(await page.evaluate(() => (window as any).__audioNotes.map((n: any) => [n.wave, n.hz, n.to]))).toEqual([["sine", 392, 523.25], ["sine", 659.25, 783.99]]);
  expect(await page.evaluate(() => (window as any).__audioGains[0].target)).toBeCloseTo(.064);
  await page.evaluate(() => (window as any).__setSoundSettings({ muted: true }));
  await expect.poll(state).toBe("suspended"); await cue("victory"); expect(await notes()).toBe(2);
  expect(await page.evaluate(() => (window as any).__audioNotes.every((n: any) => (n.ended || n.stops >= 2)))).toBe(true);
  await page.evaluate(() => (window as any).__setSoundSettings({ muted: false, volume: 0 }));
  await expect.poll(() => page.evaluate(() => (window as any).__audioGains[0].target)).toBe(0);
  await cue("treasure"); expect(await notes()).toBe(2);
  await page.evaluate(() => (window as any).__setSoundSettings({ volume: 35 }));
  await expect.poll(state).toBe("running");
  expect(await page.evaluate(() => (window as any).__audioGains[0].target)).toBeCloseTo(.056);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(state).toBe("suspended"); await cue("heal"); expect(await notes()).toBe(2);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(state).toBe("running"); expect(await notes()).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as any).__audioNotes.every((n: any) => n.ended))).toBe(true);
  const counts = await page.evaluate(async () => {
    const w = window as any, context = w.__audioSessions[0]; await context.suspend();
    const resume = context.resume.bind(context), now = performance.now.bind(performance), initial = w.__audioNotes.length;
    context.resume = () => Promise.resolve(); let clock = 100000;
    Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
    const counts: number[] = [];
    try {
      for (const [delta, id] of [[0, "treasure"], [50, "victory"], [100, "victory"], [200, "treasure"], [300, "constructor"]] as const) {
        clock = 100000 + delta; window.dispatchEvent(new CustomEvent("audio:cue", { detail: id })); counts.push(w.__audioNotes.length - initial);
      }
    } finally { Object.defineProperty(performance, "now", { configurable: true, value: now }); context.resume = resume; await resume(); }
    return counts;
  });
  expect(counts).toEqual([3, 3, 6, 6, 6]);
  await page.evaluate(() => (window as any).__disposeSound()); await expect.poll(state).toBe("closed");
  const final = await notes(); await cue("treasure"); await page.keyboard.press("Space");
  expect(await notes()).toBe(final); expect(await sessions()).toBe(1);
  const preview = await page.evaluate(async () => {
    const source = await (await fetch("/src/Sound.tsx")).text();
    const path = source.match(/from "([^"]*shared\/sound\.ts[^"]*)"/)?.[1];
    if (!path) throw new Error("Sound catalog missing");
    const renderer = "/src/sound-synthesis.ts";
    const [{ soundPattern }, { synthesizePattern }] = await Promise.all([import(path), import(renderer)]);
    const ids = ["skill:물", "skill:불", "skill:바람", "skill:번개", "skill:얼음", "skill:자연", "heal", "shield", "status", "miss", "treasure", "victory", "battle"];
    const rate = 22050, span = .65, context = new OfflineAudioContext(1, Math.ceil(rate * span * ids.length), rate);
    const master = context.createGain(); master.gain.value = .16; master.connect(context.destination);
    ids.forEach((id, i) => synthesizePattern(context, master, soundPattern(id), { start: i * span }));
    const pcm = (await context.startRendering()).getChannelData(0), peaks = ids.map((_, i) => {
      let peak = 0; for (let n = Math.floor(i * span * rate); n < Math.min(pcm.length, Math.floor((i + 1) * span * rate)); n++) peak = Math.max(peak, Math.abs(pcm[n])); return peak;
    });
    const bytes = new Uint8Array(44 + pcm.length * 2), view = new DataView(bytes.buffer);
    const word = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
    word(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); word(8, "WAVEfmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, "data"); view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), true);
    let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { peaks, finite: pcm.every(Number.isFinite), wav: btoa(binary) };
  });
  expect(preview.finite).toBe(true); expect(preview.peaks).toHaveLength(13);
  for (const peak of preview.peaks) { expect(peak).toBeGreaterThan(.001); expect(peak).toBeLessThan(.2); }
  await writeFile(testInfo.outputPath("battle-sounds.wav"), Buffer.from(preview.wav, "base64"));
  expect(errors).toEqual([]);
});
