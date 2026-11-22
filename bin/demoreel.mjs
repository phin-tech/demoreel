#!/usr/bin/env node
// demoreel build|lint|render|export [project]
import { join, resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build, removeScenePages, writeStoryboard } from "../src/build.mjs";

const tool = join(dirname(fileURLToPath(import.meta.url)), "..");
const hyperframes = join(tool, "node_modules/.bin/hyperframes");
const [command, ...rest] = process.argv.slice(2);
const dir = resolve(rest.find((a) => !a.startsWith("-")) ?? ".");

const usage = `demoreel <command> [project-folder]

  build    write index.html and scene-NN.html from demo.json (and resized images in build/)
  lint     build, then HyperFrames' own checks
  render   build, then render the whole film to out/<name>.mp4
  export   render every scene alone to out/scenes/, with storyboard.md, manifest.json and captions.srt,
           for an editor such as Google Vids

The project folder holds demo.json and the files it names. See README.md.`;

function hf(args) {
  const r = spawnSync(hyperframes, args, { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!["build", "lint", "render", "export"].includes(command)) {
  console.log(usage);
  process.exit(command ? 1 : 0);
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
  writeStoryboard(dir, cfg, join(dir, "out"));
  console.log("wrote out/scenes/*.mp4, out/storyboard.md, out/manifest.json, out/captions.srt");
}
