/* ===========================================================
   calendar.js — month view: which tasks are scheduled/due on which day.
   Reuses Tracker.dayStats() for the completion color so the calendar's
   idea of "how did this day go" matches the green-light tracker exactly.
   =========================================================== */

const Calendar = (() => {

  let current = new Date(); // any date within the currently-shown month

  function tasksForDate(dateKey) {
    const map = new Map();
    Checklist.getActive().forEach(item => {
      // A due date makes a task one-time: it belongs on that single day
      // in the Calendar, never repeating on other scheduled days —
      // regardless of whatever schedule value happens to be stored.
      const matches = item.dueDate ? item.dueDate === dateKey : Checklist.isScheduledOn(item, dateKey);
      if (matches) map.set(item.id, item);
    });
    return Array.from(map.values());
  }

  /** The one task-ordering rule for the whole Calendar: High, then
   *  Medium, then Low. Used for both the cell preview chips and the
   *  day-modal list, so ordering is consistent everywhere tasks show up. */
  function sortByPriority(items) {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    return items.slice().sort((a, b) => (priorityRank[a.priority] - priorityRank[b.priority]) || (a.order - b.order));
  }

  const MAX_PREVIEW = 2;

  function render() {
    const firstDayOfWeek = Storage.getSettings().firstDayOfWeek || 0;
    const year = current.getFullYear();
    const month = current.getMonth();
    const today = Utils.todayKey();

    document.getElementById('calendarMonthLabel').textContent =
      current.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    // Weekday header, respecting first-day-of-week
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const orderedNames = [...dayNames.slice(firstDayOfWeek), ...dayNames.slice(0, firstDayOfWeek)];
    const headerEl = document.getElementById('calendarWeekdays');
    headerEl.innerHTML = orderedNames.map(n => `<span>${n}</span>`).join('');

    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';
    const days = Utils.buildMonthGrid(year, month, firstDayOfWeek);

    days.forEach(day => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-day' + (day.inMonth ? '' : ' is-outside') + (day.key === today ? ' is-today' : '');

      const isFuture = day.key > today;
      const stats = isFuture ? { completed: [], total: 0, ratio: 0 } : Tracker.dayStats(day.key);
      const bucket = isFuture ? -1 : Utils.intensityForRatio(stats.ratio);

      const deadlineCount = Checklist.getActive().filter(it => it.dueDate === day.key).length;
      const dayTasks = sortByPriority(tasksForDate(day.key));
      const previewTasks = dayTasks.slice(0, MAX_PREVIEW);
      const overflow = dayTasks.length - previewTasks.length;

      const chipsHtml = previewTasks.map(t => {
        const doneOnThisDay = t.completionHistory.includes(day.key);
        return `<span class="cal-task-chip priority-${t.priority}${doneOnThisDay ? ' is-done' : ''}" title="${Utils.escapeHtml(t.text)}">${Utils.escapeHtml(t.text)}</span>`;
      }).join('');
      const moreHtml = overflow > 0 ? `<span class="cal-task-more">+${overflow} more</span>` : '';

      cell.innerHTML = `
        <div class="cal-day-top">
          <span class="cal-day-num${bucket >= 0 ? ` cal-day-num-level-${bucket}` : ''}">${day.date.getDate()}</span>
          ${deadlineCount > 0 ? `<span class="cal-day-deadline" title="${deadlineCount} deadline(s)">${deadlineCount}</span>` : ''}
        </div>
        <div class="cal-day-tasks">${chipsHtml}${moreHtml}</div>
      `;
      cell.addEventListener('click', () => openDayModal(day.key));
      grid.appendChild(cell);
    });
  }

  let openDateKey = null;

  function openDayModal(dateKey) {
    openDateKey = dateKey;
    document.getElementById('calDayModalTitle').textContent = Utils.formatFriendlyDate(dateKey);
    const tasks = sortByPriority(tasksForDate(dateKey));
    const list = document.getElementById('calDayModalList');
    list.innerHTML = '';
    if (tasks.length === 0) {
      list.innerHTML = '<p class="empty-body">Nothing scheduled or due this day.</p>';
    } else {
      tasks.forEach(item => {
        // dateKey here is what makes the modal show THIS day's completion
        // state rather than the item's shared "today" flag.
        const row = Checklist.renderTaskItem(item, { noDrag: true, dateKey });
        list.appendChild(row);
      });
    }
    document.getElementById('calendarDayModalOverlay').classList.add('is-visible');
  }

  function shiftMonth(delta) {
    current = new Date(current.getFullYear(), current.getMonth() + delta, 1);
    render();
  }

  function goToToday() {
    current = new Date();
    render();
  }

  function bind() {
    document.getElementById('calPrevMonth').addEventListener('click', () => shiftMonth(-1));
    document.getElementById('calNextMonth').addEventListener('click', () => shiftMonth(1));
    document.getElementById('calTodayBtn').addEventListener('click', goToToday);

    const overlay = document.getElementById('calendarDayModalOverlay');
    document.getElementById('closeCalDayModal').addEventListener('click', () => {
      overlay.classList.remove('is-visible');
      openDateKey = null;
    });
    overlay.addEventListener('click', (e) => {
      if (e.target !== overlay) return;
      overlay.classList.remove('is-visible');
      openDateKey = null;
    });

    // Let tasks be checked off, pinned, or edited right from the
    // calendar's day modal, with the list and month grid refreshing.
    document.getElementById('calDayModalList').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || !openDateKey) return;
      const li = e.target.closest('.task-item');
      const action = btn.dataset.action;

      if (action === 'toggle') {
        Checklist.toggleCompleteOnDate(li.dataset.id, openDateKey);
        openDayModal(openDateKey);
        render();
        if (window.SignalboardApp) window.SignalboardApp.refreshAll();
      } else if (action === 'pin') {
        Checklist.togglePin(li.dataset.id);
        openDayModal(openDateKey);
        if (window.SignalboardApp) window.SignalboardApp.refreshAll();
      } else if (action === 'edit' && window.SignalboardApp) {
        document.getElementById('calendarDayModalOverlay').classList.remove('is-visible');
        window.SignalboardApp.openEditModal(li.dataset.id);
      }
    });
  }

  return { render, bind, shiftMonth, goToToday };
})();

window.SignalboardCalendar = Calendar;
