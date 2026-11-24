// The one-file export's markers: chapters for the mp4, a YouTube list, and a manifest that says which file is the film.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chapterName, ffmetadata, youtubeChapters } from "../src/chapters.mjs";
import { writeStoryboard } from "../src/build.mjs";

const cfg = {
  title: "Store; tour",
  fps: 30,
  total: 75.5,
  scenes: [
    { id: "01-intro", type: "bullets", title: "A store = apps", start: 0, duration: 9.3 },
    { id: "02-browse", type: "clip", events: { events: [] }, start: 9.3, duration: 7.3 },
    { id: "03-outro", type: "clip", events: { events: [] }, chapter: "Get it", start: 16.6, duration: 58.9 },
  ],
};

test("a chapter is named by `chapter`, then the title, then the kicker, then the scene's name", () => {
  assert.equal(chapterName(cfg.scenes[0]), "A store = apps");
  assert.equal(chapterName(cfg.scenes[1]), "browse");
  assert.equal(chapterName(cfg.scenes[2]), "Get it");
  assert.equal(chapterName({ id: "04-x", kicker: "How it works" }), "How it works");
});

test("ffmpeg's metadata has a chapter per scene in milliseconds, with its special characters escaped", () => {
  const meta = ffmetadata(cfg);
  assert.match(meta, /^;FFMETADATA1\ntitle=Store\\; tour\n/);
  assert.match(meta, /\[CHAPTER\]\nTIMEBASE=1\/1000\nSTART=0\nEND=9300\ntitle=A store \\= apps/);
  assert.match(meta, /START=16600\nEND=75500\ntitle=Get it/);
});

test("the YouTube list starts at 0:00, one line per scene", () => {
  assert.equal(youtubeChapters(cfg), "0:00 A store = apps\n0:09 browse\n0:16 Get it\n");
  assert.equal(youtubeChapters({ scenes: [{ id: "01-a", start: 3725 }] }), "1:02:05 a\n");
});

test("the manifest names the film when the export is one file, and each scene's file otherwise", () => {
  const one = mkdtempSync(join(tmpdir(), "demoreel-chapters-"));
  writeStoryboard(one, cfg, one, { film: "store.mp4" });
  const film = JSON.parse(readFileSync(join(one, "manifest.json"), "utf8"));
  assert.equal(film.film, "store.mp4");
  assert.deepEqual(film.scenes.map((s) => [s.file, s.start, s.duration]), [["store.mp4", 0, 9.3], ["store.mp4", 9.3, 7.3], ["store.mp4", 16.6, 58.9]]);

  const each = mkdtempSync(join(tmpdir(), "demoreel-chapters-"));
  writeStoryboard(each, cfg, each);
  const scenes = JSON.parse(readFileSync(join(each, "manifest.json"), "utf8"));
  assert.equal(scenes.film, undefined);
  assert.equal(scenes.scenes[1].file, "scenes/02-browse.mp4");
});

test("captions come as WebVTT too, timed along the film or within the scene", async () => {
  const { vtt } = await import("../src/build.mjs");
  const rows = [
    { start: 0, audioOffset: 0.3, captions: [{ start: 0, end: 1.25, text: "One place." }] },
    { start: 9.3, audioOffset: 0.3, captions: [{ start: 0.5, end: 2, text: "Pick a box." }] },
  ];
  assert.equal(vtt(rows, true), "WEBVTT\n\n00:00:00.300 --> 00:00:01.550\nOne place.\n\n00:00:10.100 --> 00:00:11.600\nPick a box.\n");
  assert.equal(vtt([rows[1]], false), "WEBVTT\n\n00:00:00.800 --> 00:00:02.300\nPick a box.\n");
  assert.equal(vtt([{ start: 0, captions: [] }], true), "");
});
