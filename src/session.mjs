// Signed-in sessions for the web driver. An app behind a login can't be filmed from a fresh browser, so `demoreel login`
// opens a visible Chrome, you sign in, and the cookies and local storage are saved to a file; `record.session` loads that
// file before the page opens. The file is Playwright's storage-state shape, so one exported from elsewhere works too:
//
//   { "cookies": [{ "name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite" }],
//     "origins": [{ "origin": "https://app.example.com", "localStorage": [{ "name", "value" }] }] }
//
// A bare array of cookies is accepted as well. The file holds live credentials: it is written readable by you only, and
// `*.session.json` is gitignored.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const COOKIE_FIELDS = ["name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite"];

/** Reads a session file into { cookies, origins }. */
export function readSession(file) {
  let raw;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (e) {
    throw new Error(`cannot read the session file ${file} (${e.code === "ENOENT" ? "it does not exist: run `demoreel login`" : e.message})`);
  }
  const session = Array.isArray(raw) ? { cookies: raw, origins: [] } : { cookies: raw.cookies ?? [], origins: raw.origins ?? [] };
  if (!Array.isArray(session.cookies) || !Array.isArray(session.origins)) throw new Error(`${file} is not a session: expected cookies and origins lists`);
  return session;
}

/** A saved cookie as the DevTools protocol wants it: a session cookie (expires -1 or absent) has no expiry. */
export function cookieParam(c) {
  const out = {};
  for (const k of COOKIE_FIELDS) if (c[k] !== undefined && c[k] !== null) out[k] = c[k];
  if (!(out.expires > 0)) delete out.expires;
  if (out.sameSite && !["Strict", "Lax", "None"].includes(out.sameSite)) delete out.sameSite;
  return out;
}

/** Loads a session into a page before it navigates: its cookies now, its local storage on each page of its origin. */
export async function applySession(page, session) {
  const cdp = await page.createCDPSession();
  const cookies = session.cookies.map(cookieParam);
  if (cookies.length) await cdp.send("Network.setCookies", { cookies });
  await cdp.detach();
  for (const o of session.origins) {
    if (!o.localStorage?.length) continue;
    await page.evaluateOnNewDocument((origin, items) => {
      if (location.origin !== origin) return;
      for (const { name, value } of items) localStorage.setItem(name, value);
    }, o.origin, o.localStorage);
  }
}

/** Reads the session out of a page that is signed in: every cookie in the browser and the page's local storage. */
export async function captureSession(page) {
  const cdp = await page.createCDPSession();
  const { cookies } = await cdp.send("Network.getAllCookies");
  await cdp.detach();
  const origin = await page.evaluate(() => location.origin);
  const localStorage = await page.evaluate(() => Object.entries(window.localStorage).map(([name, value]) => ({ name, value })));
  return {
    cookies: cookies.map((c) => ({ ...cookieParam(c), expires: c.session ? -1 : c.expires })),
    origins: localStorage.length && origin !== "null" ? [{ origin, localStorage }] : [],
  };
}

/** Writes a session so only its owner can read it. */
export function writeSession(file, session) {
  writeFileSync(file, JSON.stringify(session, null, 1) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** True when the page ended up on a different host than the one asked for: the sign-in page, usually. */
export function bounced(asked, landed) {
  try { return new URL(asked).host !== new URL(landed).host; } catch { return false; }
}
