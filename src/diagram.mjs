// A diagram scene: HyperFrames' own animated hub-and-spokes block, or a picture drawn from a file.
//
// With a `hub` and `nodes` the scene uses HyperFrames' constellation-hub block: the hub in the middle, and a connector
// drawing out to each node, one at a time, at the seconds in `cues` (so each can land as the narration names it).
//
// With a `source`, the picture is an image a scene can show.
//
// `.mmd` and `.mermaid` (Mermaid flowcharts) and `.dottie` (a Dottie drawing) are drawn by Dottie's command line
// (https://dottie.phin.tech), in its hand-drawn style unless the scene says `"clean": true`. Any other tool's picture
// works too: give the scene a `.png`, `.jpg` or `.webp` and it is shown as it is.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..");
const HUB_BLOCK = "compositions/components/constellation-hub.html";

/** The constellation-hub block's files in the project, fetched from HyperFrames' registry the first time (it needs the
 *  network once; the files stay in the project after). */
function fetchHubBlock(dir, s) {
  if (existsSync(join(dir, HUB_BLOCK))) return;
  const r = spawnSync(join(TOOL, "node_modules/.bin/hyperframes"), ["add", "constellation-hub", "--no-clipboard", "--json", "--dir", dir], { encoding: "utf8" });
  if (r.status !== 0 || !existsSync(join(dir, HUB_BLOCK))) {
    throw new Error(`scene ${s.id}: could not fetch HyperFrames' constellation-hub block (it needs the network once): ${r.stdout || r.stderr}`);
  }
}

/** The block as this scene plays it, in `build/`. The block's own clip is 4.5 seconds long and goes when it ends, so
 *  a copy is made that lasts as long as the scene, and the registry's file is left as it came. The block registers its
 *  timeline under one fixed name, so a film can have one hub scene. Returns the path the page mounts it from. */
export function hubBlock(dir, s, seconds) {
  fetchHubBlock(dir, s);
  const text = readFileSync(join(dir, HUB_BLOCK), "utf8");
  const out = join("build", `hub-${seconds}.html`);
  mkdirSync(join(dir, "build"), { recursive: true });
  // The block reads its length from the element with id "root", which in a host page is the host's, not its own.
  const sized = text.replace(/(data-(?:composition-)?duration=")4\.5"/g, `$1${seconds}"`).replace("Number(root.dataset.duration)", String(seconds));
  if (!sized.includes(`var durationValue = ${seconds};`)) throw new Error(`scene ${s.id}: HyperFrames' constellation-hub block has changed; demoreel can't size it`);
  writeFileSync(join(dir, out), sized);
  return out;
}

/** The block's variables for a scene with a `hub` and `nodes`. */
export function hubVariables(s) {
  if (!Array.isArray(s.nodes) || s.nodes.length === 0) throw new Error(`scene ${s.id}: "nodes" is the list of labels around the hub`);
  const vars = { hub_label: String(s.hub), nodes: s.nodes.join(",") };
  if (s.cues) vars.cues = s.cues.join(",");
  if (s.accent) vars.accent = s.accent;
  if (s.exit) vars.exit = s.exit;
  return vars;
}

const IMAGES = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const DOTTIE = new Set([".mmd", ".mermaid", ".dottie"]);

/** Where Dottie is: `DEMOREEL_DOTTIE` if set, else `dottie` on the PATH. */
export const dottieCommand = () => process.env.DEMOREEL_DOTTIE || "dottie";

/** The scene's `source` as an image path relative to `dir`, drawing it first when it isn't one already. */
export function diagramImage(dir, s) {
  if (!s.source) throw new Error(`scene ${s.id}: a diagram scene needs a "source" (.mmd, .mermaid, .dottie, .png, .jpg or .webp)`);
  const from = join(dir, s.source);
  if (!existsSync(from)) throw new Error(`scene ${s.id}: diagram source ${s.source} not found`);
  const ext = extname(s.source).toLowerCase();
  if (IMAGES.has(ext)) return s.source;
  if (!DOTTIE.has(ext)) throw new Error(`scene ${s.id}: don't know how to draw ${ext || s.source}; use .mmd, .mermaid, .dottie, or a .png, .jpg or .webp`);
  // The picture depends on the options too, so a changed `clean` or `page` draws again.
  const key = `${s.clean ? "clean" : "sketchy"}-${s.page ?? ""}`;
  const keyed = join("build", `${basename(s.source, ext)}-diagram-${key.replace(/[^\w-]+/g, "_")}.png`);
  const target = join(dir, keyed);
  mkdirSync(join(dir, "build"), { recursive: true });
  if (!existsSync(target) || statSync(target).mtimeMs < statSync(from).mtimeMs) {
    const args = ["render", from, "-o", target, "-s", "3"];
    if (s.clean) args.push("--clean");
    if (s.page) args.push("-p", String(s.page));
    const r = spawnSync(dottieCommand(), args, { encoding: "utf8" });
    if (r.error?.code === "ENOENT") {
      throw new Error(`scene ${s.id}: ${s.source} is drawn by Dottie (https://dottie.phin.tech), which isn't on your PATH. Install it, set DEMOREEL_DOTTIE to its path, or give the scene a .png.`);
    }
    if (r.status !== 0) throw new Error(`scene ${s.id}: dottie could not draw ${s.source}: ${r.stderr || r.error}`);
  }
  return keyed;
}
