// The web driver for `demoreel record`: drives a page in headless Chrome (puppeteer-core, with the Chrome HyperFrames
// uses), saves what the page shows as screenshots, steady at the frame rate, and writes the same events file the other drivers do. Headless Chrome has no
// pointer, so the frames come out clean, which is what the clip scene wants.
//
//   "record": { "driver": "web", "url": "http://localhost:3000" | "page.html",
//               "script": "web.script", "viewport": { "width": 1280, "height": 800 }, "scale": 2, "fps": 30 }
//
// The script has the lines typecase-drive reads, for a page: `click #id`, `click Some label`, `click:X,Y`, `move:X,Y`,
// `type some words`, `enter` / `cmd-k` / `shift-tab` (a key), `scroll:X,Y,DY`, `goto:URL`, `wait:600`; several steps may share
// a line when none has a space in it.
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { sleep } from "./util.mjs";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..");
const STEP_PAUSE = 120;
const TYPE_PAUSE = 60;
const KEYS = { enter: "Enter", escape: "Escape", esc: "Escape", tab: "Tab", backspace: "Backspace", space: " ", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
const MODS = { cmd: "Meta", ctrl: "Control", alt: "Alt", shift: "Shift" };

function findChrome() {
  if (process.env.DEMOREEL_CHROME) return process.env.DEMOREEL_CHROME;
  const r = spawnSync(join(TOOL, "node_modules/.bin/hyperframes"), ["browser", "path"], { encoding: "utf8" });
  const path = (r.stdout ?? "").trim().split("\n").pop();
  if (r.status !== 0 || !path) throw new Error("no Chrome found: run `npx hyperframes browser ensure`, or set DEMOREEL_CHROME to a Chrome binary");
  return path;
}

// A script line into steps: `type …` and `click …` take the rest of the line, any other line is steps split on spaces.
export function steps(script) {
  const out = [];
  for (const raw of script.split("\n")) {
    // A comment is a whole line starting with #; a # inside a step (`click:#add`) is a selector.
    const line = raw.trim().startsWith("#") ? "" : raw.trim();
    if (!line) continue;
    if (/^type\s+/.test(line)) out.push({ type: line.replace(/^type\s+/, "") });
    else if (/^click\s+/.test(line)) out.push({ click: line.replace(/^click\s+/, "") });
    else for (const tok of line.split(/\s+/)) {
      const m = /^([a-z]+):(.*)$/.exec(tok);
      if (m) out.push({ [m[1]]: m[2] });
      else out.push({ key: tok });
    }
  }
  return out;
}

export async function recordWeb(dir, scene, { log = console.log } = {}) {
  const r = scene.record;
  if (!r.url) throw new Error(`scene ${scene.id}: record.url is the page to open`);
  if (!r.script) throw new Error(`scene ${scene.id}: record.script is the file of steps to run`);
  const fps = r.fps ?? 30;
  const viewport = { width: 1280, height: 800, ...r.viewport };
  const scale = r.scale ?? 2;
  const url = /^[a-z]+:\/\//.test(r.url) ? r.url : pathToFileURL(resolve(dir, r.url)).href;
  const plan = steps(readFileSync(resolve(dir, r.script), "utf8"));
  const video = resolve(dir, scene.video ?? `${scene.id}.mp4`);
  const eventsFile = resolve(dir, scene.events ?? `${scene.id}.events.json`);
  const work = join(resolve(dir, "build"), "record", scene.id);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ["--hide-scrollbars"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: scale });
    await page.goto(url, { waitUntil: "networkidle0" });

    // Frames are real screenshots, at the page's device scale, taken back to back while the script runs; each is held until
    // the next, and later made into a steady rate. (Chrome's screencast ignores the device scale and comes out soft.)
    // This is CDP's own capture and not page.screenshot, which takes focus from the page it is filming, so typing is lost.
    const cdp = await page.createCDPSession();
    const shown = []; // { t, file }
    let recording = true;
    const grab = async () => {
      const t = Date.now() / 1000;
      const file = join(work, `shot-${String(shown.length).padStart(6, "0")}.png`);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false });
      writeFileSync(file, Buffer.from(data, "base64"));
      shown.push({ t, file });
    };
    await grab();
    const t0 = shown[0].t;
    const capturing = (async () => { while (recording) await grab(); })();

    const events = [];
    const now = () => Date.now() / 1000;
    const note = (e) => events.push({ frame: Math.max(0, Math.round((now() - t0) * fps)), ...e });
    const where = async (target) => {
      const box = await page.evaluate((target) => {
        const visible = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
        let el = null;
        try { el = document.querySelector(target); } catch { /* not a selector: a label */ }
        if (!el || !visible(el)) {
          const want = target.trim().toLowerCase();
          el = [...document.querySelectorAll("button, a, [role=button], input, label, summary, li, span, div")]
            .filter(visible).find((e) => (e.getAttribute("aria-label") || e.textContent || e.value || e.placeholder || "").trim().toLowerCase() === want) ?? null;
        }
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }, target);
      if (!box) throw new Error(`nothing on the page matches "${target}"`);
      return box;
    };
    const press = async (key) => {
      const parts = key.split("-");
      const name = parts.pop();
      const mods = parts.map((m) => MODS[m]).filter(Boolean);
      for (const m of mods) await page.keyboard.down(m);
      await page.keyboard.press(KEYS[name] ?? name);
      for (const m of mods.reverse()) await page.keyboard.up(m);
      note({ kind: "key", key });
    };

    await sleep(STEP_PAUSE);
    for (const step of plan) {
      const [verb, arg] = Object.entries(step)[0];
      if (verb === "wait") { await sleep(Number(arg) || 500); continue; }
      if (verb === "goto") { await page.goto(/^[a-z]+:\/\//.test(arg) ? arg : pathToFileURL(resolve(dir, arg)).href, { waitUntil: "networkidle0" }); }
      else if (verb === "click") {
        const at = /^\d/.test(arg) ? Object.fromEntries(["x", "y"].map((k, i) => [k, Number(arg.split(",")[i])])) : await where(arg);
        await page.mouse.move(at.x, at.y, { steps: 12 });
        await page.mouse.click(at.x, at.y);
        note({ kind: "click", x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10, held: "" });
      } else if (verb === "move") {
        const [x, y] = arg.split(",").map(Number);
        await page.mouse.move(x, y, { steps: 12 });
        note({ kind: "hover", x, y });
      } else if (verb === "scroll") {
        const [x, y, dy] = arg.split(",").map(Number);
        await page.mouse.move(x, y);
        note({ kind: "scroll", x, y, dy });
        for (let i = 0; i < 10; i++) { await page.mouse.wheel({ deltaY: dy / 10 }); await sleep(33); }
      } else if (verb === "type") {
        for (const ch of arg) {
          await page.keyboard.type(ch);
          note({ kind: "key", key: ch === " " ? "space" : ch });
          await sleep(TYPE_PAUSE);
        }
      } else if (verb === "key") await press(arg);
      else throw new Error(`a step this driver does not know: ${verb}${arg ? `:${arg}` : ""}`);
      await sleep(STEP_PAUSE);
    }
    await sleep(400);
    recording = false;
    await capturing;
    const end = Date.now() / 1000;

    // The frame for each tick of the steady rate is the latest one taken by then; the file number is the frame number.
    const total = Math.max(1, Math.ceil((end - t0) * fps));
    const out = join(work, "frames");
    mkdirSync(out, { recursive: true });
    let at = 0;
    for (let k = 0; k < total; k++) {
      while (at + 1 < shown.length && shown[at + 1].t <= t0 + k / fps) at++;
      linkSync(shown[at].file, join(out, `${String(k).padStart(5, "0")}.png`));
    }
    mkdirSync(dirname(video), { recursive: true });
    const enc = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(out, "%05d.png"),
      "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", video], { encoding: "utf8" });
    if (enc.status !== 0) throw new Error(`ffmpeg could not make the video: ${enc.stderr}`);
    writeFileSync(eventsFile, JSON.stringify({ fps, frames: total, window: { w: viewport.width, h: viewport.height }, events }, null, 1) + "\n");
    log(`  ${scene.id}: ${shown.length} frames drawn, ${total} at ${fps}fps, ${events.length} events`);
    return { video, events: eventsFile, frames: total };
  } finally {
    await browser.close();
  }
}
