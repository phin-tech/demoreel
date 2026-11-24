// Turns a project's demo.json into HyperFrames HTML: one page for the whole film, or one per scene so each can be
// rendered alone and handed to an editor such as Google Vids.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join, basename, extname, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { esc, round } from "./util.mjs";
import { diagramImage, hubBlock, hubVariables } from "./diagram.mjs";
import { createHash } from "node:crypto";
import { GSAP } from "./hyperframes.mjs";
import { scriptNarration } from "./script.mjs";

// The page is laid out at 1920x1080 and HyperFrames draws it at twice that (Chrome's device scale, not a CSS zoom), so a
// 4K frame is sharp; `scale: 1` or DEMOREEL_SCALE=1 (the CLI's --hd) draws it at 1080p.
const DEFAULT_SCALE = 2;
// The voice starts this many seconds into its scene, so the picture is there before the first word.
const DEFAULT_AUDIO_OFFSET = 0.3;
// Letters typed by a driver arrive as a key event each, a couple of frames apart; presses of a key are further apart.
// Keys this close together, two or more of them, are shown as one piece of typing.
const TYPING_GAP_FRAMES = 3;

// The look of a film. `theme` in demo.json changes any of these for the whole film, and a scene's own `theme` for that
// scene. Each is a HyperFrames variable too, so `hyperframes render --variables '{"accent":"#3a7be8"}'` re-themes a
// built film without touching demo.json.
export const THEME = {
  accent: "#e8a53a",
  ink: "#f3efe6",
  muted: "#a9a49a",
  surface: "rgba(40,38,44,.92)",
  font: '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif',
  background: "radial-gradient(1200px 800px at 25% 10%, #2e2a24 0%, #17161a 55%, #0e0e11 100%)",
};
const THEME_TYPES = { accent: "color", ink: "color", muted: "color", surface: "string", font: "string", background: "string" };
const THEME_LABELS = { accent: "Accent", ink: "Text", muted: "Muted text", surface: "Key cap", font: "Font", background: "Background" };

/** The theme as CSS custom properties, `--accent: …; --ink: …`, for a style attribute or a rule. */
export const themeVars = (t) => Object.keys(THEME).filter((k) => t[k] !== undefined).map((k) => `--${k}: ${t[k]};`).join(" ");

// HyperFrames' variable declarations for the theme: it sets each as the CSS property of the same name.
const themeDeclarations = (t) => Object.keys(THEME).map((id) => ({ id, type: THEME_TYPES[id], label: THEME_LABELS[id], default: t[id] }));

/** Output sizes HyperFrames renders at by preset, since its `--resolution` takes only these names. */
const RESOLUTIONS = {
  "1920x1080": "landscape", "1080x1920": "portrait", "1080x1080": "square",
  "3840x2160": "landscape-4k", "2160x3840": "portrait-4k", "2160x2160": "square-4k",
  "2560x1440": "landscape-1440p", "1440x2560": "portrait-1440p", "1440x1440": "square-1440p",
};

/** The `hyperframes render` flags that draw the film at its `scale`: none at 1, else the preset for the output size. */
export function resolutionArgs(cfg) {
  if (cfg.scale === 1) return [];
  const size = `${cfg.width * cfg.scale}x${cfg.height * cfg.scale}`;
  const preset = RESOLUTIONS[size];
  if (!preset) {
    throw new Error(`HyperFrames can't draw a ${cfg.width}x${cfg.height} film at scale ${cfg.scale} (${size}); its sizes are ${Object.keys(RESOLUTIONS).join(", ")}. Change "scale" or the size, or use --hd.`);
  }
  return ["--resolution", preset];
}
const GLYPHS = { cmd: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃", enter: "↵", escape: "esc", space: "space", tab: "⇥", backspace: "⌫" };

export const cleanNarration = (s = "") => s.replace(/\[[^\]]*\]\s*/g, "").replace(/\s+/g, " ").trim();

