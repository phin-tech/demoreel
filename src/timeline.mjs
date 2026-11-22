// A timeline file for an editor that has a real timeline, such as DaVinci Resolve (free) or Final Cut: each scene's video on
// the main track, silent, and its voice on an audio track under it, where the voice starts. Written as FCPXML 1.8, which
// Resolve and Final Cut both open. The media is copied beside it, so the folder can be moved as a whole.
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { esc } from "./util.mjs";


function probe(file, entries, stream) {
  const args = ["-v", "error", ...(stream ? ["-select_streams", stream] : []), "-show_entries", entries, "-of", "json", file];
  const r = spawnSync("ffprobe", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe could not read ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout);
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

  let format = null;
  let resources = "";
  let spine = "";
  let at = 0;
  for (const s of cfg.scenes) {
    const scene = join(outDir, "scenes", `${s.id}.mp4`);
    if (!existsSync(scene)) throw new Error(`out/scenes/${s.id}.mp4 is missing: run \`demoreel export\` first`);
    // The scene's own mp4 has its voice in it; the timeline keeps the voice apart, so its video is copied without sound.
    const video = join(tdir, "video", `${s.id}.mp4`);
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", scene, "-an", "-c:v", "copy", video]);
    if (r.status !== 0) throw new Error(`ffmpeg could not copy ${scene}: ${r.stderr}`);
    const info = probe(video, "stream=width,height:format=duration", "v:0");
    const { width, height } = info.streams[0];
    format ??= { width, height };
    const n = frames(parseFloat(info.format.duration));
    const v = `v${s.n}`;
    resources += `    <asset id="${v}" name="${esc(s.id)}" src="${esc(pathToFileURL(resolve(video)).href)}" start="0s" duration="${t(n)}" hasVideo="1" format="r1"/>\n`;

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
      // Under the scene's picture, starting where demoreel starts the voice.
      voice = `\n              <asset-clip ref="${asset}" lane="-1" offset="${t(frames(s.audioOffset ?? 0.3))}" name="${esc(s.id)} voice" start="0s" duration="${Math.round(length * rate)}/${rate}s"/>\n            `;
    }
    spine += `            <asset-clip ref="${v}" offset="${t(at)}" name="${esc(s.id)}" start="0s" duration="${t(n)}" format="r1" tcFormat="NDF">${voice}</asset-clip>\n`;
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
