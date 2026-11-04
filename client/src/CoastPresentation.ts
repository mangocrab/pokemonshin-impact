import { HAERIN_AVATAR } from "./avatar-manifest";
import { TRAVELER_DISPLAY_SIZE } from "../../shared/art-layout";
import type { AvatarId } from "../../shared/avatars";
import { ART } from "./art-manifest";
import Phaser from "phaser";
import { graphicsOptions, type GameSettings } from "../../shared/settings";
import { travelerStep, travelerFrame, type TravelerStep } from "../../shared/presentation";
import { ObjectRelief } from "./ObjectRelief";
import { GroundContacts } from "./GroundContacts";
/** Painted diffuse atlas with an independent geometric normal map, matching authoritative terrain. */
function paintedTiles(scene: Phaser.Scene) {
  const source = scene.textures.get("terrain-art").getSourceImage() as HTMLImageElement;
  return ["water", "sand", "grass", "wood"].map((id) => {
    const f = ART.terrain.frames[id as keyof typeof ART.terrain.frames];
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, f.x, f.y, f.w, f.h, 0, 0, 128, 128);
    return { canvas, data: ctx.getImageData(0, 0, 128, 128).data };
  });
}
function coastTexture(scene: Phaser.Scene) {
  const width = 800, height = 500, tiles = paintedTiles(scene);
  const canvas = document.createElement("canvas"), normals = document.createElement("canvas");
  canvas.width = normals.width = width; canvas.height = normals.height = height;
  const diffuse = canvas.getContext("2d")!, normal = normals.getContext("2d")!;
  const colors = diffuse.createImageData(width, height), vectors = normal.createImageData(width, height);
  const elevation = new Float32Array(width * height);
  const feather = (from: number, to: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const shore = 140 + Math.sin(x / 85) * 5, grass = 335 + Math.sin(x / 60) * 12;
    const sea = 1 - feather(shore - 2, shore + 2, y);
    const path = feather(335, 353, x) * (1 - feather(407, 425, x)) * feather(180, 198, y);
    const green = feather(grass - 5, grass + 6, y) * feather(60, 70, x) * (1 - feather(735, 745, x)) * (1 - path);
    const tx = Math.floor(x / 128) % 2 ? 127 - x % 128 : x % 128;
    const ty = Math.floor(y / 128) % 2 ? 127 - y % 128 : y % 128;
    const sample = (ty * 128 + tx) * 4;
    const edge = (1 - sea) * (1 - feather(shore + 1, shore + 5, y)) * 5;
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) {
      const land = tiles[1].data[sample + c] * (1 - green) + tiles[2].data[sample + c] * green;
      colors.data[i + c] = land * (1 - sea) + tiles[0].data[sample + c] * sea + edge - path * 1.5;
    }
    colors.data[i + 3] = 255;
    elevation[y * width + x] = (1 - sea) * (1 + green * 2) + Math.sin(x / 9 + y / 13) * (sea * 0.2 + (1 - sea) * 0.07);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = elevation[y * width + Math.min(x + 1, width - 1)] - elevation[y * width + Math.max(x - 1, 0)];
    const dy = elevation[Math.min(y + 1, height - 1) * width + x] - elevation[Math.max(y - 1, 0) * width + x];
    const length = Math.hypot(dx, dy, 1), i = (y * width + x) * 4;
    vectors.data[i] = 128 - dx / length * 127;
    vectors.data[i + 1] = 128 + dy / length * 127;
    vectors.data[i + 2] = 128 + 127 / length; vectors.data[i + 3] = 255;
  }
  diffuse.putImageData(colors, 0, 0); normal.putImageData(vectors, 0, 0);
  scene.textures.addCanvas("coast-relief", canvas)?.setDataSource(normals);
  const island = document.createElement("canvas"); island.width = 340; island.height = 350;
  const ctx = island.getContext("2d")!;
  ctx.fillStyle = ctx.createPattern(tiles[1].canvas, "repeat")!;
  ctx.beginPath(); ctx.roundRect(0, 0, 340, 380, 60); ctx.fill();
  ctx.fillStyle = ctx.createPattern(tiles[2].canvas, "repeat")!;
  ctx.beginPath(); ctx.roundRect(20, 30, 310, 310, 45); ctx.fill();
  scene.textures.addCanvas("sanctuary-paint", island);
}
export class CoastPresentation {
  private terrain: Phaser.GameObjects.Image;
  private waves: Phaser.GameObjects.Graphics;
  private contacts: GroundContacts;
  private leaves: { sprite: Phaser.GameObjects.Image; angle: number; phase: number }[] = [];
  private motes: Phaser.GameObjects.Arc[] = [];
  private light: Phaser.GameObjects.Light;
  private options = { lighting: true, shadows: true, effects: true, motion: true };
  private last = -Infinity;
  private quality: "high" | "low" = "high";
  private travelers = new Map<Phaser.GameObjects.Container, TravelerStep>();
  private relief: ObjectRelief;
  private appearances = new Map<Phaser.GameObjects.Container, AvatarId>();
  private avatarLoading = false;
  private avatarFailed = false;
  constructor(private scene: Phaser.Scene) {
    this.relief = new ObjectRelief(scene);
    this.contacts = new GroundContacts(scene);
    scene.add.tileSprite(1000, 500, 2000, 1000, "terrain-art", "water").setTileScale(0.5).setDepth(-110);
    coastTexture(scene);
    this.terrain = scene.add.image(800, 500, "coast-relief").setDisplaySize(1600, 1000).setDepth(-100);
    scene.add.image(1830, 825, "sanctuary-paint").setDepth(-90);
    scene.add.image(1610, 800, "terrain-art", "wood").setDisplaySize(140, 80).setDepth(-80);
    for (let x = 1550; x < 1680; x += 16) scene.add.line(0, 0, x, 760, x, 840, 0x70543b, 0.22).setOrigin(0).setDepth(-79);
    scene.add.text(1710, 700, "물결의 안뜰", { fontSize: "20px", color: "#3f6b5b" }).setDepth(-80);
    this.waves = scene.add.graphics().setDepth(-90);
    scene.lights.enable().setAmbientColor(0xdde4ee);
    this.light = scene.lights.addLight(-400, -400, 3600, 0xfff6e5, 0.28).setZNormal(.28);
    this.terrain.setCrop(0, 0, 785, 500);
    this.terrain.setLighting(true).setSelfShadow(false);
    for (let i = 0; i < 18; i++) this.motes.push(scene.add.circle(140 + (i * 83) % 1350, 360 + (i * 59) % 580, 1 + i % 2, 0xd9f2ff, 0.4).setDepth(2000));
  }
  get motionEnabled() { return this.options.motion; }
  get reliefState() { return { ...this.relief.summary, groundContacts: this.contacts.summary }; }
  travelerShadow(sprite: Phaser.GameObjects.Container) { return this.relief.shadowFrame(sprite.getByName("traveler-body") as Phaser.GameObjects.Image); }
  travelerOcclusion(sprite: Phaser.GameObjects.Container) { return this.relief.receivingState(sprite.getByName("traveler-body") as Phaser.GameObjects.Image); }
  finishObjects() { this.relief.scan(this.scene.children.list); }
  activateObjects() { this.relief.activate(); }
  traveler(sprite: Phaser.GameObjects.Container) {
    const registered = this.travelers.has(sprite);
    this.travelers.set(sprite, { x: sprite.x, y: sprite.y, phase: 0, movingUntil: 0, direction: "south" });
    if (!registered) {
      this.appearances.set(sprite, "traveler");
      sprite.once("destroy", () => { this.travelers.delete(sprite); this.appearances.delete(sprite); });
    }
    this.relief.register(sprite.getByName("traveler-body") as Phaser.GameObjects.Image);
  }
  appearance(sprite: Phaser.GameObjects.Container, avatar: AvatarId = "traveler") {
    const changed = this.appearances.get(sprite) !== avatar;
    this.appearances.set(sprite, avatar);
    if (changed && avatar === "haerin") this.avatarFailed = false;
    if (avatar !== "haerin" || this.scene.textures.exists("haerin-art") || this.avatarLoading || this.avatarFailed) return;
    this.avatarLoading = true;
    const failed = (file: Phaser.Loader.File) => { if (file.key === "haerin-art") this.avatarFailed = true; };
    this.scene.load.once("complete", () => { this.avatarLoading = false; this.scene.load.off("loaderror", failed); });
    this.scene.load.on("loaderror", failed);
    this.scene.load.atlas("haerin-art", HAERIN_AVATAR.url, HAERIN_AVATAR.atlas);
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }
  travelerAppearance(sprite: Phaser.GameObjects.Container) {
    return (sprite.getByName("traveler-body") as Phaser.GameObjects.Image).texture.key === "haerin-art" ? "haerin" : "traveler";
  }
  shadow(sprite: Phaser.GameObjects.Ellipse) { return this.contacts.register(sprite); }
  foliage(sprite: Phaser.GameObjects.Image, angle: number) {
    this.leaves.push({ sprite, angle, phase: this.leaves.length * 0.7 });
  }
  configure(settings: GameSettings, systemReducedMotion: boolean) {
    this.options = graphicsOptions(settings, systemReducedMotion); this.quality = settings.quality;
    this.scene.game.loop.setFPSLimit(settings.quality === "low" ? 20 : 30);
    this.terrain.setLighting(this.options.lighting);
    this.relief.configure(this.options.lighting, this.options.shadows, settings.quality === "high");
    if (this.options.lighting) this.scene.lights.enable(); else this.scene.lights.disable();
    this.contacts.configure(this.options.shadows);
    for (const mote of this.motes) mote.setVisible(this.options.effects && this.options.motion);
    for (const leaf of this.leaves) leaf.sprite.setAngle(leaf.angle);
    this.last = -Infinity;
    this.drawWaves(0);
  }
  private drawWaves(time: number) {
    this.waves.clear();
    for (let band = 0; band < 3; band++) {
      this.waves.lineStyle(1.5 - band * 0.3, 0xe5f2f3, 0.28 - band * 0.06).beginPath();
      for (let x = 0; x <= 1600; x += 16) {
        const y = 252 - band * 34 + Math.sin(x / 125 + time * 0.0006 + band) * 7;
        if (x === 0) this.waves.moveTo(x, y); else this.waves.lineTo(x, y);
      }
      this.waves.strokePath();
    }
  }
  update(time: number, active = true) {
    for (const [sprite, old] of this.travelers) {
      const step = travelerStep(old, sprite, time);
      this.travelers.set(sprite, active ? step : { ...step, movingUntil: 0 });
      const body = sprite.getByName("traveler-body") as Phaser.GameObjects.Image;
      const frame = travelerFrame(step, time, active && this.options.motion);
      const texture = this.appearances.get(sprite) === "haerin" && this.scene.textures.exists("haerin-art") ? "haerin-art" : "traveler-art";
      if (body.texture.key !== texture) body.setTexture(texture, frame); else body.setFrame(frame);
      body.setScale(TRAVELER_DISPLAY_SIZE / body.frame.realHeight).setY(5).setAngle(0).setFlipX(false);
    }
    this.relief.update(); this.contacts.update();
    if (!active || !this.options.motion || time - this.last < (this.quality === "low" ? 100 : 33)) return;
    this.last = time; this.drawWaves(time);
    for (const leaf of this.leaves) leaf.sprite.setAngle(leaf.angle + Math.sin(time * 0.0012 + leaf.phase) * 0.8);
    // Fixed sunlight keeps the cast direction stable while the normal maps respond per pixel.
    if (this.options.effects) this.motes.forEach((mote, i) => {
      mote.setPosition(140 + (i * 83 + time * 0.005) % 1350, 360 + (i * 59) % 580 + Math.sin(time * 0.001 + i) * 12);
      mote.setAlpha(0.18 + (Math.sin(time * 0.0015 + i) + 1) * 0.12);
    });
  }
}
