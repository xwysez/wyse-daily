/* ===========================================================
   events.js — Event Calendar: one-time/personal events (birthdays,
   appointments, meetings, deadlines, vacations, exams...).

   Deliberately independent from checklist.js/calendar.js: events are
   not tasks, don't have priorities or recurring schedules, and aren't
   part of the green-light completion tracking. Storage.getEvents()/
   saveEvents() is its own key, never touching the items array.
   =========================================================== */

const Events = (() => {

  const EVENT_COLORS = ['blue', 'green', 'amber', 'red', 'violet', 'gray'];

  let current = new Date(); // any date within the currently-shown month
  let events = [];
  let editingId = null;
  let openDateKey = null;

  // ---------------- data ----------------
  function load() {
    events = Storage.getEvents();
  }

  function persist() {
    Storage.saveEvents(events);
  }

  function addEvent(data) {
    const event = {
      id: Utils.uid(),
      title: data.title.trim(),
      date: data.date,
      time: data.time || '',
      description: (data.description || '').trim(),
      color: EVENT_COLORS.includes(data.color) ? data.color : 'blue',
      category: (data.category || '').trim(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    events.push(event);
    persist();
    return event;
  }

  function updateEvent(id, data) {
    const event = events.find(e => e.id === id);
    if (!event) return;
    Object.assign(event, {
      title: data.title.trim(),
      date: data.date,
      time: data.time || '',
      description: (data.description || '').trim(),
      color: EVENT_COLORS.includes(data.color) ? data.color : 'blue',
      category: (data.category || '').trim(),
      updatedAt: Date.now()
    });
    persist();
  }

  function deleteEvent(id) {
    events = events.filter(e => e.id !== id);
    persist();
  }

  function eventsForDate(dateKey) {
    return events
      .filter(e => e.date === dateKey)
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  }

  // ---------------- month view ----------------
  function render() {
    const firstDayOfWeek = Storage.getSettings().firstDayOfWeek || 0;
    const year = current.getFullYear();
    const month = current.getMonth();
    const today = Utils.todayKey();

    document.getElementById('eventsMonthLabel').textContent =
      current.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const orderedNames = [...dayNames.slice(firstDayOfWeek), ...dayNames.slice(0, firstDayOfWeek)];
    document.getElementById('eventsWeekdays').innerHTML = orderedNames.map(n => `<span>${n}</span>`).join('');

    const grid = document.getElementById('eventsGrid');
    grid.innerHTML = '';
    const days = Utils.buildMonthGrid(year, month, firstDayOfWeek);

    days.forEach(day => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'evt-day' + (day.inMonth ? '' : ' is-outside') + (day.key === today ? ' is-today' : '');

      const dayEvents = eventsForDate(day.key);
      const previewEvents = dayEvents.slice(0, 2);
      const overflow = dayEvents.length - previewEvents.length;

      const chipsHtml = previewEvents.map(e =>
        `<span class="evt-chip evt-color-${e.color}" title="${Utils.escapeHtml(e.title)}">${Utils.escapeHtml(e.title)}</span>`
      ).join('');
      const moreHtml = overflow > 0 ? `<span class="evt-more">+${overflow} more</span>` : '';

      cell.innerHTML = `
        <div class="evt-day-top">
          <span class="evt-day-num">${day.date.getDate()}</span>
        </div>
        <div class="evt-day-list">${chipsHtml}${moreHtml}</div>
      `;
      cell.addEventListener('click', () => openDayModal(day.key));
      grid.appendChild(cell);
    });
  }

  function shiftMonth(delta) {
    current = new Date(current.getFullYear(), current.getMonth() + delta, 1);
    render();
  }

  function goToToday() {
    current = new Date();
    render();
  }

  // ---------------- day modal ----------------
  function openDayModal(dateKey) {
    openDateKey = dateKey;
    document.getElementById('eventDayModalTitle').textContent = Utils.formatFriendlyDate(dateKey);
    renderDayModalList();
    document.getElementById('eventDayModalOverlay').classList.add('is-visible');
  }

  function renderDayModalList() {
    const list = document.getElementById('eventDayModalList');
    const dayEvents = eventsForDate(openDateKey);
    list.innerHTML = '';
    if (dayEvents.length === 0) {
      list.innerHTML = '<p class="empty-body">No events on this day.</p>';
      return;
    }
    dayEvents.forEach(event => {
      const row = document.createElement('div');
      row.className = 'evt-row';
      row.dataset.id = event.id;
      const timeHtml = event.time ? `<span class="evt-row-time">${escapeTime(event.time)}</span>` : '';
      const categoryHtml = event.category ? `<span class="evt-row-category">${Utils.escapeHtml(event.category)}</span>` : '';
      const descHtml = event.description ? `<p class="evt-row-desc">${Utils.escapeHtml(event.description)}</p>` : '';
      row.innerHTML = `
        <span class="evt-row-dot evt-color-${event.color}"></span>
        <div class="evt-row-body">
          <div class="evt-row-head">
            <p class="evt-row-title">${Utils.escapeHtml(event.title)}</p>
            ${timeHtml}
          </div>
          ${categoryHtml}
          ${descHtml}
        </div>
        <div class="evt-row-actions">
          <button data-action="edit" title="Edit"><svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg></button>
          <button data-action="delete" title="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg></button>
        </div>
      `;
      list.appendChild(row);
    });
  }

  function escapeTime(time) {
    // time inputs are already constrained to HH:MM by the browser; format for display
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }

  // ---------------- add/edit modal ----------------
  function openAddModal(prefillDate) {
    editingId = null;
    document.getElementById('eventModalTitle').textContent = 'New event';
    document.getElementById('eventForm').reset();
    document.getElementById('eventDate').value = prefillDate || Utils.todayKey();
    setActiveColorSwatch('blue');
    document.getElementById('deleteEventBtn').hidden = true;
    document.getElementById('eventModalOverlay').classList.add('is-visible');
    setTimeout(() => document.getElementById('eventTitle').focus(), 50);
  }

  function openEditModal(id) {
    const event = events.find(e => e.id === id);
    if (!event) return;
    editingId = id;
    document.getElementById('eventModalTitle').textContent = 'Edit event';
    document.getElementById('eventTitle').value = event.title;
    document.getElementById('eventDate').value = event.date;
    document.getElementById('eventTime').value = event.time || '';
    document.getElementById('eventCategory').value = event.category || '';
    document.getElementById('eventDescription').value = event.description || '';
    setActiveColorSwatch(event.color);
    document.getElementById('deleteEventBtn').hidden = false;
    document.getElementById('eventModalOverlay').classList.add('is-visible');
  }

  function closeModal() {
    document.getElementById('eventModalOverlay').classList.remove('is-visible');
    editingId = null;
  }

  function setActiveColorSwatch(color) {
    document.querySelectorAll('#eventColorPicker .swatch').forEach(sw => {
      sw.classList.toggle('is-active', sw.dataset.color === color);
    });
    document.getElementById('eventColorInput').value = color;
  }

  // ---------------- bind ----------------
  function bind() {
    document.getElementById('evtPrevMonth').addEventListener('click', () => shiftMonth(-1));
    document.getElementById('evtNextMonth').addEventListener('click', () => shiftMonth(1));
    document.getElementById('evtTodayBtn').addEventListener('click', goToToday);
    document.getElementById('openAddEvent').addEventListener('click', () => openAddModal());

    const dayOverlay = document.getElementById('eventDayModalOverlay');
    document.getElementById('closeEventDayModal').addEventListener('click', () => {
      dayOverlay.classList.remove('is-visible');
      openDateKey = null;
    });
    dayOverlay.addEventListener('click', (e) => {
      if (e.target !== dayOverlay) return;
      dayOverlay.classList.remove('is-visible');
      openDateKey = null;
    });
    document.getElementById('addEventForDay').addEventListener('click', () => {
      dayOverlay.classList.remove('is-visible');
      openAddModal(openDateKey);
    });

    document.getElementById('eventDayModalList').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const row = e.target.closest('.evt-row');
      const id = row.dataset.id;
      if (btn.dataset.action === 'edit') {
        dayOverlay.classList.remove('is-visible');
        openEditModal(id);
      } else if (btn.dataset.action === 'delete') {
        if (confirm('Delete this event?')) {
          deleteEvent(id);
          renderDayModalList();
          render();
        }
      }
    });

    const modalOverlay = document.getElementById('eventModalOverlay');
    document.getElementById('closeEventModal').addEventListener('click', closeModal);
    document.getElementById('cancelEventModal').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

    document.querySelectorAll('#eventColorPicker .swatch').forEach(sw => {
      sw.addEventListener('click', () => setActiveColorSwatch(sw.dataset.color));
    });

    document.getElementById('eventForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = {
        title: document.getElementById('eventTitle').value,
        date: document.getElementById('eventDate').value,
        time: document.getElementById('eventTime').value,
        category: document.getElementById('eventCategory').value,
        description: document.getElementById('eventDescription').value,
        color: document.getElementById('eventColorInput').value
      };
      if (!data.title.trim() || !data.date) return;
      if (editingId) updateEvent(editingId, data);
      else addEvent(data);
      closeModal();
      render();
    });

    document.getElementById('deleteEventBtn').addEventListener('click', () => {
      if (editingId && confirm('Delete this event permanently?')) {
        deleteEvent(editingId);
        closeModal();
        render();
      }
    });
  }

  return { load, bind, render, shiftMonth, goToToday };
})();
