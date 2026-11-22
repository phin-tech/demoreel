import { test } from "node:test";
import assert from "node:assert/strict";
import { steps } from "../src/web.mjs";

test("a comment is a whole line starting with #", () => {
  assert.deepEqual(steps("# a note\nwait:300\n  # another\n"), [{ wait: "300" }]);
});

test("type and click take the rest of the line", () => {
  assert.deepEqual(steps("type Buy more coffee\nclick Add note"), [{ type: "Buy more coffee" }, { click: "Add note" }]);
});

test("steps with no space in them can share a line, and a # inside one is a selector", () => {
  assert.deepEqual(steps("click:#add wait:500 enter"), [{ click: "#add" }, { wait: "500" }, { key: "enter" }]);
});

test("a key with a modifier is one step", () => {
  assert.deepEqual(steps("cmd-a type:Bender"), [{ key: "cmd-a" }, { type: "Bender" }]);
});
