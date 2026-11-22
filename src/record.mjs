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
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs one scene's `record` block and returns the files it wrote. */
export async function record(dir, scene, { log = console.log } = {}) {
  const r = scene.record;
  if (r.driver === "web") return (await import("./web.mjs")).recordWeb(dir, scene, { log });
  if ((r.driver ?? "typecase") !== "typecase") throw new Error(`scene ${scene.id}: driver "${r.driver}" is not one demoreel can run yet (typecase, web)`);
  if (!r.command?.length) throw new Error(`scene ${scene.id}: record.command is the app to start`);
  if (!r.script) throw new Error(`scene ${scene.id}: record.script is the file of steps to run`);
  const fps = r.fps ?? 30;
  const script = resolve(dir, r.script);
  if (!existsSync(script)) throw new Error(`scene ${scene.id}: ${script} is missing`);
  const drive = r.drive ? resolve(dir, r.drive) : "typecase-drive";
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
    cwd, stdio: ["ignore", out, out], env: { ...process.env, ...r.env, [r.socketEnv ?? "TYPECASE_DRIVER_SOCKET"]: socket },
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
