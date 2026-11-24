# The project format

demoreel and [Booth](https://github.com/phin-tech/booth) read the same project folder, in two languages: demoreel in
JavaScript, Booth in Swift. The rules they must agree on are written here once, with cases both test suites run
(`test/spec.test.mjs` here, `Tests/BoothKitTests/SpecTests.swift` in Booth, which finds this folder through
`DEMOREEL_SPEC` or a demoreel checkout beside Booth's). A rule changes here first: its case, then both readers.

Booth works without demoreel; only its tests need this folder.

## Scenes and their names

A scene's **name** is its `id` in `demo.json`, or else its `type`. Its **id** is its number and name, `03-clip`: the
number is its place in the list, from 01, so it changes when scenes are added, cut or joined. Takes, rendered files and
the manifest use the id. Its **ref**, when it has one, is its `ref` in `demo.json` (see the anchors below).

## Narration and its chunks

A scene's narration is split into **chunks**, the pieces it is recorded, retaken and timed in (`chunks.json`):

- `[audio tags]` are for a voice engine, and are not part of a chunk.
- A line break ends a chunk, so a person says where they fall, and a chunk can be several sentences.
- A narration with no line break (a single line, or one line and blank ones) has a chunk for each sentence.
- A sentence ends at a `.`, `?` or `!` followed by a space or the end; a run of them ends it once, at the last, and a
  full stop inside a word (`1.2`) doesn't end it.
- A line of nothing but tags is not a chunk.

## Where the narration lives

In each scene's `narration` in `demo.json`, unless the project has a `script.md`. Then script.md is the narration, and
`narration` in `demo.json` is not used (Booth takes it out when it moves the narration over).

## script.md

```markdown
# My demo

<!-- notes -->

## intro · 01 · 0:00 – 0:07

[enthusiasm] My App puts everything in one place.
It keeps up with you.

Here is how it works.
```

- A `## ` heading starts a scene's section. Its first word, up to a space or `·`, is the scene's **key**; the rest of the
  line is for reading. A `## ` inside a comment is not a heading.
- A heading may end with an **anchor**, `{#k7qx}`: the scene's `ref` in `demo.json`, a short id of lowercase letters and
  digits that stays with the scene when it is renamed, renumbered or another scene takes its name (Booth gives each scene
  one when it keeps the narration in script.md, and a new one to each scene it makes). It is not part of the key.
- A scene's key is its name, unless another scene has that name: then it is its id (`keys` in `script.json`).
- A heading finds its scene by its anchor; without one, or with one no scene has, by its key or id. One that finds none
  is reported by its key, and its narration not used (`narrations`).
- Under a heading, each paragraph is a chunk: a blank line starts the next, and lines without one between them are one
  chunk, joined with spaces, however they wrap (`parse`). A scene's narration is its paragraphs, a line each, which
  splits into the same chunks.
- `<!-- comments -->`, on a line or across lines, are not narration.
- Text before the first heading is not narration.

A tool that changes script.md changes only the lines it is about, so a person's wrapping, comments and notes stay.

## The cases

Each file is JSON: an `about`, then lists of cases, each with a `why` (a sentence saying what it shows) and its input and
expected output. `null` in an expected list means none.
