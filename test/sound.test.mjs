import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eventTime, fitSkips } from "../src/build.mjs";
import { keepSounds } from "../src/record.mjs";

const recorded = { fps: 30, frames: 600, events: [
  { frame: 30, kind: "click", x: 1, y: 1 }, { frame: 90, kind: "click", x: 1, y: 1 }, { frame: 450, kind: "key", key: "m" },
] };

test("a time can name an event, with seconds after or before it", () => {
  assert.equal(eventTime(4.5, recorded), 4.5);
  assert.equal(eventTime("event:2", recorded), 3);
  assert.equal(eventTime("event:2+0.5", recorded), 3.5);
  assert.equal(eventTime("event:-1-1", recorded), 14);
  assert.throws(() => eventTime("event:9", recorded), /has 3 events/);
  assert.throws(() => eventTime("soon", recorded), /not a time/);
});

test("fit leaves out the longest quiet stretch first, keeping a second after and half before each event", () => {
  // From 0 to 20s: quiet 4–14.5 (after the click at 3s, before the key at 15s) is the longest.
  assert.deepEqual(fitSkips(recorded, 0, 20, [], 12), [{ from: 4, to: 12 }]);
  assert.deepEqual(fitSkips(recorded, 0, 20, [], 30), [], "already short enough");
});

test("fit doesn't cut while a sound plays, or inside a skip already there", () => {
  const playing = { ...recorded, events: [...recorded.events, { frame: 120, kind: "sound", seconds: 8 }] };
  const cuts = fitSkips(playing, 0, 20, [], 10);
  assert.ok(cuts.every((k) => k.to <= 4 || k.from >= 13), JSON.stringify(cuts));
  assert.deepEqual(fitSkips(recorded, 0, 20, [{ from: 5, to: 9 }], 12).filter((k) => k.from < 9 && k.to > 5), []);
});

test("record keeps what the app played beside the clip, and the events name the copies", () => {
  const dir = mkdtempSync(join(tmpdir(), "demoreel-sound-"));
  mkdirSync(join(dir, "elsewhere"));
  writeFileSync(join(dir, "elsewhere", "take.wav"), "RIFF");
  const events = { events: [{ frame: 1, kind: "sound", file: join(dir, "elsewhere", "take.wav") }, { frame: 2, kind: "sound", file: "/no/such.wav" }] };
  keepSounds(dir, { id: "voices" }, events);
  assert.deepEqual(readdirSync(join(dir, "voices.sounds")), ["01-take.wav"]);
  assert.deepEqual(events.events, [{ frame: 1, kind: "sound", file: "voices.sounds/01-take.wav" }]);
  assert.ok(!existsSync(join(dir, "elsewhere", "take.wav")) === false);
});
