// Run with `npm test`. Booth splits a narration the same way (its tests use these examples), so change both together.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chunks, sentences } from "../src/build.mjs";

test("with no line break, a chunk is a sentence", () => {
  assert.deepEqual(chunks("Open the changes. Leave notes in ink! Want a tour? Yes."),
    ["Open the changes.", "Leave notes in ink!", "Want a tour?", "Yes."]);
});

test("a line break ends a chunk, which can hold several sentences", () => {
  assert.deepEqual(chunks("Open the changes. Read them properly.\nLeave notes in ink.\n\nSee a diagram. Then ship."),
    ["Open the changes. Read them properly.", "Leave notes in ink.", "See a diagram. Then ship."]);
  assert.deepEqual(chunks("One.\r\nTwo."), ["One.", "Two."]);
});

test("audio tags are not part of a chunk, and a line of nothing but tags is not a chunk", () => {
  assert.deepEqual(chunks("[enthusiasm] Red Pen is local, [natural pace] fast and private.\n[pause]\n[bold] Review faster."),
    ["Red Pen is local, fast and private.", "Review faster."]);
});

test("one line with a trailing break is still split by sentence", () => {
  assert.deepEqual(chunks("One. Two.\n"), ["One.", "Two."]);
});

test("a full stop inside a word does not end a sentence", () => {
  assert.deepEqual(sentences("Version 1.2 is out. Try it."), ["Version 1.2 is out.", "Try it."]);
  // a run of marks ends it once, at the last (an ellipsis before a space ends one, like any full stop, as in Booth)
  assert.deepEqual(sentences("Wait... what?! Fine."), ["Wait...", "what?!", "Fine."]);
});

test("no narration has no chunks", () => {
  assert.deepEqual(chunks(""), []);
  assert.deepEqual(chunks(undefined), []);
  assert.deepEqual(chunks("[pause]"), []);
});
