import { test } from "node:test";
import assert from "node:assert/strict";
import { move } from "./world.js";
test("server limits speed including diagonal and oversized input", () => {
  const start = { x: 800, y: 500 };
  const end = move(start, { x: 999, y: 999 }, 10);
  assert.ok(Math.hypot(end.x - start.x, end.y - start.y) <= 18.00001);
});
test("world boundaries cannot be crossed", () => {
  assert.deepEqual(move({ x: 30, y: 310 }, { x: -1, y: -1 }, 0.1), {
    x: 30,
    y: 310,
  });
});
test("invalid movement is rejected", () => {
  assert.throws(() => move({ x: 800, y: 500 }, { x: NaN, y: 0 }, 0.1));
});

import { isWalkable, nearbyChest } from "../../shared/world.js";
test("building walls block movement and allow sliding", () => {
  const result = move({ x: 950, y: 600 }, { x: 1, y: 1 }, 0.1);
  assert.ok(result.x <= 953);
  assert.ok(result.y > 600);
});
test("thin palm trunks cannot be tunneled through", () => {
  const result = move({ x: 278, y: 490 }, { x: 1, y: 0 }, 0.1);
  assert.ok(result.x <= 279);
});
test("water and building interiors are not walkable", () => {
  assert.equal(isWalkable({ x: 800, y: 200 }), false);
  assert.equal(isWalkable({ x: 1050, y: 620 }), false);
});
test("only nearby unopened chests can be interacted with", () => {
  assert.equal(nearbyChest({ x: 800, y: 560 }, []), undefined);
  assert.equal(nearbyChest({ x: 850, y: 560 }, [])?.id, "coast-1");
  assert.equal(nearbyChest({ x: 850, y: 560 }, ["coast-1"]), undefined);
});

test("locked regions reject movement and forged availability cannot cross the old boundary", () => {
  assert.deepEqual(move({ x: 1570, y: 800 }, { x: 999, y: 0 }, 10), { x: 1570, y: 800 });
  assert.equal(isWalkable({ x: 1780, y: 800 }), false);
  assert.equal(isWalkable({ x: 1780, y: 800 }, ["tide-sanctuary"]), true);
});
test("unlocked sanctuary uses its bridge, island shore and expanded world bounds", () => {
  const regions = ["tide-sanctuary"];
  assert.ok(move({ x: 1570, y: 800 }, { x: 1, y: 0 }, 0.1, regions).x > 1570);
  assert.equal(move({ x: 1570, y: 700 }, { x: 1, y: 0 }, 0.1, regions).x, 1570);
  assert.equal(move({ x: 1700, y: 670 }, { x: 0, y: -1 }, 0.1, regions).y, 670);
  assert.equal(move({ x: 1970, y: 800 }, { x: 1, y: 0 }, 0.1, regions).x, 1970);
});
