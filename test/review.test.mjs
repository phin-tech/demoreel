import { test } from "node:test";
import assert from "node:assert/strict";
import { misheard, quiet } from "../src/review.mjs";

const heard = (text) => text.split(" ").map((t) => ({ text: t }));

test("words read wrong or dropped are found, with what was heard instead", () => {
  assert.deepEqual(misheard("demoreel turns your app into a demo video.", heard("Tomorrow turns your app into a demo video")),
    [{ meant: "demoreel", heard: "Tomorrow" }]);
  assert.deepEqual(misheard("Save it to script.md, to edit.", heard("Save it to script.amd to edit")),
    [{ meant: "script.md,", heard: "script.amd" }]);
  assert.deepEqual(misheard("Tick the one to use.", heard("Tick the one")), [{ meant: "to use.", heard: "" }]);
  assert.deepEqual(misheard("All [chuckle] good.", heard("All good")), [], "audio tags aren't words");
});

test("long quiet stretches are found, before, between and after the words", () => {
  const words = [{ start: 0, end: 2 }, { start: 7, end: 8 }];
  assert.deepEqual(quiet(words, 14, 0.5), [{ from: 2.5, to: 7.5 }, { from: 8.5, to: 14 }]);
  assert.deepEqual(quiet(words, 9, 0.5), [{ from: 2.5, to: 7.5 }]);
});