/** Text split after each full stop, question mark or exclamation mark that ends a word (not the dot in "v1.2"). */
export function sentences(text = "") {
  const chars = [...cleanNarration(text)];
  const out = [];
  let cur = "";
  chars.forEach((c, i) => {
    cur += c;
    if (/[.?!]/.test(c) && (i + 1 === chars.length || chars[i + 1] === " ")) {
      out.push(cur.trim());
      cur = "";
    }
  });
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * The chunks of a narration: the pieces it is recorded, retaken and timed in. A line break ends a chunk, so a person says
 * where they fall, and a chunk can be several sentences. A narration with no line break has a chunk for each sentence.
 * [Audio tags] are stripped, as for the captions. Booth splits the same way: the rule and its cases are in spec/.
 */
export function chunks(narration = "") {
  const lines = String(narration).split(/\r?\n/).map(cleanNarration).filter(Boolean);
  return lines.length > 1 ? lines : sentences(lines[0] ?? "");
}

/** Speech at -16 LUFS, a usual level for a voice-over online. `"loudness"` in demo.json changes it; false leaves the
 *  voice as recorded. */
const DEFAULT_LOUDNESS = -16;

/** A copy of a voice brought to `loudness` (LUFS), in build/voice/, made again only when the file or the level changes,
 *  so a take recorded quietly is as loud as the next. The file itself is left alone. Returns the path to use. */
function levelled(dir, audio, loudness) {
  if (loudness === false || loudness === null) return audio;
  const source = join(dir, audio);
  const { size, mtimeMs } = statSync(source);
  const key = createHash("sha1").update(`${audio}:${size}:${mtimeMs}:${loudness}`).digest("hex").slice(0, 10);
  const out = `build/voice/${basename(audio, extname(audio))}-${key}.wav`;
  if (existsSync(join(dir, out))) return out;
  mkdirSync(join(dir, "build/voice"), { recursive: true });
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", source,
    "-af", `loudnorm=I=${loudness}:TP=-1.5:LRA=11`, "-ar", "48000", join(dir, out)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`could not level ${audio}: ${r.stderr || r.error}`);
  return out;
}

function probeSeconds(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const seconds = parseFloat(r.stdout);
  if (r.status !== 0 || !(seconds > 0)) throw new Error(`ffprobe could not read the length of ${file}: ${r.stderr}`);
  return seconds;
}

// The voice sits under the scene's own start, as a sibling of the stage, since HyperFrames wants media outside timed elements.
const audioTag = (s, t0) => s.audio
  ? `      <audio id="a${s.n}" src="${esc(s.audio)}" data-start="${round(t0 + (s.audioOffset ?? DEFAULT_AUDIO_OFFSET))}" data-duration="${round(s.audioSeconds)}" data-track-index="2"></audio>`
  : "";

function checkTheme(theme, where) {
  const unknown = Object.keys(theme).filter((k) => !(k in THEME));
  if (unknown.length) throw new Error(`${where}: unknown theme key ${unknown.join(", ")}; a theme has ${Object.keys(THEME).join(", ")}`);
}

