/**
 * quiet-hours.js — the sweep yields the machine during Shizu's prime hours.
 *
 * Windows (America/New_York, so daylight saving takes care of itself — EDT in
 * summer, EST in winter, no offsets to re-edit twice a year):
 *
 *   06:00-09:00   and   18:00-21:00
 *
 * Two callers, both needed. The DRIVER checks before it starts a tier, so no
 * new work opens inside a window. The WORKER checks between reps, because a
 * tier runs for hours — pausing only at tier boundaries would let a job that
 * started at 05:00 grind straight through the morning.
 *
 * A paused worker holds its memory and its progress and burns no CPU:
 * Atomics.wait blocks the thread outright rather than spinning. Everything
 * resumes on its own; nothing is lost and no tier restarts.
 *
 * ARKGRID_NO_QUIET=1 disables the whole thing for a run.
 */
"use strict";

var WINDOWS = [[6, 9], [18, 21]];   // [startHour, endHour) local New York
var TZ = "America/New_York";

/** Hour 0-23 in New York right now (handles EDT/EST automatically). */
function nyHour() {
  var s = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "numeric", hour12: false
  }).format(new Date());
  return parseInt(s, 10) % 24;
}

function inQuiet() {
  if (process.env.ARKGRID_NO_QUIET === "1") return false;
  var h = nyHour();
  return WINDOWS.some(function (w) { return h >= w[0] && h < w[1]; });
}

/** Minutes until the current window closes (0 when not in one). */
function minutesLeft() {
  if (!inQuiet()) return 0;
  var h = nyHour();
  var w = WINDOWS.filter(function (x) { return h >= x[0] && h < x[1]; })[0];
  var now = new Date();
  var mins = parseInt(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, minute: "numeric"
  }).format(now), 10);
  return (w[1] - h) * 60 - mins;
}

/**
 * Block while inside a window. Synchronous and CPU-free — Atomics.wait parks
 * the thread. `log` is called once on entry and once on exit.
 */
function waitIfQuiet(log) {
  if (!inQuiet()) return false;
  var lock = new Int32Array(new SharedArrayBuffer(4));
  if (log) log("  quiet hours (" + nyHour() + ":00 New York) — pausing ~" +
    minutesLeft() + " min");
  while (inQuiet()) Atomics.wait(lock, 0, 0, 60000);   // recheck once a minute
  if (log) log("  quiet hours over — resuming");
  return true;
}

module.exports = { inQuiet: inQuiet, waitIfQuiet: waitIfQuiet,
  minutesLeft: minutesLeft, nyHour: nyHour, WINDOWS: WINDOWS };
