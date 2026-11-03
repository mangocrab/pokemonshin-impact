import { test, expect } from "@playwright/test";

test("offscreen receivers defer masks, offscreen casters still shade and repeated visitors release textures", async ({ page }) => {
  test.setTimeout(45000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/ReceiverShadows.ts", source = await (await fetch(modulePath)).text();
    const phaserPath = source.match(/import Phaser from "([^"]+)"/)?.[1];
    if (!phaserPath) throw new Error("Phaser dependency URL missing from Vite module");
    const [{ default: Phaser }, { ReceiverShadows }] = await Promise.all([import(phaserPath), import(modulePath)]);
    const mount = document.createElement("div"); document.body.append(mount);
    let game: any;
    const scene: any = await new Promise(resolve => {
      game = new Phaser.Game({ type: Phaser.WEBGL, width: 160, height: 140, parent: mount,
        banner: false, audio: { noAudio: true }, scene: { create(this: any) { resolve(this); } } });
    });
    try {
      const texture = (key: string, w: number, h: number, frames: string[]) => {
        const t = scene.textures.createCanvas(key, w, h);
        t.context.fillStyle = "white"; t.context.fillRect(0, 0, w, h); t.refresh();
        for (const frame of frames) t.add(frame, 0, 0, 0, w, h);
      };
      texture("world-art", 32, 48, ["cottage"]); texture("traveler-art", 16, 32, ["south-0", "east-1"]);
      const masks = new ReceiverShadows(scene), camera = scene.cameras.main;
      camera.preRender();
      const caster = scene.add.image(-24, 80, "world-art", "cottage").setOrigin(.5, 1);
      const traveler = (frame = "south-0", x = 2) => scene.add.image(x, 85, "traveler-art", frame).setOrigin(.5, 1);
      masks.register(caster);
      const receiver = traveler("south-0", 500); masks.register(receiver); masks.configure(true);
      const initial = { ...masks.summary }, baselineTextures = scene.textures.getTextureKeys().length;
      receiver.setX(2); masks.configure(true);
      const entered = { ...masks.summary, coverage: masks.state(receiver).coverage };
      for (let i = 0; i < 20; i++) { masks.configure(true); masks.update(); }
      const idle = { ...masks.summary };
      receiver.setX(500).setFrame("east-1"); masks.update();
      const outside = { ...masks.summary, active: masks.state(receiver).active };
      receiver.setX(2); masks.update();
      const returned = { ...masks.summary, active: masks.state(receiver).active };
      camera.setScroll(300, 0); camera.preRender(); masks.update();
      const cameraAway = masks.state(receiver).active;
      camera.setScroll(0, 0); camera.preRender(); masks.update();
      const cameraBack = { ...masks.summary, active: masks.state(receiver).active };
      receiver.destroy();
      const cycles: { active: boolean; masks: number; textures: number; after: number }[] = [];
      const liveTextures = () => scene.textures.getTextureKeys().filter((key: string) => key.startsWith("receiving-")).length;
      for (let i = 0; i < 12; i++) {
        const visitor = traveler(i % 2 ? "east-1" : "south-0"); masks.register(visitor); masks.configure(true);
        const active = masks.state(visitor).active, count = masks.summary.masks, textures = liveTextures();
        visitor.destroy();
        cycles.push({ active, masks: count, textures, after: liveTextures() });
      }
      return { initial, entered, idle, outside, returned, cameraAway, cameraBack, cycles,
        final: { ...masks.summary, textureDelta: scene.textures.getTextureKeys().length - baselineTextures, objects: scene.children.list.length } };
    } finally { game.destroy(true); mount.remove(); }
  });
  expect(result.initial).toMatchObject({ volumes: 4, masks: 0, alphaFrames: 0, maskBuilds: 0, screenReceivers: 0 });
  expect(result.entered).toMatchObject({ masks: 1, alphaFrames: 1, maskBuilds: 1, screenReceivers: 1 });
  expect(result.entered.coverage).toBeGreaterThan(0);
  expect(result.idle.maskBuilds).toBe(1);
  expect(result.outside).toMatchObject({ masks: 1, alphaFrames: 1, maskBuilds: 1, active: false });
  expect(result.returned).toMatchObject({ masks: 1, alphaFrames: 2, maskBuilds: 2, active: true });
  expect(result.cameraAway).toBe(false);
  expect(result.cameraBack).toMatchObject({ maskBuilds: 2, active: true });
  expect(result.cycles).toHaveLength(12);
  for (const cycle of result.cycles) expect(cycle).toEqual({ active: true, masks: 1, textures: 1, after: 0 });
  expect(result.final).toMatchObject({ masks: 0, alphaFrames: 2, maskBuilds: 14, textureDelta: 0, objects: 1 });
  expect(errors).toEqual([]);
});
