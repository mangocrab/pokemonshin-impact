import { ART } from "./art-manifest";
import Phaser from "phaser";
import { graphicsOptions, type GameSettings } from "../../shared/settings";
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
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const shore = 140 + Math.sin(x / 85) * 5, grass = 335 + Math.sin(x / 60) * 12;
    const sea = y < shore, green = y > grass && x > 65 && x < 740;
    const path = x > 345 && x < 415 && y > 185;
    const tile = tiles[sea ? 0 : green && !path ? 2 : 1].data;
    const tx = Math.floor(x / 128) % 2 ? 127 - x % 128 : x % 128;
    const ty = Math.floor(y / 128) % 2 ? 127 - y % 128 : y % 128;
    const sample = (ty * 128 + tx) * 4;
    const edge = !sea && y < shore + 5 ? 8 : 0;
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) colors.data[i + c] = tile[sample + c] + edge - (path ? 7 : 0);
    colors.data[i + 3] = 255;
    elevation[y * width + x] = (sea ? 0 : green && !path ? 3 : 1) + Math.sin(x / 9 + y / 13) * (sea ? 0.2 : 0.07);
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
  private shadows = new Set<Phaser.GameObjects.Shape>();
  private leaves: { sprite: Phaser.GameObjects.Image; angle: number; phase: number }[] = [];
  private motes: Phaser.GameObjects.Arc[] = [];
  private light: Phaser.GameObjects.Light;
  private options = { lighting: true, shadows: true, effects: true, motion: true };
  private last = -Infinity;
  private quality: "high" | "low" = "high";
  constructor(private scene: Phaser.Scene) {
    scene.add.tileSprite(1000, 500, 2000, 1000, "terrain-art", "water").setTileScale(0.5).setDepth(-110);
    coastTexture(scene);
    this.terrain = scene.add.image(800, 500, "coast-relief").setDisplaySize(1600, 1000).setDepth(-100);
    scene.add.image(1830, 825, "sanctuary-paint").setDepth(-90);
    scene.add.image(1610, 800, "terrain-art", "wood").setDisplaySize(140, 80).setDepth(-80);
    for (let x = 1550; x < 1680; x += 16) scene.add.line(0, 0, x, 760, x, 840, 0x70543b, 0.22).setOrigin(0).setDepth(-79);
    scene.add.text(1710, 700, "물결의 안뜰", { fontSize: "20px", color: "#3f6b5b" }).setDepth(-80);
    this.waves = scene.add.graphics().setDepth(-90);
    scene.lights.enable().setAmbientColor(0xd6e4da);
    this.light = scene.lights.addLight(550, 100, 1400, 0xffecd0, 0.16);
    this.terrain.setCrop(0, 0, 785, 500);
    this.terrain.setLighting(true).setSelfShadow(false);
    for (let i = 0; i < 18; i++) this.motes.push(scene.add.circle(140 + (i * 83) % 1350, 360 + (i * 59) % 580, 1 + i % 2, 0xfff4cc, 0.35).setDepth(2000));
  }
  get motionEnabled() { return this.options.motion; }
  shadow<T extends Phaser.GameObjects.Shape>(sprite: T): T {
    this.shadows.add(sprite); sprite.setVisible(this.options.shadows);
    sprite.once("destroy", () => this.shadows.delete(sprite)); return sprite;
  }
  foliage(sprite: Phaser.GameObjects.Image, angle: number) {
    this.leaves.push({ sprite, angle, phase: this.leaves.length * 0.7 });
  }
  configure(settings: GameSettings, systemReducedMotion: boolean) {
    this.options = graphicsOptions(settings, systemReducedMotion); this.quality = settings.quality;
    this.scene.game.loop.setFPSLimit(settings.quality === "low" ? 20 : 30);
    this.terrain.setLighting(this.options.lighting);
    if (this.options.lighting) this.scene.lights.enable(); else this.scene.lights.disable();
    for (const shadow of this.shadows) shadow.setVisible(this.options.shadows);
    for (const mote of this.motes) mote.setVisible(this.options.effects && this.options.motion);
    for (const leaf of this.leaves) leaf.sprite.setAngle(leaf.angle);
    this.last = -Infinity;
    this.drawWaves(0);
  }
  private drawWaves(time: number) {
    this.waves.clear();
    for (let band = 0; band < 3; band++) {
      this.waves.lineStyle(2 - band * 0.4, 0xf0ffef, 0.45 - band * 0.1).beginPath();
      for (let x = 0; x <= 1600; x += 16) {
        const y = 252 - band * 34 + Math.sin(x / 125 + time * 0.0006 + band) * 7;
        if (x === 0) this.waves.moveTo(x, y); else this.waves.lineTo(x, y);
      }
      this.waves.strokePath();
    }
  }
  update(time: number) {
    if (!this.options.motion || time - this.last < (this.quality === "low" ? 100 : 33)) return;
    this.last = time; this.drawWaves(time);
    for (const leaf of this.leaves) leaf.sprite.setAngle(leaf.angle + Math.sin(time * 0.0012 + leaf.phase) * 0.8);
    if (this.options.lighting) this.light.setPosition(550 + Math.sin(time * 0.00012) * 70, 100);
    if (this.options.effects) this.motes.forEach((mote, i) => {
      mote.setPosition(140 + (i * 83 + time * 0.005) % 1350, 360 + (i * 59) % 580 + Math.sin(time * 0.001 + i) * 12);
      mote.setAlpha(0.18 + (Math.sin(time * 0.0015 + i) + 1) * 0.12);
    });
  }
}
