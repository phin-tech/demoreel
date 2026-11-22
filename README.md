# demoreel

Product demo videos from code. A scripted recording of an app, floating screenshots with bullets, a drawn pointer, click
rings and key caps, narration, and captions, rendered at 4K with [HyperFrames](https://github.com/heygen-com/hyperframes)
(Apache-2.0). It can also render each scene as its own mp4 with a storyboard, so the pieces can go into Google Vids or
another editor.

## Use

```bash
npm install                                  # once: HyperFrames, pinned
npx hyperframes telemetry disable            # once: it reports anonymous usage by default
node bin/demoreel.mjs render examples/redpen   # → examples/redpen/out/redpen-demo.mp4
node bin/demoreel.mjs export examples/redpen   # → out/scenes/*.mp4, storyboard.md, manifest.json, captions.srt
```

Needs Node 22+, ffmpeg and Chrome (HyperFrames downloads its own). `lint` runs HyperFrames' checks; `build` only writes the HTML.

## A project

A folder with `demo.json` and the files it names. Two kinds of scene:

```jsonc
{ "type": "bullets", "id": "queue", "duration": 5, "kicker": "Red Pen", "title": "…", "bullets": ["…"],
  "cards": [{ "image": "queue.png", "x": 830, "y": 200, "width": 1000, "delay": 0.1,
              "zoom": { "to": 1.25, "origin": "70% 30%", "at": 2.4, "duration": 2.4 } }],   // zoom is optional
  "narration": "[enthusiasm] Text to voice." }

{ "type": "clip", "id": "walk", "video": "walk.mp4", "events": "walk.events.json", "narration": "…" }
```

A scene lasts as long as its `narration` takes to say (150 words a minute, set with `"wordsPerMinute"`, plus a short pause; or a measured `"audioSeconds"` on the scene, which wins) if that is longer than its `duration`, so the voice is never cut off; a clip holds its last frame. Layout is in a 1920×1080 space. The theme (`accent`, `ink`, `font`, `background`) can be set at the top level under `theme`.
A clip's `events.json` is what the app did and on which frame: `{"fps":30,"frames":165,"events":[{"frame":15,"kind":"key","key":"j"},
{"frame":107,"kind":"click","x":552,"y":312}]}`, with `x`/`y` in the recorded window's points (1280×801 unless the scene says
`"window": {"w":…,"h":…}`). Keys, clicks, hovers, scrolls and drags are drawn; keys show as key caps, clicks as rings.

## Recording an app

demoreel doesn't record. The app drives itself and writes frames and `events.json`. Red Pen does this with
`REDPEN_KEYS="…" just record <name>`; encode the frames with ffmpeg. Another app needs only the same two outputs.

## With an agent

`skills/demoreel/SKILL.md` is the workflow written for an agent. Copy or link it into `~/.claude/skills/demoreel/` to use it.
