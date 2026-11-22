---
name: demoreel
description: Make a product demo video from scripted app recordings, floating screenshots, bullets, narration and captions, and hand it off scene by scene to Google Vids or another editor. Use when asked for a demo video, a product tour clip, a storyboard, narration for a demo, or scenes to import into Vids.
---

# demoreel

Demos are built from a `demo.json` (scenes) and rendered with HyperFrames. Read `README.md` for the file format.

## Workflow

1. **Storyboard first.** Write the scenes as a list before touching tools: what is on screen, what is said, how long.
   Keep a scene to one idea, 4–8 seconds, one line or two of narration.
2. **Get the material.**
   - Stills of the app: its screenshot tool, at the window's real size.
   - Live parts: record the app driving itself, saving every frame and an `events.json` of what was done on which
     frame (`{"fps":30,"frames":N,"events":[{"frame":15,"kind":"key","key":"j"}, …]}`; kinds `key`, `click`, `hover`,
     `scroll`, `drag`, with `x`/`y` in window points). Encode the frames with ffmpeg
     (`ffmpeg -framerate 30 -i %05d.png -c:v libx264 -crf 14 -pix_fmt yuv420p clip.mp4`). The pointer, click rings and key
     caps are drawn later from `events.json`, because a hidden window has no real pointer.
3. **Write `demo.json`.** `bullets` scenes (title, bullets, floating `cards`, optional `zoom`) and `clip` scenes (a video and
   its events). Put the narration in each scene.
4. **Check, then render.** `demoreel lint <folder>`, then look at frames before calling it done: render, then pull stills
   with `ffmpeg -ss <t> -i out/x.mp4 -frames:v 1 f.png` and read them. A passing lint does not show how it looks.
5. **Hand off.** `demoreel export <folder>` writes `out/scenes/*.mp4`, `storyboard.md`, `manifest.json` and
   `captions.srt`. In Google Vids: new video, import the scene mp4s in order, paste each scene's narration into its
   voice-over, add music, export. The captions are an even split of each scene, so re-time them against real audio.

## Rules

- **Narration tags** (`[enthusiasm]`, `[natural pace]`, `[bold]`) belong to the voice engine, which differs by service. Test one
  scene before using them everywhere. They are stripped for captions and on-screen text.
- **Scene length follows the voice.** Once there is audio, set each scene's `duration` from the narration's length plus a
  short pause. Guesses of 5 seconds are placeholders.
- **Sharp frames.** The stage is drawn at 2x (a 1920x1080 layout rendered at 3840x2160). Images are resized to exactly
  twice their on-screen width; a `zoom` card uses the original, so keep the zoom to about 1.25x of a 2560px source.
- **One card per scene, large.** Overlapping window screenshots read as clutter; zoom into the part being discussed.
- **Motion is seekable.** Effects are GSAP `tl.to` after a `gsap.set`. Never use `fromTo` for something that should be hidden
  first (it draws its start state at once), no `Date.now()`, no `Math.random()`, no network at render time.
- **HyperFrames commands.** Use `lint` and `render` only. `share`, `publish` and `auth` upload to HeyGen; `templates` and `billing`
  are its paid tier. Turn its usage reporting off once with `hyperframes telemetry disable`.
- **Do not publish or push** a demo, its repo or its assets unless asked to.
