/* ===========================================================
   pomodoro.js — a small self-contained Pomodoro timer for Focus mode.
   Session count persists per-day in localStorage directly (it's a
   lightweight counter, not core task data, so it doesn't need to go
   through storage.js's items/settings machinery).
   =========================================================== */

const Pomodoro = (() => {

  const SESSIONS_KEY = 'signalboard.pomodoroSessions';
  const PREFS_KEY = 'signalboard.pomodoroPrefs';
  const DEFAULT_PREFS = { workMinutes: 25, breakMinutes: 5 };

  let mode = 'work';       // 'work' | 'break'
  let secondsLeft = DEFAULT_PREFS.workMinutes * 60;
  let running = false;
  let intervalId = null;

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
    } catch (e) {
      return { ...DEFAULT_PREFS };
    }
  }

  function savePrefs(prefs) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { console.error(e); }
  }

  function getTodaySessionCount() {
    try {
      const raw = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}');
      return raw[Utils.todayKey()] || 0;
    } catch (e) {
      return 0;
    }
  }

  function incrementTodaySessionCount() {
    try {
      const raw = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}');
      const today = Utils.todayKey();
      raw[today] = (raw[today] || 0) + 1;
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(raw));
    } catch (e) { console.error(e); }
  }

  function resetTimerForMode() {
    const prefs = loadPrefs();
    secondsLeft = (mode === 'work' ? prefs.workMinutes : prefs.breakMinutes) * 60;
  }

  function tick() {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      if (mode === 'work') incrementTodaySessionCount();
      mode = mode === 'work' ? 'break' : 'work';
      resetTimerForMode();
      pause(); // stop automatically at the boundary; user starts the next segment
    }
    render();
  }

  function start() {
    if (running) return;
    running = true;
    intervalId = setInterval(tick, 1000);
    render();
  }

  function pause() {
    running = false;
    clearInterval(intervalId);
    intervalId = null;
    render();
  }

  function toggle() {
    if (running) pause(); else start();
  }

  function reset() {
    pause();
    mode = 'work';
    resetTimerForMode();
    render();
  }

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function render() {
    const timeEl = document.getElementById('pomodoroTime');
    const modeEl = document.getElementById('pomodoroMode');
    const toggleEl = document.getElementById('pomodoroToggle');
    const sessionsEl = document.getElementById('pomodoroSessions');
    const ringEl = document.getElementById('pomodoroRing');
    if (!timeEl) return; // Focus view not in the DOM yet / not active

    timeEl.textContent = formatTime(Math.max(0, secondsLeft));
    modeEl.textContent = mode === 'work' ? 'Focus session' : 'Break';
    modeEl.classList.toggle('is-break', mode === 'break');
    toggleEl.textContent = running ? 'Pause' : (secondsLeft === totalForMode() ? 'Start' : 'Resume');
    sessionsEl.textContent = getTodaySessionCount();

    const total = totalForMode();
    const progress = total > 0 ? (total - secondsLeft) / total : 0;
    if (ringEl) ringEl.style.setProperty('--pomodoro-progress', String(Utils.clamp(progress, 0, 1)));
  }

  function totalForMode() {
    const prefs = loadPrefs();
    return (mode === 'work' ? prefs.workMinutes : prefs.breakMinutes) * 60;
  }

  function bind() {
    document.getElementById('pomodoroToggle').addEventListener('click', toggle);
    document.getElementById('pomodoroReset').addEventListener('click', reset);

    const workInput = document.getElementById('pomodoroWorkMinutes');
    const breakInput = document.getElementById('pomodoroBreakMinutes');
    workInput.addEventListener('change', () => {
      const minutes = Utils.clamp(parseInt(workInput.value, 10) || DEFAULT_PREFS.workMinutes, 1, 120);
      workInput.value = minutes;
      savePrefs({ ...loadPrefs(), workMinutes: minutes });
      if (mode === 'work' && !running) resetTimerForMode();
      render();
    });
    breakInput.addEventListener('change', () => {
      const minutes = Utils.clamp(parseInt(breakInput.value, 10) || DEFAULT_PREFS.breakMinutes, 1, 60);
      breakInput.value = minutes;
      savePrefs({ ...loadPrefs(), breakMinutes: minutes });
      if (mode === 'break' && !running) resetTimerForMode();
      render();
    });

    const prefs = loadPrefs();
    workInput.value = prefs.workMinutes;
    breakInput.value = prefs.breakMinutes;
    resetTimerForMode();
    render();
  }

  return { bind, render, reset };
})();
