// `demoreel review`: what to look at before a render, in out/review.md. For each scene, how long it lasts against how
// long its voice speaks (a scene much longer than its voice is quiet for the rest), the words the voice was meant to
// say that it didn't say as written (heard by Parakeet: a name read wrong, a word dropped), and any stretch of the scene
// where nothing is said for long. Two stills a scene are taken beside it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanNarration } from "./build.mjs";
import { transcribe } from "./captions.mjs";
import { round } from "./util.mjs";

const r1 = (n) => Math.round(n * 10) / 10;
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** The script's words that weren't heard as written, in order, each with the words heard in their place. */
export function misheard(script, heard) {
  const a = cleanNarration(script).split(/\s+/).filter(Boolean);
  const b = heard.map((w) => w.text ?? w);
  const A = a.map(norm), B = b.map(norm);
  // Longest common subsequence, then the stretches of the script outside it.
  const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
    L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0, said = [], meant = [];
  const flush = () => {
    if (meant.length) out.push({ meant: meant.join(" "), heard: said.join(" ") });
    said = []; meant = [];
  };
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { flush(); i++; j++; }
    else if (j < B.length && (i >= A.length || L[i][j + 1] >= L[i + 1][j])) said.push(b[j++]);
    else meant.push(a[i++]);
  }
  flush();
  return out;
}

/** Stretches longer than `longest` seconds in a scene where its voice says nothing: before it starts, between words, after. */
export function quiet(words, duration, offset, longest = 4, sounds = []) {
  // What the clip plays (a take, a chime) counts as heard, as the voice does.
  const times = [[0, offset], ...words.map((w) => [offset + w.start, offset + w.end]), ...sounds.map((k) => [k.at, k.at + k.seconds]), [duration, duration]]
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (let k = 1; k < times.length; k++) {
    const from = Math.max(...times.slice(0, k).map((t) => t[1])), to = times[k][0];
    if (to - from > longest) out.push({ from: round(from), to: round(to) });
  }
  return out;
}

export function writeReview(dir, cfg) {
  const md = [`# ${cfg.title ?? cfg.name ?? "Demo"}: review`, "", `${cfg.scenes.length} scenes, ${r1(cfg.total)}s. Stills are in out/snapshots/.`, ""];
  let flagged = 0;
  for (const s of cfg.scenes) {
    md.push(`## ${s.id} (${r1(s.start)}s, lasts ${r1(s.duration)}s)`, "");
    if (!s.narration) { md.push("No narration.", ""); continue; }
    if (!s.audio) { md.push("No voice yet: nothing to listen to.", ""); continue; }
    let words;
    try {
      words = transcribe(dir, s);
    } catch (e) {
      md.push(`Couldn't hear it: ${e.message}`, "");
      continue;
    }
    const spare = s.duration - (s.audioSeconds ?? 0);
    md.push(`Voice ${r1(s.audioSeconds ?? 0)}s${spare > 4 ? `, then **${r1(spare)}s with nothing said**` : ""}.`);
    for (const m of misheard(s.narration, words)) {
      flagged++;
      md.push(`- **"${m.meant}"** was heard as ${m.heard ? `"${m.heard}"` : "nothing"}`);
    }
    for (const q of quiet(words, s.duration, s.audioOffset ?? 0.5, 4, s.type === "clip" ? s.sounds ?? [] : [])) {
      flagged++;
      md.push(`- quiet from ${q.from}s to ${q.to}s into the scene`);
    }
    md.push("");
  }
  writeFileSync(join(dir, "out", "review.md"), md.join("\n") + "\n");
  return flagged;
}
