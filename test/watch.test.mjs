// `watch` exports again for a change to what the film is made from, and not for its own output or a take being recorded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matters } from "../src/watch.mjs";

const dir = mkdtempSync(join(tmpdir(), "demoreel-watch-"));
mkdirSync(join(dir, "audio"));
writeFileSync(join(dir, "demo.json"), JSON.stringify({ scenes: [
  { type: "bullets", id: "intro", cards: [{ image: "shots/queue.png" }], audio: "./audio/mine.wav" },
  { type: "clip", id: "browse" },
  { type: "diagram", id: "how", source: "how.mmd" },
] }));
writeFileSync(join(dir, "audio/takes.json"), JSON.stringify({ "02-browse": "02-browse-take-3.wav" }));

test("demo.json, the chosen takes, and every file a scene names count", () => {
  for (const rel of ["demo.json", "audio/takes.json", "shots/queue.png", "audio/mine.wav", "how.mmd", "browse.mp4", "browse.events.json", "audio/02-browse-take-3.wav"]) {
    assert.equal(matters(dir, rel), true, rel);
  }
});

test("demoreel's own output, Booth's marks, and a take nobody chose don't", () => {
  for (const rel of ["index.html", "scene-01.html", "out/manifest.json", "build/voice/x.wav", "deck/index.html", "audio/02-browse-take-4.wav", "audio/02-browse-take-3.marks.json", "notes.txt"]) {
    assert.equal(matters(dir, rel), false, rel);
  }
});
