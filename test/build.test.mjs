// The film page: drawn at its layout size for HyperFrames to scale, its theme as variables, a scene's own theme, and
// motion blur on the pointer only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, load, resolutionArgs, THEME } from "../src/build.mjs";

function project(demo) {
  const dir = mkdtempSync(join(tmpdir(), "demoreel-build-"));
  writeFileSync(join(dir, "demo.json"), JSON.stringify(demo));
  return dir;
}

const bullets = (extra = {}) => ({ type: "bullets", id: "intro", title: "Hello", bullets: ["One"], ...extra });

test("the 4K film is a 1080p page that HyperFrames renders at the 4K preset", () => {
  const dir = project({ scenes: [bullets()] });
  const cfg = build(dir);
  const html = readFileSync(join(dir, "index.html"), "utf8");
  assert.match(html, /data-width="1920" data-height="1080"/);
  assert.doesNotMatch(html, /transform: scale/);
  assert.deepEqual(resolutionArgs(cfg), ["--resolution", "landscape-4k"]);
});

test("scale 1 needs no resolution flag, and a size with no preset is refused", () => {
  assert.deepEqual(resolutionArgs({ width: 1920, height: 1080, scale: 1 }), []);
  assert.deepEqual(resolutionArgs({ width: 1080, height: 1920, scale: 2 }), ["--resolution", "portrait-4k"]);
  assert.throws(() => resolutionArgs({ width: 1600, height: 900, scale: 2 }), /can't draw a 1600x900 film at scale 2/);
});

test("the theme is declared as HyperFrames variables, defaulting to the film's", () => {
  const dir = project({ theme: { accent: "#3a7be8" }, scenes: [bullets()] });
  build(dir);
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const declared = JSON.parse(html.match(/data-composition-variables="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  assert.deepEqual(declared.map((v) => v.id), Object.keys(THEME));
  assert.equal(declared.find((v) => v.id === "accent").default, "#3a7be8");
  assert.match(html, /:root \{ --accent: #3a7be8;/);
});

test("a scene's own theme goes on that scene only", () => {
  const dir = project({ scenes: [bullets({ theme: { accent: "#e83a6b", background: "#123" } }), bullets({ id: "two" })] });
  build(dir);
  const html = readFileSync(join(dir, "index.html"), "utf8");
  assert.match(html, /<div id="s01" class="scene clip"[^>]* style="--accent: #e83a6b; --background: #123;">\s*<div class="backdrop">/);
  assert.match(html, /<div id="s02" class="scene clip"[^>]*data-track-index="2">/);
});

test("an unknown theme key is an error, not ignored", () => {
  assert.throws(() => load(project({ theme: { accnt: "#fff" }, scenes: [bullets()] })), /unknown theme key accnt/);
  assert.throws(() => load(project({ scenes: [bullets({ theme: { colour: "#fff" } })] })), /scene 01-intro: unknown theme key colour/);
});

test("motionBlur turns blur on at the root and off for everything but the pointer", () => {
  const off = project({ scenes: [bullets()] });
  build(off);
  assert.doesNotMatch(readFileSync(join(off, "index.html"), "utf8"), /data-motion-blur/);
  const on = project({ motionBlur: true, scenes: [bullets()] });
  build(on);
  const html = readFileSync(join(on, "index.html"), "utf8");
  assert.match(html, /<div id="root"[^>]* data-motion-blur="on">/);
  assert.match(html, /<div class="left" data-motion-blur="off">/);
});
