import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, graphicsOptions } from "../../shared/settings.js";
test("low quality avoids lighting and particles while preserving independent shadow preference", () => {
  assert.deepEqual(graphicsOptions({ ...DEFAULT_SETTINGS, quality: "low", shadows: false }), {
    lighting: false, shadows: false, effects: false, motion: true,
  });
  assert.equal(graphicsOptions({ ...DEFAULT_SETTINGS, lighting: false }).lighting, false);
});
test("system reduced-motion overrides animation even when account preference allows it", () => {
  assert.equal(graphicsOptions(DEFAULT_SETTINGS, true).motion, false);
  assert.equal(graphicsOptions({ ...DEFAULT_SETTINGS, reducedMotion: true }).motion, false);
  assert.equal(graphicsOptions(DEFAULT_SETTINGS).motion, true);
});
