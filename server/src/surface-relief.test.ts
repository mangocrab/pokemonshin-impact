import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNormalMap, shadowLayout, surfaceMaterial } from "../../shared/surface-relief.js";
function mask() {
  const rgba = new Uint8ClampedArray(32 * 48 * 4);
  for (let y = 3; y < 45; y++) for (let x = 5; x < 27; x++) { const i = (y * 32 + x) * 4; rgba[i] = 180; rgba[i + 3] = 255; }
  return rgba;
}
test("normal generation preserves diffuse input and ignores paint color and baked shading", () => {
  const a = mask(), original = a.slice(), b = a.slice();
  for (let i = 0; i < b.length; i += 4) { b[i] = 0; b[i + 1] = 20; b[i + 2] = 255; }
  assert.deepEqual(buildNormalMap(a, 32, 48, "cloth"), buildNormalMap(b, 32, 48, "cloth"));
  assert.deepEqual(a, original);
});
test("normal vectors are normalized, vary over the object and stay flat outside the silhouette", () => {
  const rgba = mask(), normal = buildNormalMap(rgba, 32, 48, "metal"), colors = new Set<string>();
  for (let i = 0; i < normal.length; i += 4) {
    assert.ok(Math.abs(Math.hypot((normal[i] - 128) / 127, (normal[i + 1] - 128) / 127, (normal[i + 2] - 128) / 127) - 1) < .014);
    assert.equal(normal[i + 3], 255);
    if (!rgba[i + 3]) assert.deepEqual([...normal.slice(i, i + 4)], [128, 128, 255, 255]);
    else colors.add([...normal.slice(i, i + 3)].join(","));
  }
  assert.ok(colors.size > 30);
});
test("separate silhouettes and alpha gutters never inherit neighboring surface normals", () => {
  const rgba = mask();
  for (let y = 0; y < 48; y++) for (let x = 14; x <= 18; x++) rgba[(y * 32 + x) * 4 + 3] = 1;
  const normal = buildNormalMap(rgba, 32, 48, "cloth");
  for (let y = 0; y < 48; y++) assert.deepEqual([...normal.slice((y * 32 + 16) * 4, (y * 32 + 16) * 4 + 4)], [128, 128, 255, 255]);
});
test("material profiles cover live structures, plants, creatures and all traveler directions", () => {
  assert.equal(surfaceMaterial("cottage"), "stone"); assert.equal(surfaceMaterial("altar"), "stone");
  assert.equal(surfaceMaterial("chest-open"), "metal"); assert.equal(surfaceMaterial("palm"), "foliage");
  assert.equal(surfaceMaterial("coral-crab"), "shell"); assert.equal(surfaceMaterial("north-2"), "cloth");
  assert.notDeepEqual(buildNormalMap(mask(), 32, 48, "cloth"), buildNormalMap(mask(), 32, 48, "metal"));
});
test("ground projection anchors the feet and places the head shadow away from upper-left sunlight", () => {
  for (const [w, h] of [[128, 128], [42, 128], [128, 64]]) {
    const s = shadowLayout(w, h);
    const project = (x: number, y: number) => ({ x: s.a * x + s.c * y + s.e, y: s.b * x + s.d * y + s.f });
    const foot = project(w / 2, h), head = project(w / 2, 0);
    assert.ok(Math.abs(foot.x - s.originX * s.width) < 1e-9);
    assert.ok(Math.abs(foot.y - s.originY * s.height) < 1e-9);
    assert.ok(head.x > foot.x && head.y > foot.y);
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) { const p = project(x, y); assert.ok(p.x >= 0 && p.x <= s.width && p.y >= 0 && p.y <= s.height); }
  }
});
test("invalid normal dimensions fail rather than uploading an incomplete texture", () => {
  assert.throws(() => buildNormalMap(new Uint8ClampedArray(4), 32, 48, "cloth"));
  assert.throws(() => buildNormalMap(new Uint8ClampedArray(0), 0, 0, "cloth"));
});
test("surface relief has no diagonal bias when an irregular silhouette is reflected", () => {
  const a = mask(), mirrored = new Uint8ClampedArray(a.length);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
    if (x + y < 22 || x * 2 - y > 12) a[(y * 32 + x) * 4 + 3] = 0;
    mirrored[(y * 32 + 31 - x) * 4 + 3] = a[(y * 32 + x) * 4 + 3];
  }
  const left = buildNormalMap(a, 32, 48, "cloth"), right = buildNormalMap(mirrored, 32, 48, "cloth");
  for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
    const p = (y * 32 + x) * 4, q = (y * 32 + 31 - x) * 4;
    assert.ok(Math.abs(left[p] + right[q] - 256) <= 1);
    assert.ok(Math.abs(left[p + 1] - right[q + 1]) <= 1);
    assert.ok(Math.abs(left[p + 2] - right[q + 2]) <= 1);
  }
});