export function load(dir) {
  const cfg = JSON.parse(readFileSync(join(dir, "demo.json"), "utf8"));
  cfg.width ??= 1920;
  cfg.height ??= 1080;
  cfg.fps ??= 30;
  cfg.scale = Number(process.env.DEMOREEL_SCALE) || cfg.scale || DEFAULT_SCALE;
  if (cfg.theme) checkTheme(cfg.theme, "theme");
  cfg.theme = { ...THEME, ...cfg.theme };
  const takesFile = join(dir, "audio/takes.json");
  const takes = existsSync(takesFile) ? JSON.parse(readFileSync(takesFile, "utf8")) : {};
  let start = 0;
  // The narration is script.md's when the project has one (see script.mjs), else each scene's own.
  const script = scriptNarration(dir, cfg.scenes);
  if (script?.unknown.length) console.warn(`script.md: no scene is called ${script.unknown.join(", ")}, so that narration isn't used`);
  cfg.scenes = cfg.scenes.map((scene, i) => {
    const n = String(i + 1).padStart(2, "0");
    const s = { ...scene, n, id: `${n}-${scene.id ?? scene.type}` };
    if (script) s.narration = script.byScene[i] ?? "";
    if (s.theme) checkTheme(s.theme, `scene ${s.id}`);
    // A scene lasts as long as its narration takes to say (its `audioSeconds` if measured, else `wordsPerMinute`) and a short pause, if that is longer
    // than the scene's own `duration` (a clip's is the clip's length), so the voice is never cut off.
    // A take chosen in Booth (audio/takes.json) is the scene's audio unless the scene names one itself.
    if (!s.audio && takes[s.id] && existsSync(join(dir, "audio", takes[s.id]))) s.audio = `audio/${takes[s.id]}`;
    // A recorded `audio` file is measured, and that is its `audioSeconds`.
    if (s.audio) {
      if (!existsSync(join(dir, s.audio))) throw new Error(`scene ${s.id}: audio file ${s.audio} not found`);
      // The file as recorded, which Booth keeps its notes beside; the voice used is a levelled copy of it.
      s.recorded = s.audio;
      s.audio = levelled(dir, s.audio, cfg.loudness ?? DEFAULT_LOUDNESS);
      s.audioSeconds = probeSeconds(join(dir, s.audio));
    }
    const words = cleanNarration(s.narration).split(/\s+/).filter(Boolean).length;
    // A measured `audioSeconds` (how long the voice really takes) beats the estimate, with a shorter pause after.
    s.spoken = s.audioSeconds
      ? Math.ceil((s.audioSeconds + 0.6) * 10) / 10
      : words ? Math.ceil(((words * 60) / (cfg.wordsPerMinute ?? 150) + 0.8) * 10) / 10 : 0;
    if (s.type === "diagram") {
      // A diagram is a title across the top and the picture under it, centered across the frame.
      const width = s.width ?? (s.hub ? 1500 : 1700);
      const x = Math.round((cfg.width - width) / 2);
      if (s.hub) {
        // HyperFrames' hub-and-spokes block, mounted in a box. It registers its timeline under one fixed name.
        if (cfg.scenes.some((o, j) => j < i && o.type === "diagram" && o.hub)) throw new Error(`scene ${s.id}: a film can have one hub diagram; use a "source" picture for another`);
        s.block = { src: null, vars: hubVariables(s), x, y: s.y ?? 250, width, height: s.height ?? 780 };
      } else {
        s.cards = [{ image: diagramImage(dir, s), x, y: s.y ?? 310, width, delay: 0.3, ...s.card }];
      }
      s.layout = "top";
      s.type = "bullets";
    }
    if (s.type === "clip") {
      // A scene that `demoreel record` makes needs to name no files: they are <id>.mp4 and <id>.events.json.
      // A scene that names its `video` but no `events`, with no <id>.events.json beside it, is a plain video: nothing is drawn over it.
      s.video ??= `${scene.id ?? "clip"}.mp4`;
      const eventsFile = s.events ?? `${scene.id ?? "clip"}.events.json`;
      const plain = scene.video !== undefined && scene.events === undefined && !existsSync(join(dir, eventsFile));
      const recorded = plain ? null : JSON.parse(readFileSync(join(dir, eventsFile), "utf8"));
      s.plain = plain;
      // `from` and `to` (seconds) use only that part of the video; without `to` or events it plays to the video's end.
      const length = s.to === undefined && !recorded ? probeSeconds(join(dir, s.video)) : undefined;
      try {
        const from = s.from ?? 0;
        // `skip` takes stretches out of that part (a long wait, say): the video cuts across them, and says so.
        s.kept = keptRanges(from, from + clipSeconds({ from: s.from, to: s.to, events: recorded, fps: cfg.fps, length }), s.skip);
        s.clipSeconds = round(s.kept.reduce((sum, [a, b]) => sum + b - a, 0));
      } catch (e) {
        throw new Error(`scene ${s.id}: ${e.message}`);
      }
      s.events = keptEvents(recorded ?? { fps: cfg.fps, events: [] }, s.kept, cfg.fps);
      s.duration = Math.max(s.clipSeconds, s.spoken);
    } else {
      s.duration = Math.max(s.duration ?? 5, s.spoken);
      if (s.block) s.block.src = hubBlock(dir, s, round(s.duration - 0.7));
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
// A scene with its own `theme` carries it as CSS properties, so its text and accents change and the film's stay as they are.
const sceneStyle = (s) => (s.theme ? ` style="${esc(themeVars(s.theme))}"` : "");
// With `motionBlur` only the pointer is blurred, so everything else that moves opts out.
const still = (cfg) => (cfg.motionBlur ? ` data-motion-blur="off"` : "");

export function textScene(dir, cfg, s, t0, opts = {}) {
  const id = `s${s.n}`;
  const bullets = (s.bullets ?? []).map((b) => `<li><i></i><span>${esc(b)}</span></li>`).join("");
  const cards = (s.cards ?? []).map((c, k) => {
    const src = image(dir, c.image, c.width, Boolean(c.zoom), cfg.scale);
    return `<div class="card" id="${id}c${k}"${still(cfg)} style="left:${c.x}px;top:${c.y}px;width:${c.width}px"><img src="${src}" /></div>`;
  }).join("");
  // A HyperFrames block mounted in a box of its own: it plays from a little after the scene starts and ends with it.
  const block = s.block
    ? `<div id="${id}b"${still(cfg)} data-composition-id="constellation-hub" data-composition-src="${esc(s.block.src)}" data-variable-values="${esc(JSON.stringify(s.block.vars))}" data-start="${round(t0 + 0.3)}" data-duration="${round(s.duration - 0.7)}" data-track-index="${Number(s.n) + 100}" style="position:absolute;left:${s.block.x}px;top:${s.block.y}px;width:${s.block.width}px;height:${s.block.height}px"></div>`
    : "";
  // A scene with its own background paints it across the frame, over the film's.
  const bg = s.theme?.background ? `<div class="backdrop"></div>` : "";
  const html = `<div id="${id}" class="scene clip" data-start="${round(t0)}" data-duration="${round(s.duration)}" data-track-index="${Number(s.n)}"${sceneStyle(s)}>
  ${bg}<div class="left${s.layout === "top" ? " top" : ""}"${still(cfg)}>${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ""}<div class="title">${esc(s.title ?? "")}</div><ul class="bullets">${bullets}</ul></div>${cards}${block}</div>`;

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

/** How long a clip scene's video plays, in seconds: `to` - `from`, else to the end of the recording (its events'
 *  `frames`) or of the video (`length`, measured). A `to` past the end of the recording stops at its end. */
export function clipSeconds({ from = 0, to, events, fps = 30, length }) {
  const end = events ? events.frames / (events.fps ?? fps) : length;
  const stop = to === undefined ? end : end === undefined ? to : Math.min(to, end);
  if (!(from >= 0)) throw new Error(`"from" must be 0 or more seconds, not ${from}`);
  if (!(stop > from)) throw new Error(`the clip ends (${round(stop)}s) before it starts ("from": ${from})`);
  return round(stop - from);
}

/** A recording's events as seen from `from` seconds in, for `seconds`: those outside the range are dropped and the
 *  rest are renumbered so frame 0 is `from`. */
export function rangeEvents(recorded, from, seconds, fps = 30) {
  return keptEvents(recorded, [[from, from + seconds]], fps);
}

/** The stretches of a recording a clip plays, in its seconds: `from` to `stop`, less each `skip` ({ from, to }). A skip
 *  must lie inside the clip, and skips may not overlap; they can be given in any order. */
export function keptRanges(from, stop, skip = []) {
  const skips = [...skip].sort((a, b) => a.from - b.from);
  const kept = [];
  let at = from;
  for (const k of skips) {
    if (!(k.to > k.from)) throw new Error(`a skip ends (${k.to}s) before it starts (${k.from}s)`);
    if (k.from <= at || k.to >= stop) throw new Error(`the skip ${k.from}s–${k.to}s is not inside the clip (${round(at)}s–${round(stop)}s) or overlaps another`);
    kept.push([at, k.from]);
    at = k.to;
  }
  kept.push([at, stop]);
  return kept.map(([a, b]) => [round(a), round(b)]);
}

/** A recording's events as the clip plays them: those in a stretch it skips (or outside it) are dropped, the rest are
 *  renumbered from the clip's first frame, and a `skip` event (with the `seconds` left out) marks each cut. */
export function keptEvents(recorded, kept, fps = 30) {
  const rate = recorded.fps ?? fps;
  const events = [];
  let base = 0;
  kept.forEach(([a, b], i) => {
    const first = Math.round(a * rate);
    const frames = Math.round((b - a) * rate);
    if (i > 0) events.push({ frame: base, kind: "skip", seconds: round(a - kept[i - 1][1]) });
    for (const e of recorded.events ?? []) {
      const f = e.frame - first;
      if (f >= 0 && f < frames) events.push({ ...e, frame: base + f });
    }
    base += frames;
  });
  return { ...recorded, fps: rate, frames: base, events };
}

// The part of the video a clip scene plays (`from` to `to`) is cut out by ffmpeg, and a clip shorter than its
// narration holds its last frame, which ffmpeg makes by cloning it. The copy goes in build/, named for both.
function heldClip(dir, s) {
  const from = s.from ?? 0;
  const kept = s.kept ?? [[from, from + s.clipSeconds]];
  const cuts = kept.length > 1;
  const trim = from > 0 || s.to !== undefined || cuts;
  const hold = s.duration > s.clipSeconds + 0.05;
  if (!trim && !hold) return s.video;
  const tag = [trim && kept.map(([a, b]) => `${a}-${b}`).join("_"), hold && `held-${Math.round(s.duration * 10)}`].filter(Boolean).join("-");
  const out = join("build", `${basename(s.video, extname(s.video))}-${tag}.mp4`);
  const source = join(dir, s.video);
  const to = join(dir, out);
  mkdirSync(join(dir, "build"), { recursive: true });
  if (!existsSync(to) || statSync(to).mtimeMs < statSync(source).mtimeMs) {
    const args = ["-y", "-loglevel", "error"];
    const pad = hold ? `tpad=stop_mode=clone:stop_duration=${round(s.duration - s.clipSeconds)}` : "";
    if (cuts) {
      // Each kept stretch, trimmed and joined end to end.
      const parts = kept.map(([a, b], i) => `[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[p${i}]`);
      const join = `${kept.map((_, i) => `[p${i}]`).join("")}concat=n=${kept.length}:v=1:a=0${pad ? `,${pad}` : ""}[v]`;
      args.push("-i", source, "-filter_complex", [...parts, join].join(";"), "-map", "[v]");
    } else {
      if (trim) args.push("-ss", String(round(from)), "-t", String(s.clipSeconds));
      args.push("-i", source);
      if (pad) args.push("-vf", pad);
    }
    args.push("-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", to);
    const r = spawnSync("ffmpeg", args);
    if (r.status !== 0) throw new Error(`ffmpeg could not ${trim ? "cut" : "hold the last frame of"} ${s.video}: ${r.stderr}`);
  }
  return out;
}

/** How much time a skip left out, as said on screen: "28s", "2m 05s". */
export const skipLabel = (seconds) => {
  const n = Math.round(seconds);
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, "0")}s`;
};

export function clipScene(dir, cfg, s, t0) {
  const id = `s${s.n}`;
  const win = s.window ?? s.events.window ?? { w: 1280, h: 801 };
  // `layout: "full"` fills the frame with the video, letterboxed, and draws key caps over it but no pointer or clicks.
  // A plain video (no events) has no pointer either.
  const full = s.layout === "full";
  const pointer = !full && !s.plain;
  const card = full ? { x: 0, y: 0, width: cfg.width } : { x: 180, y: 70, width: 1560, ...s.card };
  const k = card.width / win.w;
  const height = full ? cfg.height : round(win.h * k);
  const fps = s.events.fps ?? cfg.fps;
  const at = (p) => ({ x: round(card.x + p.x * k), y: round(card.y + p.y * k) });
  const GLIDE = 14 / fps;
  const start = at({ x: (s.pointer?.x ?? 0.55) * win.w, y: (s.pointer?.y ?? 0.6) * win.h });

  let rings = "";
  let keys = "";
  let skips = "";
  const js = [];
  const fade = s.theme?.background ? `#${id}, #${id}v, #${id}g` : `#${id}, #${id}v`;
  js.push(`gsap.set("${fade}",{opacity:0});`);
  js.push(`tl.to("${fade}",{opacity:1,duration:.4},${round(t0)});`);
  js.push(`tl.to("${fade}",{opacity:0,duration:.4},${round(t0 + s.duration - 0.4)});`);
  if (pointer) js.push(`gsap.set("#${id}cursor",{x:${start.x},y:${start.y}});`);
  const events = s.events.events;
  const gap = s.typingGap ?? TYPING_GAP_FRAMES;
  const isChar = (e) => e.kind === "key" && (e.key.length === 1 || e.key === "space");
  const runs = new Map();
  const inRun = new Set();
  for (let a = 0; a < events.length; a++) {
    if (inRun.has(a) || !isChar(events[a])) continue;
    let b = a;
    while (b + 1 < events.length && isChar(events[b + 1]) && events[b + 1].frame - events[b].frame <= gap) b++;
    if (b > a) {
      runs.set(a, events.slice(a, b + 1));
      for (let k = a; k <= b; k++) inRun.add(k);
    }
  }
  events.forEach((e, i) => {
    const t = t0 + e.frame / fps;
    if (inRun.has(i) && !runs.has(i)) return;
    // A run of typing is one cap whose letters appear as they are typed.
    if (runs.has(i)) {
      const run = runs.get(i);
      const spans = run.map((c, n) => `<span id="${id}k${i}c${n}">${c.key === "space" ? "&nbsp;" : esc(c.key)}</span>`).join("");
      keys += `<div class="keyset" id="${id}k${i}"><div class="cap">${spans}</div></div>`;
      js.push(`gsap.set("#${id}k${i}",{opacity:0,y:14});`);
      run.forEach((c, n) => {
        js.push(`gsap.set("#${id}k${i}c${n}",{opacity:0});`);
        js.push(`tl.to("#${id}k${i}c${n}",{opacity:1,duration:.01},${round(t0 + c.frame / fps)});`);
      });
      js.push(`tl.to("#${id}k${i}",{opacity:1,y:0,duration:.2,ease:"power2.out"},${round(t)});tl.to("#${id}k${i}",{opacity:0,duration:.27},${round(t0 + run.at(-1).frame / fps + 0.93)});`);
      return;
    }
    if (e.kind === "skip") {
      // Time left out: a tag in the clip's corner for a moment, so the cut reads as a jump and not a glitch.
      skips += `<div class="skipped" id="${id}j${i}"${still(cfg)} style="left:${round(card.x + card.width - 24)}px;top:${round(card.y + 24)}px">⏩ ${skipLabel(e.seconds)} later</div>`;
      js.push(`gsap.set("#${id}j${i}",{opacity:0,y:-8});`);
      js.push(`tl.to("#${id}j${i}",{opacity:1,y:0,duration:.25,ease:"power2.out"},${round(t)});tl.to("#${id}j${i}",{opacity:0,duration:.35},${round(t + 1.6)});`);
      return;
    }
    if (full) {
      // Only keys are drawn over a full-frame video.
    } else if (e.x !== undefined) {
      const to = at(e);
      js.push(`tl.to("#${id}cursor",{x:${to.x},y:${to.y},duration:${round(GLIDE)},ease:"power2.inOut"},${round(Math.max(t0, t - GLIDE))});`);
    }
    if (e.kind === "click" && !full) {
      const to = at(e);
      rings += `<div class="ring" id="${id}r${i}"${still(cfg)}></div>`;
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

  // The video is not inside the timed scene div, which would leave the renderer unable to find it, and has an id. So a
  // scene background of its own is a timed element of its own too, under the video, fading in and out with it.
  const backdrop = s.theme?.background
    ? `<div id="${id}g" class="clip backdrop" style="${esc(themeVars(s.theme))}" data-start="${round(t0)}" data-duration="${round(s.duration)}" data-track-index="${Number(s.n) + 200}"></div>\n`
    : "";
  const cursor = !pointer ? "" : `<div class="cursor" id="${id}cursor"><svg width="34" height="40" viewBox="0 0 17 20"><path d="M1 1 L1 15.5 L5 12 L7.8 18.2 L10.2 17.1 L7.5 11 L13 11 Z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg></div>`;
  const html = `${backdrop}<video id="${id}v" class="clip clipvideo${full ? " full" : ""}"${still(cfg)} src="${heldClip(dir, s)}" muted playsinline style="left:${card.x}px;top:${card.y}px;width:${card.width}px;height:${height}px" data-start="${round(t0)}" data-duration="${round(s.duration)}" data-track-index="${Number(s.n) + 100}"></video>
<div id="${id}" class="scene clip" data-start="${round(t0)}" data-duration="${round(s.duration)}" data-track-index="${Number(s.n)}"${sceneStyle(s)}>
  ${rings}${skips}${cursor}
  <div class="keys"${still(cfg)}>${keys}</div></div>`;
  return { html, js: js.join("\n") };
}

// The look of a scene, shared by the film's page and the deck's slides.
export const rules = `      .scene { font-family: var(--font); }
      .backdrop { position: absolute; inset: 0; background: var(--background); }
      .left { position: absolute; left: 110px; top: 0; bottom: 0; width: 700px; display: flex; flex-direction: column; justify-content: center; }
      .left.top { top: 80px; bottom: auto; left: 110px; width: 1700px; }
      .kicker { color: var(--accent); font-size: 26px; letter-spacing: 4px; text-transform: uppercase; font-weight: 600; }
      .title { color: var(--ink); font-size: 66px; font-weight: 700; line-height: 1.06; margin-top: 14px; letter-spacing: -1.5px; text-wrap: balance; }
      .bullets { list-style: none; margin-top: 44px; }
      .bullets li { display: flex; align-items: center; gap: 20px; margin-bottom: 22px; }
      .bullets i { width: 14px; height: 14px; border-radius: 7px; background: var(--accent); flex: none; }
      .bullets span { color: var(--ink); font-size: 36px; font-weight: 500; }
      .card { position: absolute; border-radius: 18px; overflow: hidden; box-shadow: 0 40px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); }
      .card img, .card video { width: 100%; display: block; }
      .clipvideo { position: absolute; object-fit: cover; border-radius: 18px; box-shadow: 0 40px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); }
      .clipvideo.full { object-fit: contain; border-radius: 0; box-shadow: none; background: #000; }
      .skipped { position: absolute; transform: translateX(-100%); padding: 10px 20px; border-radius: 14px; font-size: 30px; font-weight: 600;
        color: var(--ink); background: var(--surface); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 8px 24px rgba(0,0,0,.5); white-space: nowrap; }
      .cursor { position: absolute; left: 0; top: 0; transform-origin: 0 0; filter: drop-shadow(0 4px 6px rgba(0,0,0,.5)); }
      .ring { position: absolute; left: 0; top: 0; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%;
        border: 4px solid var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); }
      .keys { position: absolute; left: 0; right: 0; bottom: 36px; height: 0; }
      .keyset { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; gap: 10px; }
      .cap { min-width: 64px; padding: 10px 20px; border-radius: 14px; text-align: center; font-size: 38px; font-weight: 600; color: var(--ink);
        background: var(--surface); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 8px 24px rgba(0,0,0,.5), inset 0 -3px 0 rgba(0,0,0,.35); }
`;

// The page is the film at its layout size; HyperFrames draws it at `scale` when it renders (see resolutionArgs).
function page(cfg, parts, total, audio = "") {
  const W = cfg.width;
  const H = cfg.height;
  const blur = cfg.motionBlur ? ` data-motion-blur="on"` : "";
  return `<!doctype html>
<html lang="en" data-composition-variables="${esc(JSON.stringify(themeDeclarations(cfg.theme)))}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="build/gsap.min.js"></script>
    <style>
      :root { ${themeVars(cfg.theme)} }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0e0e11; }
      #stage { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; font-family: var(--font); background: var(--background); overflow: hidden; }
      #stage .scene.clip { position: absolute; left: 0; top: 0; right: auto; bottom: auto; width: ${W}px; height: ${H}px; }
${rules}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${round(total)}" data-width="${W}" data-height="${H}" data-fps="${cfg.fps}"${blur}>
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
  copyFileSync(GSAP, join(dir, "build/gsap.min.js"));
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
      const label = e.kind === "key" ? `key ${e.key}` : e.kind === "skip" ? `skip ${skipLabel(e.seconds)}` : e.kind;
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

/** The storyboard, the manifest and captions: what an editor needs besides the video. With `film` (its name in `outDir`)
 *  the export is that one file and each scene is the stretch of it from its `start` for its `duration`; without, each
 *  scene is its own file in scenes/. */
export function writeStoryboard(dir, cfg, outDir, { film } = {}) {
  mkdirSync(outDir, { recursive: true });
  const rows = cfg.scenes.map((s) => ({
    id: s.id, file: film ?? `scenes/${s.id}.mp4`, start: round(s.start), duration: round(s.duration), type: s.type,
    onScreen: [s.kicker, s.title, ...(s.bullets ?? [])].filter(Boolean),
    narration: s.narration ?? "", narrationClean: cleanNarration(s.narration), chunks: chunks(s.narration), cues: cues(s),
    audioOffset: s.audioOffset ?? DEFAULT_AUDIO_OFFSET, captions: s.captions,
  }));
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ fps: cfg.fps, total: round(cfg.total), ...(film ? { film } : {}), scenes: rows }, null, 2) + "\n");
  const files = film ? `The whole film in \`${film}\`, a chapter at each scene` : "One mp4 per scene in `scenes/`";
  const md = [`# ${cfg.title ?? "Demo"}: storyboard`, "", `Total ${round(cfg.total)}s. ${files}; narration below is the text to voice (tags are for the voice engine; captions have them stripped).`, ""];
  for (const r of rows) {
    md.push(`## ${r.id} (${r.start}s–${round(r.start + r.duration)}s)`, "", film ? `In \`${film}\` from ${r.start}s` : `File: \`${r.file}\``);
    if (r.onScreen.length) md.push("", "On screen:", ...r.onScreen.map((x) => `- ${x}`));
    md.push("", r.narration ? `Narration: ${r.narration}` : "Narration: (none yet)", "");
  }
  writeFileSync(join(outDir, "storyboard.md"), md.join("\n"));
  const whole = srt(rows, true);
  rmSync(join(outDir, "captions.vtt"), { force: true });
  if (whole) writeFileSync(join(outDir, "captions.vtt"), vtt(rows, true));
  // Nothing to write, and nothing stale left from an earlier export.
  rmSync(join(outDir, "captions.srt"), { force: true });
  if (whole) writeFileSync(join(outDir, "captions.srt"), whole);
}

// Captions come only from real audio (see captions.mjs). `whole` runs the times across the film, else from the scene's start.
/** The same captions as WebVTT, which browsers, YouTube and most editors read. */
export function vtt(rows, whole) {
  const cues = [];
  for (const r of rows) {
    const base = (whole ? r.start : 0) + (r.audioOffset ?? DEFAULT_AUDIO_OFFSET);
    for (const c of r.captions ?? []) cues.push(`${timecode(base + c.start).replace(",", ".")} --> ${timecode(base + c.end).replace(",", ".")}\n${c.text}\n`);
  }
  return cues.length ? `WEBVTT\n\n${cues.join("\n")}` : "";
}

function srt(rows, whole) {
  let n = 1;
  const out = [];
  for (const r of rows) {
    const base = (whole ? r.start : 0) + (r.audioOffset ?? DEFAULT_AUDIO_OFFSET);
    for (const c of r.captions ?? []) out.push(`${n++}\n${timecode(base + c.start)} --> ${timecode(base + c.end)}\n${c.text}\n`);
  }
  return out.join("\n");
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
    const row = { narrationClean: cleanNarration(s.narration), duration: s.duration, audioOffset: s.audioOffset ?? DEFAULT_AUDIO_OFFSET, captions: s.captions };
    writeFileSync(join(folder, "narration.txt"), (row.narrationClean || "(no narration yet)") + "\n");
    if (s.narration) writeFileSync(join(folder, "narration-with-tags.txt"), s.narration + "\n");
    if (s.captions?.length) {
      writeFileSync(join(folder, "captions.srt"), srt([row], false));
      writeFileSync(join(folder, "captions.vtt"), vtt([row], false));
    }
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
    "captions.srt and captions.vtt are there for a scene with recorded audio: its words, timed from what was said.",
    "",
  ].join("\n"));
}
