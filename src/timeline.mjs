// A timeline file for an editor that has a real timeline, such as DaVinci Resolve (free) or Final Cut: each scene's video on
// the main track, silent, and its voice on an audio track under it, where the voice starts. Written as FCPXML 1.8, which
// Resolve and Final Cut both open. The media is copied beside it, so the folder can be moved as a whole. Each scene has a
// marker with its name where it starts and its narration as a note; a voice recorded in Booth has a marker where each
// sentence of it starts.
//
// It is made from whichever export was run last, as out/manifest.json records: the one film (each scene is its stretch
// of it) or a file per scene (`export --scenes`).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { esc } from "./util.mjs";
import { chapterName } from "./chapters.mjs";
import { chunks, cleanNarration } from "./build.mjs";


function probe(file, entries, stream) {
  const args = ["-v", "error", ...(stream ? ["-select_streams", stream] : []), "-show_entries", entries, "-of", "json", file];
  const r = spawnSync("ffprobe", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe could not read ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** Where each sentence (chunk) of a take starts, in seconds into it, from the marks Booth keeps beside the take
 *  (`<take>.marks.json`: when each sentence ended). Only the sentences whose start is known; none when there are no marks,
 *  or they have more ends than the narration has sentences, so were made for a script since changed. */
export function sentenceStarts(dir, s) {
  if (!s.recorded) return [];
  const file = join(dir, s.recorded.replace(/\.[^./]+$/, "") + ".marks.json");
  if (!existsSync(file)) return [];
  let marks;
  try {
    marks = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const said = chunks(s.narration);
  const ends = Array.isArray(marks.ends) ? marks.ends : [];
  if (ends.length > said.length) return [];
  return said.flatMap((text, k) => (k === 0 ? [{ at: 0, text }] : k - 1 < ends.length ? [{ at: ends[k - 1], text }] : []));
}

// FCPXML only takes these audio rates.
const RATES = [32000, 44100, 48000, 88200, 96000];

export function writeTimeline(dir, cfg, outDir) {
  const tdir = join(outDir, "timeline");
  rmSync(tdir, { recursive: true, force: true });
  mkdirSync(join(tdir, "video"), { recursive: true });
  mkdirSync(join(tdir, "audio"), { recursive: true });
  const fps = cfg.fps;
  const frames = (seconds) => Math.max(1, Math.round(seconds * fps));
  const t = (n) => `${n}/${fps}s`;

  const manifestFile = join(outDir, "manifest.json");
  if (!existsSync(manifestFile)) throw new Error("out/manifest.json is missing: run `demoreel export` first");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const exported = new Map(manifest.scenes.map((r) => [r.id, r]));

  // The video without its sound (the timeline keeps each voice apart), copied once, as an asset.
  let format = null;
  let resources = "";
  const silent = (from, name, id) => {
    if (!existsSync(from)) throw new Error(`${from} is missing: run \`demoreel export\` first`);
    const video = join(tdir, "video", `${name}.mp4`);
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", from, "-an", "-c:v", "copy", video]);
    if (r.status !== 0) throw new Error(`ffmpeg could not copy ${from}: ${r.stderr}`);
    const info = probe(video, "stream=width,height:format=duration", "v:0");
    const { width, height } = info.streams[0];
    format ??= { width, height };
    const n = frames(parseFloat(info.format.duration));
    resources += `    <asset id="${id}" name="${esc(name)}" src="${esc(pathToFileURL(resolve(video)).href)}" start="0s" duration="${t(n)}" hasVideo="1" format="r1"/>\n`;
    return n;
  };
  if (manifest.film) silent(join(outDir, manifest.film), manifest.film.replace(/\.mp4$/, ""), "film");

  let spine = "";
  let at = 0;
  for (const s of cfg.scenes) {
    const row = exported.get(s.id);
    if (!row) throw new Error(`scene ${s.id} is not in out/manifest.json: run \`demoreel export\` again`);
    // From the film, the scene is its stretch of it; else its own file, from the start.
    let v, from, n;
    if (manifest.film) {
      v = "film";
      from = Math.round(row.start * fps);
      n = frames(row.duration);
    } else {
      v = `v${s.n}`;
      from = 0;
      n = silent(join(outDir, "scenes", `${s.id}.mp4`), s.id, v);
    }

    let voice = "";
    if (s.audio) {
      const source = join(dir, s.audio);
      const copy = join(tdir, "audio", `${s.id}${extname(s.audio)}`);
      copyFileSync(source, copy);
      const a = probe(copy, "stream=sample_rate,channels:format=duration", "a:0");
      const rate = RATES.includes(Number(a.streams[0].sample_rate)) ? Number(a.streams[0].sample_rate) : 48000;
      const length = parseFloat(a.format.duration);
      const asset = `a${s.n}`;
      resources += `    <asset id="${asset}" name="${esc(s.id)} voice" src="${esc(pathToFileURL(resolve(copy)).href)}" start="0s" duration="${Math.round(length * rate)}/${rate}s" hasAudio="1" audioSources="1" audioChannels="${a.streams[0].channels}" audioRate="${rate}"/>\n`;
      // Under the scene's picture, starting where demoreel starts the voice. A clip attached to another is placed in
      // that clip's own time, which for a stretch of the film starts at the stretch's start. Its markers are in its own
      // time, from the start of the take.
      const marks = sentenceStarts(dir, s).map((m, k) =>
        `\n                <marker start="${Math.round(m.at * rate)}/${rate}s" duration="${t(1)}" value="${k + 1}. ${esc(m.text)}"/>`).join("");
      const open = `<asset-clip ref="${asset}" lane="-1" offset="${t(from + frames(s.audioOffset ?? 0.3))}" name="${esc(s.id)} voice" start="0s" duration="${Math.round(length * rate)}/${rate}s"`;
      voice = `\n              ${open}${marks ? `>${marks}\n              </asset-clip>` : "/>"}\n            `;
    }
    // A marker sits in the clip's own time, so at its start.
    const marker = `${voice ? "  " : "\n              "}<marker start="${t(from)}" duration="${t(1)}" value="${esc(chapterName(s))}"/>\n            `;
    // The narration as the clip's note, which comes first in a clip.
    const said = cleanNarration(s.narration);
    const note = said ? `\n              <note>${esc(said)}</note>` : "";
    spine += `            <asset-clip ref="${v}" offset="${t(at)}" name="${esc(s.id)}" start="${t(from)}" duration="${t(n)}" format="r1" tcFormat="NDF">${note}${voice}${marker}</asset-clip>\n`;
    at += n;
  }

  const name = esc(cfg.title ?? cfg.name ?? "demo");
  writeFileSync(join(tdir, `${(cfg.name ?? "demo").replace(/[^\w.-]+/g, "-")}.fcpxml`), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>

<fcpxml version="1.8">
  <resources>
    <format id="r1" name="FFVideoFormat${format.width}x${format.height}p${fps}" frameDuration="${t(1)}" width="${format.width}" height="${format.height}" colorSpace="1-1-1 (Rec. 709)"/>
${resources}  </resources>
  <library>
    <event name="${name}">
      <project name="${name}">
        <sequence format="r1" duration="${t(at)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spine}          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`);
  if (existsSync(join(outDir, "captions.srt"))) copyFileSync(join(outDir, "captions.srt"), join(tdir, "captions.srt"));
  writeFileSync(join(tdir, "HOW-TO.txt"), [
    `${cfg.title ?? "Demo"}: a timeline for an editor`,
    "",
    "DaVinci Resolve (free): File > Import > Timeline, and choose the .fcpxml here. Scenes are on the main track, silent;",
    "each recorded voice is on an audio track under its scene. Final Cut Pro: File > Import > XML.",
    "If clips show as offline, relink them to the video/ and audio/ folders here (the file points at them by path, so",
    "keep the folder where it was or relink after moving it).",
    existsSync(join(tdir, "captions.srt")) ? "Captions: captions.srt, imported as a subtitle track (Resolve: File > Import > Subtitle)." : "",
    "",
    "Written by demoreel, which has not been able to test the import in every version of these apps: if one refuses the",
    "file, its error message is the thing to send back.",
    "",
  ].join("\n"));
  return { dir: tdir, scenes: cfg.scenes.length, seconds: at / fps };
}
