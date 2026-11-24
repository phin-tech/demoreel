#!/usr/bin/env node
// demoreel build|lint|check|snapshot|render|export|timeline|deck|present|record|login [project]
import { join, resolve } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hyperframes } from "../src/hyperframes.mjs";
import { addChapters, youtubeChapters } from "../src/chapters.mjs";
import { watch } from "../src/watch.mjs";
import { fileURLToPath } from "node:url";
import { buildDeck } from "../src/deck.mjs";
import { writeTimeline } from "../src/timeline.mjs";
import { loginScenes, recordScenes } from "../src/record.mjs";
import { writeReview } from "../src/review.mjs";
import { addCaptions, build, removeScenePages, resolutionArgs, writeStoryboard, writeVids } from "../src/build.mjs";

const [command, ...rest] = process.argv.slice(2);
if (process.argv.includes("--hd")) process.env.DEMOREEL_SCALE = "1";
// Options that take a value; that value is not the project folder.
const WITH_VALUE = new Set(["--scene", "--at", "--variables"]);
const option = (name) => rest.find((a, i) => rest[i - 1] === name);
const dir = resolve(rest.find((a, i) => !a.startsWith("-") && !WITH_VALUE.has(rest[i - 1])) ?? ".");
// A quick, rough render to look at; the default quality is the one to deliver.
const quality = rest.includes("--draft") ? ["--quality", "draft"] : [];
// Theme values for this render only, over demo.json's: --variables '{"accent":"#3a7be8"}'.
const variables = option("--variables") ? ["--variables", option("--variables"), "--strict-variables"] : [];

const usage = `demoreel <command> [project-folder]

  build    write index.html and scene-NN.html from demo.json (and resized images in build/)
  lint     build, then HyperFrames' own checks of the page (quick, no browser)
  check    build, then lint and play the film in a browser: layout, contrast, motion and audio problems
  snapshot build, then save stills to out/snapshots/ without rendering: a frame from each scene, or the
           seconds given with --at 2,7.5
  review   build, then out/review.md (for each scene: words its voice didn't say as written, and long stretches with
           nothing said) and two stills a scene in out/snapshots/
  render   build, then render the whole film to out/<name>.mp4
  record   run each clip scene's \`record\` block: launch the app hidden, run its script through the driver, and write
           the scene's video and events (needs the app and typecase-drive; see docs/adr/0001-*.md)
  login    sign in once for a web scene whose \`record\` has a \`session\`: opens Chrome on the page, waits for you to sign
           in and press Enter here, and saves the cookies for \`record\` to use (the file is private and gitignored)
  timeline write out/timeline/: an FCPXML for DaVinci Resolve or Final Cut (scenes silent on one track, each voice on
           an audio track under it), after \`export\`
  deck     write deck/ from demo.json: a slideshow of the same scenes (bullets come in one per press, a card's \`link\`
           jumps to a scene marked \`branch\`, the narration is the speaker notes)
  present  build the deck and serve it on localhost to click through (stays running; Ctrl+C stops)
  export   render the film to out/<name>.mp4 with a chapter at each scene, out/chapters.txt (the same, for a YouTube
           description), and storyboard.md, manifest.json and captions.srt in out/
           --scenes renders every scene alone instead, with a folder each in out/vids/ (video, narration, captions)
           to drag into an editor such as Google Vids
  watch    export now, then again whenever demo.json, a take chosen in Booth, or a file a scene uses changes (stays
           running; Ctrl+C stops). Exports at draft quality unless --full; passes on --hd and --scenes

Add --hd to draw at 1080p instead of 4K: smaller files, quicker to upload.
Add --draft to render or export at draft quality, much faster, to look over before the real render.
Add --variables '{"accent":"#3a7be8"}' to render or export with theme values other than demo.json's.

The project folder holds demo.json and the files it names. See README.md.`;

