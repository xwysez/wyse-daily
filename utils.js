/* ===========================================================
   utils.js — small stateless helpers shared across modules
   =========================================================== */

const Utils = (() => {

  /** Returns a date in local YYYY-MM-DD form (never UTC-shifted). */
  function toDateKey(date = new Date()) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function todayKey() {
    return toDateKey(new Date());
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  /** Builds a flat array of day cells (padded to full weeks, respecting
   *  first-day-of-week) for a given month — shared by anything that
   *  renders a month-grid calendar (Routine Calendar, Event Calendar,
   *  the Statistics monthly tracker). */
  function buildMonthGrid(year, month, firstDayOfWeek) {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startOffset = (first.getDay() - firstDayOfWeek + 7) % 7;
    const gridStart = addDays(first, -startOffset);
    const totalCells = Math.ceil((startOffset + last.getDate()) / 7) * 7;

    const days = [];
    let cursor = new Date(gridStart);
    for (let i = 0; i < totalCells; i++) {
      days.push({ key: toDateKey(cursor), inMonth: cursor.getMonth() === month, date: new Date(cursor) });
      cursor = addDays(cursor, 1);
    }
    return days;
  }

  /** ISO-ish: week starts Sunday, matching GitHub's contribution graph. */
  function startOfWeek(date) {
    const d = new Date(date);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function isSameWeek(keyA, keyB) {
    return toDateKey(startOfWeek(parseDateKey(keyA))) === toDateKey(startOfWeek(parseDateKey(keyB)));
  }

  function isSameMonth(keyA, keyB) {
    const a = parseDateKey(keyA), b = parseDateKey(keyB);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function formatFriendlyDate(key) {
    const d = parseDateKey(key);
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function formatShortDate(key) {
    const d = parseDateKey(key);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /** Formats a date key according to a user's preferred format string
   *  ('short' | 'numeric-mdy' | 'numeric-dmy' | 'iso'). Falls back to
   *  formatShortDate for unknown/missing formats. */
  function formatDatePref(key, format) {
    const d = parseDateKey(key);
    const pad = n => String(n).padStart(2, '0');
    const mm = pad(d.getMonth() + 1), dd = pad(d.getDate()), yyyy = d.getFullYear();
    if (format === 'numeric-mdy') return `${mm}/${dd}/${yyyy}`;
    if (format === 'numeric-dmy') return `${dd}/${mm}/${yyyy}`;
    if (format === 'iso') return `${yyyy}-${mm}-${dd}`;
    return formatShortDate(key);
  }

  function uid() {
    return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function debounce(fn, wait = 150) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  /** completion ratio -> lamp intensity bucket 0..3 */
  function intensityForRatio(ratio) {
    if (ratio <= 0) return 0;
    if (ratio <= 0.33) return 1;
    if (ratio <= 0.66) return 2;
    return 3;
  }

  return {
    toDateKey, todayKey, parseDateKey, addDays, buildMonthGrid, startOfWeek,
    isSameWeek, isSameMonth, formatFriendlyDate, formatShortDate, formatDatePref,
    uid, escapeHtml, debounce, clamp, intensityForRatio
  };
})();
