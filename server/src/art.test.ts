import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { HAERIN_AVATAR } from "../../client/src/avatar-manifest.js";
import { effectiveAvatar } from "../../shared/avatars.js";
import { ART } from "../../client/src/art-manifest.js";
import { CHARACTERS, ENCOUNTERS } from "../../shared/combat.js";
import { NPCS } from "../../shared/story.js";
import { TRAVELER_DIRECTIONS } from "../../shared/presentation.js";
test("shipping art atlases cover the live roster/world, stay inside their sheets and respect the 2 MiB download budget", () => {
  for (const c of CHARACTERS) assert.ok(c.id in ART.heroes.frames, c.id);
  for (const n of [...NPCS, ...ENCOUNTERS]) assert.ok(n.id in ART.world.frames, n.id);
  const traveler = JSON.parse(readFileSync("client/public/art/traveler.json", "utf8"));
  const cells = new Set<string>();
  for (const direction of TRAVELER_DIRECTIONS) for (const step of [0, 1, 2]) {
    const id = `${direction}-${step}`, f = traveler.frames[id];
    assert.ok(id in ART.traveler.frames, id);
    assert.equal(f.trimmed, true);
    assert.equal(f.sourceSize.w, ART.traveler.width / 3);
    assert.equal(f.sourceSize.h, ART.traveler.height / 4);
    assert.ok(f.spriteSourceSize.x >= 0 && f.spriteSourceSize.y >= 0);
    assert.ok(f.spriteSourceSize.x + f.frame.w <= f.sourceSize.w && f.spriteSourceSize.y + f.frame.h <= f.sourceSize.h);
    cells.add(JSON.stringify(f.frame));
  }
  assert.equal(cells.size, 12);
  for (const [upper, lower] of [["coral-crab", "daon"], ["sanctuary-bloom", "moru"], ["altar", "serin"], ["lantern", "traveler"]] as const) {
    const a = ART.world.frames[upper], b = ART.world.frames[lower];
    assert.ok(a.y + a.h < b.y, `${upper}/${lower} need a transparent row gutter`);
  }
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
  total += statSync("client/public/art/haerin-avatar.webp").size;
  assert.ok(total < 2 * 1024 * 1024, `Art download is ${total} bytes`);
});

test("Haerin's optional atlas keeps twelve distinct frames and one foot plane without stretching cells", () => {
  const atlas = JSON.parse(readFileSync("client/public/art/haerin-avatar.json", "utf8"));
  assert.deepEqual(atlas.meta.size, { w: HAERIN_AVATAR.width, h: HAERIN_AVATAR.height });
  const cells = new Set<string>();
  for (const direction of TRAVELER_DIRECTIONS) for (const step of [0, 1, 2]) {
    const id = `${direction}-${step}` as keyof typeof HAERIN_AVATAR.frames, f = atlas.frames[id]; cells.add(JSON.stringify(f.frame));
    assert.equal(f.trimmed, true); assert.deepEqual(f.sourceSize, { w: 342, h: 384 });
    assert.equal(f.spriteSourceSize.y + f.spriteSourceSize.h, 376);
    assert.ok(f.spriteSourceSize.x >= 0 && f.spriteSourceSize.x + f.frame.w <= 342);
    assert.ok(f.spriteSourceSize.y >= 0); assert.deepEqual(f.frame, HAERIN_AVATAR.frames[id]);
    assert.ok(f.frame.x >= 0 && f.frame.y >= 0 && f.frame.x + f.frame.w <= HAERIN_AVATAR.width && f.frame.y + f.frame.h <= HAERIN_AVATAR.height);
  }
  assert.equal(cells.size, 12);
});
test("only the supported and equipped hero can replace the common traveler", () => {
  assert.equal(effectiveAvatar("haerin", true), "haerin");
  assert.equal(effectiveAvatar("haerin", false), "traveler");
  assert.equal(effectiveAvatar("luna", true), "traveler");
  assert.equal(effectiveAvatar("traveler", true), "traveler");
});