function hf(args) {
  const r = hyperframes(args, { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!["build", "lint", "check", "snapshot", "review", "render", "export", "watch", "timeline", "record", "login", "deck", "present"].includes(command)) {
  console.log(usage);
  process.exit(command ? 1 : 0);
}

if (command === "deck" || command === "present") {
  const r = buildDeck(dir);
  // HyperFrames checks the slideshow block against its own format, which its docs don't spell out, so a release that
  // changes the format stops here rather than in front of an audience.
  const lint = hyperframes(["lint", "deck", "--json"], { cwd: dir, encoding: "utf8" });
  let found;
  try {
    found = JSON.parse(lint.stdout);
  } catch {
    console.error(`could not check the deck: ${lint.stderr || lint.stdout}`);
    process.exit(1);
  }
  if (found.errorCount > 0) {
    for (const f of found.findings.filter((f) => f.severity === "error")) console.error(`deck: ${f.code}: ${f.message}`);
    process.exit(1);
  }
  console.log(`wrote ${r.out}: ${r.slides} slides, ${r.branches} branch`);
  if (command === "present") {
    const p = hyperframes(["present", "deck", "--no-open"], { cwd: dir, stdio: "inherit" });
    process.exit(p.status ?? 0);
  }
  process.exit(0);
}

if (command === "watch") {
  const flags = [...(rest.includes("--full") ? [] : ["--draft"]), ...["--hd", "--scenes"].filter((f) => rest.includes(f))];
  try {
    watch(dir, flags, fileURLToPath(import.meta.url));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  // It runs until stopped; nothing after this is for it.
  await new Promise(() => {});
} else if (command === "record") {
  try {
    await recordScenes(dir, option("--scene"));
  } catch (e) {
    console.error(`record failed: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (command === "login") {
  try {
    const { createInterface } = await import("node:readline/promises");
    await loginScenes(dir, option("--scene"), async (scene) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      await rl.question(`Sign in to ${scene.record.url} in the Chrome window, then press Enter here to save the session. `);
      rl.close();
    });
  } catch (e) {
    console.error(`login failed: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (command === "timeline") {
  const cfg = build(dir);
  try {
    const r = writeTimeline(dir, cfg, join(dir, "out"));
    console.log(`wrote ${r.dir}: ${r.scenes} scenes, ${r.seconds.toFixed(1)}s`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  process.exit(0);
}

// `export` makes one file unless --scenes asks for one per scene.
const perScene = command === "export" && rest.includes("--scenes");
const cfg = build(dir, { scenes: perScene });
console.log(`built ${cfg.scenes.length} scenes, ${cfg.total}s`);
const name = (cfg.name ?? "demo").replace(/[^\w.-]+/g, "-");
// Only a render needs a size HyperFrames can draw; building and checking work at any.
let size = [];
if (command === "render" || command === "export") {
  try {
    size = resolutionArgs(cfg);
  } catch (e) {
    if (command === "export") removeScenePages(dir, cfg);
    console.error(e.message);
    process.exit(1);
  }
}
if (command === "lint") hf(["lint", "."]);
if (command === "check") hf(["check", "."]);
if (command === "snapshot") {
  const at = option("--at");
  // Without times, a still from the middle of each scene.
  const times = at ?? cfg.scenes.map((s) => Math.round((s.start + s.duration / 2) * 100) / 100).join(",");
  hf(["snapshot", ".", "--at", times, "--no-end", "-o", "out/snapshots"]);
}
if (command === "review") {
  mkdirSync(join(dir, "out"), { recursive: true });
  const flagged = writeReview(dir, cfg);
  const times = cfg.scenes.flatMap((s) => [s.start + 0.4 * s.duration, s.start + 0.85 * s.duration]).map((t) => Math.round(t * 100) / 100).join(",");
  hf(["snapshot", ".", "--at", times, "--no-end", "-o", "out/snapshots"]);
  console.log(`wrote out/review.md (${flagged} thing${flagged === 1 ? "" : "s"} to look at) and two stills a scene in out/snapshots/`);
}
if (command === "render") {
  mkdirSync(join(dir, "out"), { recursive: true });
  hf(["render", ...size, ...quality, ...variables, "-o", `out/${name}.mp4`]);
}
if (command === "export") {
  const out = join(dir, "out");
  mkdirSync(out, { recursive: true });
  // The other kind of export's files would be out of date, and Booth and `timeline` would find them.
  if (perScene) {
    mkdirSync(join(out, "scenes"), { recursive: true });
    rmSync(join(out, "chapters.txt"), { force: true });
    try {
      for (const s of cfg.scenes) hf(["render", "-c", `./scene-${s.n}.html`, ...size, ...quality, ...variables, "-o", `out/scenes/${s.id}.mp4`]);
    } finally {
      removeScenePages(dir, cfg);
    }
  } else {
    rmSync(join(out, "scenes"), { recursive: true, force: true });
    rmSync(join(out, "vids"), { recursive: true, force: true });
    hf(["render", ...size, ...quality, ...variables, "-o", `out/${name}.mp4`]);
    try {
      addChapters(join(out, `${name}.mp4`), cfg, join(dir, "build"));
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    writeFileSync(join(out, "chapters.txt"), youtubeChapters(cfg));
  }
  // Captions for each scene that has recorded audio, timed from what was said (already there if they were burned in).
  addCaptions(dir, cfg);
  writeStoryboard(dir, cfg, out, perScene ? {} : { film: `${name}.mp4` });
  if (perScene) {
    writeVids(cfg, out);
    console.log("wrote out/vids/scene-*/ (video, narration, captions), out/storyboard.md, out/manifest.json, out/captions.srt and .vtt");
  } else {
    console.log(`wrote out/${name}.mp4 (a chapter at each scene), out/chapters.txt, out/storyboard.md, out/manifest.json, out/captions.srt and .vtt`);
  }
}
