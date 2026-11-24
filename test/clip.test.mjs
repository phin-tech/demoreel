import { test } from "node:test";
import assert from "node:assert/strict";
import { clipSeconds, rangeEvents, cues } from "../src/build.mjs";

const recorded = {
  fps: 30, frames: 300, window: { w: 1440, h: 900 },
  events: [{ frame: 10, kind: "key", key: "j" }, { frame: 90, kind: "click", x: 5, y: 6 }, { frame: 150, kind: "key", key: "cmd-k" }, { frame: 240, kind: "click", x: 1, y: 2 }],
};

test("a clip plays from `from` to `to`, else to the end of its recording or video", () => {
  assert.equal(clipSeconds({ events: recorded }), 10);
  assert.equal(clipSeconds({ from: 2, to: 6.5, events: recorded }), 4.5);
  assert.equal(clipSeconds({ from: 3, events: recorded }), 7);
  assert.equal(clipSeconds({ from: 0, to: 12.4 }), 12.4);
  assert.equal(clipSeconds({ from: 1.5, length: 20.25 }), 18.75);
  assert.equal(clipSeconds({ events: { frames: 50 }, fps: 25 }), 2);
});

test("a `to` past the end of the recording stops at its end", () => {
  assert.equal(clipSeconds({ from: 4, to: 60, events: recorded }), 6);
});

test("a range that ends before it starts, or starts before 0, is an error", () => {
  assert.throws(() => clipSeconds({ from: 5, to: 5 }), /ends/);
  assert.throws(() => clipSeconds({ from: 11, events: recorded }), /ends/);
  assert.throws(() => clipSeconds({ from: -1, to: 3 }), /from/);
});

test("events outside the range are dropped and the rest start from `from`", () => {
  const r = rangeEvents(recorded, 2, 4, 30);
  assert.equal(r.frames, 120);
  assert.equal(r.fps, 30);
  assert.deepEqual(r.window, recorded.window);
  assert.deepEqual(r.events, [{ frame: 30, kind: "click", x: 5, y: 6 }, { frame: 90, kind: "key", key: "cmd-k" }]);
  assert.equal(recorded.events[1].frame, 90, "the recording itself is left alone");
});

test("a whole recording keeps every event", () => {
  assert.deepEqual(rangeEvents(recorded, 0, 10, 30).events, recorded.events);
});

test("a clip with no events has no cues", () => {
  const s = { type: "clip", events: rangeEvents({ fps: 30, events: [] }, 0, 12.4, 30) };
  assert.deepEqual(cues(s), []);
});

test("cues of a ranged clip are timed from its own start", () => {
  const s = { type: "clip", events: rangeEvents(recorded, 2, 4, 30) };
  assert.deepEqual(cues(s), [{ t: 1, label: "click" }, { t: 3, label: "key cmd-k" }]);
});
