// `demoreel record`: for each clip scene with a `record` block, launch the app hidden, run a script against it through a
// driver, and leave the scene's `video` and `events` files ready. See docs/adr/0001-drivers-share-one-recording-contract.md.
//
//   "record": { "driver": "typecase",
//               "command": ["./target/debug/examples/driven"],   // the app, as it is started
//               "cwd": "../typecase",                             // where to start it (relative to the project)
//               "script": "driven.script",                        // the lines typecase-drive reads
//               "drive": "../typecase/target/debug/typecase-drive", // the driver CLI (default: typecase-drive on the PATH)
//               "socketEnv": "TYPECASE_DRIVER_SOCKET",            // how the app is told where to listen
//               "env": {}, "fps": 30 }
//
//   "driver": "vhs" is a Mac app built with swift-vhs (github.com/phin-tech/swift-vhs) in its Debug build: the same block,
//   with "drive" defaulting to vhs-drive and "socketEnv" to VHS_SOCKET. Its scripts are typecase-drive's lines.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { sleep } from "./util.mjs";


/** Runs the `record` block of each scene of a project that has one (just `only`, by its id, if given). */
export async function recordScenes(dir, only, { log = console.log } = {}) {
  // demo.json is read as it is: the clip files this makes may not exist yet, which loading the project would refuse.
  const raw = JSON.parse(readFileSync(join(dir, "demo.json"), "utf8"));
  const todo = raw.scenes.map((s) => ({ ...s, id: s.id ?? s.type })).filter((s) => s.record && (!only || s.id === only));
  if (!todo.length) throw new Error("no scene has a `record` block" + (only ? ` named ${only}` : ""));
  const done = [];
  for (const scene of todo) {
    const r = await record(dir, scene, { log });
    log(`wrote ${r.video} and ${r.events} (${r.frames} frames)`);
    done.push(r);
  }
  return done;
}

/** What the app played while it was recorded (its `sound` events name the files) is copied beside the recording, into
 *  <id>.sounds/, since the app's own copy may be gone by the time the film is made; the events then name the copies. */
export function keepSounds(dir, scene, events) {
  const sounds = (events.events ?? []).filter((e) => e.kind === "sound" && e.file);
  if (!sounds.length) return;
  const folder = `${scene.id}.sounds`;
  rmSync(join(dir, folder), { recursive: true, force: true });
  mkdirSync(join(dir, folder), { recursive: true });
  sounds.forEach((e, i) => {
    const source = resolve(dir, e.file);
    if (!existsSync(source)) { e.missing = e.file; return; }
    const name = `${String(i + 1).padStart(2, "0")}-${basename(source)}`;
    copyFileSync(source, join(dir, folder, name));
    e.file = `${folder}/${name}`;
  });
  events.events = events.events.filter((e) => !e.missing);
}

/** The drivers that run as a CLI against a socket the app listens on, and their defaults. */
const DRIVERS = {
  typecase: { drive: "typecase-drive", socketEnv: "TYPECASE_DRIVER_SOCKET" },
  vhs: { drive: "vhs-drive", socketEnv: "VHS_SOCKET" },
};

