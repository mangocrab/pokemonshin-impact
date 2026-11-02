import { WORLD, isWalkable, type Position } from "../../shared/world.js";
export { WORLD } from "../../shared/world.js";
export function move(
  position: Position,
  input: Position,
  dt: number,
  regions: readonly string[] = [],
): Position {
  if (![input.x, input.y, dt].every(Number.isFinite))
    throw new Error("Invalid movement");
  const length = Math.hypot(input.x, input.y),
    scale = length > 1 ? 1 / length : 1;
  const distance = WORLD.speed * Math.min(0.1, Math.max(0, dt));
  // Short substeps prevent thin colliders from being skipped. Separate axes allow wall sliding.
  const steps = Math.max(1, Math.ceil(distance / 4));
  let result = { ...position };
  for (let i = 0; i < steps; i++) {
    const x = Math.max(
      30,
      Math.min(WORLD.width - 30, result.x + (input.x * scale * distance) / steps),
    );
    if (isWalkable({ x, y: result.y }, regions)) result.x = x;
    const y = Math.max(
      310,
      Math.min(970, result.y + (input.y * scale * distance) / steps),
    );
    if (isWalkable({ x: result.x, y }, regions)) result.y = y;
  }
  return result;
}
