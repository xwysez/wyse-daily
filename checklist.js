/* ===========================================================
   checklist.js — checklist data model + rendering + interactions
   =========================================================== */

const Checklist = (() => {

  let items = [];
  let categories = [];
  let dragId = null;

  let state = {
    search: '',
    priority: 'all',
    category: 'all',
    sort: 'manual'
  };

  function load() {
    items = Storage.getItems();
    categories = Storage.getCategories();
    state.sort = Storage.getSettings().defaultSort || 'manual';
    applyRecurringResets();
  }

  function persist() {
    Storage.saveItems(items);
  }

  function persistCategories() {
    Storage.saveCategories(categories);
  }

  // ---------------- recurring reset ----------------
  // If a recurring item's last completion doesn't fall in the current
  // day/week/month, flip it back to "open" so it can be checked again,
  // while keeping its completionHistory (the tracker log) intact.
  function applyRecurringResets() {
    const today = Utils.todayKey();
    let changed = false;
    items.forEach(item => {
      if (!item.recurring || !item.completed) return;
      const last = item.completionHistory[item.completionHistory.length - 1];
      if (!last) return;
      let stillCurrent = false;
      if (item.recurring === 'daily') stillCurrent = last === today;
      if (item.recurring === 'weekly') stillCurrent = Utils.isSameWeek(last, today);
      if (item.recurring === 'monthly') stillCurrent = Utils.isSameMonth(last, today);
      if (!stillCurrent) {
        item.completed = false;
        changed = true;
      }
    });
    if (changed) persist();
  }

  // ---------------- scheduling ----------------
  // A task's `schedule` controls which days it's visible on. Missing or
  // malformed schedules default to 'daily' so older data (and anything
  // fed in from outside the form) behaves exactly like before this
  // feature existed: visible every day.
  function normalizeSchedule(schedule) {
    if (!schedule || !schedule.type) return { type: 'daily', days: [0, 1, 2, 3, 4, 5, 6] };
    if (schedule.type === 'custom') {
      const days = Array.isArray(schedule.days) ? schedule.days.filter(d => d >= 0 && d <= 6) : [];
      return { type: 'custom', days };
    }
    return { type: schedule.type, days: [] };
  }

  function isScheduledOn(item, dateKey) {
    const schedule = item.schedule;
    if (!schedule || !schedule.type || schedule.type === 'daily') return true;
    const dow = Utils.parseDateKey(dateKey).getDay(); // 0 = Sun ... 6 = Sat
    if (schedule.type === 'weekdays') return dow >= 1 && dow <= 5;
    if (schedule.type === 'weekends') return dow === 0 || dow === 6;
    if (schedule.type === 'custom') return (schedule.days || []).includes(dow);
    return true;
  }

  function scheduleLabel(schedule) {
    if (!schedule || !schedule.type || schedule.type === 'daily') return '';
    if (schedule.type === 'weekdays') return '📆 Weekdays';
    if (schedule.type === 'weekends') return '📆 Weekends';
    if (schedule.type === 'custom') {
      const names = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
      const days = (schedule.days || []).slice().sort();
      return days.length ? `📆 ${days.map(d => names[d]).join(' ')}` : '📆 Custom';
    }
    return '';
  }

  // ---------------- CRUD ----------------
  function addItem(data) {
    const cat = (data.category || 'General').trim() || 'General';
    ensureCategory(cat);
    const isOneTime = !!data.dueDate;
    const item = {
      id: Utils.uid(),
      text: data.text.trim(),
      category: cat,
      priority: data.priority || 'medium',
      dueDate: data.dueDate || null,
      recurring: isOneTime ? '' : (data.recurring || ''),
      schedule: isOneTime ? normalizeSchedule(null) : normalizeSchedule(data.schedule),
      pinned: !!data.pinned,
      completed: false,
      archived: false,
      order: items.length,
      createdAt: Utils.todayKey(),
      archivedAt: null,
      completionHistory: [],
      updatedAt: Date.now()
    };
    items.push(item);
    persist();
    return item;
  }

  function updateItem(id, data) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    if (data.category) ensureCategory(data.category.trim());
    const isOneTime = !!data.dueDate;
    Object.assign(item, {
      text: data.text.trim(),
      category: (data.category || 'General').trim() || 'General',
      priority: data.priority || 'medium',
      dueDate: data.dueDate || null,
      recurring: isOneTime ? '' : (data.recurring || ''),
      schedule: isOneTime ? normalizeSchedule(null) : normalizeSchedule(data.schedule),
      pinned: !!data.pinned,
      updatedAt: Date.now()
    });
    persist();
  }

  function deleteItem(id) {
    items = items.filter(i => i.id !== id);
    persist();
  }

  /** Toggles whether an item was completed on a specific date. The
   *  `completed` flag is intentionally only kept in sync when the date
   *  being toggled is today — it represents "today's" state and drives
   *  the checklist/focus/dashboard views, all of which are about today.
   *  Toggling a past or future date (from the calendar) only changes
   *  completionHistory for that date, so it can never bleed into how
   *  other dates or the "current" flag look. */
  function toggleCompleteOnDate(id, dateKey) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const wasCompletedOnDate = item.completionHistory.includes(dateKey);
    if (wasCompletedOnDate) {
      item.completionHistory = item.completionHistory.filter(d => d !== dateKey);
    } else {
      item.completionHistory.push(dateKey);
    }
    if (dateKey === Utils.todayKey()) {
      item.completed = !wasCompletedOnDate;
    }
    item.updatedAt = Date.now();
    persist();
  }

  function toggleComplete(id) {
    toggleCompleteOnDate(id, Utils.todayKey());
  }

  function archiveItem(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.archived = true;
    item.archivedAt = Utils.todayKey();
    item.updatedAt = Date.now();
    persist();
  }

  function unarchiveItem(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.archived = false;
    item.archivedAt = null;
    item.updatedAt = Date.now();
    persist();
  }

  function togglePin(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.pinned = !item.pinned;
    item.updatedAt = Date.now();
    persist();
  }

  function reorder(draggedId, targetId) {
    const from = items.findIndex(i => i.id === draggedId);
    const to = items.findIndex(i => i.id === targetId);
    if (from === -1 || to === -1 || from === to) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    items.forEach((it, idx) => { it.order = idx; });
    persist();
  }

  function ensureCategory(cat) {
    if (cat && !categories.includes(cat)) {
      categories.push(cat);
      persistCategories();
    }
  }

  // ---------------- getters ----------------
  function getAll() { return items; }
  function getCategories() { return categories; }
  function getActive() { return items.filter(i => !i.archived); }
  function getArchived() { return items.filter(i => i.archived); }

  function getFiltered() {
    const q = state.search.trim().toLowerCase();
    const today = Utils.todayKey();
    const hideCompleted = Storage.getSettings().hideCompleted;
    return getActive()
      .filter(i => state.priority === 'all' || i.priority === state.priority)
      .filter(i => state.category === 'all' || i.category === state.category)
      .filter(i => !q || i.text.toLowerCase().includes(q))
      .filter(i => q || isScheduledOn(i, today)) // schedule only hides items in the default (unsearched) view
      .filter(i => !hideCompleted || !i.completed)
      .sort(sortComparator(state.sort));
  }

  function sortComparator(sort) {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    if (sort === 'dueDate') {
      return (a, b) => {
        if (!a.dueDate && !b.dueDate) return a.order - b.order;
        if (!a.dueDate) return 1;   // undated tasks sort after dated ones
        if (!b.dueDate) return -1;
        return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.order - b.order;
      };
    }
    if (sort === 'priority') {
      return (a, b) => (priorityRank[a.priority] - priorityRank[b.priority]) || (a.order - b.order);
    }
    if (sort === 'created') {
      return (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.order - b.order);
    }
    return (a, b) => a.order - b.order; // 'manual'
  }

  /** Tasks with a due date today or in the future (or overdue), soonest
   *  first — powers the Dashboard's "Upcoming deadlines" rail card. */
  function getUpcomingDeadlines(limit = 5) {
    const today = Utils.todayKey();
    return getActive()
      .filter(item => item.dueDate && !item.completed)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
      .slice(0, limit);
  }

  function getTodayFocusItems() {
    const today = Utils.todayKey();
    return getActive().filter(item => isPartOfToday(item, today))
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1; // open tasks first, done ones trail
        const order = { high: 0, medium: 1, low: 2 };
        return (b.pinned - a.pinned) || (order[a.priority] - order[b.priority]);
      });
  }

  /** Whether an item belongs to "today's" task set at all — used both
   *  to build the Focus mode list and to count today's progress. This
   *  intentionally does NOT exclude completed items the way the old
   *  filter did: excluding them was what made the "X of Y done" counter
   *  shrink its own denominator every time a task got checked off. */
  function isPartOfToday(item, today) {
    if (!isScheduledOn(item, today)) return false;
    if (item.dueDate && item.dueDate < today) return !item.completed; // overdue only while still open
    if (item.dueDate === today) return true; // due today — counts whether open or done
    if (item.recurring) return true; // recurring occurrence — counts whether open or done
    if (!item.dueDate) return !item.completed || item.completionHistory.includes(today); // undated: open, or completed specifically today
    return false;
  }

  function setFilter(patch) { Object.assign(state, patch); }
  function getFilterState() { return state; }

  // ---------------- rendering: checklist / archive groups ----------------
  function groupByCategory(list) {
    const groups = {};
    list.forEach(item => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    return groups;
  }

  function priorityLabel(p) {
    return { low: 'Low', medium: 'Medium', high: 'High' }[p] || 'Medium';
  }

  function recurringLabel(r) {
    return { daily: '↻ Daily', weekly: '↻ Weekly', monthly: '↻ Monthly' }[r] || '';
  }

  function checkSvg() {
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function renderTaskItem(item, opts = {}) {
    const li = document.createElement('li');
    // opts.dateKey lets a caller (the calendar) ask "was this completed
    // on THIS date" instead of the item's shared 'today' flag — that
    // flag is only ever meaningful for today, so using it for every
    // date in the calendar was the bug that made completing a task once
    // show it as completed on every day it's scheduled.
    const isCompleted = opts.dateKey ? item.completionHistory.includes(opts.dateKey) : item.completed;
    li.className = 'task-item' + (isCompleted ? ' is-completed' : '') + (item.pinned ? ' is-pinned' : '');
    li.draggable = !opts.noDrag;
    li.dataset.id = item.id;
    if (opts.dateKey) li.dataset.dateKey = opts.dateKey;

    const today = Utils.todayKey();
    const isOverdue = item.dueDate && item.dueDate < today && !item.completed;
    const dueHtml = item.dueDate
      ? `<span class="meta-due${isOverdue ? ' is-overdue' : ''}">${isOverdue ? '⚠ ' : '📅 '}${Utils.formatDatePref(item.dueDate, Storage.getSettings().dateFormat)}</span>`
      : '';
    const recurHtml = item.recurring ? `<span class="meta-recur">${recurringLabel(item.recurring)}</span>` : '';
    const scheduleText = scheduleLabel(item.schedule);
    const scheduleHtml = scheduleText ? `<span class="meta-schedule">${scheduleText}</span>` : '';

    li.innerHTML = `
      ${opts.noDrag ? '' : '<span class="drag-handle" title="Drag to reorder">⋮⋮</span>'}
      <button class="task-check" data-action="toggle" aria-label="Toggle complete">${checkSvg()}</button>
      <div class="task-body">
        <p class="task-text">${Utils.escapeHtml(item.text)}</p>
        <div class="task-meta">
          <span class="meta-pill priority-${item.priority}">${priorityLabel(item.priority)}</span>
          ${dueHtml}
          ${recurHtml}
          ${scheduleHtml}
        </div>
      </div>
      <div class="task-actions">
        ${opts.archiveView ? `
          <button data-action="unarchive" title="Restore"><svg viewBox="0 0 24 24"><path d="M12 19V5M12 5l-5 5M12 5l5 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button data-action="delete" title="Delete permanently"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>
        ` : `
          <button data-action="pin" title="${item.pinned ? 'Unpin' : 'Pin'}" class="${item.pinned ? 'is-pin-active' : ''}"><svg viewBox="0 0 24 24"><path d="M12 2l1.6 5.2L19 9l-4.6 3 1.2 5.4L12 14.8 7.4 17.4l1.2-5.4L4 9l5.4-1.8L12 2z" fill="${item.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
          <button data-action="edit" title="Edit"><svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg></button>
          <button data-action="archive" title="Archive"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4" rx="1" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" stroke="currentColor" stroke-width="1.8" fill="none"/></svg></button>
          <button data-action="delete" title="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>
        `}
      </div>
    `;
    return li;
  }

  function renderGroups(container, list, opts = {}) {
    container.innerHTML = '';
    const groups = groupByCategory(list);
    const catNames = Object.keys(groups).sort();
    catNames.forEach(cat => {
      const groupItems = groups[cat].sort((a, b) => (b.pinned - a.pinned) || (a.order - b.order));
      const section = document.createElement('div');
      section.className = 'category-group';
      section.innerHTML = `<div class="category-heading">${Utils.escapeHtml(cat)} <span class="count">· ${groupItems.length}</span></div>`;
      const ul = document.createElement('ul');
      ul.className = 'item-list';
      groupItems.forEach(item => ul.appendChild(renderTaskItem(item, opts)));
      section.appendChild(ul);
      container.appendChild(section);
    });
    return catNames.length;
  }

  return {
    load, addItem, updateItem, deleteItem, toggleComplete, toggleCompleteOnDate,
    archiveItem, unarchiveItem, togglePin, reorder,
    getAll, getCategories, getActive, getArchived, getFiltered, getTodayFocusItems,
    getUpcomingDeadlines, isScheduledOn, scheduleLabel,
    setFilter, getFilterState, renderGroups, renderTaskItem, priorityLabel
  };
})();
