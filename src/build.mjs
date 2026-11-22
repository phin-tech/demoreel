// Turns a project's demo.json into HyperFrames HTML: one page for the whole film, or one per scene so each can be
// rendered alone and handed to an editor such as Google Vids.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join, basename, extname, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..");
// The stage is laid out at 1920x1080 and drawn at twice that, which is what keeps a 4K frame sharp; `scale: 1` or
// DEMOREEL_SCALE=1 (the CLI's --hd) draws it at 1080p.
const DEFAULT_SCALE = 2;

const THEME = {
  accent: "#e8a53a",
  ink: "#f3efe6",
  muted: "#a9a49a",
  font: '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif',
  background: "radial-gradient(1200px 800px at 25% 10%, #2e2a24 0%, #17161a 55%, #0e0e11 100%)",
};
const GLYPHS = { cmd: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃", enter: "↵", escape: "esc", space: "space", tab: "⇥", backspace: "⌫" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const round = (n) => Math.round(n * 1000) / 1000;
export const cleanNarration = (s = "") => s.replace(/\[[^\]]*\]\s*/g, "").replace(/\s+/g, " ").trim();

function probeSeconds(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const seconds = parseFloat(r.stdout);
  if (r.status !== 0 || !(seconds > 0)) throw new Error(`ffprobe could not read the length of ${file}: ${r.stderr}`);
  return seconds;
}

// The voice sits under the scene's own start, as a sibling of the stage, since HyperFrames wants media outside timed elements.
const audioTag = (s, t0) => s.audio
  ? `      <audio id="a${s.n}" src="${esc(s.audio)}" data-start="${round(t0 + (s.audioOffset ?? 0.3))}" data-duration="${round(s.audioSeconds)}" data-track-index="2"></audio>`
  : "";

export function load(dir) {
  const cfg = JSON.parse(readFileSync(join(dir, "demo.json"), "utf8"));
  cfg.width ??= 1920;
  cfg.height ??= 1080;
  cfg.fps ??= 30;
  cfg.scale = Number(process.env.DEMOREEL_SCALE) || cfg.scale || DEFAULT_SCALE;
  cfg.theme = { ...THEME, ...cfg.theme };
  const takesFile = join(dir, "audio/takes.json");
  const takes = existsSync(takesFile) ? JSON.parse(readFileSync(takesFile, "utf8")) : {};
  let start = 0;
  cfg.scenes = cfg.scenes.map((scene, i) => {
    const n = String(i + 1).padStart(2, "0");
    const s = { ...scene, n, id: `${n}-${scene.id ?? scene.type}` };
    // A scene lasts as long as its narration takes to say (its `audioSeconds` if measured, else `wordsPerMinute`) and a short pause, if that is longer
    // than the scene's own `duration` (a clip's is the clip's length), so the voice is never cut off.
    // A take chosen in Booth (audio/takes.json) is the scene's audio unless the scene names one itself.
    if (!s.audio && takes[s.id] && existsSync(join(dir, "audio", takes[s.id]))) s.audio = `audio/${takes[s.id]}`;
    // A recorded `audio` file is measured, and that is its `audioSeconds`.
    if (s.audio) {
      if (!existsSync(join(dir, s.audio))) throw new Error(`scene ${s.id}: audio file ${s.audio} not found`);
      s.audioSeconds = probeSeconds(join(dir, s.audio));
    }
    const words = cleanNarration(s.narration).split(/\s+/).filter(Boolean).length;
    // A measured `audioSeconds` (how long the voice really takes) beats the estimate, with a shorter pause after.
    s.spoken = s.audioSeconds
      ? Math.ceil((s.audioSeconds + 0.6) * 10) / 10
      : words ? Math.ceil(((words * 60) / (cfg.wordsPerMinute ?? 150) + 0.8) * 10) / 10 : 0;
    if (s.type === "clip") {
      s.events = JSON.parse(readFileSync(join(dir, s.events), "utf8"));
      s.clipSeconds = s.events.frames / (s.events.fps ?? cfg.fps);
      s.duration = Math.max(s.clipSeconds, s.spoken);
    } else {
      s.duration = Math.max(s.duration ?? 5, s.spoken);
    }
    s.start = start;
    start += s.duration;
    return s;
  });
  cfg.total = start;
  return cfg;
}