/** Runs one scene's `record` block and returns the files it wrote. */
export async function record(dir, scene, { log = console.log } = {}) {
  const r = scene.record;
  if (r.driver === "web") return (await import("./web.mjs")).recordWeb(dir, scene, { log });
  const kind = r.driver ?? "typecase";
  if (!DRIVERS[kind]) throw new Error(`scene ${scene.id}: driver "${r.driver}" is not one demoreel can run yet (typecase, vhs, web)`);
  if (!r.command?.length) throw new Error(`scene ${scene.id}: record.command is the app to start`);
  if (!r.script) throw new Error(`scene ${scene.id}: record.script is the file of steps to run`);
  const fps = r.fps ?? 30;
  const script = resolve(dir, r.script);
  if (!existsSync(script)) throw new Error(`scene ${scene.id}: ${script} is missing`);
  // A bare name is a command on the PATH; anything with a slash is a file, relative to the project.
  const drive = r.drive ? (r.drive.includes("/") ? resolve(dir, r.drive) : r.drive) : DRIVERS[kind].drive;
  const cwd = resolve(dir, r.cwd ?? ".");
  const video = resolve(dir, scene.video ?? `${scene.id}.mp4`);
  const eventsFile = resolve(dir, scene.events ?? `${scene.id}.events.json`);

  // A Unix socket's path has to be short (about 100 bytes on macOS), so it lives under /tmp, not in the project.
  const work = mkdtempSync("/tmp/dr-");
  const socket = join(work, "s");
  const frames = join(resolve(dir, "build"), "record", scene.id);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const appLog = join(work, "app.log");
  const out = openSync(appLog, "a");
  const command = resolve(cwd, r.command[0]);
  const app = spawn(existsSync(command) ? command : r.command[0], r.command.slice(1), {
    cwd, stdio: ["ignore", out, out], env: { ...process.env, ...r.env, [r.socketEnv ?? DRIVERS[kind].socketEnv]: socket },
  });
  let exited = false;
  app.on("exit", () => { exited = true; });
  const driver = (...args) => spawnSync(drive, ["--socket", socket, ...args], { encoding: "utf8" });
  try {
    // The first command waits for the app's window.
    const windows = driver("--wait", "60", "windows");
    if (windows.status !== 0) throw new Error(`the app did not come up: ${windows.stderr || windows.stdout}\n(see ${appLog})`);
    const size = /(\d+)\s*[×x]\s*(\d+)/.exec(windows.stdout);
    log(`  ${scene.id}: ${windows.stdout.trim().split("\n")[0]}`);
    const demo = driver("demo", script, frames, "--events", "--fps", String(fps));
    if (demo.status !== 0) throw new Error(`the script failed: ${demo.stderr || demo.stdout}`);
    log(`  ${scene.id}: ${(demo.stdout || demo.stderr).trim().split("\n")[0]}`);

    mkdirSync(join(video, ".."), { recursive: true });
    const enc = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(frames, "%05d.png"),
      "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", video], { encoding: "utf8" });
    if (enc.status !== 0) throw new Error(`ffmpeg could not make the video: ${enc.stderr}`);

    // The window's size goes with the events, so a scene need not say it.
    const events = JSON.parse(readFileSync(join(frames, "events.json"), "utf8"));
    if (size) events.window = { w: Number(size[1]), h: Number(size[2]) };
    keepSounds(dir, scene, events);
    writeFileSync(eventsFile, JSON.stringify(events, null, 1) + "\n");
    return { video, events: eventsFile, frames: events.frames };
  } finally {
    // The app is ours to stop: ask it to quit, and make sure.
    if (!exited) driver("quit");
    for (let i = 0; i < 20 && !exited; i++) await sleep(100);
    if (!exited) app.kill("SIGKILL");
    rmSync(work, { recursive: true, force: true });
  }
}

/** `demoreel login`: for each web clip scene with a `record.session` (just `only`, by its id, if given), sign in by hand in
 *  a visible Chrome and save the session. `wait` is awaited once the page is open and you have signed in. */
export async function loginScenes(dir, only, wait, { log = console.log } = {}) {
  const raw = JSON.parse(readFileSync(join(dir, "demo.json"), "utf8"));
  const todo = raw.scenes.map((s) => ({ ...s, id: s.id ?? s.type }))
    .filter((s) => s.record?.driver === "web" && s.record.session && (!only || s.id === only));
  if (!todo.length) throw new Error("no web scene has a `record.session`" + (only ? ` named ${only}` : ""));
  // Scenes that share a session file are signed in once.
  const seen = new Set();
  for (const scene of todo) {
    const file = resolve(dir, scene.record.session);
    if (seen.has(file)) continue;
    seen.add(file);
    const { loginWeb } = await import("./web.mjs");
    await loginWeb(dir, scene, () => wait(scene), { log });
  }
}
