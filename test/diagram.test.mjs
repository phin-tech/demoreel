// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagramImage } from "../src/diagram.mjs";
import { load } from "../src/build.mjs";

const project = (scenes, files = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "demoreel-diagram-"));
  writeFileSync(join(dir, "demo.json"), JSON.stringify({ name: "t", scenes }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};

test("an image source is shown as it is, with no other tool needed", () => {
  const dir = project([], { "arch.png": "x" });
  assert.equal(diagramImage(dir, { id: "a", source: "arch.png" }), "arch.png");
});

test("a diagram scene needs a source that exists and one it knows how to draw", () => {
  const dir = project([], { "arch.vsdx": "x" });
  assert.throws(() => diagramImage(dir, { id: "a" }), /needs a "source"/);
  assert.throws(() => diagramImage(dir, { id: "a", source: "missing.mmd" }), /not found/);
  assert.throws(() => diagramImage(dir, { id: "a", source: "arch.vsdx" }), /don't know how to draw/);
});

test("a missing Dottie is explained, not a crash", () => {
  const dir = project([], { "flow.mmd": "flowchart LR\n A-->B\n" });
  const was = process.env.DEMOREEL_DOTTIE;
  process.env.DEMOREEL_DOTTIE = join(dir, "no-such-dottie");
  try {
    assert.throws(() => diagramImage(dir, { id: "a", source: "flow.mmd" }), /isn't on your PATH/);
  } finally {
    if (was === undefined) delete process.env.DEMOREEL_DOTTIE; else process.env.DEMOREEL_DOTTIE = was;
  }
});

test("load turns a diagram scene into a title over one wide card, and keeps its narration", () => {
  const dir = project(
    [{ type: "diagram", id: "how", source: "arch.png", title: "How", narration: "One two three.", width: 1400, y: 300 }],
    { "arch.png": "x" },
  );
  const [s] = load(dir).scenes;
  assert.equal(s.type, "bullets");
  assert.equal(s.layout, "top");
  assert.deepEqual(s.cards[0], { image: "arch.png", x: 260, y: 300, width: 1400, delay: 0.3 });
  assert.equal(s.narration, "One two three.");
});

test("a hub scene mounts a copy of the block that lasts as long as the scene, and a film can have one", () => {
  const dir = project([
    { type: "diagram", id: "how", title: "How", hub: "App", nodes: ["A", "B"], cues: [1, 2], accent: "violet", duration: 10 },
  ]);
  mkdirSync(join(dir, "compositions/components"), { recursive: true });
  writeFileSync(join(dir, "compositions/components/constellation-hub.html"),
    '<html data-composition-duration="4.5"><div id="root" data-duration="4.5"></div><script>var durationValue = Number(root.dataset.duration);</script></html>');
  const [s] = load(dir).scenes;
  assert.equal(s.block.src, "build/hub-9.3.html");
  assert.deepEqual(s.block.vars, { hub_label: "App", nodes: "A,B", cues: "1,2", accent: "violet" });
  const copy = readFileSync(join(dir, s.block.src), "utf8");
  assert.match(copy, /data-duration="9\.3"/);
  assert.match(copy, /var durationValue = 9\.3;/);
  assert.ok(readFileSync(join(dir, "compositions/components/constellation-hub.html"), "utf8").includes("4.5"), "the registry's file is left as it came");

  const two = project([
    { type: "diagram", id: "a", hub: "X", nodes: ["A"] },
    { type: "diagram", id: "b", hub: "Y", nodes: ["B"] },
  ]);
  mkdirSync(join(two, "compositions/components"), { recursive: true });
  writeFileSync(join(two, "compositions/components/constellation-hub.html"), '<html data-duration="4.5"><script>var durationValue = Number(root.dataset.duration);</script></html>');
  assert.throws(() => load(two), /one hub diagram/);
});

test("a hub needs nodes", () => {
  const dir = project([{ type: "diagram", id: "a", hub: "X" }]);
  mkdirSync(join(dir, "compositions/components"), { recursive: true });
  writeFileSync(join(dir, "compositions/components/constellation-hub.html"), "x");
  assert.throws(() => load(dir), /"nodes"/);
});
