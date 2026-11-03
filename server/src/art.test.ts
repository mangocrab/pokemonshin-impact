import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { ART } from "../../client/src/art-manifest.js";
import { CHARACTERS, ENCOUNTERS } from "../../shared/combat.js";
import { NPCS } from "../../shared/story.js";
test("shipping art atlases cover the live roster/world, stay inside their sheets and respect the 2 MiB download budget", () => {
  for (const c of CHARACTERS) assert.ok(c.id in ART.heroes.frames, c.id);
  for (const n of [...NPCS, ...ENCOUNTERS]) assert.ok(n.id in ART.world.frames, n.id);
  let total = 0;
  for (const [name, sheet] of Object.entries(ART)) {
    const path = `client/public/art/${name}.webp`, bytes = readFileSync(path);
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF"); assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    const atlas = JSON.parse(readFileSync(`client/public/art/${name}.json`, "utf8"));
    assert.deepEqual(atlas.meta.size, { w: sheet.width, h: sheet.height });
    for (const [id, f] of Object.entries(sheet.frames)) {
      assert.ok(f.x >= 0 && f.y >= 0 && f.w > 0 && f.h > 0 && f.x + f.w <= sheet.width && f.y + f.h <= sheet.height, `${name}/${id}`);
      assert.deepEqual(atlas.frames[id].frame, f, `${name}/${id} Phaser/UI frame mismatch`);
    }
    total += statSync(path).size;
  }
  assert.ok(total < 2 * 1024 * 1024, `Art download is ${total} bytes`);
});
