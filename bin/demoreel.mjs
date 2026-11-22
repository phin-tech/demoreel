#!/usr/bin/env node
// demoreel build|lint|render|export|deck|present [project]
import { join, resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDeck } from "../src/deck.mjs";
import { transcribe, align, cues as captionCues } from "../src/captions.mjs";
import { build, removeScenePages, writeStoryboard, writeVids } from "../src/build.mjs";

const tool = join(dirname(fileURLToPath(import.meta.url)), "..");
const hyperframes = join(tool, "node_modules/.bin/hyperframes");
const [command, ...rest] = process.argv.slice(2);
if (process.argv.includes("--hd")) process.env.DEMOREEL_SCALE = "1";
const dir = resolve(rest.find((a) => !a.startsWith("-")) ?? ".");

const usage = `demoreel <command> [project-folder]

  build    write index.html and scene-NN.html from demo.json (and resized images in build/)
  lint     build, then HyperFrames' own checks
  render   build, then render the whole film to out/<name>.mp4
  deck     write deck/ from demo.json: a slideshow of the same scenes (bullets come in one per press, a card's \`link\`
           jumps to a scene marked \`branch\`, the narration is the speaker notes)
  present  build the deck and serve it on localhost to click through (stays running; Ctrl+C stops)
  export   render every scene alone, with a folder each in out/vids/ (video, narration, captions) to drag into an
           editor such as Google Vids, and storyboard.md, manifest.json and captions.srt in out/

Add --hd to draw at 1080p instead of 4K: smaller files, quicker to upload.

The project folder holds demo.json and the files it names. See README.md.`;

function hf(args) {
  const r = spawnSync(hyperframes, args, { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!["build", "lint", "render", "export", "deck", "present"].includes(command)) {
  console.log(usage);
  process.exit(command ? 1 : 0);
}

if (command === "deck" || command === "present") {
  const r = buildDeck(dir);
  console.log(`wrote ${r.out}: ${r.slides} slides, ${r.branches} branch`);
  if (command === "present") {
    const p = spawnSync(hyperframes, ["present", "deck", "--no-open"], { cwd: dir, stdio: "inherit" });
    process.exit(p.status ?? 0);
  }
  process.exit(0);
}

const cfg = build(dir, { scenes: command === "export" });
console.log(`built ${cfg.scenes.length} scenes, ${cfg.total}s`);
const name = (cfg.name ?? "demo").replace(/[^\w.-]+/g, "-");
if (command === "lint") hf(["lint", "."]);
if (command === "render") {
  mkdirSync(join(dir, "out"), { recursive: true });
  hf(["render", "-o", `out/${name}.mp4`]);
}
if (command === "export") {
  mkdirSync(join(dir, "out/scenes"), { recursive: true });
  try {
    for (const s of cfg.scenes) hf(["render", "-c", `./scene-${s.n}.html`, "-o", `out/scenes/${s.id}.mp4`]);
  } finally {
    removeScenePages(dir, cfg);
  }
  // Captions for each scene that has recorded audio, timed from what was said.
  for (const s of cfg.scenes) {
    if (!s.audio || !s.narration) continue;
    try {
      s.captions = captionCues(align(s.narration, transcribe(dir, hyperframes, s)));
    } catch (e) {
      console.warn(`scene ${s.id}: no captions: ${e.message}`);
    }
  }
  writeStoryboard(dir, cfg, join(dir, "out"));
  writeVids(cfg, join(dir, "out"));
  console.log("wrote out/vids/scene-*/ (video, narration, captions), out/storyboard.md, out/manifest.json, out/captions.srt");
}
