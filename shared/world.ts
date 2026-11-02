export type Position = { x: number; y: number };
export const WORLD = { width: 1600, height: 1000, speed: 180 };
export const SPAWN: Position = { x: 800, y: 560 };
export const INTERACTION_RADIUS = 64;
export const CHESTS = [
  { id: "coast-1", x: 890, y: 560, name: "해안의 작은 선물" },
  { id: "grove-1", x: 430, y: 740, name: "야자수 숲의 선물" },
  { id: "harbor-1", x: 1260, y: 800, name: "쉼터 뒤의 선물" },
] as const;
export const PALMS = [
  [300, 490],
  [1160, 450],
  [1330, 750],
  [190, 800],
  [990, 860],
] as const;
export const OBSTACLES = [
  { x: 965, y: 565, width: 170, height: 110 },
  ...PALMS.map(([x, y]) => ({ x: x - 9, y: y - 10, width: 18, height: 20 })),
];
export function isWalkable(p: Position) {
  const radius = 12;
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= 30 &&
    p.x <= 1570 &&
    p.y >= 310 &&
    p.y <= 970 &&
    !OBSTACLES.some(
      (o) =>
        p.x > o.x - radius &&
        p.x < o.x + o.width + radius &&
        p.y > o.y - radius &&
        p.y < o.y + o.height + radius,
    )
  );
}
export function nearbyChest(position: Position, opened: readonly string[]) {
  return CHESTS.find(
    (c) =>
      !opened.includes(c.id) &&
      Math.hypot(c.x - position.x, c.y - position.y) <= INTERACTION_RADIUS,
  );
}