// An image drawn at `width` css pixels is saved at twice that, so the browser never resamples it.
function image(dir, rel, width, native, scale) {
  if (native) return rel;
  const out = join("build", `${basename(rel, extname(rel))}-${width * scale}.png`);
  const from = join(dir, rel);
  const to = join(dir, out);
  mkdirSync(join(dir, "build"), { recursive: true });
  if (!existsSync(to) || statSync(to).mtimeMs < statSync(from).mtimeMs) {
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", from, "-vf", `scale=${width * scale}:-1:flags=lanczos`, to]);
    if (r.status !== 0) throw new Error(`ffmpeg could not resize ${rel}: ${r.stderr}`);
  }
  return out;
}

// Every effect is a plain `tl.to` after a `gsap.set`, since a `fromTo` draws its first state at once and would
// show a click ring or key cap before its time.
export function textScene(dir, cfg, s, t0, opts = {}) {
  const id = `s${s.n}`;
  const bullets = (s.bullets ?? []).map((b) => `<li><i></i><span>${esc(b)}</span></li>`).join("");
  const cards = (s.cards ?? []).map((c, k) => {
    const src = image(dir, c.image, c.width, Boolean(c.zoom), cfg.scale);
    return `<div class="card" id="${id}c${k}" style="left:${c.x}px;top:${c.y}px;width:${c.width}px"><img src="${src}" /></div>`;
  }).join("");
  const html = `<div id="${id}" class="scene clip" data-start="${round(t0)}" data-duration="${round(s.duration)}" data-track-index="${Number(s.n)}">
  <div class="left">${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ""}<div class="title">${esc(s.title ?? "")}</div><ul class="bullets">${bullets}</ul></div>${cards}</div>`;

  const js = [];
  js.push(`gsap.set("#${id}",{opacity:0});`);
  js.push(`tl.to("#${id}",{opacity:1,duration:.4},${round(t0)});`);
  js.push(`tl.to("#${id}",{opacity:0,duration:.4},${round(t0 + s.duration - 0.4)});`);
  js.push(`gsap.set("#${id} .kicker, #${id} .title",{opacity:0,y:30});`);
  js.push(`tl.to("#${id} .kicker, #${id} .title",{opacity:1,y:0,duration:.6,ease:"power3.out",stagger:.1},${round(t0 + 0.15)});`);
  (s.bullets ?? []).forEach((_, k) => {
    js.push(`gsap.set("#${id} .bullets li:nth-child(${k + 1})",{opacity:0,x:-40});`);
    js.push(`tl.to("#${id} .bullets li:nth-child(${k + 1})",{opacity:1,x:0,duration:.5,ease:"power3.out"},${round(opts.deck ? t0 + 1.5 + k : t0 + 0.9 + k * 0.35)});`);
  });
  (s.cards ?? []).forEach((c, k) => {
    const at = t0 + 0.3 + (c.delay ?? 0);
    // `tilt` (degrees) starts the card turned away in perspective and swings it to face the viewer as it lands,
    // so it rests flat and its text stays sharp.
    const tilt = c.tilt ? `,rotationY:${Number(c.tilt)},transformPerspective:1800,transformOrigin:"${c.tilt > 0 ? "0% 50%" : "100% 50%"}"` : "";
    js.push(`gsap.set("#${id}c${k}",{opacity:0,y:120${tilt}});`);
    js.push(`tl.to("#${id}c${k}",{opacity:1,y:0${c.tilt ? ",rotationY:0" : ""},duration:${c.tilt ? 1.3 : 0.9},ease:"power3.out"},${round(at)});`);
    // A slow drift after it lands, so it floats, ending with the scene.
    js.push(`tl.to("#${id}c${k}",{y:-10,duration:${round(Math.max(0.5, t0 + s.duration - at - 0.9))},ease:"sine.inOut"},${round(at + 0.9)});`);
    if (c.zoom) {
      js.push(`tl.fromTo("#${id}c${k} img",{scale:1,transformOrigin:"${c.zoom.origin ?? "50% 50%"}"},{scale:${c.zoom.to ?? 1.25},duration:${c.zoom.duration ?? 2.4},ease:"power2.inOut",immediateRender:false},${round(t0 + (c.zoom.at ?? 1.8))});`);
    }
  });
  return { html, js: js.join("\n") };
}

// A clip shorter than its narration holds its last frame, which ffmpeg makes by cloning it.
function heldClip(dir, s) {
  if (s.duration <= s.clipSeconds + 0.05) return s.video;
  const out = join("build", `${basename(s.video, extname(s.video))}-held-${Math.round(s.duration * 10)}.mp4`);
  const from = join(dir, s.video);
  const to = join(dir, out);
  mkdirSync(join(dir, "build"), { recursive: true });
  if (!existsSync(to) || statSync(to).mtimeMs < statSync(from).mtimeMs) {
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", from, "-vf", `tpad=stop_mode=clone:stop_duration=${round(s.duration - s.clipSeconds)}`, "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", to]);
    if (r.status !== 0) throw new Error(`ffmpeg could not hold the last frame of ${s.video}: ${r.stderr}`);
  }
  return out;
}

