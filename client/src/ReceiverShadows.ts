import Phaser from "phaser";
import { receiverCandidates, receiverShadowMask, spriteOccluders, type LightOccluder } from "../../shared/light-occlusion";

type AlphaFrame = { alpha: Uint8ClampedArray; width: number; height: number; scaleX: number; scaleY: number };
type Surface = { key: string; canvas: HTMLCanvasElement; texture: Phaser.Textures.CanvasTexture; image: Phaser.GameObjects.Image };
type Receiver = { sprite: Phaser.GameObjects.Image; id: string; stamp: string; frame: string; updated: number;
  coverage: number; maximum: number; surface?: Surface };
/** Height-aware 2.5D receiving masks. Original albedo and authoritative collision stay untouched. */
export class ReceiverShadows {
  private receivers = new Map<Phaser.GameObjects.Image, Receiver>();
  private alphaFrames = new Map<string, AlphaFrame>();
  private occluders: LightOccluder[] = [];
  private geometry = "";
  private sequence = 0;
  private enabled = false;
  constructor(private scene: Phaser.Scene) {}
  register(sprite: Phaser.GameObjects.Image) {
    if (this.receivers.has(sprite)) return;
    const receiver: Receiver = { sprite, id: `receiver-${++this.sequence}`, stamp: "", frame: "", updated: -Infinity, coverage: 0, maximum: 0 };
    this.receivers.set(sprite, receiver);
    sprite.once("destroy", () => {
      this.receivers.delete(sprite);
      if (receiver.surface) {
        if (receiver.surface.image.scene) receiver.surface.image.destroy();
        if (this.scene.textures.exists(receiver.surface.key)) this.scene.textures.remove(receiver.surface.key);
      }
    });
  }
  private visible(sprite: Phaser.GameObjects.Image) {
    if (!sprite.visible || sprite.alpha <= 0) return false;
    let parent = sprite.parentContainer;
    while (parent) { if (!parent.visible || parent.alpha <= 0) return false; parent = parent.parentContainer; }
    return true;
  }
  private bounds(sprite: Phaser.GameObjects.Image) {
    const matrix = sprite.getWorldTransformMatrix();
    const round = (value: number) => Math.round(value * 10) / 10;
    return { x: round(matrix.tx), y: round(matrix.ty), width: round(sprite.frame.realWidth * Math.hypot(matrix.a, matrix.b)),
      height: round(sprite.frame.realHeight * Math.hypot(matrix.c, matrix.d)) };
  }
  private geometryState() {
    const volumes: LightOccluder[] = [];
    for (const r of this.receivers.values()) {
      if (r.sprite.texture.key !== "world-art" || !["cottage", "palm", "altar"].includes(String(r.sprite.frame.name)) || !this.visible(r.sprite)) continue;
      const b = this.bounds(r.sprite);
      volumes.push(...spriteOccluders(r.id, String(r.sprite.frame.name), b.x, b.y, b.width, b.height));
    }
    const stamp = JSON.stringify(volumes);
    if (stamp !== this.geometry) { this.geometry = stamp; this.occluders = volumes; }
  }
  configure(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) for (const r of this.receivers.values()) r.surface?.image.setVisible(false);
    else this.update(true);
  }
  private alphaFrame(sprite: Phaser.GameObjects.Image, key: string) {
    let cached = this.alphaFrames.get(key);
    if (!cached) {
      const f = sprite.frame, scale = Math.min(1, 128 / Math.max(f.realWidth, f.realHeight));
      const width = Math.max(1, Math.round(f.realWidth * scale)), height = Math.max(1, Math.round(f.realHeight * scale));
      const scaleX = width / f.realWidth, scaleY = height / f.realHeight;
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(sprite.texture.getSourceImage() as HTMLImageElement, f.cutX, f.cutY, f.cutWidth, f.cutHeight,
        f.x * scaleX, f.y * scaleY, f.width * scaleX, f.height * scaleY);
      const rgba = ctx.getImageData(0, 0, width, height).data, alpha = new Uint8ClampedArray(width * height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
      cached = { width, height, scaleX, scaleY, alpha }; this.alphaFrames.set(key, cached);
    }
    return cached;
  }
  private position(r: Receiver, alpha: AlphaFrame) {
    const { sprite, surface } = r;
    if (!surface) return;
    surface.image.setPosition(sprite.x, sprite.y).setOrigin(sprite.originX, sprite.originY)
      .setScale(sprite.scaleX / alpha.scaleX, sprite.scaleY / alpha.scaleY).setRotation(sprite.rotation).setAlpha(sprite.alpha);
    if (!sprite.parentContainer) surface.image.setDepth(sprite.depth + .01);
  }
  update(force = false) {
    if (!this.enabled) return;
    this.geometryState();
    const now = performance.now();
    for (const r of this.receivers.values()) {
      const sprite = r.sprite, frame = `${sprite.texture.key}:${sprite.frame.name}`;
      if (!this.visible(sprite)) { r.surface?.image.setVisible(false); continue; }
      const b = this.bounds(sprite);
      const stamp = `${this.geometry}|${frame}|${b.x},${b.y},${b.width},${b.height}|${sprite.originX},${sprite.originY}`;
      const cached = this.alphaFrames.get(frame);
      if (cached) this.position(r, cached);
      if (!force && stamp === r.stamp) { r.surface?.image.setVisible(r.coverage > 0); continue; }
      // Rebuild poses immediately; moving within one pose is capped at about 15 Hz.
      if (!force && frame === r.frame && now - r.updated < 66) continue;
      r.stamp = stamp; r.frame = frame; r.updated = now;
      const candidates = receiverCandidates(b.x, b.y, b.width, sprite.originX, this.occluders, r.id);
      if (!candidates.length) { r.coverage = r.maximum = 0; r.surface?.image.setVisible(false); continue; }
      const alpha = this.alphaFrame(sprite, frame);
      const mask = receiverShadowMask(alpha.alpha, alpha.width, alpha.height,
        { ...b, owner: r.id, originX: sprite.originX, originY: sprite.originY }, candidates);
      r.coverage = mask.coverage; r.maximum = mask.maximum;
      if (!mask.coverage) { r.surface?.image.setVisible(false); continue; }
      if (!r.surface) {
        const canvas = document.createElement("canvas"); canvas.width = alpha.width; canvas.height = alpha.height;
        const key = `receiving-${r.id}`;
        const texture = this.scene.textures.addCanvas(key, canvas)!;
        const image = this.scene.add.image(sprite.x, sprite.y, key).setVisible(false);
        if (sprite.parentContainer) sprite.parentContainer.addAt(image, sprite.parentContainer.getIndex(sprite) + 1);
        r.surface = { key, canvas, texture, image };
      }
      const s = r.surface;
      if (s.canvas.width !== alpha.width || s.canvas.height !== alpha.height) s.texture.setSize(alpha.width, alpha.height);
      const imageData = s.texture.context.createImageData(alpha.width, alpha.height); imageData.data.set(mask.pixels);
      s.texture.context.putImageData(imageData, 0, 0); s.texture.refresh();
      s.image.setTexture(s.key).setVisible(true); this.position(r, alpha);
    }
  }
  state(sprite: Phaser.GameObjects.Image) {
    const r = this.receivers.get(sprite), active = Boolean(this.enabled && r?.surface?.image.visible && this.visible(sprite));
    return { active, coverage: active ? r!.coverage : 0, maximum: active ? r!.maximum : 0, frame: r?.frame ?? "" };
  }
  get summary() { return { enabled: this.enabled, volumes: this.enabled ? this.occluders.length : 0,
    shadedObjects: [...this.receivers.values()].filter((r) => this.state(r.sprite).active).length,
    alphaFrames: this.alphaFrames.size, masks: [...this.receivers.values()].filter((r) => r.surface).length }; }
}
