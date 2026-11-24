// Captions from real audio: Parakeet (through `hyperframes transcribe`, on this machine) gives each spoken word a time, those
// times are laid onto the words of the script so the text is what was meant and the timing is what was said, and the
// words are grouped into cues.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cleanNarration } from "./build.mjs";
import { hyperframes } from "./hyperframes.mjs";
import { round } from "./util.mjs";

const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** The spoken words of a scene's audio with their times, from a cache in build/ unless the audio has changed. */
export function transcribe(dir, s) {
  const source = join(dir, s.audio);
  const cache = join(dir, "build", `${s.id}.words.json`);
  const stamp = statSync(source).mtimeMs;
  if (existsSync(cache)) {
    const saved = JSON.parse(readFileSync(cache, "utf8"));
    if (saved.audio === s.audio && saved.stamp === stamp) return saved.words;
  }
  const work = join(dir, "build", "transcribe");
  mkdirSync(work, { recursive: true });
  // Parakeet reads wav, mono, 16 kHz.
  const wav = join(work, `${s.id}.wav`);
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-ar", "16000", "-ac", "1", wav]);
  if (r.status !== 0) throw new Error(`ffmpeg could not read ${s.audio}: ${r.stderr}`);
  const t = hyperframes(["transcribe", wav, "-e", "parakeet", "--json"], { cwd: work, encoding: "utf8" });
  // The result line names the file the words were written to, an array of {text, start, end}.
  const lines = (t.stdout ?? "").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  const done = lines.find((l) => l.ok === true && l.transcriptPath);
  if (!done) {
    const why = lines.find((l) => l.ok === false)?.error?.message ?? lines.find((l) => l.reason)?.reason ?? t.stderr;
    throw new Error(`could not transcribe ${s.audio}: ${why}. Parakeet is installed with \`npx hyperframes models install parakeet\`.`);
  }
  const words = JSON.parse(readFileSync(done.transcriptPath, "utf8"));
  writeFileSync(cache, JSON.stringify({ audio: s.audio, stamp, words }));
  return words;
}

// Equal, one a prefix of the other (a clipped word), or one letter wrong in a word long enough to bear it.
function similar(a, b) {
  if (a === b) return true;
  if (a.length >= 3 && b.startsWith(a)) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return Math.max(a.length, b.length) - i - j <= 1;
}

/** The script's words with the times they were said: each is matched to the next heard word that is like it, and the
 *  ones with no match (a word misheard or skipped) take a time between their neighbours. */
export function align(script, heard) {
  const words = cleanNarration(script).split(/\s+/).filter(Boolean);
  const times = words.map(() => null);
  let h = 0;
  words.forEach((w, i) => {
    for (let k = h; k < Math.min(heard.length, h + 4); k++) {
      if (similar(norm(heard[k].text), norm(w))) { times[i] = { start: heard[k].start, end: heard[k].end }; h = k + 1; break; }
    }
  });
  // Fill the gaps evenly between the nearest matched words (or the start and end of the speech).
  const first = heard[0]?.start ?? 0;
  const last = heard.at(-1)?.end ?? first;
  let i = 0;
  while (i < words.length) {
    if (times[i]) { i++; continue; }
    let j = i;
    while (j < words.length && !times[j]) j++;
    const from = i > 0 ? times[i - 1].end : first;
    const to = j < words.length ? times[j].start : Math.max(last, from);
    for (let n = i; n < j; n++) {
      const a = from + ((to - from) * (n - i)) / (j - i);
      const b = from + ((to - from) * (n - i + 1)) / (j - i);
      times[n] = { start: a, end: b };
    }
    i = j;
  }
  return words.map((text, n) => ({ text, start: round(times[n].start), end: round(times[n].end) }));
}

/** Caption cues from timed words: a sentence end or a pause ends one, and so does too many words or too long on screen. */
export function cues(words, { maxWords = 10, maxSeconds = 4.5, pause = 0.7 } = {}) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (cur.length) out.push({ start: cur[0].start, end: cur.at(-1).end, text: cur.map((w) => w.text).join(" ") });
    cur = [];
  };
  words.forEach((w, i) => {
    if (cur.length && (cur.length >= maxWords || w.end - cur[0].start > maxSeconds || w.start - cur.at(-1).end > pause)) flush();
    cur.push(w);
    // A sentence end always ends a cue, and a comma does once there are a few words to read.
    if (/[.!?]$/.test(w.text) || (/[,;:]$/.test(w.text) && cur.length >= 4) || i === words.length - 1) flush();
  });
  return out;
}
