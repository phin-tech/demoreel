// The shared rules for chunks and sentences are in spec/chunks.json (test/spec.test.mjs runs them, as Booth's tests do).
// What is only demoreel's is here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chunks } from "../src/build.mjs";

test("a narration that isn't there has no chunks", () => {
  assert.deepEqual(chunks(undefined), []);
});
