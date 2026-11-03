import Phaser from "phaser";
import { ART } from "./art-manifest";
import { buildNormalMap, shadowLayout, shadowRasterSize, shadowBandWeights, SHADOW_BLURS, surfaceMaterial } from "../../shared/surface-relief";
import { ReceiverShadows } from "./ReceiverShadows";

type Atlas = "world" | "traveler";
type Binding = { sprite: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; frame: string };
/** Per-frame procedural normal maps and alpha-projected ground shadows. No diffuse art edits. */
export class ObjectRelief {
  private normals = new Set<Atlas>();
  private objects = new Map<Phaser.GameObjects.Image, Binding>();
  private shadows = new Map<string, ReturnType<typeof shadowLayout> & { scaleX: number; scaleY: number }>();
  private lighting = false;
  private castShadows = true;
  private ready = false;
  private highQuality = true;
  private receivers: ReceiverShadows;
  constructor(private scene: Phaser.Scene) { this.receivers = new ReceiverShadows(scene); }
  private atlas(sprite: Phaser.GameObjects.Image): Atlas { return sprite.texture.key === "traveler-art" ? "traveler" : "world"; }
  private ensureNormals(atlas: Atlas) {
    if (this.normals.has(atlas)) return;
    const sheet = ART[atlas], texture = this.scene.textures.get(`${atlas}-art`);
    const source = texture.getSourceImage() as HTMLImageElement;
    const canvas = document.createElement("canvas"); canvas.width = sheet.width; canvas.height = sheet.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgb(128,128,255)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [id, frame] of Object.entries(sheet.frames)) {
      const scale = Math.min(1, 128 / Math.max(frame.w, frame.h));
      const w = Math.max(1, Math.round(frame.w * scale)), h = Math.max(1, Math.round(frame.h * scale));
      const tile = document.createElement("canvas"); tile.width = w; tile.height = h;
      const tc = tile.getContext("2d", { willReadFrequently: true })!;
      tc.drawImage(source, frame.x, frame.y, frame.w, frame.h, 0, 0, w, h);
      const rgba = tc.getImageData(0, 0, w, h);
      const normal = tc.createImageData(w, h); normal.data.set(buildNormalMap(rgba.data, w, h, surfaceMaterial(id)));
      tc.putImageData(normal, 0, 0); ctx.drawImage(tile, frame.x, frame.y, frame.w, frame.h);
    }
    texture.setDataSource(canvas); this.normals.add(atlas);
  }
  private shadowTexture(sprite: Phaser.GameObjects.Image) {
    const atlas = this.atlas(sprite), id = String(sprite.frame.name), key = `cast-${atlas}-${id}`;
    let layout = this.shadows.get(key);
    if (!layout) {
      const frame = sprite.frame;
      const { width, height, scaleX, scaleY } = shadowRasterSize(frame.realWidth, frame.realHeight);
      const silhouette = document.createElement("canvas"); silhouette.width = width; silhouette.height = height;
      const mask = silhouette.getContext("2d")!;
      // Phaser's trim offsets reconstruct the common traveler cell before projecting it.
      mask.drawImage(sprite.texture.getSourceImage() as HTMLImageElement, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
        frame.x * scaleX, frame.y * scaleY, frame.width * scaleX, frame.height * scaleY);
      mask.globalCompositeOperation = "source-in"; mask.fillStyle = "#253943"; mask.fillRect(0, 0, width, height);
      const projection = shadowLayout(width, height);
      const canvas = document.createElement("canvas"); canvas.width = projection.width; canvas.height = projection.height;
      const ctx = canvas.getContext("2d")!;
      const source = mask.getImageData(0, 0, width, height), band = mask.createImageData(width, height);
      // Split original alpha into overlapping height bands, then blur each projected band.
      // Additive composition preserves the partition's opacity instead of darkening its overlaps.
      ctx.globalCompositeOperation = "lighter";
      for (let layer = 0; layer < SHADOW_BLURS.length; layer++) {
        for (let y = 0; y < height; y++) {
          const weight = shadowBandWeights(1 - (y + .5) / height)[layer];
          for (let x = 0; x < width; x++) {
            const p = (y * width + x) * 4;
            band.data[p] = 37; band.data[p + 1] = 57; band.data[p + 2] = 67;
            band.data[p + 3] = Math.round(source.data[p + 3] * weight);
          }
        }
        mask.putImageData(band, 0, 0);
        ctx.filter = `blur(${SHADOW_BLURS[layer]}px)`;
        ctx.setTransform(projection.a, projection.b, projection.c, projection.d, projection.e, projection.f);
        ctx.drawImage(silhouette, 0, 0);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = "none";
      ctx.globalCompositeOperation = "destination-in";
      const fade = ctx.createLinearGradient(0, projection.originY * canvas.height, 0, canvas.height);
      fade.addColorStop(0, "rgba(0,0,0,.95)"); fade.addColorStop(1, "rgba(0,0,0,.35)");
      ctx.fillStyle = fade; ctx.fillRect(0, 0, canvas.width, canvas.height);
      this.scene.textures.addCanvas(key, canvas);
      layout = { ...projection, scaleX, scaleY }; this.shadows.set(key, layout);
    }
    return { key, layout };
  }
  register(sprite: Phaser.GameObjects.Image) {
    if (this.objects.has(sprite) || !["world-art", "traveler-art"].includes(sprite.texture.key)) return;
    if (this.ready && this.lighting) this.ensureNormals(this.atlas(sprite));
    const shadow = this.scene.add.image(sprite.x, sprite.y, "__DEFAULT").setVisible(false).setAlpha(.18).setDepth(-2);
    sprite.parentContainer?.addAt(shadow, 0);
    this.objects.set(sprite, { sprite, shadow, frame: "" });
    this.receivers.register(sprite);
    sprite.setLighting(this.ready && this.lighting).setSelfShadow(false);
    sprite.once("destroy", () => { this.objects.delete(sprite); if (shadow.scene) shadow.destroy(); });
    this.sync(this.objects.get(sprite)!);
  }
  scan(list: Phaser.GameObjects.GameObject[]) {
    for (const object of [...list]) {
      if (object instanceof Phaser.GameObjects.Image) this.register(object);
      else if (object instanceof Phaser.GameObjects.Container) this.scan(object.list);
    }
  }
  configure(lighting: boolean, shadows: boolean, highQuality = true) {
    this.lighting = lighting; this.castShadows = shadows; this.highQuality = highQuality;
    if (!this.ready) return;
    for (const binding of this.objects.values()) {
      if (lighting) this.ensureNormals(this.atlas(binding.sprite));
      binding.sprite.setLighting(lighting); this.sync(binding);
    }
    this.receivers.configure(shadows && highQuality);
  }
  activate() {
    if (this.ready) return;
    this.ready = true; this.configure(this.lighting, this.castShadows, this.highQuality);
  }
  private sync(binding: Binding) {
    const { sprite, shadow } = binding;
    if (!this.ready || !this.castShadows) { shadow.setVisible(false); return; }
    const { key, layout } = this.shadowTexture(sprite);
    if (binding.frame !== key) { shadow.setTexture(key).setOrigin(layout.originX, layout.originY); binding.frame = key; }
    shadow.setPosition(sprite.x, sprite.y).setScale(sprite.scaleX / layout.scaleX, sprite.scaleY / layout.scaleY)
      .setVisible(this.castShadows && sprite.visible).setAlpha(.18 * sprite.alpha);
  }
  update() { for (const binding of this.objects.values()) this.sync(binding); if (this.ready) this.receivers.update(); }
  shadowFrame(sprite: Phaser.GameObjects.Image) { return this.objects.get(sprite)?.shadow.texture.key ?? ""; }
  receivingState(sprite: Phaser.GameObjects.Image) { return this.receivers.state(sprite); }
  get summary() { return { objects: this.objects.size, atlases: this.normals.size,
    normalFrames: [...this.normals].reduce((n, atlas) => n + Object.keys(ART[atlas].frames).length, 0),
    litObjects: [...this.objects.values()].filter((b) => b.sprite.lighting).length,
    projectedShadows: [...this.objects.values()].filter((b) => b.shadow.visible).length,
    cachedShadows: this.shadows.size, lighting: this.lighting, shadows: this.castShadows, occlusion: this.receivers.summary }; }
}
