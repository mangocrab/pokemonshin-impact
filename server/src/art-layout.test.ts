import { test } from "node:test";
import assert from "node:assert/strict";
import { artScale } from "../../shared/art-layout.js";
import { ART } from "../../client/src/art-manifest.js";

test("map illustrations preserve their authored proportions inside the actual presentation bounds", () => {
  for (const [id, width, height] of [["daon", 56, 86], ["moru", 56, 86], ["serin", 56, 86], ["cottage", 208, 194], ["chest", 42, 34], ["chest-open", 42, 45], ["palm", 145, 164]] as const) {
    const frame = ART.world.frames[id], scale = artScale(frame.w, frame.h, width, height);
    assert.ok(frame.w * scale <= width + 1e-9 && frame.h * scale <= height + 1e-9, id);
    assert.ok(Math.abs(frame.w * scale - width) < 1e-9 || Math.abs(frame.h * scale - height) < 1e-9, id);
    assert.ok(Math.abs((frame.w * scale) / (frame.h * scale) - frame.w / frame.h) < 1e-12, id);
  }
  // A tall adult illustration must keep its narrow silhouette, rather than stretch to a fixed box.
  assert.equal(artScale(100, 400, 56, 86), 86 / 400);
  assert.equal(artScale(400, 100, 56, 86), 56 / 400);
});
