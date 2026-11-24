// `demoreel watch`: export again whenever what the film is made from changes, so Booth (which reloads when the export
// lands) shows the scenes at their new lengths a few seconds after a take is ticked.
//
// It reacts to demo.json, Booth's audio/takes.json, and the files they name (the takes in use, clips and their events,
// screenshots, diagram sources), and to nothing else: not demoreel's own output, and not a take still being recorded.
import { watch as watchFiles, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, relative, sep } from "node:path";

const QUIET = 1500;

/** Every string in a JSON value, which in demo.json takes in each file a scene names. */
const strings = (v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

/** Whether a change to `rel` (a path in the project, with /) changes the film. */
export function matters(dir, rel) {
  if (rel === "demo.json" || rel === "audio/takes.json") return true;
  if (/^(out|build|deck|node_modules|compositions|\.hyperframes)\//.test(rel) || rel.endsWith(".marks.json")) return false;
  const read = (file) => {
    try {
      return JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      return null;
    }
  };
  const demo = read("demo.json");
  const named = new Set(strings(demo).map((s) => s.replace(/^\.\//, "")));
  // A clip scene that names no files is <id>.mp4 and <id>.events.json.
  for (const s of demo?.scenes ?? []) if (s.type === "clip" && s.id) named.add(`${s.id}.mp4`).add(`${s.id}.events.json`);
  for (const take of Object.values(read("audio/takes.json") ?? {})) if (typeof take === "string") named.add(`audio/${take}`);
  return named.has(rel);
}

/** Runs `demoreel export <dir> …flags` now and again after each change, a moment after the changes stop. Never returns. */
export function watch(dir, flags, bin) {
  if (!existsSync(join(dir, "demo.json"))) throw new Error(`${dir} has no demo.json`);
  let running = null;
  let again = false;
  let timer = null;

  const run = () => {
    if (running) {
      again = true;
      return;
    }
    const started = Date.now();
    console.log(`\n▶ demoreel export ${flags.join(" ")}`.trimEnd());
    running = spawn(process.execPath, [bin, "export", dir, ...flags], { stdio: "inherit" });
    running.on("exit", (code) => {
      running = null;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(code === 0 ? `✓ exported in ${secs}s; watching for changes` : `✗ export failed (exit ${code}); watching for changes`);
      if (again) {
        again = false;
        run();
      }
    });
  };

  watchFiles(dir, { recursive: true }, (_, file) => {
    if (!file) return;
    const rel = relative(dir, join(dir, file)).split(sep).join("/");
    if (!matters(dir, rel)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`changed: ${rel}`);
      run();
    }, QUIET);
  });
  process.on("SIGINT", () => {
    running?.kill("SIGINT");
    process.exit(130);
  });
  run();
}
