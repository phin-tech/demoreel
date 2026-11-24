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

Add `"tilt": -35` to a card (degrees; negative turns it from the right, positive from the left) and it lands by swinging
to face you, ending flat so the text stays sharp. Try -20 for something subtler.

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
`key` (`cmd-k`, `shift-enter`, `escape`), `click`, `hover`, `scroll` and `drag`. Two or more single-character keys
within 3 frames of each other are shown as one piece of typing (`"typingGap"` on the scene changes the 3). Keys show as key caps, clicks as an amber
ring, and the pointer glides to each position just before it happens.

Add it as a second scene:

```json
{ "type": "clip", "id": "walk", "video": "walk.mp4", "events": "walk.events.json" }
```

**Let demoreel record it.** If the app can be driven by Typecase's driver (a GPUI app
built with its `driver` feature, run with `typecase-drive`), give the scene a `record` block and no files:

```json
{ "type": "clip", "id": "demo",
  "record": { "command": ["./target/debug/examples/driven"], "cwd": "../typecase",
              "drive": "../typecase/target/debug/typecase-drive", "script": "demo.script" } }
```

`demoreel record my-demo` starts the app hidden, runs `demo.script` (the lines `typecase-drive` reads: `click #add`,
`type Sam`, `wait:600`), writes `demo.mp4` and `demo.events.json` (with the window's size in it, so the scene needn't
say it), and quits the app. `--scene <id>` records one scene. Options: `socketEnv` (the variable that tells the app where
to listen, default `TYPECASE_DRIVER_SOCKET`), `env`, `fps` (30). Nothing takes focus and no screen recording
permission is needed. The design is in `docs/adr/0001-drivers-share-one-recording-contract.md`.

**A website works the same way.** `"driver": "web"` drives a page in headless Chrome (the one HyperFrames uses) and
needs nothing running but the page:

```json
{ "type": "clip", "id": "notes",
  "record": { "driver": "web", "url": "page.html", "script": "web.script",
              "viewport": { "width": 1000, "height": 640 } } }
```

`url` is a web address (start your dev server first) or a file next to `demo.json`. The script has the same lines as
the Typecase driver, for a page: `click #note` (a selector) or `click Add note` (the text of a button or link),
`click:X,Y`, `move:X,Y` (hover), `type some words`, `enter` or `cmd-k` (a key), `scroll:X,Y,DY`, `goto:URL`, `wait:600`;
`#` starts a comment line. Frames are taken at 2x (`"scale"` changes it) while the script runs and made into a steady
30fps, and events are written in pixels of the page. Chrome comes from `npx hyperframes browser path`, or set
`DEMOREEL_CHROME` to a Chrome binary. `page.screenshot` takes focus from the page it films, so the driver captures with
the DevTools protocol directly.

**An app behind a login.** A fresh headless Chrome isn't signed in, so a page behind a login, OAuth or SSO would show the
sign-in page. Give the `record` block a `session` file and sign in once by hand:

```json
"record": { "driver": "web", "url": "https://app.internal.example/", "script": "web.script", "session": "app.session.json" }
```

```bash
demoreel login my-demo      # opens Chrome on the url; sign in (MFA, SSO, whatever it asks), then press Enter in the terminal
demoreel record my-demo     # loads the cookies and local storage first, so the page opens signed in
```

`login` saves every cookie in that window and the page's local storage to `app.session.json`, readable only by you; `*.session.json`
is gitignored. A VPN needs nothing from demoreel: Chrome runs on your Mac and uses its network, so connect before
`login` and `record`. If `record` ends up on a different host than `url` (the sign-in page, usually), it stops and says the session
has probably expired; run `login` again. The file is Playwright's storage-state shape, so one exported elsewhere works, and
a bare list of cookies does too. Treat it like a password: it signs in as you, and the video shows whatever your account can see.
`--scene <id>` limits `login` to one scene.

