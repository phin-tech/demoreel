import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bounced, cookieParam, readSession, writeSession } from "../src/session.mjs";

test("a session cookie loses its expiry and unknown fields are dropped", () => {
  assert.deepEqual(cookieParam({ name: "a", value: "b", domain: "x.test", path: "/", expires: -1, size: 5, session: true, sameSite: "Lax" }),
    { name: "a", value: "b", domain: "x.test", path: "/", sameSite: "Lax" });
});

test("a persistent cookie keeps its expiry, and a bad sameSite is dropped", () => {
  assert.deepEqual(cookieParam({ name: "a", value: "b", expires: 1900000000, sameSite: "Unspecified" }), { name: "a", value: "b", expires: 1900000000 });
});

test("a session file is storage state or a bare list of cookies, and is written private", () => {
  const dir = mkdtempSync(join(tmpdir(), "session-"));
  const state = { cookies: [{ name: "a", value: "b", domain: "x.test" }], origins: [{ origin: "https://x.test", localStorage: [{ name: "k", value: "v" }] }] };
  writeSession(join(dir, "s.json"), state);
  assert.deepEqual(readSession(join(dir, "s.json")), state);
  assert.equal(statSync(join(dir, "s.json")).mode & 0o777, 0o600);
  writeFileSync(join(dir, "bare.json"), JSON.stringify(state.cookies));
  assert.deepEqual(readSession(join(dir, "bare.json")), { cookies: state.cookies, origins: [] });
});

test("a missing session file says to run login", () => {
  assert.throws(() => readSession("/nonexistent/s.json"), /demoreel login/);
});

test("landing on another host than the one asked for is a bounce, a path change is not", () => {
  assert.equal(bounced("https://app.test/home", "https://login.test/auth?x=1"), true);
  assert.equal(bounced("https://app.test/home", "https://app.test/dashboard"), false);
});