export function clipScene(dir, cfg, s, t0) {
  const id = `s${s.n}`;
  const win = s.window ?? { w: 1280, h: 801 };
  const card = { x: 180, y: 70, width: 1560, ...s.card };
  const k = card.width / win.w;
  const height = round(win.h * k);
  const fps = s.events.fps ?? cfg.fps;
  const at = (p) => ({ x: round(card.x + p.x * k), y: round(card.y + p.y * k) });
  const GLIDE = 14 / fps;
  const start = at({ x: (s.pointer?.x ?? 0.55) * win.w, y: (s.pointer?.y ?? 0.6) * win.h });

  let rings = "";
  let keys = "";
  const js = [];
  js.push(`gsap.set("#${id}, #${id}v",{opacity:0});`);
  js.push(`tl.to("#${id}, #${id}v",{opacity:1,duration:.4},${round(t0)});`);
  js.push(`tl.to("#${id}, #${id}v",{opacity:0,duration:.4},${round(t0 + s.duration - 0.4)});`);
  js.push(`gsap.set("#${id}cursor",{x:${start.x},y:${start.y}});`);
  s.events.events.forEach((e, i) => {
    const t = t0 + e.frame / fps;
    if (e.x !== undefined) {
      const to = at(e);
      js.push(`tl.to("#${id}cursor",{x:${to.x},y:${to.y},duration:${round(GLIDE)},ease:"power2.inOut"},${round(Math.max(t0, t - GLIDE))});`);
    }
    if (e.kind === "click") {
      const to = at(e);
      rings += `<div class="ring" id="${id}r${i}"></div>`;
      js.push(`gsap.set("#${id}r${i}",{x:${to.x},y:${to.y},scale:.17,opacity:0});`);
      js.push(`tl.to("#${id}cursor",{scale:.86,duration:.08},${round(t)});tl.to("#${id}cursor",{scale:1,duration:.1},${round(t + 0.1)});`);
      js.push(`tl.to("#${id}r${i}",{opacity:1,duration:.01},${round(t)});tl.to("#${id}r${i}",{scale:1,opacity:0,duration:.66,ease:"power2.out"},${round(t + 0.01)});`);
    }
    if (e.kind === "key") {
      const caps = e.key.split("-").map((p) => `<div class="cap">${esc(GLYPHS[p] ?? p.toUpperCase())}</div>`).join("");
      keys += `<div class="keyset" id="${id}k${i}">${caps}</div>`;
      js.push(`gsap.set("#${id}k${i}",{opacity:0,y:14});`);
      js.push(`tl.to("#${id}k${i}",{opacity:1,y:0,duration:.2,ease:"power2.out"},${round(t)});tl.to("#${id}k${i}",{opacity:0,duration:.27},${round(t + 0.93)});`);
    }
  });

  // The video is not inside the timed scene div, which would leave the renderer unable to find it, and has an id.
  const html = `<video id="${id}v" class="clip clipvideo" src="${heldClip(dir, s)}" muted playsinline style="left:${card.x}px;top:${card.y}px;width:${card.width}px;height:${height}px" data-start="${round(t0)}" data-duration="${round(s.duration)}" data-track-index="${Number(s.n) + 100}"></video>
<div id="${id}" class="scene clip" data-start="${round(t0)}" data-duration="${round(s.duration)}" data-track-index="${Number(s.n)}">
  ${rings}<div class="cursor" id="${id}cursor"><svg width="34" height="40" viewBox="0 0 17 20"><path d="M1 1 L1 15.5 L5 12 L7.8 18.2 L10.2 17.1 L7.5 11 L13 11 Z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg></div>
  <div class="keys">${keys}</div></div>`;
  return { html, js: js.join("\n") };
}

