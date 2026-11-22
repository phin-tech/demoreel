// Small helpers the other modules share.

/** A number to the millisecond, for times written into pages and files. */
export const round = (n) => Math.round(n * 1000) / 1000;

/** Text made safe for HTML, in an element or in a quoted attribute. */
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
