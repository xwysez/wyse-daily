/* ===========================================================
   storage.js — all localStorage reads/writes live here.
   Nothing else in the app should call localStorage directly.
   =========================================================== */

const Storage = (() => {

  const KEYS = {
    items: 'signalboard.items.v1',
    theme: 'signalboard.theme.v1',
    palette: 'signalboard.palette.v1',
    year: 'signalboard.trackerYear.v1',
    categories: 'signalboard.categories.v1',
    // Stable key (no version suffix) that tracks the schema version of
    // everything else in localStorage. Note: the ".v1" suffixes on the
    // keys above are just their original names and are NOT the same
    // thing as dataVersion below — renaming a key would orphan old data,
    // so schema upgrades happen by migrating the *contents* of these
    // keys in place, never by changing the keys themselves.
    meta: 'signalboard.meta',
    settings: 'signalboard.settings',
    events: 'signalboard.events'
  };

  // New settings fields can be added here freely — getSettings() always
  // merges stored values over these defaults, so old saved settings
  // objects automatically pick up any new field without needing a
  // migration entry every time.
  const DEFAULT_SETTINGS = {
    themeMode: 'system',        // 'light' | 'dark' | 'system'
    fontSize: 'medium',         // 'small' | 'medium' | 'large'
    compactMode: false,
    animationsEnabled: true,
    firstDayOfWeek: 0,          // 0 = Sunday, 1 = Monday
    dateFormat: 'short',        // 'short' | 'numeric-mdy' | 'numeric-dmy' | 'iso'
    hideCompleted: false,
    defaultSort: 'manual'       // 'manual' | 'dueDate' | 'priority' | 'created'
  };

  // Bump this whenever the shape of stored data changes, and add a
  // matching entry to MIGRATIONS (see below).
  const CURRENT_VERSION = 3;

  function safeGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.error('Storage read failed for', key, e);
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Storage write failed for', key, e);
      return false;
    }
  }

  // ---------------- versioning / migrations ----------------

  /** Pulls every persisted key into one plain object so a migration step
   *  can see (and touch) all of a user's data at once, not just items. */
  function loadRawBag() {
    return {
      items: safeGet(KEYS.items, []),
      categories: safeGet(KEYS.categories, ['Work', 'Personal', 'Health']),
      theme: safeGet(KEYS.theme, null),
      palette: safeGet(KEYS.palette, 'green'),
      trackerYear: safeGet(KEYS.year, new Date().getFullYear())
    };
  }

  function saveBag(bag) {
    safeSet(KEYS.items, bag.items);
    safeSet(KEYS.categories, bag.categories);
    safeSet(KEYS.theme, bag.theme);
    safeSet(KEYS.palette, bag.palette);
    safeSet(KEYS.year, bag.trackerYear);
  }

  /** Each entry upgrades the bag from (version-1) -> version.
   *  To ship a new schema change: bump CURRENT_VERSION above and add
   *  MIGRATIONS[<newVersion>] here. Steps always run in order, so each
   *  one can assume the bag already matches the previous version. */
  const MIGRATIONS = {
    // 0 -> 1: normalize every item so it has the full current field set.
    // This also doubles as a safety net for any hand-edited or
    // pre-release data that might be missing fields.
    1: (bag) => {
      bag.items = (bag.items || []).map(item => ({
        id: item.id || Utils.uid(),
        text: item.text || '',
        category: item.category || 'General',
        priority: item.priority || 'medium',
        dueDate: item.dueDate || null,
        recurring: item.recurring || '',
        completed: !!item.completed,
        archived: !!item.archived,
        order: typeof item.order === 'number' ? item.order : 0,
        createdAt: item.createdAt || Utils.todayKey(),
        archivedAt: item.archivedAt || null,
        completionHistory: Array.isArray(item.completionHistory) ? item.completionHistory : []
      }));
      bag.categories = Array.isArray(bag.categories) && bag.categories.length
        ? bag.categories
        : ['Work', 'Personal', 'Health'];
      return bag;
    },

    // 1 -> 2: add `updatedAt` (ms epoch) to every item. Needed by the
    // Firebase sync layer to decide, when the same task was edited on
    // two devices, which edit wins — without this every item would
    // look equally "fresh" and syncing could pick the wrong version.
    2: (bag) => {
      const now = Date.now();
      bag.items = (bag.items || []).map(item => ({
        ...item,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now
      }));
      return bag;
    },

    // 2 -> 3: add `schedule` (which days a task appears on) and `pinned`.
    // Default schedule is 'daily' — identical in effect to a task having
    // no schedule at all before this version, so every existing task
    // keeps appearing every day with zero behavior change.
    3: (bag) => {
      bag.items = (bag.items || []).map(item => ({
        ...item,
        schedule: item.schedule && item.schedule.type
          ? item.schedule
          : { type: 'daily', days: [0, 1, 2, 3, 4, 5, 6] },
        pinned: !!item.pinned
      }));
      return bag;
    }

    // 4: (bag) => { ...next schema change goes here...; return bag; }
  };

  /** Runs any migrations needed to bring stored data up to
   *  CURRENT_VERSION, then records the new version. Safe to call
   *  every load: it's a no-op once a user is already current. */
  function migrate() {
    const meta = safeGet(KEYS.meta, { dataVersion: 0 });
    let version = meta.dataVersion || 0;
    if (version >= CURRENT_VERSION) return;

    let bag = loadRawBag();
    while (version < CURRENT_VERSION) {
      version += 1;
      const step = MIGRATIONS[version];
      if (step) bag = step(bag);
    }
    saveBag(bag);
    safeSet(KEYS.meta, { dataVersion: CURRENT_VERSION });
  }

  function getDataVersion() {
    return safeGet(KEYS.meta, { dataVersion: 0 }).dataVersion;
  }

  // Run migrations immediately, before any other code (Checklist, Tracker,
  // app.js) has a chance to read items/theme/palette/year.
  migrate();

  // ---------------- change notifications (for firebase-sync.js) ----------------
  // Storage stays decoupled from any sync layer: it just announces "items or
  // categories changed" and lets whoever cares (currently firebase-sync.js)
  // decide what to do about it. Theme/palette/year are device-local display
  // preferences and intentionally don't trigger this — only real task data does.
  const listeners = [];

  function subscribe(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i > -1) listeners.splice(i, 1);
    };
  }

  function notify() {
    listeners.forEach(fn => {
      try { fn(); } catch (e) { console.error('Storage listener failed', e); }
    });
  }

  // ---------------- Items ----------------
  function getItems() {
    return safeGet(KEYS.items, []);
  }

  function saveItems(items) {
    const ok = safeSet(KEYS.items, items);
    notify();
    return ok;
  }

  // ---------------- Categories (remembered even with 0 items) ----------------
  function getCategories() {
    return safeGet(KEYS.categories, ['Work', 'Personal', 'Health']);
  }

  function saveCategories(cats) {
    const ok = safeSet(KEYS.categories, cats);
    notify();
    return ok;
  }

  // ---------------- Preferences ----------------
  function getTheme() {
    return safeGet(KEYS.theme, null); // null => follow system on first run
  }

  function saveTheme(theme) {
    return safeSet(KEYS.theme, theme);
  }

  function getPalette() {
    return safeGet(KEYS.palette, 'green');
  }

  function savePalette(p) {
    return safeSet(KEYS.palette, p);
  }

  function getTrackerYear() {
    return safeGet(KEYS.year, new Date().getFullYear());
  }

  function saveTrackerYear(y) {
    return safeSet(KEYS.year, y);
  }

  // ---------------- Settings ----------------
  function getSettings() {
    return { ...DEFAULT_SETTINGS, ...safeGet(KEYS.settings, {}) };
  }

  function saveSettings(settings) {
    return safeSet(KEYS.settings, { ...getSettings(), ...settings });
  }

  // ---------------- Events (Event Calendar — separate from routine tasks) ----------------
  function getEvents() {
    return safeGet(KEYS.events, []);
  }

  function saveEvents(events) {
    const ok = safeSet(KEYS.events, events);
    notify();
    return ok;
  }

  // ---------------- export / import / reset ----------------
  function exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      dataVersion: getDataVersion(),
      items: getItems(),
      categories: getCategories(),
      events: getEvents(),
      settings: getSettings(),
      theme: getTheme(),
      palette: getPalette(),
      trackerYear: getTrackerYear()
    };
  }

  function importAll(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
      throw new Error('That file doesn\u2019t look like a Wyse Daily export.');
    }
    safeSet(KEYS.items, data.items);
    if (Array.isArray(data.categories)) safeSet(KEYS.categories, data.categories);
    if (Array.isArray(data.events)) safeSet(KEYS.events, data.events);
    if (data.settings) safeSet(KEYS.settings, { ...DEFAULT_SETTINGS, ...data.settings });
    if (data.theme) safeSet(KEYS.theme, data.theme);
    if (data.palette) safeSet(KEYS.palette, data.palette);
    if (typeof data.trackerYear === 'number') safeSet(KEYS.year, data.trackerYear);
    // Imported data might come from an older export — force everything
    // back through the same migration chain new/legacy data already
    // goes through, rather than trusting the file's own dataVersion.
    safeSet(KEYS.meta, { dataVersion: 0 });
    migrate();
    notify();
  }

  function resetAll() {
    Object.values(KEYS).forEach(key => {
      try { localStorage.removeItem(key); } catch (e) { console.error('Reset failed for', key, e); }
    });
  }

  return {
    getItems, saveItems,
    getCategories, saveCategories,
    getTheme, saveTheme,
    getPalette, savePalette,
    getTrackerYear, saveTrackerYear,
    getSettings, saveSettings,
    getEvents, saveEvents,
    exportAll, importAll, resetAll,
    getDataVersion,
    subscribe
  };
})();
