# Every driver records the same thing: clean frames and an events file

demoreel's clip scenes show an app being used: a recording with no pointer in it, and an `events.json` saying what was
done on which frame. The pointer, click rings and key caps are drawn over it afterwards, so they can be restyled without
recording again. Anything that can drive an app and produce those two files can feed a clip scene.

So demoreel is the one entrance, and not the one place the driving code lives. `demoreel record` takes a scene's `record`
block (which driver, what to launch, the script, the window size), runs the matching driver and encodes the result into a
clip scene. A driver is an adapter: demoreel starts it, hands it the script and collects frames and `events.json`.
The web driver lives in demoreel, since it is Node and `puppeteer-core` is already installed beside HyperFrames. The
others stay in the code that knows the target (Typecase's driver for GPUI apps, a debug socket inside a Swift app),
and demoreel runs their commands.

| Target | Driven by | Frames come from | Runs hidden |
|---|---|---|---|
| GPUI apps (Red Pen, Corkboard, Microfiche) | Typecase's driver (`typecase-drive`) | The driver draws the window itself | Yes |
| Websites | Headless Chrome through `puppeteer-core`, already installed with HyperFrames | Page screenshots, resampled to a steady 30fps | Yes |
| Swift apps we build | A debug socket in the app, grown from the template's `DebugDriver` | To be decided: the current snapshot draws some views blank | Probably |
| iOS apps | The simulator: `xcrun simctl` for video, something else to tap | `simctl io recordVideo` | Mostly |
| Other Mac apps | The Accessibility API | ScreenCaptureKit | No |

## What every driver produces

- **Frames or a video** at a fixed rate (30fps unless told otherwise), with no pointer and no key pill drawn into them.
  Frame files are numbered from `00000`, so the file number, the `frame` in an event and the index in an encoded video
  are the same number.
- **`events.json`**, in the shape `README.md` ("The files other tools can rely on", the `events.json` entry) gives
  field by field: `{"fps":30,"frames":N,"events":[{"frame":15,"kind":"key","key":"cmd-k"}, …]}`, with `kind` one of
  `key`, `click`, `hover`, `scroll`, `drag`, and positions in the window's own units measured from its top-left corner
  (points for a native window, CSS pixels for a page). `frame` indexes the delivered frames or video, so a driver that
  resamples works it out from its timestamps.
- **No focus taken and no window shown**, wherever the target allows it. A driver that cannot run hidden says so.

Where a driver reads a script, it uses the lines Typecase's does (`click #id`, `click Label`, `type some words`, a key
name, `wait:600`, `move:X,Y`), so one script can run against whichever driver fits. A driver may add steps of its own.

## Order

1. Typecase's `--events` recording, which writes exactly this and is built (`feat/driver-events`, not yet released),
   and moving Red Pen onto it in place of `REDPEN_RECORD`.
2. `demoreel record`, the single entrance, with an adapter for Typecase's driver first since it works today. It owns the
   process it launches (a driver that does not quit when asked is killed), keeps the driver's socket path short in a
   temporary folder, and takes the window size from the driver when the scene does not give one.
3. The web driver, inside demoreel and behind the same `record` block.
4. A Swift driver in `apple-template`, after a test of how well a window can be captured, since that is the unknown.
5. Pacing a script from the words of recorded narration, which sits on top of any driver.

iOS and other Mac apps wait until something needs them. The Accessibility route needs Accessibility and Screen
Recording permission and a visible window, and iOS needs a simulator set up first.

## Not chosen

- **An editor inside demoreel or Booth** (a timeline and effects, like Camtasia or Motion). It is a different product
  and a lot of work, and the part that makes demoreel worth having is that the video is made from a script and recordings,
  which an editor works against. Finishing by hand goes through the timeline export (`demoreel timeline`) into DaVinci
  Resolve or Final Cut instead.
- **HyperFrames' desktop app** as the place to edit. It signs in to a HeyGen account, and what it edits is the HTML that
  demoreel generates, which is rewritten at the next build.
- **GPUI for a preview.** There is a GPUI video crate (`gpui-video-player`), but it pins a different GPUI than gpui-kit
  does and there is no web view in the kit to show demoreel's page.

## Consequences

- A new kind of target is a new driver in its own place, plus a small adapter in demoreel so `demoreel record` can run
  it. demoreel does not need to know how a target is driven, only how to start the driver and where its output lands.
- demoreel grows a runtime dependency on `puppeteer-core` for the web driver, which today comes only through HyperFrames
  and is not declared by demoreel itself.
- The contract is shared by repositories: demoreel, Typecase and any app with a driver. Changing the shape of
  `events.json` means changing all of them together, and the README section is where it is written down.
- A website cannot be captured at an exact rate in real time, so a web driver timestamps its frames and resamples them.
- The events a driver writes are as fine as what it does: Typecase writes a `key` event for each typed character, so
  demoreel has to join a run of typing into one key cap or draws one per letter, which it does not yet do. The Typecase
  driver also has no scroll or drag step yet.
- Swift capture is unproven. If a window can only be captured with the Screen Recording permission, that driver cannot
  run hidden or unattended.
- What has been run: the Typecase driver and `demoreel record` on Typecase's `driven` example, hidden, end to end into a
  rendered clip scene, looking at still frames and not the motion. The web, Swift, iOS and Accessibility drivers are
  designs only.
