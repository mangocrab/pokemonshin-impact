import type Phaser from "phaser";
/** Detached ground effects must still respect the entire owner's visibility and opacity. */
export function worldAppearance(object: { visible: boolean; alpha: number; parentContainer: Phaser.GameObjects.Container | null }, ignoreOwnVisibility = false) {
  let visible = ignoreOwnVisibility || object.visible, alpha = object.alpha;
  let parent = object.parentContainer;
  while (parent) { visible = visible && parent.visible; alpha *= parent.alpha; parent = parent.parentContainer; }
  return { visible: visible && alpha > 0, alpha };
}
