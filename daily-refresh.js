/* ===========================================================
   daily-refresh.js — detects the calendar date changing (typically at
   midnight) while the app is left open, and refreshes every
   date-dependent piece of the UI automatically.

   Two detection mechanisms, used together:
   1. A timer scheduled for the next local midnight (+ a few seconds of
      safety margin). This is the primary mechanism for a tab left open
      and in the foreground.
   2. A check on visibilitychange/focus. Browsers throttle or suspend
      timers in backgrounded tabs, so a tab that was minimized or in a
      background tab through midnight might not fire its timer exactly
      on time (or, in rare cases, at all until the tab wakes up) — this
      catches that by comparing "today" against the last known date the
      moment the tab becomes active again.

   Either path converges on the same handleDateRollover(), which only
   does anything if the date actually changed, so switching tabs
   rapidly or a timer firing a little early/late never causes redundant
   work.
   =========================================================== */

const DailyRefresh = (() => {

  let lastKnownDate = Utils.todayKey();
  let timerId = null;

  function msUntilNextMidnight() {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    return nextMidnight.getTime() - now.getTime();
  }

  function scheduleNextCheck() {
    clearTimeout(timerId);
    // setTimeout delays beyond ~24 days overflow to fire immediately in
    // some engines; a day is always well under that, but clamp defensively.
    const ms = Math.min(msUntilNextMidnight(), 2147483647);
    timerId = setTimeout(handleTimerFire, ms);
  }

  function handleTimerFire() {
    checkForDateChange();
    scheduleNextCheck(); // always reschedule, whether or not the date had actually changed yet
  }

  function checkForDateChange() {
    const nowKey = Utils.todayKey();
    if (nowKey === lastKnownDate) return;
    handleDateRollover(nowKey);
  }

  function handleDateRollover(nowKey) {
    lastKnownDate = nowKey;

    // Recompute which recurring tasks are "current" for the new day —
    // yesterday's completions stay recorded in each task's history
    // (that's what the green-light tracker and Statistics read from),
    // this only resets the *today* checkbox state so recurring tasks
    // reopen for the new day instead of staying checked off forever.
    Checklist.applyRecurringResets();

    if (window.SignalboardApp) {
      window.SignalboardApp.updateTodayLabel();
      window.SignalboardApp.refreshAll(); // Dashboard, Focus mode, Upcoming Deadlines, streaks, Statistics
    }
    if (window.SignalboardCalendar) window.SignalboardCalendar.render(); // Routine Calendar's "today" highlight + grid
    if (typeof Events !== 'undefined') Events.render(); // Event Calendar's "today" highlight
    if (typeof Pomodoro !== 'undefined') Pomodoro.render(); // today's session count resets to 0
  }

  function init() {
    scheduleNextCheck();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForDateChange();
    });
    window.addEventListener('focus', checkForDateChange);
  }

  document.addEventListener('DOMContentLoaded', init);

  return {};
})();
