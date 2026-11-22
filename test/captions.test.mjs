import { test } from "node:test";
import assert from "node:assert/strict";
import { align, cues } from "../src/captions.mjs";

const heard = (...words) => words.map(([text, start, end]) => ({ text, start, end }));

test("captions show the words of the script, timed by when they were said", () => {
  const words = align("Red Pen puts every pull request in one queue.",
    heard(["Red", 0.2, 0.4], ["Pen", 0.4, 0.7], ["puts", 0.7, 1.0], ["every", 1.0, 1.2], ["pull", 1.2, 1.5], ["request", 1.5, 1.9], ["in", 1.9, 2.0], ["one", 2.0, 2.2], ["queue", 2.3, 2.9]));
  assert.deepEqual(words.map((w) => w.text), ["Red", "Pen", "puts", "every", "pull", "request", "in", "one", "queue."]);
  assert.equal(words[0].start, 0.2);
  assert.equal(words[8].end, 2.9);
});

test("a word that was misheard still gets a time between its neighbours", () => {
  const words = align("what needs you at the top", heard(["what", 1, 1.2], ["needs", 1.2, 1.5], ["in", 1.5, 1.6], ["at", 1.6, 1.8], ["the", 1.8, 1.9], ["top", 1.9, 2.3]));
  assert.deepEqual(words.map((w) => w.text), ["what", "needs", "you", "at", "the", "top"]);
  const you = words[2];
  assert.ok(you.start >= words[1].end && you.end <= words[3].start + 1e-9, "between needs and at");
});

test("audio tags in the narration are not captioned", () => {
  const words = align("[enthusiasm] Hello there.", heard(["Hello", 0, 0.4], ["there", 0.4, 0.8]));
  assert.deepEqual(words.map((w) => w.text), ["Hello", "there."]);
});

test("a sentence end always ends a caption", () => {
  const w = [["One", 0, 0.2], ["two.", 0.2, 0.4], ["Three", 0.5, 0.7], ["four.", 0.7, 0.9]].map(([text, start, end]) => ({ text, start, end }));
  assert.deepEqual(cues(w).map((c) => c.text), ["One two.", "Three four."]);
});

test("a comma ends a caption once there are a few words to read", () => {
  const w = "Red Pen puts every pull request in one queue, with what needs you."
    .split(" ").map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
  assert.deepEqual(cues(w).map((c) => c.text), ["Red Pen puts every pull request in one queue,", "with what needs you."]);
});

test("a long pause ends a caption", () => {
  const w = [["Hello", 0, 0.3], ["again", 3, 3.3]].map(([text, start, end]) => ({ text, start, end }));
  assert.equal(cues(w).length, 2);
});
