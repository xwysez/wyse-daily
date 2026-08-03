/* ===========================================================
   settings.js — settings storage wiring + applying prefs to the DOM.
   Mirrors the pattern of checklist.js/tracker.js: owns one concern,
   reads/writes through Storage, and exposes a small render/bind API
   that app.js calls into.
   =========================================================== */

const Settings = (() => {

  let systemThemeQuery = null;

  // ---------------- apply preferences to the document ----------------
  function applyAll() {
    const settings = Storage.getSettings();
    applyTheme(settings.themeMode);
    applyPalette(Storage.getPalette());
    document.documentElement.setAttribute('data-font-size', settings.fontSize);
    document.documentElement.classList.toggle('compact', !!settings.compactMode);
    document.documentElement.classList.toggle('no-animations', !settings.animationsEnabled);
  }

  function applyTheme(mode) {
    if (systemThemeQuery) {
      systemThemeQuery.removeEventListener('change', onSystemThemeChange);
      systemThemeQuery = null;
    }
    let isDark;
    if (mode === 'system') {
      systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      systemThemeQuery.addEventListener('change', onSystemThemeChange);
      isDark = systemThemeQuery.matches;
    } else {
      isDark = mode === 'dark';
    }
    document.documentElement.classList.toggle('dark', isDark);
    const label = document.getElementById('themeLabel');
    if (label) label.textContent = mode === 'system' ? 'System theme' : (isDark ? 'Dark mode' : 'Light mode');
  }

  function onSystemThemeChange(e) {
    document.documentElement.classList.toggle('dark', e.matches);
  }

  function applyPalette(palette) {
    document.documentElement.setAttribute('data-palette', palette);
    document.querySelectorAll('.swatch').forEach(sw => {
      sw.classList.toggle('is-active', sw.dataset.palette === palette);
    });
  }

  // ---------------- one-time migration from the old light/dark-only toggle ----------------
  // Before Settings existed, the sidebar's theme button wrote 'light' or
  // 'dark' straight into Storage's theme key. If someone had already set
  // that, honor it as their initial themeMode instead of silently
  // resetting everyone to 'system'.
  function reconcileLegacyTheme() {
    const settings = Storage.getSettings();
    const legacyTheme = Storage.getTheme();
    if (settings.themeMode === 'system' && (legacyTheme === 'light' || legacyTheme === 'dark')) {
      Storage.saveSettings({ themeMode: legacyTheme });
    }
  }

  // ---------------- init ----------------
  function init() {
    reconcileLegacyTheme();
    applyAll();
    bindUI();
  }

  function bindUI() {
    const openBtn = document.getElementById('openSettings');
    const overlay = document.getElementById('settingsModalOverlay');
    if (!openBtn || !overlay) return;

    openBtn.addEventListener('click', () => {
      populateForm();
      overlay.classList.add('is-visible');
    });
    document.getElementById('closeSettings').addEventListener('click', () => overlay.classList.remove('is-visible'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('is-visible'); });

    // Theme mode (radio group)
    document.querySelectorAll('input[name="themeMode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        Storage.saveSettings({ themeMode: radio.value });
        applyTheme(radio.value);
      });
    });

    // Accent/theme color (reuses the same swatches + storage as the Stats page)
    document.querySelectorAll('#settingsColorSwatches .swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        Storage.savePalette(sw.dataset.palette);
        applyPalette(sw.dataset.palette);
      });
    });

    // Simple field -> setting bindings
    bindSelect('settingFontSize', 'fontSize');
    bindSelect('settingFirstDay', 'firstDayOfWeek', v => parseInt(v, 10));
    bindSelect('settingDateFormat', 'dateFormat');
    bindSelect('settingDefaultSort', 'defaultSort');
    bindToggle('settingCompactMode', 'compactMode');
    bindToggle('settingAnimations', 'animationsEnabled');
    bindToggle('settingHideCompleted', 'hideCompleted');

    document.getElementById('exportDataBtn').addEventListener('click', exportData);
    document.getElementById('importDataInput').addEventListener('change', importData);
    document.getElementById('resetDataBtn').addEventListener('click', resetData);

    document.getElementById('logoutBtn').addEventListener('click', () => {
      overlay.classList.remove('is-visible');
      Auth.logout();
    });
  }

  function bindSelect(elId, settingKey, transform) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener('change', () => {
      const value = transform ? transform(el.value) : el.value;
      Storage.saveSettings({ [settingKey]: value });
      applyAll();
      if (window.SignalboardApp) window.SignalboardApp.refreshAll();
      if (window.SignalboardCalendar) window.SignalboardCalendar.render();
    });
  }

  function bindToggle(elId, settingKey) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener('change', () => {
      Storage.saveSettings({ [settingKey]: el.checked });
      applyAll();
      if (window.SignalboardApp) window.SignalboardApp.refreshAll();
    });
  }

  function populateForm() {
    const s = Storage.getSettings();
    const emailEl = document.getElementById('accountEmail');
    if (emailEl) {
      const user = window.Auth ? Auth.getUser() : null;
      emailEl.textContent = user && user.email ? user.email : '—';
    }
    const themeRadio = document.querySelector(`input[name="themeMode"][value="${s.themeMode}"]`);
    if (themeRadio) themeRadio.checked = true;
    applyPalette(Storage.getPalette()); // syncs the settings-modal swatches' active state too
    setValue('settingFontSize', s.fontSize);
    setValue('settingFirstDay', String(s.firstDayOfWeek));
    setValue('settingDateFormat', s.dateFormat);
    setValue('settingDefaultSort', s.defaultSort);
    setChecked('settingCompactMode', s.compactMode);
    setChecked('settingAnimations', s.animationsEnabled);
    setChecked('settingHideCompleted', s.hideCompleted);
  }

  function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }
  function setChecked(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  }

  // ---------------- export / import / reset ----------------
  function exportData() {
    const data = Storage.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wyse-daily-export-${Utils.todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importData(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const count = Array.isArray(data.items) ? data.items.length : 0;
        const ok = confirm(`Import ${count} task(s)? This will replace all data currently on this device.`);
        if (!ok) return;
        Storage.importAll(data);
        applyAll();
        if (window.SignalboardApp) window.SignalboardApp.refreshAll();
        if (window.SignalboardCalendar) window.SignalboardCalendar.render();
      } catch (err) {
        console.error('Import failed', err);
        alert('Could not import that file: ' + err.message);
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  }

  function resetData() {
    const ok = confirm('Reset ALL data? This deletes every task, category, and preference on this device and cannot be undone.');
    if (!ok) return;
    const reallyOk = confirm('Are you absolutely sure? This is permanent.');
    if (!reallyOk) return;
    Storage.resetAll();
    window.location.reload();
  }

  return { init, applyAll };
})();
