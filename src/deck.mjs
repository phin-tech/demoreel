// Turns a project's demo.json into a HyperFrames slideshow in <project>/deck/, to click through with `demoreel present`.
// Every scene is a slide in its own file (the player only lists slides that are mounted from separate files), bullets come
// in one per press, a card with `link` is a hotspot into a scene marked `branch`, and the narration is the speaker notes.
import { writeFileSync, mkdirSync, rmSync, cpSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { round } from "./util.mjs";
import { build, textScene, clipScene, rules, cleanNarration, themeVars } from "./build.mjs";
import { GSAP } from "./hyperframes.mjs";

function imageSize(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  const [w, h] = r.stdout.trim().split(",").map(Number);
  return w > 0 && h > 0 ? { w, h } : null;
}

// A bullets slide waits for each bullet to be asked for, a clip slide plays its clip.
const slideLength = (s) => (s.type === "clip" ? s.duration : Math.max(6, 1.5 + (s.bullets?.length ?? 0) + 1.5));

function slideFile(dir, cfg, s, id, length) {
  const t = cfg.theme;
  const scene = { ...s, duration: length };
  const { html, js } = s.type === "clip" ? clipScene(dir, cfg, scene, 0) : textScene(dir, cfg, scene, 0, { deck: true });
  return `<template>
  <style>
    #${id} { position: absolute; inset: 0; ${themeVars(t)} font-family: var(--font); background: var(--background); overflow: hidden; }
    #${id} .scene.clip { position: absolute; inset: 0; }
${rules}
  </style>
  <div id="${id}" data-composition-id="${id}" data-width="${cfg.width}" data-height="${cfg.height}">
${html}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
${js}
    tl.to({}, { duration: ${round(length)} }, 0);
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
}

export function buildDeck(dir) {
  const cfg = build(dir);
  const out = join(dir, "deck");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "compositions"), { recursive: true });
  // The slides' own images, resized clips and the animation library, which `build` put in build/.
  cpSync(join(dir, "build"), join(out, "build"), { recursive: true });
  // A card that zooms, or a clip that needs no hold, is shown from its own file rather than a resized copy.
  for (const s of cfg.scenes) {
    for (const rel of [s.video, ...(s.cards ?? []).map((c) => c.image)].filter(Boolean)) {
      mkdirSync(dirname(join(out, rel)), { recursive: true });
      copyFileSync(join(dir, rel), join(out, rel));
    }
  }
  copyFileSync(GSAP, join(out, "gsap.min.js"));

  const id = (s) => `d${s.n}`;
  const main = cfg.scenes.filter((s) => !s.branch);
  const branches = cfg.scenes.filter((s) => s.branch);
  const order = [...main, ...branches];

  let at = 0;
  const hosts = [];
  const slides = [];
  const starts = new Map();
  for (const s of order) {
    const length = slideLength(s);
    starts.set(s.id, at);
    mkdirSync(join(out, "compositions"), { recursive: true });
    writeFileSync(join(out, "compositions", `${id(s)}.html`), slideFile(dir, cfg, s, id(s), length));
    hosts.push(`    <div id="${id(s)}" data-composition-id="${id(s)}" data-composition-src="compositions/${id(s)}.html" data-label="${(s.title ?? s.id).replace(/"/g, "&quot;")}" data-start="${round(at)}" data-duration="${round(length)}" data-track-index="1" data-width="${cfg.width}" data-height="${cfg.height}"></div>`);
    s.deckStart = at;
    s.deckLength = length;
    at += length;
  }

  // A card with `link: "<scene id>"` is a hotspot over where it sits, which jumps to that branch scene.
  const targetOf = (name) => branches.find((b) => b.id === name || b.id.endsWith(`-${name}`));
  const entry = (s) => {
    const row = { sceneId: id(s) };
    const notes = cleanNarration(s.narration);
    if (notes) row.notes = notes;
    if (s.type !== "clip" && s.bullets?.length) row.fragments = s.bullets.map((_, k) => round(s.deckStart + 1.5 + k));
    const spots = (s.cards ?? []).filter((c) => c.link).map((c, k) => {
      const target = targetOf(c.link);
      if (!target) throw new Error(`scene ${s.id}: a card links to "${c.link}", which is not a scene marked "branch": true`);
      const dim = imageSize(join(dir, c.image));
      const w = (c.width / cfg.width) * 100;
      const h = dim ? ((c.width * dim.h) / dim.w / cfg.height) * 100 : w * 0.6;
      return { id: `${id(s)}h${k}`, label: c.linkLabel ?? target.title ?? target.id, target: id(target), region: { x: round((c.x / cfg.width) * 100), y: round((c.y / cfg.height) * 100), w: round(w), h: round(h) } };
    });
    if (spots.length) row.hotspots = spots;
    return row;
  };
  const island = {
    slides: main.map(entry),
    slideSequences: branches.map((b) => ({ id: id(b), label: b.title ?? b.id, slides: [{ sceneId: id(b) }] })),
  };

  writeFileSync(join(out, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=${cfg.width}, height=${cfg.height}"/>
<script src="gsap.min.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box} html,body{width:${cfg.width}px;height:${cfg.height}px;overflow:hidden;background:#0e0e11}</style></head><body>
<script type="application/hyperframes-slideshow+json">
${JSON.stringify(island, null, 1)}
</script>
<div id="main" data-composition-id="main" data-start="0" data-duration="${round(at)}" data-width="${cfg.width}" data-height="${cfg.height}">
${hosts.join("\n")}
</div>
<script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>
`);
  return { out, slides: main.length, branches: branches.length };
}
