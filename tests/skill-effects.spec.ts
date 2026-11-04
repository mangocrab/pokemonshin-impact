import { test, expect } from "@playwright/test";
import { ELEMENTS, type ResolvedSkillCue } from "../shared/combat";

test("six skill elements, support, miss and cooperative summaries remain readable without blocking inputs", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); await page.goto("/");
  const cue = (element: ResolvedSkillCue["element"], category: ResolvedSkillCue["category"] = "attack", hit = true): ResolvedSkillCue => ({
    round: 1, actor: "ally", actorId: "haerin", actorName: "여행자", target: "enemy", targetId: "coral-crab", skillId: `${element}-${category}-${hit}`, skillName: `${element} 기술`, element, category, hit,
  });
  const samples = [...ELEMENTS.map(e => [cue(e)]), ...(["heal", "shield", "status"] as const).map(c => [cue("물", c)]),
    [cue("물", "attack", false)], Array.from({ length: 4 }, (_, i) => ({ ...cue("물"), actor: i ? "visitor" as const : "ally" as const }))];
  await page.evaluate(async samples => {
    const source = await (await fetch("/src/main.tsx")).text();
    const r = source.match(/from "([^"]*\/react\.js[^"]*)"/)?.[1], d = source.match(/from "([^"]*\/react-dom_client\.js[^"]*)"/)?.[1];
    if (!r || !d) throw new Error("React dependencies missing");
    const component = "/src/SkillEffects.tsx";
    const [{ default: React }, dom, { SkillEffects }] = await Promise.all([import(r), import(d), import(component)]);
    const mount = document.createElement("div"); mount.id = "skill-gallery";
    Object.assign(mount.style, { display: "grid", gridTemplateColumns: innerWidth > 700 ? "repeat(3,minmax(0,1fr))" : "1fr", gap: "8px", padding: "8px", maxWidth: "900px", margin: "0 auto" });
    document.getElementById("root")!.style.display = "none"; document.body.append(mount);
    const root = (dom.createRoot ?? dom.default.createRoot)(mount); (window as any).__skillGallery = root;
    root.render(React.createElement(React.Fragment, null, ...samples.map((cues, i) => React.createElement("div", {
      key: i, className: "battle-field combatant", "data-case": i, "data-motion": "false", "data-effects": "true", style: { minHeight: "180px", margin: 0, width: "100%" },
    }, React.createElement("button", { style: { position: "absolute", bottom: "10px", left: "40%" }, onClick: () => { mount.dataset.clicked = String(i); } }, `입력 ${i}`), React.createElement(SkillEffects, { cues, side: "enemy" })))));
  }, samples);
  const gallery = page.locator("#skill-gallery"); await expect(gallery.locator(".skill-effects")).toHaveCount(11);
  const paths = [];
  for (let i = 0; i < ELEMENTS.length; i++) {
    const card = gallery.locator(`[data-case="${i}"]`); await expect(card.locator(".skill-effect")).toHaveAttribute("data-element", ELEMENTS[i]);
    paths.push(await card.locator(".art-icon path").getAttribute("d"));
    await gallery.getByRole("button", { name: `입력 ${i}`, exact: true }).click(); await expect(gallery).toHaveAttribute("data-clicked", String(i));
  }
  expect(new Set(paths).size).toBe(6);
  for (const kind of ["heal", "shield", "status"]) await expect(gallery.locator(`[data-kind="${kind}"] .skill-aura`)).toBeVisible();
  const miss = gallery.locator('[data-kind="miss"]'); await expect(miss).toContainText("빗나감"); await expect(miss.locator(".skill-aura")).toBeHidden();
  const coop = gallery.locator('[data-case="10"]'); await expect(coop.locator(".skill-effect")).toHaveCount(2); await expect(coop).toContainText("+2개 기술");
  expect(await gallery.locator(".skill-caption").evaluateAll(nodes => nodes.every(n => {
    const a = n.getBoundingClientRect(), b = n.closest(".combatant")!.getBoundingClientRect(); return a.left >= b.left && a.right <= b.right;
  }))).toBe(true);
  await gallery.locator(".battle-field").evaluateAll(nodes => nodes.forEach(n => n.setAttribute("data-motion", "true")));
  await expect(gallery.locator(".skill-aura").first()).toHaveCSS("animation-name", "skill-flame");
  // Sample the browser's actual interpolation instead of only checking animation names.
  const poses = await gallery.locator('.skill-effect:not([data-kind="miss"]) .skill-aura').evaluateAll(nodes => nodes.map(node => {
    const animation = node.getAnimations()[0];
    if (!animation) throw new Error("Skill animation missing");
    animation.pause(); animation.currentTime = 0;
    const from = getComputedStyle(node).transform;
    animation.currentTime = 500;
    const to = getComputedStyle(node).transform;
    animation.currentTime = 250; // Capture the readable peak while still testing the later pose.
    return { name: getComputedStyle(node).animationName, from, to };
  }));
  expect(new Set(poses.map(p => p.name)).size).toBe(9);
  for (const pose of poses) expect(pose.to, pose.name).not.toBe(pose.from);
  await gallery.getByRole("button").evaluateAll(nodes => nodes.forEach(n => { (n as HTMLElement).style.opacity = "0"; }));
  await gallery.screenshot({ path: testInfo.outputPath("skill-motion-gallery.png") });
  await gallery.locator(".battle-field").evaluateAll(nodes => nodes.forEach(n => n.setAttribute("data-motion", "false")));
  expect(await gallery.locator(".skill-aura").evaluateAll(nodes => nodes.every(n => getComputedStyle(n).animationName === "none"))).toBe(true);
  await gallery.locator(".battle-field").evaluateAll(nodes => nodes.forEach(n => n.setAttribute("data-motion", "true")));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const aura of await gallery.locator('.skill-effect:not([data-kind="miss"]) .skill-aura').all()) await expect(aura).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await gallery.locator(".battle-field").evaluateAll(nodes => nodes.forEach(n => n.setAttribute("data-effects", "false")));
  for (const aura of await gallery.locator(".skill-aura").all()) await expect(aura).toBeHidden();
  expect(await gallery.locator(".skill-aura").evaluateAll(nodes => nodes.every(n => getComputedStyle(n).animationName === "none"))).toBe(true);
  for (const caption of await gallery.locator(".skill-caption").all()) await expect(caption).toBeVisible();
  expect(errors).toEqual([]); await page.evaluate(() => (window as any).__skillGallery.unmount());
});
