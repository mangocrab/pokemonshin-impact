export type Point3 = { x: number; y: number; z: number };
export type BoxOccluder = { kind: "box"; owner: string; min: Point3; max: Point3 };
export type EllipsoidOccluder = { kind: "ellipsoid"; owner: string; center: Point3; radius: Point3 };
export type LightOccluder = BoxOccluder | EllipsoidOccluder;
const RAYS = [
  { x: -.42, y: -.22, weight: 2 },
  { x: -.438, y: -.234, weight: 1 }, { x: -.438, y: -.206, weight: 1 },
  { x: -.402, y: -.234, weight: 1 }, { x: -.402, y: -.206, weight: 1 },
];
function hitsBox(p: Point3, dx: number, dy: number, b: BoxOccluder) {
  let entry = Math.max(0, b.min.z - p.z), exit = b.max.z - p.z;
  // Both horizontal ray components point toward the upper-left sunlight.
  entry = Math.max(entry, (b.max.x - p.x) / dx, (b.max.y - p.y) / dy);
  exit = Math.min(exit, (b.min.x - p.x) / dx, (b.min.y - p.y) / dy);
  return exit > .001 && exit >= entry;
}
function hitsEllipsoid(p: Point3, dx: number, dy: number, s: EllipsoidOccluder) {
  const { radius: r, center: c } = s;
  if (r.x <= 0 || r.y <= 0 || r.z <= 0) return false;
  const x = (p.x - c.x) / r.x, y = (p.y - c.y) / r.y, z = (p.z - c.z) / r.z;
  const a = (dx / r.x) ** 2 + (dy / r.y) ** 2 + (1 / r.z) ** 2;
  const b = 2 * (x * dx / r.x + y * dy / r.y + z / r.z), k = x * x + y * y + z * z - 1;
  const discriminant = b * b - 4 * a * k;
  return discriminant >= 0 && (-b + Math.sqrt(discriminant)) / (2 * a) > .001;
}
export function lightOcclusion(point: Point3, occluders: readonly LightOccluder[], owner?: string) {
  let blocked = 0;
  for (const ray of RAYS) {
    for (const o of occluders) if (o.owner !== owner && (o.kind === "box" ? hitsBox(point, ray.x, ray.y, o) : hitsEllipsoid(point, ray.x, ray.y, o))) { blocked += ray.weight; break; }
  }
  return blocked / 6;
}
export function occluderBounds(o: LightOccluder) {
  const min = o.kind === "box" ? o.min : { x: o.center.x - o.radius.x, y: o.center.y - o.radius.y, z: o.center.z - o.radius.z };
  const max = o.kind === "box" ? o.max : { x: o.center.x + o.radius.x, y: o.center.y + o.radius.y, z: o.center.z + o.radius.z };
  const padding = Math.max(0, max.z) * .025 + 1;
  return { left: min.x - padding, right: max.x + Math.max(0, max.z) * .42 + padding,
    top: min.y - padding, bottom: max.y + Math.max(0, max.z) * .22 + padding };
}
export function receiverCandidates(x: number, y: number, width: number, originX: number, occluders: readonly LightOccluder[], owner: string) {
  return occluders.filter((o) => {
    if (o.owner === owner) return false;
    const b = occluderBounds(o);
    return x + (1 - originX) * width >= b.left && x - originX * width <= b.right && y >= b.top && y <= b.bottom;
  });
}
function box(owner: string, x: number, y: number, width: number, depth: number, bottom: number, top: number): BoxOccluder {
  return { kind: "box", owner, min: { x: x - width / 2, y: y - depth / 2, z: bottom }, max: { x: x + width / 2, y: y + depth / 2, z: top } };
}
/** Visual volumes only: these never participate in authoritative movement/collision. */
export function spriteOccluders(owner: string, frame: string, x: number, y: number, width: number, height: number): LightOccluder[] {
  if (frame === "cottage") {
    const depth = width * .53, cy = y - depth / 2;
    return [box(owner, x, cy, width * .82, depth, 0, height * .68),
      box(owner, x, cy, width * 1.06, depth * 1.10, height * .68, height * .82),
      box(owner, x, cy, width * .72, depth, height * .82, height * .93),
      box(owner, x, cy, width * .32, depth * .86, height * .93, height)];
  }
  if (frame === "palm") return [box(owner, x, y, 17, 16, 0, height * .78),
    { kind: "ellipsoid", owner, center: { x, y, z: height * .78 }, radius: { x: width * .4, y: width * .15, z: height * .20 } }];
  if (frame === "altar") return [
    box(owner, x, y, width * .92, width * .35, 0, height * .18),
    box(owner, x - width * .34, y, width * .16, width * .22, height * .18, height * .83),
    box(owner, x + width * .34, y, width * .16, width * .22, height * .18, height * .83),
    box(owner, x, y, width * .9, width * .25, height * .83, height),
  ];
  return [];
}
export type ShadowReceiver = { owner: string; x: number; y: number; width: number; height: number; originX: number; originY: number };
/** Clip a height-aware receiving mask to the authored alpha; never alter the diffuse source. */
export function receiverShadowMask(alpha: Uint8ClampedArray, width: number, height: number, receiver: ShadowReceiver, occluders: readonly LightOccluder[]) {
  if (alpha.length !== width * height || width < 1 || height < 1) throw new Error("Invalid receiving mask dimensions");
  const pixels = new Uint8ClampedArray(width * height * 4);
  let opaque = 0, shaded = 0, maximum = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (alpha[i] < 32) continue;
    opaque++;
    const shade = lightOcclusion({ x: receiver.x + ((x + .5) / width - receiver.originX) * receiver.width,
      y: receiver.y, z: Math.max(0, (receiver.originY - (y + .5) / height) * receiver.height) }, occluders, receiver.owner);
    if (!shade) continue;
    shaded++; maximum = Math.max(maximum, shade);
    pixels[i * 4] = 29; pixels[i * 4 + 1] = 43; pixels[i * 4 + 2] = 56;
    pixels[i * 4 + 3] = Math.round(alpha[i] * shade * .20);
  }
  return { pixels, coverage: opaque ? shaded / opaque : 0, maximum };
}
