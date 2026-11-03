import { test, expect } from "@playwright/test";

test("ground shadows stay behind opaque bodies and follow owner transforms, visibility and lifetime", async ({ page }, testInfo) => {
  test.setTimeout(45000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const reliefPath = "/src/ObjectRelief.ts", contactsPath = "/src/GroundContacts.ts";
    // Resolve Vite's actual dependency URL rather than assuming a workspace/cache location.
    const moduleSource = await (await fetch(reliefPath)).text();
    const phaserPath = moduleSource.match(/import Phaser from "([^"]+)"/)?.[1];
    if (!phaserPath) throw new Error("Phaser dependency URL missing from Vite module");
    const [{ default: Phaser }, { ObjectRelief }, { GroundContacts }] = await Promise.all([import(phaserPath), import(reliefPath), import(contactsPath)]);
    const mount = document.createElement("div"); mount.id = "ground-fixture";
    Object.assign(mount.style, { position: "fixed", top: "0", left: "0", zIndex: "100000" }); document.body.append(mount);
    let game: any;
    const scene: any = await new Promise(resolve => {
      game = new Phaser.Game({ type: Phaser.WEBGL, width: 160, height: 140, parent: mount, backgroundColor: "#ffffff",
        banner: false, audio: { noAudio: true }, scene: { create(this: any) { resolve(this); } } });
    });
    const pixel = (x: number, y: number) => new Promise<number[]>(resolve => game.renderer.snapshotPixel(x, y, (c: any) => resolve([c.r, c.g, c.b])));
    try {
      const texture = scene.textures.createCanvas("world-art", 32, 48);
      texture.context.fillStyle = "#ffffff"; texture.context.fillRect(0, 0, 32, 48); texture.refresh();
      // The red body overlaps the front actor's ground shadow, but not its white body.
      scene.add.rectangle(108, 96, 20, 20, 0xff0000).setDepth(80);
      const body = scene.add.image(0, 0, "world-art").setOrigin(.5, 1);
      const contacts = new GroundContacts(scene);
      const anchor = contacts.register(scene.add.ellipse(18, 6, 20, 10, 0x000000, 1));
      const owner = scene.add.container(80, 90, [anchor, body]).setDepth(90);
      const relief = new ObjectRelief(scene); relief.register(body); relief.configure(false, true, false); relief.activate();
      contacts.update(); relief.update();
      const coveredBody = await pixel(101, 96), exposedGround = await pixel(90, 97);
      const projected = scene.children.list.find((o: any) => o.type === "Image" && o !== body);
      const contact = scene.children.list.find((o: any) => o.type === "Ellipse");
      const plane = { projectedDepth: projected.depth, contactDepth: contact.depth, projectedParent: projected.parentContainer === null, contactParent: contact.parentContainer === null };
      owner.setVisible(false); relief.update(); contacts.update();
      const hidden = { cast: relief.summary.projectedShadows, contact: contacts.summary.visible, pixel: await pixel(90, 97) };
      owner.setVisible(true).setPosition(35, 40).setScale(1.5).setAlpha(.4); relief.update(); contacts.update();
      const transformed = { castX: projected.x, castY: projected.y, castAlpha: projected.alpha,
        contactX: contact.x, contactY: contact.y, contactAlpha: contact.alpha, anchorHidden: !anchor.visible };
      contacts.configure(false); relief.configure(false, false, false);
      const disabled = { cast: relief.summary.projectedShadows, contact: contacts.summary.visible };
      contacts.configure(true); relief.configure(false, true, false);
      const restored = { cast: relief.summary.projectedShadows, contact: contacts.summary.visible };
      owner.destroy();
      const removed = { objects: relief.summary.objects, contacts: contacts.summary.objects, castDestroyed: !projected.scene, contactDestroyed: !contact.scene };
      return { coveredBody, exposedGround, plane, hidden, transformed, disabled, restored, removed };
    } finally { game.destroy(true); mount.remove(); }
  });
  expect(result.coveredBody).toEqual([255, 0, 0]);
  expect(Math.max(...result.exposedGround)).toBeLessThan(245);
  expect(result.plane).toEqual({ projectedDepth: -2, contactDepth: -1, projectedParent: true, contactParent: true });
  expect(result.hidden).toEqual({ cast: 0, contact: 0, pixel: [255, 255, 255] });
  expect(result.transformed).toMatchObject({ castX: 35, castY: 40, contactX: 62, contactY: 49, anchorHidden: true });
  expect(result.transformed.castAlpha).toBeCloseTo(.18 * .4);
  expect(result.transformed.contactAlpha).toBeCloseTo(.4);
  expect(result.disabled).toEqual({ cast: 0, contact: 0 }); expect(result.restored).toEqual({ cast: 1, contact: 1 });
  expect(result.removed).toEqual({ objects: 0, contacts: 0, castDestroyed: true, contactDestroyed: true });
  expect(errors).toEqual([]);
});
