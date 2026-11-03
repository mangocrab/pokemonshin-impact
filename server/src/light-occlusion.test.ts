import { test } from "node:test";
import assert from "node:assert/strict";
import { lightOcclusion, receiverCandidates, receiverShadowMask, spriteOccluders, type BoxOccluder, type LightOccluder } from "../../shared/light-occlusion.js";
const wall: BoxOccluder = { kind: "box", owner: "wall", min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 100, z: 100 } };
test("tall volumes block the sun on the down-right side rather than darkening nearby objects indiscriminately", () => {
  assert.equal(lightOcclusion({ x: 120, y: 110, z: 0 }, [wall]), 1);
  assert.equal(lightOcclusion({ x: -20, y: -20, z: 0 }, [wall]), 0);
  assert.equal(lightOcclusion({ x: 120, y: 300, z: 0 }, [wall]), 0);
});
test("receiving surface height leaves the head lit while the feet are in shadow", () => {
  assert.equal(lightOcclusion({ x: 120, y: 110, z: 0 }, [wall]), 1);
  assert.equal(lightOcclusion({ x: 120, y: 110, z: 90 }, [wall]), 0);
  assert.equal(lightOcclusion({ x: 120, y: 110, z: 150 }, [wall]), 0);
});
test("self ownership excludes all parts of the same caster", () => {
  assert.equal(lightOcclusion({ x: 120, y: 110, z: 0 }, [wall], "wall"), 0);
  assert.equal(receiverCandidates(120, 110, 20, .5, [wall], "wall").length, 0);
});
test("ellipsoid canopies cast bounded soft-edged shadows above the ground", () => {
  const canopy: LightOccluder = { kind: "ellipsoid", owner: "tree", center: { x: 0, y: 0, z: 100 }, radius: { x: 30, y: 10, z: 20 } };
  assert.equal(lightOcclusion({ x: 42, y: 22, z: 0 }, [canopy]), 1);
  assert.equal(lightOcclusion({ x: 42, y: 22, z: 130 }, [canopy]), 0);
  assert.equal(lightOcclusion({ x: 200, y: 200, z: 0 }, [canopy]), 0);
  let partial = false;
  for (let y = 0; y < 50; y++) for (let x = 0; x < 90; x++) { const shade = lightOcclusion({ x, y, z: 0 }, [canopy]); if (shade > 0 && shade < 1) partial = true; }
  assert.ok(partial);
});
test("altar pillars and the upper beam leave an actual opening", () => {
  const altar = spriteOccluders("altar", "altar", 0, 0, 100, 100);
  assert.equal(altar.length, 4);
  assert.equal(lightOcclusion({ x: 0, y: 0, z: 20 }, altar), 0);
  assert.equal(lightOcclusion({ x: -34, y: 0, z: 20 }, altar), 1);
  assert.equal(lightOcclusion({ x: 0, y: 0, z: 90 }, altar), 1);
});
test("receiving masks preserve authored alpha and encode partial-height shading", () => {
  const alpha = new Uint8ClampedArray(8 * 12).fill(255);
  for (let y = 0; y < 12; y++) alpha[y * 8] = 0;
  const original = alpha.slice();
  const result = receiverShadowMask(alpha, 8, 12, { owner: "actor", x: 120, y: 110, width: 20, height: 100, originX: .5, originY: 1 }, [wall]);
  assert.ok(result.coverage > 0 && result.coverage < 1);
  assert.equal(result.pixels[(0 * 8 + 4) * 4 + 3], 0);
  assert.ok(result.pixels[(11 * 8 + 4) * 4 + 3] > 0);
  for (let y = 0; y < 12; y++) assert.equal(result.pixels[(y * 8) * 4 + 3], 0);
  assert.deepEqual(alpha, original);
});
test("broad-phase bounds never discard a point that a height-aware ray shades", () => {
  const volumes = [wall, ...spriteOccluders("palm", "palm", 10, 30, 100, 160)];
  for (let z = 0; z <= 160; z += 20) for (let y = -20; y <= 180; y += 10) for (let x = -50; x <= 220; x += 10) {
    if (lightOcclusion({ x, y, z }, volumes)) assert.ok(receiverCandidates(x, y, 1, .5, volumes, "actor").length > 0);
  }
});
test("only visual tall-caster profiles are created and invalid mask sizes fail", () => {
  assert.equal(spriteOccluders("c", "cottage", 1050, 675, 208, 194).length, 4);
  assert.equal(spriteOccluders("p", "palm", 300, 490, 145, 164).length, 2);
  assert.deepEqual(spriteOccluders("chest", "chest", 0, 0, 42, 34), []);
  assert.throws(() => receiverShadowMask(new Uint8ClampedArray(1), 8, 12, { owner: "x", x: 0, y: 0, width: 20, height: 80, originX: .5, originY: 1 }, []));
});
