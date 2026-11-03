export type SurfaceMaterial = "cloth" | "stone" | "metal" | "foliage" | "shell";
const STRENGTH: Record<SurfaceMaterial, number> = { cloth: .075, stone: .065, metal: .12, foliage: .05, shell: .10 };
export function surfaceMaterial(id: string): SurfaceMaterial {
  if (["cottage", "altar"].includes(id)) return "stone";
  if (["chest", "chest-open", "lantern"].includes(id)) return "metal";
  if (["palm", "sanctuary-bloom"].includes(id)) return "foliage";
  return id === "coral-crab" ? "shell" : "cloth";
}

/** Technical surface data, not a repaint: source RGB is deliberately never interpreted as height. */
export function buildNormalMap(rgba: Uint8ClampedArray, width: number, height: number, material: SurfaceMaterial) {
  if (width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error("Invalid relief dimensions");
  const distance = new Float32Array(width * height), field = new Float32Array(width * height);
  const inside = (i: number) => rgba[i * 4 + 3] >= 48;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    distance[i] = inside(i) ? Math.min(x + 1, y + 1, width - x, height - y) : 0;
  }
  // Two-pass chamfer distance keeps each disconnected limb/leaf's own rounded edge.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
    if (y) distance[i] = Math.min(distance[i], distance[i - width] + 1);
    if (x && y) distance[i] = Math.min(distance[i], distance[i - width - 1] + Math.SQRT2);
    if (x < width - 1 && y) distance[i] = Math.min(distance[i], distance[i - width + 1] + Math.SQRT2);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x < width - 1) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
    if (y < height - 1) distance[i] = Math.min(distance[i], distance[i + width] + 1);
    if (x < width - 1 && y < height - 1) distance[i] = Math.min(distance[i], distance[i + width + 1] + Math.SQRT2);
    if (x && y < height - 1) distance[i] = Math.min(distance[i], distance[i + width - 1] + Math.SQRT2);
  }
  const span = Math.min(width, height), rim = Math.max(2, span * .08);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!inside(i)) continue;
    const u = (x + .5) / width, v = (y + .5) / height;
    const edge = Math.sin(Math.min(1, distance[i] / rim) * Math.PI / 2);
    const arch = material === "stone" ? 1 - Math.abs(u * 2 - 1) : Math.sqrt(Math.max(0, 1 - (u * 2 - 1) ** 2));
    const volume = arch * (.6 + .4 * Math.sin(v * Math.PI));
    field[i] = span * STRENGTH[material] * edge * (.45 + volume * .55);
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, p = i * 4;
    let dx = 0, dy = 0;
    if (inside(i)) {
      dx = (field[y * width + Math.min(width - 1, x + 1)] - field[y * width + Math.max(0, x - 1)]) / 2;
      dy = (field[Math.min(height - 1, y + 1) * width + x] - field[Math.max(0, y - 1) * width + x]) / 2;
    }
    const length = Math.hypot(dx, dy, 1);
    out[p] = 128 - 127 * dx / length; out[p + 1] = 128 + 127 * dy / length;
    out[p + 2] = 128 + 127 / length; out[p + 3] = 255;
  }
  return out;
}

/** Fixed upper-left sunlight: project each silhouette down/right onto the ground. */
export function shadowLayout(width: number, height: number) {
  const padding = 6, castX = .42, castY = .22;
  const w = Math.ceil(width + height * castX + padding * 2), h = Math.ceil(height * castY + padding * 2);
  return { width: w, height: h, originX: (width / 2 + padding) / w, originY: padding / h,
    a: 1, b: 0, c: -castX, d: -castY, e: height * castX + padding, f: height * castY + padding };
}
