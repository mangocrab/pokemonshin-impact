import { test, expect } from "@playwright/test";
import { CHARACTERS, ULTIMATES } from "../shared/combat";

test("eight ultimate signatures stay distinct, readable, nonblocking and respect reduced motion and low effects", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  const bursts = CHARACTERS.map(c => ({ characterId: c.id, name: c.name, element: c.element, skillName: ULTIMATES[c.ultimateId].name }));
  await page.evaluate(async bursts => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactPath = source.match(/from "([^"]*\/react\.js[^"]*)"/)?.[1];
    const domPath = source.match(/from "([^"]*\/react-dom_client\.js[^"]*)"/)?.[1];
    if (!reactPath || !domPath) throw new Error("React dependency URLs missing from Vite module");
    const componentPath = "/src/BattleFeedback.tsx";
    const [{ default: React }, client, { BurstCutIn }] = await Promise.all([import(reactPath), import(domPath), import(componentPath)]);
    const mount = document.createElement("div"); mount.id = "burst-gallery";
    Object.assign(mount.style, { display: "grid", gridTemplateColumns: innerWidth >= 700 ? "repeat(2,minmax(0,1fr))" : "1fr", gap: "12px", padding: "12px", background: "#162c49" });
    document.getElementById("root")!.style.display = "none"; document.body.append(mount);
    const root = (client.createRoot ?? client.default.createRoot)(mount); (window as any).__burstGallery = root;
    root.render(React.createElement(React.Fragment, null, ...bursts.map(burst => React.createElement("div", {
      key: burst.characterId, className: "battle-field", "data-motion": "false", "data-effects": "true", style: { minHeight: "190px", margin: 0 },
    }, React.createElement("button", { style: { position: "absolute", top: "32px", right: "8px" }, onClick: () => { mount.dataset.clicked = burst.characterId; } }, `${burst.name} 입력 확인`), React.createElement(BurstCutIn, { burst })))));
  }, bursts);
  const gallery = page.locator("#burst-gallery"), signatures = gallery.locator(".burst-signature");
  await expect(signatures).toHaveCount(8);
  const paths = await signatures.locator(".burst-core path").evaluateAll(nodes => nodes.map(n => n.getAttribute("d")));
  expect(new Set(paths).size).toBe(8);
  for (const burst of bursts) {
    const cutIn = gallery.locator(`[data-character="${burst.characterId}"]`);
    await expect(cutIn).toContainText(burst.skillName); await expect(cutIn.locator(".burst-signature")).toBeVisible();
    expect(await cutIn.evaluate(node => getComputedStyle(node).pointerEvents)).toBe("none");
    expect(await cutIn.evaluate(node => {
      const parent = node.getBoundingClientRect(), text = node.querySelector(".burst-copy")!.getBoundingClientRect();
      return text.left >= parent.left && text.right <= parent.right && text.bottom <= parent.bottom;
    }), burst.name).toBe(true);
    await gallery.getByRole("button", { name: `${burst.name} 입력 확인`, exact: true }).click();
    await expect(gallery).toHaveAttribute("data-clicked", burst.characterId);
  }
  await gallery.getByRole("button").evaluateAll(nodes => nodes.forEach(n => { (n as HTMLElement).style.opacity = "0"; }));
  await gallery.screenshot({ path: testInfo.outputPath("eight-ultimate-signatures.png") });
  await gallery.locator(".battle-field").evaluateAll(nodes => nodes.forEach(n => n.setAttribute("data-motion", "true")));
  const animations = await signatures.locator(".burst-core").evaluateAll(nodes => nodes.map(n => getComputedStyle(n).animationName));
  expect(new Set(animations).size).toBe(8); expect(animations).not.toContain("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const core of await signatures.locator(".burst-core").all()) await expect(core).toHaveCSS("animation-name", "none");
  await gallery.locator(".battle-field").evaluateAll(nodes => { for (const n of nodes) { n.setAttribute("data-motion", "false"); n.setAttribute("data-effects", "false"); } });
  for (const signature of await signatures.all()) await expect(signature).toBeHidden();
  for (const portrait of await gallery.locator(".burst-portrait").all()) await expect(portrait).toBeHidden();
  for (const name of bursts.map(b => b.skillName)) await expect(gallery.getByText(name, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await page.evaluate(() => (window as any).__burstGallery.unmount());
});