**A Mac app in Swift works the same way**, with [swift-vhs](https://github.com/phin-tech/swift-vhs) linked into its
Debug build. `"driver": "vhs"` runs `vhs-drive` (its `just install` puts it on your PATH) and tells the app its socket in
`VHS_SOCKET`; the script has the same lines as for Typecase's driver, and `click` takes a control's accessibility label
(`click Edit Script`) as well as `#id` and `X,Y`:

```json
{ "type": "clip", "id": "studio",
  "record": { "driver": "vhs", "command": ["../scripts/driven", "build/sample"], "script": "studio.script",
              "env": { "VHS_WINDOW_SIZE": "1440x900" } } }
```

`command` must start the app through Launch Services (`open -n -W -g --env VHS_SOCKET=… -a MyApp.app`), not by running
its binary, or macOS stops it the first time it asks for something private such as the microphone; Booth's
`scripts/driven` does this. Frames come from the window server without the Screen Recording permission. Unlike the other
drivers it takes focus: a Mac app only takes clicks in front, so `vhs-drive` brings it forward for the script and gives
the front back after.

**No way to record your app?** Any screen recording works. Record it with QuickTime, with the cursor hidden if you can, and
write the events by hand: watch the video, note the frame of each click or key (frames = seconds × 30), and read the
coordinates off a screenshot of the same window. It is fiddly the first time and quick after that.

**Your app can drive itself?** Better. Have it save a frame after every step and write the events as it goes, so the
list can never drift from what happened. Red Pen does this with `REDPEN_KEYS="…" just record <name>`, which is the
reference for how. Encode the frames with ffmpeg:

```bash
ffmpeg -framerate 30 -i frames/%05d.png -c:v libx264 -crf 14 -pix_fmt yuv420p walk.mp4
```

### A diagram scene: how it works

A `diagram` scene is a title across the top and a picture of how something works under it. There are two kinds.

**A hub and its spokes**, HyperFrames' own animated block: a hub in the middle, and a line drawing out to each node.

```json
{
  "type": "diagram",
  "id": "how",
  "kicker": "How it works",
  "title": "Your forges in. Your queue out.",
  "hub": "Red Pen",
  "nodes": ["Your queue", "Your Pulls", "Menu bar", "Your hooks", "Your agent"],
  "cues": [5.7, 7.0, 8.7, 9.4, 12.0],
  "accent": "violet",
  "narration": "Red Pen checks your forges every three minutes and keeps a local copy. From that copy come..."
}
```

- `cues` are the seconds into the scene when each line starts to draw, so each can land as the narration says its name
  (Booth shows when each word is spoken). Leave them out and the lines come in evenly over the first few seconds.
- `accent` is `green`, `blue` or `violet`. `exit` is `none` (the default), `fade` or `up`.
- Labels longer than about ten characters get clipped when there are five nodes or more; `hyperframes inspect` says so.
- The block comes from HyperFrames' registry the first time (the network is needed once; the files stay in
  `compositions/`). A film can have one hub diagram.

**A picture** from a file, with a `source`:

