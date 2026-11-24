// script.md in a project. The rules for reading it are in spec/script.json (test/spec.test.mjs runs them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../src/build.mjs";

test("a project with script.md takes its narration from it, not from demo.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "demoreel-script-"));
  writeFileSync(join(dir, "demo.json"), JSON.stringify({ scenes: [
    { type: "bullets", id: "intro", title: "Hi", narration: "Old words." },
    { type: "bullets", id: "close", title: "Bye", narration: "Stays out." },
  ] }));
  writeFileSync(join(dir, "script.md"), "## intro · 01\n\nNew words.\n\nTwo chunks.\n");
  const cfg = load(dir);
  assert.equal(cfg.scenes[0].narration, "New words.\nTwo chunks.");
  assert.equal(cfg.scenes[1].narration, "");
});

