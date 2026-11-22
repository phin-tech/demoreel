# demoreel

Make a product demo video from code: your app's screenshots floating over a title and bullets, a clip of the app being
used with a drawn pointer, click rings and key caps, and narration, rendered at 4K by
[HyperFrames](https://github.com/heygen-com/hyperframes) (HeyGen, Apache-2.0). It can also hand you each scene as its own
folder of video, narration and captions, to drag into Google Vids or any editor.

This is a hands-on tutorial. By the end you will have rendered the example, made a demo of your own, and exported it
scene by scene. It takes about half an hour, most of it waiting for renders.

## 0. What you need

- Node 22 or newer (`node --version`)
- ffmpeg (`brew install ffmpeg`)
- Chrome or Chromium. HyperFrames uses its own bundled copy; `npx hyperframes doctor` checks that your machine has what
  it needs.

## 1. Install and render the example

```bash
git clone https://github.com/phin-tech/demoreel && cd demoreel
npm install
npx hyperframes telemetry disable     # HyperFrames reports anonymous usage by default; this turns it off
alias demoreel="node $PWD/bin/demoreel.mjs"

demoreel render examples/redpen       # about 25 seconds
open examples/redpen/out/redpen-demo.mp4
```

You get a 4K video of four scenes: a title with bullets and a floating screenshot, the same with a slow zoom, a clip of an
app being used with a pointer and key caps, and a closing scene. Everything in it came from one file,
`examples/redpen/demo.json`. Open that file next to the video; the rest of the tutorial is about changing it.

## 2. Make your own demo

Copy the example and clear out what you don't need:

```bash
cp -R examples/redpen my-demo
rm -rf my-demo/out my-demo/build
```

Put your own screenshots in `my-demo/` (PNG, taken at your app's real window size). Then open `my-demo/demo.json`.

### A title scene

Delete every scene but the first and edit it:

```json
{
  "name": "my-demo",
  "title": "My app demo",
  "scenes": [
    {
      "type": "bullets",
      "id": "intro",
      "duration": 5,
      "kicker": "My App",
      "title": "One line that says what it is.",
      "bullets": ["First thing it does", "Second thing", "Third thing"],
      "cards": [{ "image": "my-screenshot.png", "x": 830, "y": 200, "width": 1000 }]
    }
  ]
}
```

Layout is in a 1920×1080 space. The text sits on the left; a `card` is a screenshot with a rounded window and shadow. `x`,
`y` and `width` place it, and it floats in from below. Render it and look:

```bash
demoreel render my-demo
open my-demo/out/my-demo.mp4
```

Add `"zoom": { "to": 1.25, "origin": "70% 30%", "at": 2.4, "duration": 2.4 }` to a card to push in on one part of it
(`origin` is the point it zooms toward, `at` is when it starts, in seconds). Keep `to` near 1.25 for a 2560px-wide
screenshot; more than that and it goes soft.

One large card per scene reads better than several overlapping.

### A clip scene: the app being used

A `clip` scene is a video of your app plus a list of what was done on which frame. The pointer, click rings and key caps
are drawn over the video from that list; they are not in the video itself.

You need two files:

- `walk.mp4`, a recording of the app, with no pointer visible
- `walk.events.json`, the list:

```json
{
  "fps": 30,
  "frames": 165,
  "events": [
    { "frame": 15,  "kind": "key",    "key": "j" },
    { "frame": 38,  "kind": "key",    "key": "cmd-k" },
    { "frame": 76,  "kind": "scroll", "x": 960, "y": 512, "dy": 500 },
    { "frame": 107, "kind": "click",  "x": 552, "y": 312 }
  ]
}
```

`frames` is the number of frames in the clip. `x` and `y` are in the recorded window's own units (points), measured
from its top-left; if the window is not 1280×801, say so on the scene with `"window": { "w": 1440, "h": 900 }`. Kinds are
`key` (`cmd-k`, `shift-enter`, `escape`), `click`, `hover`, `scroll` and `drag`. Keys show as key caps, clicks as an amber
ring, and the pointer glides to each position just before it happens.

Add it as a second scene:

```json
{ "type": "clip", "id": "walk", "video": "walk.mp4", "events": "walk.events.json" }
```

**No way to record your app?** Any screen recording works. Record it with QuickTime, with the cursor hidden if you can, and
write the events by hand: watch the video, note the frame of each click or key (frames = seconds × 30), and read the
coordinates off a screenshot of the same window. It is fiddly the first time and quick after that.

**Your app can drive itself?** Better. Have it save a frame after every step and write the events as it goes, so the
list can never drift from what happened. Red Pen does this with `REDPEN_KEYS="…" just record <name>`, which is the
reference for how. Encode the frames with ffmpeg:

```bash
ffmpeg -framerate 30 -i frames/%05d.png -c:v libx264 -crf 14 -pix_fmt yuv420p walk.mp4
```

## 3. Add narration

Put the words on each scene:

```json
{ "type": "bullets", "id": "intro", "...": "...",
  "narration": "[enthusiasm] My App puts everything in one place. [natural pace] Here is how it works." }
```

Text in square brackets is for a voice engine that understands audio tags; the captions and the plain-text narration have
them stripped. Not every engine reads them, so test one line first.

A scene now lasts as long as its narration takes to say, so the voice is never cut off. By default that is 150 words a
minute plus a short pause, and `duration` is the minimum. Two ways to make it accurate:

- Set `"wordsPerMinute": 180` at the top of `demo.json` to match the voice you'll use. To find your number, read one scene
  to the voice and compute words ÷ seconds × 60.
- Once a scene has real audio, put its length on the scene as `"audioSeconds": 10.4`. That beats any estimate.

A clip shorter than its narration holds its last frame.

**Recorded or generated audio.** Put the file on the scene, `"audio": "intro.wav"` (anything ffmpeg reads), and demoreel
measures it, sets the scene's length to fit with a short pause after, and mixes it into the video starting 0.3 seconds in
(`"audioOffset"` changes that). No need to type `audioSeconds`. Exports also copy it into the scene's folder as `voice.*`.

Keep the lines short. A long line over a still scene drags, and the fix is usually fewer words rather than a longer scene.

## 4. Check before you trust it

```bash
demoreel lint my-demo
```

This runs HyperFrames' own checks. Errors matter; the "sub-composition" warnings are suggestions you can ignore. Then
look at actual frames, because a passing lint doesn't show how it looks:

```bash
ffmpeg -ss 3 -i my-demo/out/my-demo.mp4 -frames:v 1 frame.png
```

## 5. Export for an editor

```bash
demoreel export my-demo --hd
```

`--hd` draws at 1080p (smaller files, quicker to upload); leave it off for 4K. This renders every scene alone and writes:

```
my-demo/out/vids/
  HOW-TO.txt
  scene-01-intro/   01-intro.mp4 · narration.txt · narration-with-tags.txt · captions.srt
  scene-02-walk/    …
```

Drag a scene's mp4 into Google Vids (or any editor), paste its `narration.txt` into the voice-over, and add music. The
captions are an even split of each scene, so retime them once you have real audio. `out/storyboard.md` and
`out/manifest.json` hold the whole plan, if you want it in one place.

## Reference

Top level of `demo.json`: `name` (output file name), `title`, `scenes`, `wordsPerMinute` (default 150), `fps` (30),
`scale` (2 is 4K, 1 is 1080p; `--hd` sets 1), `theme` (`accent`, `ink`, `muted`, `font`, `background`).

`bullets` scene: `id`, `kicker`, `title`, `bullets`, `cards`, `duration`, `narration`, `audio`, `audioOffset`, `audioSeconds`.
Card: `image`, `x`, `y`, `width`, `delay`, `zoom` (`to`, `origin`, `at`, `duration`).

`clip` scene: `id`, `video`, `events`, `window`, `card` (`x`, `y`, `width`; default 180, 70, 1560), `pointer` (`x`, `y` as
fractions of the window where it starts; default 0.55, 0.6), `narration`, `audio`, `audioOffset`, `audioSeconds`.

Commands: `demoreel build` writes the HTML only; `lint`; `render` (the whole film to `out/<name>.mp4`); `export`.

## Troubleshooting

- **A video in the render is frozen.** A `<video>` must not sit inside a timed element and needs an `id`; demoreel does
  this for you, so a hand edit to the generated HTML probably broke it. Run `demoreel lint`.
- **Text looks fuzzy.** Use `scale: 2` (the default), keep screenshots at their real size, and don't zoom past about 1.25×.
- **A click ring or key cap shows before it should.** In your own GSAP edits, use `gsap.set` then `tl.to`, never `fromTo`,
  which draws its first state immediately.
- **`share`, `publish` and `auth`** are HyperFrames commands that upload to HeyGen's servers. demoreel never uses them.

## Using it with an agent

`skills/demoreel/SKILL.md` is this workflow written for a coding agent: storyboard, record, write `demo.json`, check frames,
export for an editor. Install it with the [`skills`](https://github.com/vercel-labs/skills) CLI (needs Node 22.20 or newer):

```bash
# into the current project
npx skills add phin-tech/demoreel

# or for every project on this machine
npx skills add phin-tech/demoreel -g

# or choose the skill and the agent without being asked
npx skills add phin-tech/demoreel --skill demoreel -a claude-code
```

The CLI works with Claude Code, Codex, Cursor and many other agents, and asks which to install to. Afterwards
`npx skills list` shows what is installed, `npx skills update` brings it up to date and `npx skills remove demoreel`
takes it out. The skill tells the agent to run demoreel from a clone of this repo, so clone it too (see step 1).

No `skills` CLI? Copy `skills/demoreel/` into your agent's skills folder by hand; for Claude Code that is
`~/.claude/skills/demoreel/`.

## Licence

Apache-2.0. Copyright 2026 Sam Phinizy. See `LICENSE` and `NOTICE`.
