import { test } from "node:test";
import assert from "node:assert/strict";
import { burnedCaptions } from "../src/build.mjs";

const scenes = [
  { n: "01", start: 0, audioOffset: 0.5, captions: [{ start: 0.2, end: 1.8, text: "First <line>." }] },
  { n: "02", start: 10, audioOffset: 0.5, captions: [{ start: 0, end: 2, text: "Second." }] },
  { n: "03", start: 15 },
];

test("burned captions are timed like captions.vtt: the scene's start, its audio offset, the cue", () => {
  const c = burnedCaptions({}, scenes);
  assert.match(c.html, /id="cc01x0"><span>First &lt;line&gt;\.<\/span>/);
  assert.match(c.js, /tl\.to\("#cc01x0",\{opacity:1,duration:\.12\},0\.7\)/);
  assert.match(c.js, /tl\.to\("#cc02x0",\{opacity:1,duration:\.12\},10\.5\)/);
  assert.match(c.js, /tl\.to\("#cc02x0",\{opacity:0,duration:\.12\},12\.38\)/);
});

test("a scene's own page times its captions from 0, and no captions is nothing to draw", () => {
  assert.match(burnedCaptions({}, [scenes[1]], () => 0).js, /\},0\.5\)/);
  assert.equal(burnedCaptions({}, [scenes[2]]), null);
});