// The look of a scene, shared by the film's page and the deck's slides.
export const rules = (cfg) => {
  const t = cfg.theme;
  return `      .left { position: absolute; left: 110px; top: 0; bottom: 0; width: 700px; display: flex; flex-direction: column; justify-content: center; }
      .kicker { color: var(--accent); font-size: 26px; letter-spacing: 4px; text-transform: uppercase; font-weight: 600; }
      .title { color: var(--ink); font-size: 66px; font-weight: 700; line-height: 1.06; margin-top: 14px; letter-spacing: -1.5px; text-wrap: balance; }
      .bullets { list-style: none; margin-top: 44px; }
      .bullets li { display: flex; align-items: center; gap: 20px; margin-bottom: 22px; }
      .bullets i { width: 14px; height: 14px; border-radius: 7px; background: var(--accent); flex: none; }
      .bullets span { color: var(--ink); font-size: 36px; font-weight: 500; }
      .card { position: absolute; border-radius: 18px; overflow: hidden; box-shadow: 0 40px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); }
      .card img, .card video { width: 100%; display: block; }
      .clipvideo { position: absolute; object-fit: cover; border-radius: 18px; box-shadow: 0 40px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); }
      .cursor { position: absolute; left: 0; top: 0; transform-origin: 0 0; filter: drop-shadow(0 4px 6px rgba(0,0,0,.5)); }
      .ring { position: absolute; left: 0; top: 0; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%;
        border: 4px solid var(--accent); background: rgba(232,165,58,.18); }
      .keys { position: absolute; left: 0; right: 0; bottom: 36px; display: flex; justify-content: center; }
      .keyset { position: absolute; display: flex; gap: 10px; }
      .cap { min-width: 64px; padding: 10px 20px; border-radius: 14px; text-align: center; font-size: 38px; font-weight: 600; color: var(--ink);
        background: rgba(40,38,44,.92); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 8px 24px rgba(0,0,0,.5), inset 0 -3px 0 rgba(0,0,0,.35); }
`;
};

function page(cfg, parts, total, audio = "") {
  const t = cfg.theme;
  const W = cfg.width * cfg.scale;
  const H = cfg.height * cfg.scale;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="build/gsap.min.js"></script>
    <style>
      :root { --ink: ${t.ink}; --accent: ${t.accent}; --muted: ${t.muted}; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0e0e11; }
      #stage { position: absolute; left: 0; top: 0; width: ${cfg.width}px; height: ${cfg.height}px; transform: scale(${cfg.scale});
        transform-origin: 0 0; font-family: ${t.font}; background: ${t.background}; overflow: hidden; }
      #stage .scene.clip { position: absolute; left: 0; top: 0; right: auto; bottom: auto; width: ${cfg.width}px; height: ${cfg.height}px; }
${rules(cfg)}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${round(total)}" data-width="${W}" data-height="${H}" data-fps="${cfg.fps}">
      <div id="stage">
${parts.map((p) => p.html).join("\n")}
      </div>
${audio}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
${parts.map((p) => p.js).join("\n")}
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

export const removeScenePages = (dir, cfg) => cfg.scenes.forEach((s) => rmSync(join(dir, `scene-${s.n}.html`), { force: true }));

const make = (dir, cfg, s, t0) => (s.type === "clip" ? clipScene(dir, cfg, s, t0) : textScene(dir, cfg, s, t0));

/** Writes index.html (the whole film), and with `scenes` a scene-NN.html for each, and returns the config.
 *  HyperFrames wants one root page per project, so the scene pages exist only while they are rendered. */
export function build(dir, { scenes = false } = {}) {
  const cfg = load(dir);
  mkdirSync(join(dir, "build"), { recursive: true });
  copyFileSync(join(TOOL, "node_modules/hyperframes/dist/vendor/npm/gsap@3.15.0/dist/gsap.min.js"), join(dir, "build/gsap.min.js"));
  writeFileSync(join(dir, "index.html"), page(cfg, cfg.scenes.map((s) => make(dir, cfg, s, s.start)), cfg.total, cfg.scenes.map((s) => audioTag(s, s.start)).filter(Boolean).join("\n")));
  if (!scenes) removeScenePages(dir, cfg);
  if (scenes) {
    for (const s of cfg.scenes) writeFileSync(join(dir, `scene-${s.n}.html`), page(cfg, [make(dir, cfg, s, 0)], s.duration, audioTag(s, 0)));
  }
  return cfg;
}

