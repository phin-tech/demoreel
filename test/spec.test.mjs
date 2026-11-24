// The cases in spec/, which Booth's tests run too: the rules the two must agree on (see spec/README.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chunks, sentences } from "../src/build.mjs";
import { keys, narrations, parse } from "../src/script.mjs";

const spec = (name) => JSON.parse(readFileSync(new URL(`../spec/${name}.json`, import.meta.url), "utf8"));

const chunkCases = spec("chunks");
for (const c of chunkCases.chunks) test(`chunks: ${c.why}`, () => assert.deepEqual(chunks(c.narration), c.chunks));
for (const c of chunkCases.sentences) test(`sentences: ${c.why}`, () => assert.deepEqual(sentences(c.text), c.sentences));

const script = spec("script");
for (const c of script.keys) test(`script keys: ${c.why}`, () => assert.deepEqual(keys(c.names), c.keys));
for (const c of script.parse) test(`script parse: ${c.why}`, () => assert.deepEqual(parse(c.markdown), c.sections));
for (const c of script.narrations) {
  test(`script narrations: ${c.why}`, () => assert.deepEqual(narrations(c.markdown, c.names, c.refs), { byScene: c.byScene, unknown: c.unknown }));
}
