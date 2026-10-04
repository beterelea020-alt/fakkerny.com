// storage/db.js — Local/offline persistence layer.
// The browser copy stays local first. Cloud Sync observes the change event
// emitted here and mirrors the data to Turso when the user is signed in.

const NS = 'fk:';
const KEYS = {
  reminders: NS + 'reminders',
  medicine: NS + 'medicine',
  money: NS + 'money',
  habits: NS + 'habits',
  habitLogs: NS + 'habit_logs',
  notes: NS + 'notes',
  settings: NS + 'settings',
  trash: NS + 'trash'
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('fk:db read error', key, e);
    return fallback;
  }
}

function write(key, value, { notify = true } = {}) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (notify) notifyChanged();
    return true;
  } catch (e) {
    console.error('fk:db write error', key, e);
    return false;
  }
}

let suppressChangeEvents = false;

function notifyChanged() {
  if (suppressChangeEvents || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('fakkerny:data-changed'));
}

export function withoutChangeNotification(fn) {
  suppressChangeEvents = true;
  try {
    return fn();
  } finally {
    suppressChangeEvents = false;
  }
}

function makeCollection(key) {
  return {
    all() {
      return read(key, []);
    },
    get(id) {
      return this.all().find((x) => x.id === id) || null;
    },
    add(item) {
      const list = this.all();
      const record = Object.assign({ id: uid(), createdAt: Date.now() }, item);
      list.push(record);
      write(key, list);
      return record;
    },
    update(id, patch) {
      const list = this.all();
      const idx = list.findIndex((x) => x.id === id);
      if (idx === -1) return null;
      list[idx] = Object.assign({}, list[idx], patch, { updatedAt: Date.now() });
      write(key, list);
      return list[idx];
    },
    remove(id) {
      const list = this.all();
      const idx = list.findIndex((x) => x.id === id);
      if (idx === -1) return null;
      const [removed] = list.splice(idx, 1);
      write(key, list);
      return removed;
    },
    restore(item) {
      const list = this.all();
      list.push(item);
      write(key, list);
    },
    replaceAll(list) {
      write(key, Array.isArray(list) ? list : []);
    }
  };
}

export const Reminders = makeCollection(KEYS.reminders);
export const Medicine = makeCollection(KEYS.medicine);
export const Money = makeCollection(KEYS.money);
export const Habits = makeCollection(KEYS.habits);
export const Notes = makeCollection(KEYS.notes);

export const HabitLogs = {
  all() {
    return read(KEYS.habitLogs, {});
  },
  isDone(habitId, dateStr) {
    const logs = this.all();
    return !!(logs[habitId] && logs[habitId][dateStr]);
  },
  toggle(habitId, dateStr) {
    const logs = this.all();
    if (!logs[habitId]) logs[habitId] = {};
    if (logs[habitId][dateStr]) delete logs[habitId][dateStr];
    else logs[habitId][dateStr] = true;
    write(KEYS.habitLogs, logs);
    return !!logs[habitId][dateStr];
  },
  daysFor(habitId) {
    const logs = this.all();
    return logs[habitId] ? Object.keys(logs[habitId]).sort() : [];
  }
};

const DEFAULT_SETTINGS = {
  theme: 'system',
  themePreset: 'default',
  themeCustomColor: null,
  notificationsEnabled: false,
  notificationSound: true,
  pushSyncEnabled: false,
  lang: 'ar',
  onboarded: false
};

export const Settings = {
  get() {
    return Object.assign({}, DEFAULT_SETTINGS, read(KEYS.settings, {}));
  },
  set(patch) {
    const next = Object.assign({}, this.get(), patch);
    write(KEYS.settings, next);
    return next;
  }
};

export function exportAllData() {
  return {
    app: 'fakkerny',
    version: 2,
    exportedAt: new Date().toISOString(),
    data: {
      reminders: Reminders.all(),
      medicine: Medicine.all(),
      money: Money.all(),
      habits: Habits.all(),
      habitLogs: HabitLogs.all(),
      notes: Notes.all(),
      settings: Settings.get()
    }
  };
}

export function importAllData(payload) {
  if (!payload || typeof payload !== 'object' || !payload.data) {
    throw new Error('ملف غير صالح');
  }
  const d = payload.data;
  withoutChangeNotification(() => {
    if (Array.isArray(d.reminders)) Reminders.replaceAll(d.reminders);
    if (Array.isArray(d.medicine)) Medicine.replaceAll(d.medicine);
    if (Array.isArray(d.money)) Money.replaceAll(d.money);
    if (Array.isArray(d.habits)) Habits.replaceAll(d.habits);
    if (Array.isArray(d.notes)) Notes.replaceAll(d.notes);
    if (d.habitLogs && typeof d.habitLogs === 'object') write(KEYS.habitLogs, d.habitLogs, { notify: false });
    if (d.settings && typeof d.settings === 'object') Settings.set(d.settings);
  });
  notifyChanged();
  return true;
}

export function wipeAllData() {
  withoutChangeNotification(() => {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  });
  notifyChanged();
}

export { uid };
