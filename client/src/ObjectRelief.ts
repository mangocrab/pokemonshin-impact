import Phaser from "phaser";
import { ART } from "./art-manifest";
import { buildNormalMap, shadowLayout, surfaceMaterial } from "../../shared/surface-relief";

type Atlas = "world" | "traveler";
type Binding = { sprite: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; frame: string };
/** Per-frame procedural normal maps and alpha-projected ground shadows. No diffuse art edits. */
export class ObjectRelief {
  private normals = new Set<Atlas>();
  private objects = new Map<Phaser.GameObjects.Image, Binding>();
  private shadows = new Map<string, ReturnType<typeof shadowLayout> & { scale: number }>();
  private lighting = false;
  private castShadows = true;
  private ready = false;
  constructor(private scene: Phaser.Scene) {}
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
      const scale = Math.min(1, 128 / frame.realHeight);
      const width = Math.max(1, Math.round(frame.realWidth * scale)), height = Math.max(1, Math.round(frame.realHeight * scale));
      const silhouette = document.createElement("canvas"); silhouette.width = width; silhouette.height = height;
      const mask = silhouette.getContext("2d")!;
      // Phaser's trim offsets reconstruct the common traveler cell before projecting it.
      mask.drawImage(sprite.texture.getSourceImage() as HTMLImageElement, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
        frame.x * scale, frame.y * scale, frame.width * scale, frame.height * scale);
      mask.globalCompositeOperation = "source-in"; mask.fillStyle = "#253943"; mask.fillRect(0, 0, width, height);
      const projection = shadowLayout(width, height);
      const canvas = document.createElement("canvas"); canvas.width = projection.width; canvas.height = projection.height;
      const ctx = canvas.getContext("2d")!; ctx.filter = "blur(1.4px)";
      ctx.setTransform(projection.a, projection.b, projection.c, projection.d, projection.e, projection.f);
      ctx.drawImage(silhouette, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = "none";
      ctx.globalCompositeOperation = "destination-in";
      const fade = ctx.createLinearGradient(0, projection.originY * canvas.height, 0, canvas.height);
      fade.addColorStop(0, "rgba(0,0,0,.95)"); fade.addColorStop(1, "rgba(0,0,0,.35)");
      ctx.fillStyle = fade; ctx.fillRect(0, 0, canvas.width, canvas.height);
      this.scene.textures.addCanvas(key, canvas);
      layout = { ...projection, scale }; this.shadows.set(key, layout);
    }
    return { key, layout };
  }
  register(sprite: Phaser.GameObjects.Image) {
    if (this.objects.has(sprite) || !["world-art", "traveler-art"].includes(sprite.texture.key)) return;
    if (this.ready && this.lighting) this.ensureNormals(this.atlas(sprite));
    const shadow = this.scene.add.image(sprite.x, sprite.y, "__DEFAULT").setVisible(false).setAlpha(.18).setDepth(-2);
    sprite.parentContainer?.addAt(shadow, 0);
    this.objects.set(sprite, { sprite, shadow, frame: "" });
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
  configure(lighting: boolean, shadows: boolean) {
    this.lighting = lighting; this.castShadows = shadows;
    if (!this.ready) return;
    for (const binding of this.objects.values()) {
      if (lighting) this.ensureNormals(this.atlas(binding.sprite));
      binding.sprite.setLighting(lighting); this.sync(binding);
    }
  }
  activate() {
    if (this.ready) return;
    this.ready = true; this.configure(this.lighting, this.castShadows);
  }
  private sync(binding: Binding) {
    const { sprite, shadow } = binding;
    if (!this.ready || !this.castShadows) { shadow.setVisible(false); return; }
    const { key, layout } = this.shadowTexture(sprite);
    if (binding.frame !== key) { shadow.setTexture(key).setOrigin(layout.originX, layout.originY); binding.frame = key; }
    shadow.setPosition(sprite.x, sprite.y).setScale(sprite.scaleX / layout.scale, sprite.scaleY / layout.scale)
      .setVisible(this.castShadows && sprite.visible).setAlpha(.18 * sprite.alpha);
  }
  update() { for (const binding of this.objects.values()) this.sync(binding); }
  shadowFrame(sprite: Phaser.GameObjects.Image) { return this.objects.get(sprite)?.shadow.texture.key ?? ""; }
  get summary() { return { objects: this.objects.size, atlases: this.normals.size,
    normalFrames: [...this.normals].reduce((n, atlas) => n + Object.keys(ART[atlas].frames).length, 0),
    litObjects: [...this.objects.values()].filter((b) => b.sprite.lighting).length,
    projectedShadows: [...this.objects.values()].filter((b) => b.shadow.visible).length,
    cachedShadows: this.shadows.size, lighting: this.lighting, shadows: this.castShadows }; }
}
