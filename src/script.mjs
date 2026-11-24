// script.md: where a project's narration lives when it has one (demo.json keeps everything else). A heading for each scene,
// `## <name>`, then its narration a chunk to a paragraph: a blank line starts the next chunk, and lines without one
// between them are one chunk however they wrap. <!-- comments --> are left out. A project without script.md keeps each
// scene's `narration` in demo.json.
//
// Booth writes and reads it the same way (BoothKit's Script.swift): the rules and their cases are in spec/, and both
// test suites run them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SCRIPT_FILE = "script.md";

const number = (i) => String(i + 1).padStart(2, "0");

/** What each scene is called in script.md: its name, or, for a name more than one scene has, its number and name. */
export const keys = (names) => names.map((name, i) => (names.filter((n) => n === name).length === 1 ? name : `${number(i)}-${name}`));

/** The sections of a script: each heading's first word, and its paragraphs. */
export function parse(markdown) {
  const out = [];
  let paragraph = [];
  let inComment = false;
  const end = () => {
    if (paragraph.length && out.length) out.at(-1).chunks.push(paragraph.join(" "));
    paragraph = [];
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.startsWith("<!--")) {
      if (!line.includes("-->")) inComment = true;
      continue;
    }
    if (line.startsWith("## ")) {
      end();
      // An anchor, {#ref}, at the end is the scene's ref; the key is the first word of the rest.
      const anchor = line.match(/\{#([a-z0-9]+)\}\s*$/);
      const rest = anchor ? line.slice(3, anchor.index) : line.slice(3);
      out.push({ key: rest.split(/[ ·]/).find(Boolean) ?? "", chunks: [], ref: anchor?.[1] ?? null });
    } else if (!line) {
      end();
    } else {
      paragraph.push(line);
    }
  }
  end();
  return out;
}

/** Each scene's narration in a script, by its place in `names` (null for a scene it has no heading for), and the
 *  headings no scene has, by key. A heading finds its scene by its anchor (the scenes' `refs`), else by key or number and
 *  name. A narration is its paragraphs, a line each. */
export function narrations(markdown, names, refs = names.map(() => null)) {
  const byKey = keys(names);
  const ids = names.map((name, i) => `${number(i)}-${name}`);
  const byScene = names.map(() => null);
  const taken = new Set();
  const sections = parse(markdown);
  // Anchors first, so a heading found by its anchor isn't taken by another's key.
  const found = sections.map(({ ref }) => {
    const i = ref ? refs.indexOf(ref) : -1;
    if (i >= 0) taken.add(i);
    return i;
  });
  const unknown = [];
  sections.forEach(({ key, chunks }, s) => {
    let i = found[s];
    if (i < 0) {
      i = byKey.indexOf(key);
      if (i < 0) i = ids.indexOf(key);
      if (i >= 0 && taken.has(i)) i = -1;
    }
    if (i < 0) unknown.push(key);
    else {
      taken.add(i);
      byScene[i] = chunks.join("\n");
    }
  });
  return { byScene, unknown };
}

/** The narration from the project's script.md, by scene, or null when it has none. */
export function scriptNarration(dir, scenes) {
  const file = join(dir, SCRIPT_FILE);
  if (!existsSync(file)) return null;
  return narrations(readFileSync(file, "utf8"), scenes.map((s) => s.id ?? s.type ?? "scene"), scenes.map((s) => s.ref ?? null));
}
