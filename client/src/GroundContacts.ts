import Phaser from "phaser";
import { worldAppearance } from "./world-appearance";
/** Invisible local anchors keep owner lifetime/transforms; only proxies render on the ground. */
export class GroundContacts {
  private objects = new Map<Phaser.GameObjects.Ellipse, Phaser.GameObjects.Ellipse>();
  private enabled = true;
  constructor(private scene: Phaser.Scene) {}
  register(anchor: Phaser.GameObjects.Ellipse) {
    if (this.objects.has(anchor)) return anchor;
    anchor.setVisible(false);
    const shadow = this.scene.add.ellipse(0, 0, anchor.width, anchor.height, anchor.fillColor, anchor.fillAlpha)
      .setOrigin(anchor.originX, anchor.originY).setDepth(-1).setVisible(false);
    this.objects.set(anchor, shadow);
    anchor.once("destroy", () => { this.objects.delete(anchor); if (shadow.scene) shadow.destroy(); });
    return anchor;
  }
  configure(enabled: boolean) { this.enabled = enabled; this.update(); }
  update() {
    for (const [anchor, shadow] of this.objects) {
      const appearance = worldAppearance(anchor, true), matrix = anchor.getWorldTransformMatrix();
      const transform = matrix.decomposeMatrix();
      shadow.setPosition(transform.translateX, transform.translateY).setRotation(transform.rotation)
        .setScale(transform.scaleX, transform.scaleY).setAlpha(appearance.alpha).setVisible(this.enabled && appearance.visible);
    }
  }
  get summary() { return { objects: this.objects.size, visible: [...this.objects.values()].filter(s => s.visible).length }; }
}