- `.mmd` or `.mermaid` (a Mermaid flowchart) and `.dottie` (a drawing made in [Dottie](https://dottie.phin.tech)) are
  drawn by Dottie's `dottie` command, hand-drawn unless the scene says `"clean": true`. A `.dottie` file with several
  pages takes `"page": "Name"` (or a number). demoreel finds `dottie` on your PATH, or at `DEMOREEL_DOTTIE`.
- A `.png`, `.jpg` or `.webp` from any other tool (Figma, Keynote, draw.io, a screenshot) is shown as it is, and needs
  nothing installed.
- `width` (default 1700) and `y` (default 310) place it; it is centered across the frame. A left-to-right chart
  (`flowchart LR`) reads larger than a wide top-down one. It comes in like a screenshot card and does not animate.

Either way narration, the storyboard and the per-scene export work as for any other scene.

## 3. Add narration

Put the words on each scene:

```json
{ "type": "bullets", "id": "intro", "...": "...",
  "narration": "[enthusiasm] My App puts everything in one place. [natural pace] Here is how it works." }
```

Text in square brackets is for a voice engine that understands audio tags; the captions and the plain-text narration have
them stripped. Not every engine reads them, so test one line first.

**Chunks.** A narration is recorded, retaken and timed in chunks: a line break (`\n` in the JSON string) ends one, so you
choose where they fall, and a chunk can be several sentences. A narration with no line break has a chunk for each
sentence. The line breaks change nothing in the voice or the captions, which read the text as one run.
`out/manifest.json` lists each scene's chunks.

A scene now lasts as long as its narration takes to say, so the voice is never cut off. By default that is 150 words a
minute plus a short pause, and `duration` is the minimum. Two ways to make it accurate:

- Set `"wordsPerMinute": 180` at the top of `demo.json` to match the voice you'll use. To find your number, read one scene
  to the voice and compute words ÷ seconds × 60.
- Once a scene has real audio, put its length on the scene as `"audioSeconds": 10.4`. That beats any estimate.

A clip shorter than its narration holds its last frame.

**Record it with Booth.** [Booth](https://github.com/phin-tech/booth) is a Mac app that opens a project, plays each scene's
video (from `demoreel export`) beside its narration as a teleprompter, and records takes to `audio/`. The take you pick
is written to `audio/takes.json`, and demoreel uses it as that scene's `audio` unless the scene names a file itself.

Each take changes how long its scene lasts, so export again after picking one. Either leave this running while you
record, and it exports (at draft quality) whenever a take is picked or `demo.json` or a file a scene uses changes:

```bash
demoreel watch my-demo        # --full for full quality; --hd and --scenes are passed on; Ctrl+C stops
```

or press **Render** in Booth, which runs the export itself (tell it where demoreel is in Booth's Settings). Either way
Booth reloads when the export lands.

**Recorded or generated audio.** Put the file on the scene, `"audio": "intro.wav"` (anything ffmpeg reads), and demoreel
measures it, sets the scene's length to fit with a short pause after, and mixes it into the video starting 0.3 seconds in
(`"audioOffset"` changes that). No need to type `audioSeconds`. Every voice is brought to -16 LUFS first (a copy in `build/voice/`; your file is left alone), so a take
recorded quietly plays as loud as the rest; `"loudness": -14` at the top of `demo.json` changes the level, and `false`
leaves voices as recorded. Exports also copy it into the scene's folder as `voice.*`.

Keep the lines short. A long line over a still scene drags, and the fix is usually fewer words rather than a longer scene.

## 4. Check before you trust it

```bash
demoreel lint my-demo
demoreel check my-demo
```

`lint` reads the page for HyperFrames' rules; `check` does that and then plays the film in a browser, looking for text
that runs off the frame, poor contrast, long stretches where nothing moves, and audio problems. Errors matter; the
"sub-composition" warnings are suggestions you can ignore, and `check`'s craft warnings are advice, not faults. Then
look at actual frames, because a passing check doesn't show how it looks:

```bash
demoreel snapshot my-demo              # a still from the middle of each scene, in out/snapshots/, no render needed
demoreel snapshot my-demo --at 3,7.5   # the stills at those seconds
```

While you work, `demoreel render my-demo --draft` renders at draft quality, a good deal faster; render without it for
the copy you keep.

## 5. Export for an editor

```bash
demoreel export my-demo
```

This renders the film once, to `out/<name>.mp4`, with a chapter at each scene: QuickTime, IINA and VLC list them, so you
can jump from scene to scene. A chapter is named after the scene's `title` (or its `kicker`, or its id); give a scene a
`"chapter"` to name it something else. `out/chapters.txt` has the same times as `0:00 Title` lines, to paste into a
YouTube description (YouTube makes chapters of them when there are three or more and each is at least ten seconds).
`--hd` draws at 1080p (smaller files, quicker to upload); leave it off for 4K.

For an editor that wants each scene as its own clip, such as Google Vids, add `--scenes`:

```bash
demoreel export my-demo --scenes
```

That renders every scene alone and writes:

```
my-demo/out/vids/
  HOW-TO.txt
  scene-01-intro/   01-intro.mp4 · narration.txt · narration-with-tags.txt · voice.wav and captions.srt (with recorded audio)
  scene-02-walk/    …
```

Drag a scene's mp4 into Google Vids (or any editor), paste its `narration.txt` into the voice-over, and add music. The
scene's `voice.wav` and, if it has recorded audio (step 3), `captions.srt` with real timing: Parakeet transcribes the
audio on this machine and the times are laid onto the words of your narration, so the text is what you meant and the
timing is what was said. Install it once with `npx hyperframes models install parakeet`. Results are cached in `build/`,
and a scene without audio gets no captions. Either way, `out/captions.srt` has the captions for the whole film, and
`out/storyboard.md` and `out/manifest.json` (with each scene's length, where it starts and its on-screen cues) hold the
whole plan. The manifest's `film` names the one file when there is one; without it, each scene's `file` is its own.
Booth reads either.

## 6. Make a deck to click through

The same `demo.json` can be a slideshow instead of a video:

```bash
demoreel present my-demo        # builds my-demo/deck/ and serves it on http://localhost:3004
```

Each scene is a slide. Click the page once, then **→** (or Space) brings in the next bullet and then the next slide, **←**
goes back, **P** opens the audience window and **F** goes fullscreen. A clip scene plays its clip. The narration becomes
the speaker notes. `demoreel deck my-demo` only writes `my-demo/deck/`, and Ctrl+C stops `present`.

To branch, mark a scene `"branch": true` (it is left out of the main line) and give a card on another slide
`"link": "<that scene's id>"`. The card gets a button; clicking it opens the branch scene, and **←** returns. A label other
than the scene's title goes in the card's `"linkLabel"`.

The deck is for presenting from your machine. Nothing here makes a file you can send, and `hyperframes share` and
`publish` upload to HeyGen, so demoreel doesn't use them.

### A timeline for DaVinci Resolve or Final Cut

```bash
demoreel export my-demo     # the film first (or with --scenes)
demoreel timeline my-demo   # then out/timeline/
```

`out/timeline/` holds an `.fcpxml` and the media it points at: each scene's video on the main track (silent), with a
marker named after the scene where it starts and its narration as the clip's note, and each recorded voice on an audio
track under its scene, starting where demoreel starts it. A take recorded in [Booth](https://github.com/phin-tech/booth)
has a marker where each sentence of it starts, from the marks Booth keeps beside the take (`<take>.marks.json`), so you
can see the script against the voice; they are left out if the narration has since changed. It is made from whichever export you ran last: after a plain `export` each scene is its stretch of
the one film; after `export --scenes`, its own file. In DaVinci Resolve, which is free,
use File > Import > Timeline; in Final Cut, File > Import > XML. `captions.srt` is there to import as subtitles.

This is written as FCPXML 1.8 and checked only for well-formedness, not opened in Resolve or Final Cut, so if one
refuses the file, its error message is what to look at. The file points at its media by path: keep the folder where it
is, or relink the clips after moving it.

## The files other tools can rely on

demoreel and [Booth](https://github.com/phin-tech/booth) (a Mac app for recording narration) share three files and nothing
else. They are the contract; change them together.

**Scene names.** A scene's name is its position and id: `NN-<id>`, `NN` the 1-based position in `scenes` padded to two
digits, `<id>` the scene's `id` or else its `type`. `02-review` is the second scene, `id: "review"`. The name is used for
`out/scenes/<name>.mp4`, the folders in `out/vids/`, and the takes.

**`demo.json`** (you write it; Booth edits only a scene's `narration` string, leaving the rest of the file as it was).

**`out/manifest.json`** (`export` writes it; Booth reads it):

```json
{ "fps": 30, "total": 38.3, "scenes": [
  { "id": "01-queue", "start": 0, "duration": 11.2, "type": "bullets", "audioOffset": 0.3,
    "chunks": ["Red Pen puts every pull request in one queue.", "What needs you is at the top."],
    "cues": [{ "t": 0.9, "label": "bullet: What needs you, first" }] } ] }
```

`duration` is the scene's length; `chunks` is the narration split as in [Chunks](#3-add-narration), without audio tags;
`cues` are what happens on screen, in seconds from the start of the scene (bullets, a screenshot landing, a click, a
key); `audioOffset` is how far into the scene the voice starts.

**`audio/takes.json`** (Booth writes it; demoreel reads it): `{ "01-queue": "01-queue-take-2.wav" }`, the take each scene
uses, a file in `audio/`. A scene's own `audio` in `demo.json` wins over it.

**`<clip>.events.json`** (a driver writes it, such as Red Pen's `just record` or Typecase's `typecase-drive --events`;
demoreel reads it for a `clip` scene). Next to the frames of the clip, with `frame` the 0-based index of the frame an
event starts on, the same number as the frame file (`00000.png`) and the index in the encoded video:

```json
{ "fps": 30, "frames": 165, "events": [
  { "frame": 15,  "kind": "key",    "key": "cmd-k" },
  { "frame": 38,  "kind": "click",  "x": 552, "y": 312, "held": "cmd-" },
  { "frame": 50,  "kind": "hover",  "x": 40,  "y": 40 },
  { "frame": 76,  "kind": "scroll", "x": 960, "y": 512, "dy": 500 },
  { "frame": 90,  "kind": "drag",   "x": 100, "y": 200, "x2": 400, "y2": 200 } ] }
```

`x` and `y` are in the recorded window's own units, from its top-left; `held` on a click is the modifier written before
it (`cmd-`, `right-`) and may be empty. demoreel uses `frame`, `kind`, `x`, `y` and `key` (a pointer glides to each event
that has a position, a click gets a ring, a key gets a cap) and ignores the rest. Both field lists come from Red Pen's
recorder (`crates/app/src/screenshot.rs`, `Recorder::note`), which is the reference.

## Reference

Top level of `demo.json`: `name` (output file name), `title`, `scenes`, `wordsPerMinute` (default 150), `fps` (30),
`scale` (2 is 4K, 1 is 1080p; `--hd` sets 1), `theme`, `motionBlur`, `loudness`.

`scale` is applied by HyperFrames when it renders (Chrome draws the 1920×1080 page at twice the pixels), so it has to
give one of HyperFrames' sizes: 1920×1080, 1080×1920 or 1080×1080 at scale 1, the 4K version of each at scale 2, or
2560×1440 and the like. demoreel says so before it renders anything else.

`theme` is the film's look: `accent` (kickers, bullet dots, click rings), `ink` (text), `muted`, `surface` (the key caps),
`font` (a CSS font stack) and `background` (any CSS background, a gradient included). Any scene can have a `theme` of its
own with any of the same keys, and it changes only that scene. Each key is a HyperFrames variable as well, so a built film
can be rendered in other colours without changing `demo.json`:
`demoreel render my-demo --variables '{"accent":"#3a7be8"}'` (an unknown key or a bad colour stops the render).

`"motionBlur": true` blurs the pointer as it glides from one click to the next, as a camera would. Nothing else blurs.

`bullets` scene: `id`, `branch`, `kicker`, `title`, `bullets`, `cards`, `duration`, `chapter`, `theme`, `narration`, `audio`, `audioOffset`, `audioSeconds`.
Card: `image`, `x`, `y`, `width`, `delay`, `tilt`, `link`, `linkLabel`, `zoom` (`to`, `origin`, `at`, `duration`).

`clip` scene: `id`, `video`, `events`, `window`, `card` (`x`, `y`, `width`; default 180, 70, 1560), `pointer` (`x`, `y` as
fractions of the window where it starts; default 0.55, 0.6), `chapter`, `theme`, `narration`, `audio`, `audioOffset`, `audioSeconds`.

Commands: `demoreel build` writes the HTML only; `lint`; `check`; `snapshot` (`--at`); `render` (the whole film to
`out/<name>.mp4`); `export`; `timeline`; `record`; `login`; `deck`; `present`. `render` and `export` take `--draft`,
`--hd` and `--variables`, and `export` takes `--scenes`.

demoreel runs the HyperFrames in its own `node_modules` (the version `package.json` pins) and turns off its update check
each time, so HyperFrames doesn't update itself in the background and change what a film looks like.

## Troubleshooting

- **A video in the render is frozen.** A `<video>` must not sit inside a timed element and needs an `id`; demoreel does
  this for you, so a hand edit to the generated HTML probably broke it. Run `demoreel lint`.
- **Text looks fuzzy.** Render without `--hd` and `--draft`, keep screenshots at their real size, and don't zoom past
  about 1.25×.
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
