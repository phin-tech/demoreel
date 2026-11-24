// The timeline's sentence markers come from the marks Booth keeps beside a take, and only while they fit the script.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sentenceStarts } from "../src/timeline.mjs";

function take(marks) {
  const dir = mkdtempSync(join(tmpdir(), "demoreel-timeline-"));
  mkdirSync(join(dir, "audio"));
  if (marks !== undefined) writeFileSync(join(dir, "audio/01-intro-take-2.marks.json"), typeof marks === "string" ? marks : JSON.stringify(marks));
  return dir;
}

const scene = { recorded: "audio/01-intro-take-2.wav", narration: "[warm] One place for every app.\nA box for each.\nFree." };

test("each sentence starts where the one before it ended, the first at the start of the take", () => {
  const dir = take({ duration: 9, ends: [3.4, 6.1], source: "transcript" });
  assert.deepEqual(sentenceStarts(dir, scene), [
    { at: 0, text: "One place for every app." },
    { at: 3.4, text: "A box for each." },
    { at: 6.1, text: "Free." },
  ]);
});

test("a take that stopped early marks only the sentences it reached", () => {
  assert.deepEqual(sentenceStarts(take({ duration: 4, ends: [3.4] }), scene).map((m) => m.at), [0, 3.4]);
});

test("no marks, unreadable marks, marks for a longer script, or no recorded take: no markers", () => {
  assert.deepEqual(sentenceStarts(take(), scene), []);
  assert.deepEqual(sentenceStarts(take("{not json"), scene), []);
  assert.deepEqual(sentenceStarts(take({ duration: 9, ends: [1, 2, 3, 4] }), scene), []);
  assert.deepEqual(sentenceStarts(take({ duration: 9, ends: [3] }), { narration: scene.narration }), []);
});
