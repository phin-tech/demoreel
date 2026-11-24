// A marker at each scene of the one-file export: chapters inside the mp4 (QuickTime, IINA and VLC list them), and the
// same times as text in the form YouTube reads from a video's description.
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { cleanNarration } from "./build.mjs";

/** A scene's name as a chapter: its `chapter`, else its title, else its kicker, else its id. */
export const chapterName = (s) => cleanNarration(s.chapter ?? s.title ?? s.kicker ?? s.id.replace(/^\d+-/, ""));

/** ffmpeg's metadata file with a chapter for each scene, in milliseconds. */
export function ffmetadata(cfg) {
  const lines = [";FFMETADATA1", `title=${meta(cfg.title ?? cfg.name ?? "demo")}`];
  for (const s of cfg.scenes) {
    lines.push("", "[CHAPTER]", "TIMEBASE=1/1000", `START=${Math.round(s.start * 1000)}`, `END=${Math.round((s.start + s.duration) * 1000)}`, `title=${meta(chapterName(s))}`);
  }
  return lines.join("\n") + "\n";
}

// ffmpeg's metadata format escapes these with a backslash.
const meta = (text) => String(text).replace(/[=;#\\\n]/g, (c) => `\\${c}`);

/** `0:00 Title` lines, one per scene. YouTube makes chapters of them when the first is 0:00, there are three or more,
 *  and each lasts ten seconds or longer. */
export function youtubeChapters(cfg) {
  const stamp = (t) => {
    const s = Math.floor(t);
    const h = Math.floor(s / 3600);
    const m = Math.floor(s / 60) % 60;
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  };
  return cfg.scenes.map((s) => `${stamp(s.start)} ${chapterName(s)}`).join("\n") + "\n";
}

/** Writes the scenes into `file` as chapters, in place; the video and sound are copied, not encoded again. */
export function addChapters(file, cfg, workDir) {
  const metaFile = `${workDir}/chapters.ffmetadata`;
  const tmp = `${file}.chapters.mp4`;
  writeFileSync(metaFile, ffmetadata(cfg));
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-i", metaFile, "-map", "0", "-map_metadata", "1",
    "-map_chapters", "1", "-c", "copy", "-movflags", "+faststart", tmp], { encoding: "utf8" });
  if (r.status !== 0) {
    rmSync(tmp, { force: true });
    throw new Error(`ffmpeg could not add chapters to ${file}: ${r.stderr}`);
  }
  renameSync(tmp, file);
}