const timecode = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor(ms / 60000) % 60, 2)}:${p(Math.floor(ms / 1000) % 60, 2)},${p(ms % 1000, 3)}`;
};

// What happens on screen and when, in seconds from the start of the scene, for a narrator to talk to (Booth shows them).
// The bullet and card times are the ones textScene animates with.
export function cues(s) {
  const out = [];
  if (s.type === "clip") {
    const fps = s.events.fps ?? 30;
    for (const e of s.events.events) {
      const label = e.kind === "key" ? `key ${e.key}` : e.kind;
      out.push({ t: round(e.frame / fps), label });
    }
  } else {
    if (s.title) out.push({ t: 0.15, label: "title" });
    (s.bullets ?? []).forEach((b, k) => out.push({ t: round(0.9 + k * 0.35), label: `bullet: ${b}` }));
    (s.cards ?? []).forEach((c, k) => {
      const at = 0.3 + (c.delay ?? 0);
      out.push({ t: round(at), label: `screenshot ${k + 1} lands` });
      if (c.zoom) out.push({ t: round(c.zoom.at ?? 1.8), label: `zoom in on screenshot ${k + 1}` });
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** The storyboard, the manifest and approximate captions: what an editor needs besides the scene files. */
export function writeStoryboard(dir, cfg, outDir) {
  mkdirSync(outDir, { recursive: true });
  const rows = cfg.scenes.map((s) => ({
    id: s.id, file: `scenes/${s.id}.mp4`, start: round(s.start), duration: round(s.duration), type: s.type,
    onScreen: [s.kicker, s.title, ...(s.bullets ?? [])].filter(Boolean),
    narration: s.narration ?? "", narrationClean: cleanNarration(s.narration), cues: cues(s),
  }));
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ fps: cfg.fps, total: round(cfg.total), scenes: rows }, null, 2) + "\n");
  const md = [`# ${cfg.title ?? "Demo"}: storyboard`, "", `Total ${round(cfg.total)}s. One mp4 per scene in \`scenes/\`; narration below is the text to voice (tags are for the voice engine; captions have them stripped).`, ""];
  for (const r of rows) {
    md.push(`## ${r.id} (${r.start}s–${round(r.start + r.duration)}s)`, "", `File: \`${r.file}\``);
    if (r.onScreen.length) md.push("", "On screen:", ...r.onScreen.map((x) => `- ${x}`));
    md.push("", r.narration ? `Narration: ${r.narration}` : "Narration: (none yet)", "");
  }
  writeFileSync(join(outDir, "storyboard.md"), md.join("\n"));
  writeFileSync(join(outDir, "captions.srt"), captions(rows, true));
}

// Without audio the sentence timing is only an even split of each scene, so captions are a starting point. With
// `whole` the times run across the film; without, from the start of the one scene.
function captions(rows, whole) {
  let n = 1;
  const srt = [];
  for (const r of rows) {
    const base = whole ? r.start : 0;
    const sentences = r.narrationClean.split(/(?<=[.!?])\s+/).filter(Boolean);
    const span = Math.max(0.5, r.duration - 0.6);
    sentences.forEach((text, i) => {
      const a = base + 0.3 + (span * i) / sentences.length;
      const b = base + 0.3 + (span * (i + 1)) / sentences.length;
      srt.push(`${n++}\n${timecode(a)} --> ${timecode(b)}\n${text}\n`);
    });
  }
  return srt.join("\n");
}

/** out/vids/scene-NN-id/: each scene's video, narration and captions together, to drag into an editor. */
export function writeVids(cfg, outDir) {
  const vids = join(outDir, "vids");
  rmSync(vids, { recursive: true, force: true });
  const index = [];
  for (const s of cfg.scenes) {
    const folder = join(vids, `scene-${s.id}`);
    mkdirSync(folder, { recursive: true });
    copyFileSync(join(outDir, "scenes", `${s.id}.mp4`), join(folder, `${s.id}.mp4`));
    if (s.audio) copyFileSync(join(dirname(outDir), s.audio), join(folder, `voice${extname(s.audio)}`));
    const row = { narrationClean: cleanNarration(s.narration), duration: s.duration };
    writeFileSync(join(folder, "narration.txt"), (row.narrationClean || "(no narration yet)") + "\n");
    if (s.narration) writeFileSync(join(folder, "narration-with-tags.txt"), s.narration + "\n");
    if (row.narrationClean) writeFileSync(join(folder, "captions.srt"), captions([row], false));
    index.push(`scene-${s.id}/  ${round(s.duration)}s`);
  }
  writeFileSync(join(vids, "HOW-TO.txt"), [
    `${cfg.title ?? "Demo"}: scenes for an editor`,
    "",
    "One folder per scene, in order:",
    ...index.map((l) => `  ${l}`),
    "",
    "In Google Vids: make a new video, upload or drag in each scene's .mp4 in order, and paste that scene's",
    "narration.txt into its voice-over. narration-with-tags.txt keeps the audio tags for a voice engine that reads them.",
    "captions.srt times are an even split of the scene, so retime them against real audio.",
    "",
  ].join("\n"));
}
