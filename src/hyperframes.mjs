// The HyperFrames demoreel runs: the copy package.json pins, in node_modules. Every call goes through here.
//
// An installed HyperFrames updates itself in the background by default, and a new release can change what the same
// page renders, so each call turns that off and the pinned version stays the one that runs.
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..");

export const HYPERFRAMES = join(TOOL, "node_modules/.bin/hyperframes");

/** The GSAP that ships inside the pinned HyperFrames, copied next to each page that animates. */
export const GSAP = join(TOOL, "node_modules/hyperframes/dist/vendor/npm/gsap@3.15.0/dist/gsap.min.js");

/** The environment for a HyperFrames call: no update check, so no update installed behind the pin. */
export const hfEnv = (env = process.env) => ({ ...env, HYPERFRAMES_NO_UPDATE_CHECK: "1" });

/** Runs the pinned `hyperframes` with `args`; `opts` are spawnSync's. */
export const hyperframes = (args, opts = {}) => spawnSync(HYPERFRAMES, args, { ...opts, env: hfEnv(opts.env) });
