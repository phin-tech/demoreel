// The web driver for `demoreel record`: drives a page in headless Chrome (puppeteer-core, with the Chrome HyperFrames
// uses), saves what the page shows as screenshots, steady at the frame rate, and writes the same events file the other drivers do. Headless Chrome has no
// pointer, so the frames come out clean, which is what the clip scene wants.
//
//   "record": { "driver": "web", "url": "http://localhost:3000" | "page.html",
//               "script": "web.script", "viewport": { "width": 1280, "height": 800 }, "scale": 2, "fps": 30,
//               "session": "app.session.json" }      // signed-in cookies and storage, saved by `demoreel login`
//
// The script has the lines typecase-drive reads, for a page: `click #id`, `click Some label`, `click:X,Y`, `move:X,Y`,
// `type some words`, `enter` / `cmd-k` / `shift-tab` (a key), `scroll:X,Y,DY`, `goto:URL`, `wait:600`; several steps may share
// a line when none has a space in it.
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { sleep } from "./util.mjs";
import { hyperframes } from "./hyperframes.mjs";
import { applySession, bounced, captureSession, readSession, writeSession } from "./session.mjs";

// A frame is a JPEG at quality 95: at 2x a PNG takes about 120 ms to capture and this about 65, so twice as many frames
// are caught while the page moves; next to the PNG it measures 44 dB, under what the video's own encoding loses.
const SHOT = { format: "jpeg", quality: 95, optimizeForSpeed: true, captureBeyondViewport: false };
const STEP_PAUSE = 120;
const TYPE_PAUSE = 60;
const CAPTURE_TIMEOUT = 1500; // ms before one screenshot is given up on (one in flight when the page navigates is never answered)
const MAX_FAILURES = 20; // in a row, before the recording stops
const KEYS = { enter: "Enter", escape: "Escape", esc: "Escape", tab: "Tab", backspace: "Backspace", space: " ", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
const MODS = { cmd: "Meta", ctrl: "Control", alt: "Alt", shift: "Shift" };

/** The promise's result, or a rejection if it takes longer than `ms`. */
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`no answer in ${ms}ms`)), ms); })]).finally(() => clearTimeout(timer));
}

/** Opens a page and waits for its document, then for the network to go quiet, but not for long: a page with a socket, a
 *  poll or a slow third-party image never goes idle, and `load` waits for those, so neither may hold the recording up. */
async function open(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
}

export function findChrome() {
  if (process.env.DEMOREEL_CHROME) return process.env.DEMOREEL_CHROME;
  const r = hyperframes(["browser", "path"], { encoding: "utf8" });
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
    if (r.session) await applySession(page, readSession(resolve(dir, r.session)));
    await open(page, url);
    if (r.session && bounced(url, page.url())) {
      throw new Error(`scene ${scene.id}: asked for ${url} but landed on ${page.url()}: the session has probably expired, so run \`demoreel login\` again`);
    }

    // Frames are real screenshots, at the page's device scale, taken back to back while the script runs; each is held until
    // the next, and later made into a steady rate. (Chrome's screencast ignores the device scale and comes out soft.)
    // This is CDP's own capture and not page.screenshot, which takes focus from the page it is filming, so typing is lost.
    const cdp = await page.createCDPSession();
    // Chrome keeps the device scale per session, and a session of its own captures at 1x unless it is told the scale too
    // (the page's layout is unchanged: the same viewport, at the same scale).
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: scale, mobile: false });
    const shown = []; // { t, file }
    let recording = true;
    // A capture that stalls (Chrome can hang one while a page is navigating) or fails is skipped and the last frame held;
    // it only stops the recording when they keep failing, so one bad frame never loses the run.
    let failures = 0;
    const grab = async () => {
      const t = Date.now() / 1000;
      const file = join(work, `shot-${String(shown.length).padStart(6, "0")}.jpg`);
      try {
        const { data } = await withTimeout(cdp.send("Page.captureScreenshot", SHOT), CAPTURE_TIMEOUT);
        writeFileSync(file, Buffer.from(data, "base64"));
        shown.push({ t, file });
        failures = 0;
      } catch (e) {
        if (!shown.length || ++failures > MAX_FAILURES) throw new Error(`the page could not be captured: ${e.message}`);
        await sleep(100);
      }
    };
    await grab();
    const t0 = shown[0].t;
    let captureError = null;
    const capturing = (async () => { try { while (recording) await grab(); } catch (e) { captureError = e; recording = false; } })();

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
      if (verb === "goto") { await open(page, /^[a-z]+:\/\//.test(arg) ? arg : pathToFileURL(resolve(dir, arg)).href); }
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
    if (captureError) throw captureError;
    const end = Date.now() / 1000;

    // The frame for each tick of the steady rate is the latest one taken by then; the file number is the frame number.
    const total = Math.max(1, Math.ceil((end - t0) * fps));
    const out = join(work, "frames");
    mkdirSync(out, { recursive: true });
    let at = 0;
    for (let k = 0; k < total; k++) {
      while (at + 1 < shown.length && shown[at + 1].t <= t0 + k / fps) at++;
      linkSync(shown[at].file, join(out, `${String(k).padStart(5, "0")}.jpg`));
    }
    mkdirSync(dirname(video), { recursive: true });
    const enc = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(out, "%05d.jpg"),
      "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", video], { encoding: "utf8" });
    if (enc.status !== 0) throw new Error(`ffmpeg could not make the video: ${enc.stderr}`);
    writeFileSync(eventsFile, JSON.stringify({ fps, frames: total, window: { w: viewport.width, h: viewport.height }, events }, null, 1) + "\n");
    log(`  ${scene.id}: ${shown.length} frames drawn, ${total} at ${fps}fps, ${events.length} events`);
    return { video, events: eventsFile, frames: total };
  } finally {
    await browser.close();
  }
}

/** `demoreel login`: opens the scene's page in a visible Chrome, waits for you to sign in, and saves the session to
 *  record.session. `done` resolves when you are signed in (the CLI waits for Enter). */
export async function loginWeb(dir, scene, done, { log = console.log } = {}) {
  const r = scene.record;
  if (!r.url) throw new Error(`scene ${scene.id}: record.url is the page to open`);
  if (!r.session) throw new Error(`scene ${scene.id}: record.session is the file to save the sign-in to, such as "app.session.json"`);
  const url = /^[a-z]+:\/\//.test(r.url) ? r.url : pathToFileURL(resolve(dir, r.url)).href;
  const file = resolve(dir, r.session);
  const viewport = { width: 1280, height: 800, ...r.viewport };
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: false, defaultViewport: null,
    args: [`--window-size=${viewport.width},${viewport.height + 120}`] });
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await done();
    // Sign-in often ends on another page than the one asked for; the storage that matters is the app's own.
    const session = await captureSession(page);
    writeSession(file, session);
    log(`saved ${session.cookies.length} cookies from ${page.url()} to ${file}`);
    return file;
  } finally {
    await browser.close();
  }
}
