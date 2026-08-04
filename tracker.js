/* ===========================================================
   tracker.js — GitHub-style contribution grid, streaks, day stats
   =========================================================== */

const Tracker = (() => {

  // How many tasks existed (weren't yet archived) and were actually
  // scheduled to appear on a given date. Using the schedule here (not
  // just creation/archive dates) keeps completion percentages fair: a
  // weekdays-only task shouldn't count against Saturday's total.
  function totalActiveOn(dateKey, items) {
    return items.filter(it => {
      if (it.createdAt > dateKey) return false;
      if (it.archived && it.archivedAt && it.archivedAt <= dateKey) return false;
      if (!Checklist.isScheduledOn(it, dateKey)) return false;
      return true;
    }).length;
  }

  function completedOn(dateKey, items) {
    return items.filter(it => it.completionHistory.includes(dateKey));
  }

  function dayStats(dateKey) {
    const items = Checklist.getAll();
    const completed = completedOn(dateKey, items);
    const total = totalActiveOn(dateKey, items);
    return { completed, total, ratio: total > 0 ? completed.length / total : 0 };
  }

  function activeDateSet() {
    const items = Checklist.getAll();
    const set = new Set();
    items.forEach(it => it.completionHistory.forEach(d => set.add(d)));
    return set;
  }

  function currentStreak() {
    const set = activeDateSet();
    if (set.size === 0) return 0;
    const today = Utils.todayKey();
    const yesterday = Utils.toDateKey(Utils.addDays(new Date(), -1));
    let cursor;
    if (set.has(today)) cursor = Utils.parseDateKey(today);
    else if (set.has(yesterday)) cursor = Utils.parseDateKey(yesterday);
    else return 0;

    let streak = 0;
    while (set.has(Utils.toDateKey(cursor))) {
      streak++;
      cursor = Utils.addDays(cursor, -1);
    }
    return streak;
  }

  function bestStreak() {
    const set = activeDateSet();
    if (set.size === 0) return 0;
    const dates = Array.from(set).sort();
    let best = 1, run = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = Utils.parseDateKey(dates[i - 1]);
      const diffDays = Math.round((Utils.parseDateKey(dates[i]) - prev) / 86400000);
      run = diffDays === 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    return best;
  }

  function yearSummary(year) {
    const items = Checklist.getAll();
    let activeDays = 0, completedTotal = 0;
    const set = activeDateSet();
    set.forEach(d => { if (Utils.parseDateKey(d).getFullYear() === year) activeDays++; });
    items.forEach(it => it.completionHistory.forEach(d => {
      if (Utils.parseDateKey(d).getFullYear() === year) completedTotal++;
    }));
    return { activeDays, completedTotal };
  }

  function totalCompletedAllTime() {
    return Checklist.getAll().reduce((sum, it) => sum + it.completionHistory.length, 0);
  }

  /** How active (non-archived) tasks split across categories right now —
   *  powers the Statistics page's pie chart. Sorted largest group first
   *  so the legend reads most-to-least at a glance. */
  function categoryBreakdown() {
    const items = Checklist.getActive();
    const counts = {};
    items.forEach(it => {
      const cat = it.category || 'General';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    const total = items.length;
    return Object.entries(counts)
      .map(([category, count]) => ({
        category,
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count);
  }

  // Fixed, theme-independent palette for category slices. Deliberately
  // NOT tied to the user's accent color setting — that's one color for
  // the whole app's UI, but a category chart needs several *different*
  // hues to stay readable regardless of which accent is selected.
  const CATEGORY_COLORS = [
    '#3D6FE0', '#1E8F5F', '#D6800E', '#8151D6', '#E0473E',
    '#0FA3B1', '#C2185B', '#6D4C41', '#00838F', '#7CB342'
  ];

  /** Completed/total across an inclusive date range (never looks past today). */
  function rateForRange(startDate, endDate) {
    const today = Utils.todayKey();
    let completedSum = 0, totalSum = 0;
    let cursor = new Date(startDate);
    while (cursor <= endDate) {
      const key = Utils.toDateKey(cursor);
      if (key <= today) {
        const stats = dayStats(key);
        completedSum += stats.completed.length;
        totalSum += stats.total;
      }
      cursor = Utils.addDays(cursor, 1);
    }
    return totalSum > 0 ? Math.round((completedSum / totalSum) * 100) : 0;
  }

  function weeklyCompletionRate() {
    return rateForRange(Utils.addDays(new Date(), -6), new Date());
  }

  function monthlyCompletionRate() {
    return rateForRange(Utils.addDays(new Date(), -29), new Date());
  }

  function mostProductiveDay() {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    Checklist.getAll().forEach(it => it.completionHistory.forEach(d => {
      counts[Utils.parseDateKey(d).getDay()]++;
    }));
    const max = Math.max(...counts);
    if (max === 0) return null;
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return { day: names[counts.indexOf(max)], count: max };
  }

  /** Last 7 calendar days (oldest first) with a completion ratio each —
   *  powers the Dashboard's compact weekly chart. */
  function last7DaysSeries() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = Utils.addDays(new Date(), -i);
      const key = Utils.toDateKey(d);
      const stats = dayStats(key);
      days.push({
        key,
        label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
        ratio: stats.ratio,
        completed: stats.completed.length,
        total: stats.total
      });
    }
    return days;
  }

  /** Monthly completion rate for the last N months (oldest first). */
  function trendSeries(monthsBack = 6) {
    const out = [];
    const now = new Date();
    for (let i = monthsBack - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
      const cappedEnd = monthEnd > now ? now : monthEnd;
      out.push({
        label: monthStart.toLocaleDateString(undefined, { month: 'short' }),
        rate: rateForRange(monthStart, cappedEnd)
      });
    }
    return out;
  }

  /** Builds Sun-Sat weeks spanning the given year, GitHub-style. */
  function buildYearGrid(year) {
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);
    const gridStart = Utils.startOfWeek(jan1);
    const gridEnd = Utils.startOfWeek(dec31); // start of last week; we'll add 6 more days

    const weeks = [];
    let cursor = new Date(gridStart);
    while (cursor <= dec31) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const inYear = cursor.getFullYear() === year;
        week.push({ key: Utils.toDateKey(cursor), inYear, date: new Date(cursor) });
        cursor = Utils.addDays(cursor, 1);
      }
      weeks.push(week);
    }
    return weeks;
  }

  let trackerMode = 'month'; // 'month' | 'year' — Statistics defaults to month
  let trackerMonthCurrent = new Date();

  function render() {
    renderYearGrid();
    updateCoreStats();
  }

  function renderYearGrid() {
    const year = Storage.getTrackerYear();
    document.getElementById('yearLabel').textContent = year;

    const grid = document.getElementById('trackerGrid');
    grid.innerHTML = '';
    const weeks = buildYearGrid(year);
    const today = Utils.todayKey();

    weeks.forEach(week => {
      const col = document.createElement('div');
      col.className = 'tracker-week';
      week.forEach(day => {
        const lamp = document.createElement('div');
        if (!day.inYear) {
          lamp.className = 'lamp lamp-0';
          lamp.style.visibility = 'hidden';
        } else {
          const isFuture = day.key > today;
          const stats = isFuture ? { completed: [], total: 0, ratio: 0 } : dayStats(day.key);
          const bucket = Utils.intensityForRatio(stats.ratio);
          lamp.className = `lamp lamp-${bucket}${isFuture ? ' is-future' : ''}`;
          lamp.dataset.date = day.key;
          lamp.dataset.completed = stats.completed.length;
          lamp.dataset.total = stats.total;
          if (!isFuture) {
            lamp.addEventListener('mouseenter', (e) => showTooltip(e, day.key, stats));
            lamp.addEventListener('mousemove', positionTooltip);
            lamp.addEventListener('mouseleave', hideTooltip);
            lamp.addEventListener('click', () => openDayModal(day.key, stats));
          }
        }
        col.appendChild(lamp);
      });
      grid.appendChild(col);
    });
  }

  function updateCoreStats() {
    const year = Storage.getTrackerYear();
    const summary = yearSummary(year);
    document.getElementById('statStreak').textContent = currentStreak();
    document.getElementById('statBestStreak').textContent = bestStreak();
    document.getElementById('statActiveDays').textContent = summary.activeDays;
    document.getElementById('statCompletedTotal').textContent = summary.completedTotal;
    updateSidebarStreak();
  }

  // ---------------- monthly tracker (default view) ----------------
  // Same color-intensity logic as the year strip, laid out as a regular
  // month calendar instead — far bigger cells for the same reason a
  // month view always reads clearer than one slice of a 52-column strip.
  function renderTrackerMonthGrid() {
    const monthGridEl = document.getElementById('trackerMonthGrid');
    if (!monthGridEl) return;
    const firstDayOfWeek = Storage.getSettings().firstDayOfWeek || 0;
    const year = trackerMonthCurrent.getFullYear();
    const month = trackerMonthCurrent.getMonth();
    const today = Utils.todayKey();

    document.getElementById('trackerMonthLabel').textContent =
      trackerMonthCurrent.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const ordered = [...dayNames.slice(firstDayOfWeek), ...dayNames.slice(0, firstDayOfWeek)];
    document.getElementById('trackerMonthWeekdays').innerHTML = ordered.map(n => `<span>${n}</span>`).join('');

    monthGridEl.innerHTML = '';
    const days = Utils.buildMonthGrid(year, month, firstDayOfWeek);

    days.forEach(day => {
      const cell = document.createElement('button');
      cell.type = 'button';
      const isFuture = day.key > today;
      const stats = isFuture ? { completed: [], total: 0, ratio: 0 } : dayStats(day.key);
      const bucket = isFuture ? -1 : Utils.intensityForRatio(stats.ratio);
      cell.className = 'trk-day'
        + (day.inMonth ? '' : ' is-outside')
        + (day.key === today ? ' is-today' : '')
        + (bucket >= 0 ? ` trk-day-level-${bucket}` : '');
      cell.innerHTML = `<span class="trk-day-num">${day.date.getDate()}</span>`;
      if (!isFuture) {
        cell.title = `${stats.completed.length}/${stats.total} done`;
        cell.addEventListener('click', () => openDayModal(day.key, stats));
      }
      monthGridEl.appendChild(cell);
    });
  }

  function shiftTrackerMonth(delta) {
    trackerMonthCurrent = new Date(trackerMonthCurrent.getFullYear(), trackerMonthCurrent.getMonth() + delta, 1);
    renderTrackerMonthGrid();
  }

  function trackerMonthToday() {
    trackerMonthCurrent = new Date();
    renderTrackerMonthGrid();
  }

  function setTrackerMode(mode) {
    trackerMode = mode;
    const monthPanel = document.getElementById('trackerMonthPanel');
    const yearPanel = document.getElementById('trackerYearPanel');
    const monthNav = document.getElementById('trackerMonthNavGroup');
    const yearNav = document.getElementById('trackerYearNavGroup');
    if (monthPanel) monthPanel.hidden = mode !== 'month';
    if (yearPanel) yearPanel.hidden = mode !== 'year';
    if (monthNav) monthNav.hidden = mode !== 'month';
    if (yearNav) yearNav.hidden = mode !== 'year';
    document.querySelectorAll('.trk-tab').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.trackerMode === mode);
    });
    if (mode === 'month') renderTrackerMonthGrid();
    else renderYearGrid();
  }

  function updateSidebarStreak() {
    const el = document.getElementById('sidebarStreakCount');
    if (el) el.textContent = currentStreak();
  }

  function showTooltip(e, dateKey, stats) {
    const tip = document.getElementById('trackerTooltip');
    tip.innerHTML = `<strong>${Utils.formatShortDate(dateKey)}</strong> — ${stats.completed.length}/${stats.total} done`;
    tip.classList.add('is-visible');
    positionTooltip(e);
  }
  function positionTooltip(e) {
    const tip = document.getElementById('trackerTooltip');
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
  }
  function hideTooltip() {
    document.getElementById('trackerTooltip').classList.remove('is-visible');
  }

  function openDayModal(dateKey, stats) {
    document.getElementById('dayModalTitle').textContent = Utils.formatFriendlyDate(dateKey);
    document.getElementById('dayModalSub').textContent = `${stats.completed.length} of ${stats.total} tasks completed`;
    const list = document.getElementById('dayModalList');
    list.innerHTML = '';
    if (stats.completed.length === 0) {
      list.innerHTML = '<p class="empty-body">No tasks were completed on this day.</p>';
    } else {
      stats.completed.forEach(item => {
        const row = document.createElement('div');
        row.className = 'day-modal-item';
        const dotColor = `var(--signal-${item.priority})`;
        row.innerHTML = `<span class="dot" style="background:${dotColor}"></span>
          <span>${Utils.escapeHtml(item.text)}</span>`;
        list.appendChild(row);
      });
    }
    document.getElementById('dayModalOverlay').classList.add('is-visible');
  }

  function shiftYear(delta) {
    const y = Storage.getTrackerYear() + delta;
    Storage.saveTrackerYear(y);
    render();
  }

  // ---------------- Stats page ----------------
  function renderStats() {
    updateCoreStats();
    if (trackerMode === 'month') renderTrackerMonthGrid();
    else renderYearGrid();

    const weeklyEl = document.getElementById('statWeeklyRate');
    const monthlyEl = document.getElementById('statMonthlyRate');
    const productiveEl = document.getElementById('statMostProductive');
    const totalAllEl = document.getElementById('statTotalCompletedAllTime');

    if (weeklyEl) weeklyEl.textContent = weeklyCompletionRate() + '%';
    if (monthlyEl) monthlyEl.textContent = monthlyCompletionRate() + '%';
    if (totalAllEl) totalAllEl.textContent = totalCompletedAllTime();
    if (productiveEl) {
      const mp = mostProductiveDay();
      productiveEl.textContent = mp ? mp.day : '—';
    }

    renderTrendChart();
    renderCategoryPie();
  }

  function renderCategoryPie() {
    const pie = document.getElementById('completionPie');
    if (!pie) return;
    const breakdown = categoryBreakdown();
    const centerCount = document.getElementById('completionPieCenter');
    const centerLabel = document.getElementById('completionPieCenterLabel');
    const legend = document.getElementById('completionPieLegend');

    if (breakdown.length === 0) {
      pie.style.background = 'var(--lamp-0)';
      if (centerCount) centerCount.textContent = '0';
      if (centerLabel) centerLabel.textContent = 'tasks';
      if (legend) legend.innerHTML = '<p class="pie-empty">No active tasks yet.</p>';
      return;
    }

    const total = breakdown.reduce((sum, b) => sum + b.count, 0);

    // Exact fractional boundaries for the gradient itself (so slices are
    // pixel-accurate); percent shown in the legend is rounded separately
    // for display only, so the two don't have to be reconciled.
    let cursor = 0;
    const stops = breakdown.map((b, i) => {
      const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
      const start = cursor;
      cursor += (b.count / total) * 360;
      return `${color} ${start}deg ${cursor}deg`;
    });
    pie.style.background = `conic-gradient(${stops.join(', ')})`;

    if (centerCount) centerCount.textContent = String(total);
    if (centerLabel) centerLabel.textContent = total === 1 ? 'task' : 'tasks';

    if (legend) {
      legend.innerHTML = breakdown.map((b, i) => `
        <div class="pie-legend-row">
          <span class="pie-legend-dot" style="background:${CATEGORY_COLORS[i % CATEGORY_COLORS.length]}"></span>
          <span class="pie-legend-label">${Utils.escapeHtml(b.category)}</span>
          <span class="pie-legend-value">${b.count} · ${b.percent}%</span>
        </div>
      `).join('');
    }
  }

  function renderTrendChart() {
    const container = document.getElementById('trendChart');
    if (!container) return;
    container.innerHTML = '';
    trendSeries(6).forEach(point => {
      const col = document.createElement('div');
      col.className = 'trend-bar-col';
      const height = Math.max(4, point.rate);
      col.innerHTML = `<div class="trend-bar" style="height:${height}%" title="${point.label}: ${point.rate}%"></div><span class="trend-bar-label">${point.label}</span>`;
      container.appendChild(col);
    });
  }

  // ---------------- Dashboard rail ----------------
  function renderDashboardRail() {
    const todayEl = document.getElementById('railToday');
    const streakEl = document.getElementById('railStreak');
    const bestEl = document.getElementById('railBest');
    const totalEl = document.getElementById('railCompletedTotal');

    if (todayEl) todayEl.textContent = Math.round(dayStats(Utils.todayKey()).ratio * 100) + '%';
    if (streakEl) streakEl.textContent = currentStreak();
    if (bestEl) bestEl.textContent = bestStreak();
    if (totalEl) totalEl.textContent = totalCompletedAllTime();
    updateSidebarStreak();

    renderWeeklyChart();
  }

  function renderWeeklyChart() {
    const container = document.getElementById('weeklyChart');
    if (!container) return;
    container.innerHTML = '';
    last7DaysSeries().forEach(day => {
      const col = document.createElement('div');
      col.className = 'weekly-bar-col';
      const height = Math.max(4, Math.round(day.ratio * 100));
      col.innerHTML = `<div class="weekly-bar" style="height:${height}%" title="${Utils.formatShortDate(day.key)}: ${day.completed}/${day.total} done"></div><span class="weekly-bar-label">${day.label}</span>`;
      container.appendChild(col);
    });
  }

  return {
    render, shiftYear, currentStreak, bestStreak, dayStats,
    renderStats, renderDashboardRail, totalCompletedAllTime,
    shiftTrackerMonth, trackerMonthToday, setTrackerMode
  };
})();
