/* ===========================================================
   app.js — entry point: wires DOM events to Checklist/Tracker/Storage
   =========================================================== */

(() => {

  let editingId = null;

  // ---------------- init ----------------
  document.addEventListener('DOMContentLoaded', () => {
    Settings.init();
    Checklist.load();
    document.getElementById('sortSelect').value = Checklist.getFilterState().sort;
    updateTodayLabel();

    refreshAll();

    bindNav();
    bindSidebar();
    bindChecklistEvents();
    bindQuickAdd();
    bindFilters();
    bindModal();
    bindDayModal();
    bindTrackerControls();
    bindTheme();
    Calendar.bind();
    Events.load();
    Events.bind();
    Pomodoro.bind();
  });

  function updateTodayLabel() {
    const el = document.getElementById('todayDateLabel');
    if (el) {
      el.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    }
  }

  // ---------------- theme ----------------
  // Full theme control (Light/Dark/System) lives in the Settings modal via
  // Settings.js. This sidebar button is just a fast light<->dark flip for
  // when someone doesn't want to open Settings; it always sets an explicit
  // mode (never 'system') so its meaning stays predictable.
  function bindTheme() {
    document.getElementById('themeToggle').addEventListener('click', () => {
      const isDark = document.documentElement.classList.contains('dark');
      const nextMode = isDark ? 'light' : 'dark';
      Storage.saveSettings({ themeMode: nextMode });
      Settings.applyAll();
    });
  }

  // ---------------- nav / views ----------------
  function bindNav() {
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
  }
  function switchView(view) {
    document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('is-active'));
    document.getElementById(`view-${view}`).classList.add('is-active');
    if (view === 'dashboard') { renderChecklist(); Tracker.renderDashboardRail(); renderRailDeadlines(); }
    if (view === 'focus') renderFocus();
    if (view === 'calendar') Calendar.render();
    if (view === 'events') Events.render();
    if (view === 'stats') Tracker.renderStats();
    if (view === 'archive') renderArchive();
    document.getElementById('sidebar').classList.remove('is-open');
  }

  function bindSidebar() {
    document.getElementById('mobileNavToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('is-open');
    });
  }

  // ---------------- checklist rendering ----------------
  function renderCategoryFilter() {
    const select = document.getElementById('categoryFilter');
    const current = select.value;
    select.innerHTML = '<option value="all">All categories</option>' +
      Checklist.getCategories().map(c => `<option value="${Utils.escapeHtml(c)}">${Utils.escapeHtml(c)}</option>`).join('');
    select.value = current || 'all';

    const datalist = document.getElementById('categoryList');
    datalist.innerHTML = Checklist.getCategories().map(c => `<option value="${Utils.escapeHtml(c)}">`).join('');
  }

  function renderChecklist() {
    const container = document.getElementById('checklistGroups');
    const list = Checklist.getFiltered();
    const isManualSort = Checklist.getFilterState().sort === 'manual';
    const count = Checklist.renderGroups(container, list, { noDrag: !isManualSort });
    document.getElementById('checklistEmpty').hidden = list.length > 0;
    container.hidden = list.length === 0;
  }

  function renderArchive() {
    const container = document.getElementById('archiveGroups');
    const list = Checklist.getArchived();
    Checklist.renderGroups(container, list, { archiveView: true, noDrag: true });
    document.getElementById('archiveEmpty').hidden = list.length > 0;
    container.hidden = list.length === 0;
  }

  function renderFocus() {
    const items = Checklist.getTodayFocusItems();
    const list = document.getElementById('focusList');
    list.innerHTML = '';
    items.forEach(item => {
      const row = Checklist.renderTaskItem(item, { noDrag: true });
      row.classList.add('focus-item');
      list.appendChild(row);
    });
    const doneToday = items.filter(i => i.completed).length;
    document.getElementById('focusSub').textContent = `${doneToday} of ${items.length} done today`;
    document.getElementById('focusEmpty').hidden = items.length > 0;
    list.hidden = items.length === 0;
  }

  function renderRailDeadlines() {
    const items = Checklist.getUpcomingDeadlines();
    const list = document.getElementById('railDeadlineList');
    list.innerHTML = '';
    items.forEach(item => {
      const row = Checklist.renderTaskItem(item, { noDrag: true });
      row.classList.add('rail-focus-item');
      list.appendChild(row);
    });
    document.getElementById('railDeadlineEmpty').hidden = items.length > 0;
    list.hidden = items.length === 0;
  }

  function refreshAll() {
    renderCategoryFilter();
    renderChecklist();
    renderArchive();
    renderFocus();
    renderRailDeadlines();
    Tracker.renderStats();
    Tracker.renderDashboardRail();
  }

  // ---------------- checklist item interactions (delegated) ----------------
  function bindChecklistEvents() {
    document.getElementById('checklistGroups').addEventListener('click', handleItemAction);
    document.getElementById('archiveGroups').addEventListener('click', handleItemAction);
    document.getElementById('focusList').addEventListener('click', handleItemAction);
    document.getElementById('railDeadlineList').addEventListener('click', handleItemAction);

    // drag and drop (checklist only)
    const container = document.getElementById('checklistGroups');
    container.addEventListener('dragstart', (e) => {
      const li = e.target.closest('.task-item');
      if (!li) return;
      dragIdHolder.id = li.dataset.id;
      li.classList.add('is-dragging');
    });
    container.addEventListener('dragend', (e) => {
      const li = e.target.closest('.task-item');
      if (li) li.classList.remove('is-dragging');
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    container.addEventListener('dragover', (e) => {
      const li = e.target.closest('.task-item');
      if (!li) return;
      e.preventDefault();
      li.classList.add('drag-over');
    });
    container.addEventListener('dragleave', (e) => {
      const li = e.target.closest('.task-item');
      if (li) li.classList.remove('drag-over');
    });
    container.addEventListener('drop', (e) => {
      const li = e.target.closest('.task-item');
      if (!li) return;
      e.preventDefault();
      li.classList.remove('drag-over');
      const targetId = li.dataset.id;
      if (dragIdHolder.id && dragIdHolder.id !== targetId) {
        Checklist.reorder(dragIdHolder.id, targetId);
        renderChecklist();
      }
      dragIdHolder.id = null;
    });
  }
  const dragIdHolder = { id: null };

  function handleItemAction(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const li = e.target.closest('.task-item');
    const id = li.dataset.id;
    const action = btn.dataset.action;
    if (action === 'toggle') {
      const willComplete = !li.classList.contains('is-completed');
      Checklist.toggleComplete(id);
      if (willComplete) {
        // Let the completion pulse play on the actual clicked row before
        // the list re-renders (re-rendering swaps in a fresh element, so
        // the animation has to happen first, not on the new node).
        li.classList.add('just-completed');
        setTimeout(refreshAll, 240);
      } else {
        refreshAll();
      }
      return;
    }
    if (action === 'pin') { Checklist.togglePin(id); refreshAll(); }
    if (action === 'edit') openEditModal(id);
    if (action === 'archive') { Checklist.archiveItem(id); refreshAll(); }
    if (action === 'unarchive') { Checklist.unarchiveItem(id); refreshAll(); }
    if (action === 'delete') {
      if (confirm('Delete this task permanently? This cannot be undone.')) {
        Checklist.deleteItem(id);
        refreshAll();
      }
    }
  }

  // ---------------- quick add ----------------
  function bindQuickAdd() {
    document.getElementById('quickAddForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('quickAddInput');
      const text = input.value.trim();
      if (!text) return;
      Checklist.addItem({ text, category: 'General', priority: 'medium' });
      input.value = '';
      refreshAll();
    });
  }

  // ---------------- filters ----------------
  function bindFilters() {
    document.querySelectorAll('.chip[data-filter-priority]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip[data-filter-priority]').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        Checklist.setFilter({ priority: chip.dataset.filterPriority });
        renderChecklist();
      });
    });
    document.getElementById('categoryFilter').addEventListener('change', (e) => {
      Checklist.setFilter({ category: e.target.value });
      renderChecklist();
    });
    document.getElementById('sortSelect').addEventListener('change', (e) => {
      Checklist.setFilter({ sort: e.target.value });
      renderChecklist();
    });
    document.getElementById('searchInput').addEventListener('input', Utils.debounce((e) => {
      Checklist.setFilter({ search: e.target.value });
      renderChecklist();
    }, 120));
  }

  // ---------------- add/edit modal ----------------
  function bindModal() {
    const overlay = document.getElementById('itemModalOverlay');
    document.getElementById('openAddModal').addEventListener('click', openAddModal);
    document.getElementById('closeItemModal').addEventListener('click', closeModal);
    document.getElementById('cancelItemModal').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    document.getElementById('itemSchedule').addEventListener('change', (e) => {
      document.getElementById('customDaysPicker').hidden = e.target.value !== 'custom';
    });

    document.getElementById('itemDueDate').addEventListener('input', toggleOneTimeFields);

    document.getElementById('itemForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const scheduleType = document.getElementById('itemSchedule').value;
      const scheduleDays = scheduleType === 'custom'
        ? Array.from(document.querySelectorAll('#customDaysPicker input:checked')).map(cb => parseInt(cb.value, 10))
        : [];
      const data = {
        text: document.getElementById('itemText').value,
        category: document.getElementById('itemCategory').value,
        priority: document.getElementById('itemPriority').value,
        dueDate: document.getElementById('itemDueDate').value,
        recurring: document.getElementById('itemRecurring').value,
        schedule: { type: scheduleType, days: scheduleDays },
        pinned: document.getElementById('itemPinned').checked
      };
      if (!data.text.trim()) return;
      if (editingId) Checklist.updateItem(editingId, data);
      else Checklist.addItem(data);
      closeModal();
      refreshAll();
    });

    document.getElementById('deleteItemBtn').addEventListener('click', () => {
      if (editingId && confirm('Delete this task permanently?')) {
        Checklist.deleteItem(editingId);
        closeModal();
        refreshAll();
      }
    });
  }

  // A due date makes a task one-time (see checklist.js), so its Repeat
  // and Scheduled Days fields don't apply — hide them rather than
  // leaving controls on screen that have no effect once saved.
  function toggleOneTimeFields() {
    const hasDueDate = !!document.getElementById('itemDueDate').value;
    document.getElementById('repeatFieldWrap').hidden = hasDueDate;
    document.getElementById('scheduleFieldWrap').hidden = hasDueDate;
    document.getElementById('oneTimeHint').hidden = !hasDueDate;
  }

  function openAddModal() {
    editingId = null;
    document.getElementById('modalTitle').textContent = 'New task';
    document.getElementById('itemForm').reset();
    document.getElementById('itemPriority').value = 'medium';
    document.getElementById('itemSchedule').value = 'daily';
    document.getElementById('customDaysPicker').hidden = true;
    document.getElementById('deleteItemBtn').hidden = true;
    toggleOneTimeFields();
    document.getElementById('itemModalOverlay').classList.add('is-visible');
    setTimeout(() => document.getElementById('itemText').focus(), 50);
  }

  function openEditModal(id) {
    const item = Checklist.getAll().find(i => i.id === id);
    if (!item) return;
    editingId = id;
    document.getElementById('modalTitle').textContent = 'Edit task';
    document.getElementById('itemText').value = item.text;
    document.getElementById('itemCategory').value = item.category;
    document.getElementById('itemPriority').value = item.priority;
    document.getElementById('itemDueDate').value = item.dueDate || '';
    document.getElementById('itemRecurring').value = item.recurring || '';
    document.getElementById('itemPinned').checked = !!item.pinned;

    const schedule = item.schedule && item.schedule.type ? item.schedule : { type: 'daily', days: [] };
    document.getElementById('itemSchedule').value = schedule.type;
    document.querySelectorAll('#customDaysPicker input').forEach(cb => {
      cb.checked = schedule.type === 'custom' && (schedule.days || []).includes(parseInt(cb.value, 10));
    });
    document.getElementById('customDaysPicker').hidden = schedule.type !== 'custom';
    toggleOneTimeFields();

    document.getElementById('deleteItemBtn').hidden = false;
    document.getElementById('itemModalOverlay').classList.add('is-visible');
  }

  function closeModal() {
    document.getElementById('itemModalOverlay').classList.remove('is-visible');
    editingId = null;
  }

  // ---------------- day modal ----------------
  function bindDayModal() {
    const overlay = document.getElementById('dayModalOverlay');
    document.getElementById('closeDayModal').addEventListener('click', () => overlay.classList.remove('is-visible'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('is-visible'); });
  }

  // ---------------- tracker controls ----------------
  function bindTrackerControls() {
    document.getElementById('prevYear').addEventListener('click', () => Tracker.shiftYear(-1));
    document.getElementById('nextYear').addEventListener('click', () => Tracker.shiftYear(1));
    document.getElementById('prevTrackerMonth').addEventListener('click', () => Tracker.shiftTrackerMonth(-1));
    document.getElementById('nextTrackerMonth').addEventListener('click', () => Tracker.shiftTrackerMonth(1));
    document.getElementById('trackerMonthTodayBtn').addEventListener('click', () => Tracker.trackerMonthToday());
    document.querySelectorAll('.trk-tab').forEach(tab => {
      tab.addEventListener('click', () => Tracker.setTrackerMode(tab.dataset.trackerMode));
    });
  }

  // Exposed so firebase-sync.js can refresh the UI after pulling/merging
  // remote data, without the two modules needing to know about each other's
  // internals.
  window.SignalboardApp = { refreshAll, openEditModal, updateTodayLabel };

  // Keyboard shortcuts. Escape always closes modals; 'n' and '/' jump to
  // quick-add / search, but only when the user isn't already typing
  // somewhere and no modal is open, so normal typing is never hijacked.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('itemModalOverlay').classList.remove('is-visible');
      document.getElementById('dayModalOverlay').classList.remove('is-visible');
      return;
    }

    const modalOpen = document.getElementById('itemModalOverlay').classList.contains('is-visible')
      || document.getElementById('dayModalOverlay').classList.contains('is-visible');
    const tag = (e.target.tagName || '').toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (isTyping || modalOpen || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'n') {
      e.preventDefault();
      switchView('dashboard');
      setTimeout(() => document.getElementById('quickAddInput').focus(), 50);
    }
    if (e.key === '/') {
      e.preventDefault();
      switchView('dashboard');
      setTimeout(() => document.getElementById('searchInput').focus(), 50);
    }
  });

})();
