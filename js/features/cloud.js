// Cloud/account layer for Fakkerny.
// Local storage remains the source of truth while offline; when an account is
// signed in, changes are debounced and mirrored to the Turso-backed Vercel API.

import { exportAllData, importAllData, Reminders, Medicine, Money, Habits, Notes, HabitLogs } from '../storage/db.js';

const META_KEY = 'fk:cloud_meta';
const CHANGE_EVENT = 'fakkerny:data-changed';
const AUTH_EVENT = 'fakkerny:auth-changed';

const state = {
  user: null,
  usage: null,
  syncing: false,
  timer: null,
  ready: false
};

function meta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || '{}');
  } catch {
    return {};
  }
}

function setMeta(patch) {
  const next = { ...meta(), ...patch };
  localStorage.setItem(META_KEY, JSON.stringify(next));
  return next;
}

function localHasUserData() {
  return Reminders.all().length + Medicine.all().length + Money.all().length + Habits.all().length + Notes.all().length + Object.keys(HabitLogs.all()).length > 0;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const error = new Error(body?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function emit(name, detail = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }));
}

function setUser(user) {
  state.user = user || null;
  if (user) setMeta({ userId: user.id });
  else setMeta({ userId: null });
  emit(AUTH_EVENT, { user: state.user });
}

export function getCloudState() {
  return { ...state };
}

export function getCurrentUser() {
  return state.user;
}

export function isLoggedIn() {
  return !!state.user;
}

export async function getMe() {
  const body = await request('/api/auth/me', { method: 'GET' });
  setUser(body.user || null);
  return state.user;
}

export async function register(email, password) {
  const body = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
  setUser(body.user);
  return body.user;
}

export async function login(email, password) {
  const body = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  setUser(body.user);
  return body.user;
}

export async function logout() {
  await request('/api/auth/logout', { method: 'POST', body: '{}' });
  state.usage = null;
  setUser(null);
}

export async function fetchCloudData() {
  return request('/api/data', { method: 'GET' });
}

export async function syncNow({ silent = false } = {}) {
  if (!state.user || state.syncing) return { skipped: true };
  state.syncing = true;
  emit(AUTH_EVENT, { user: state.user, syncing: true });
  try {
    const payload = exportAllData();
    const response = await request('/api/data', { method: 'PUT', body: JSON.stringify({ state: payload }) });
    const now = response.updatedAt || Date.now();
    setMeta({ userId: state.user.id, localChangedAt: now, lastSyncedAt: now });
    if (!silent) emit('fakkerny:toast', { message: 'تمت مزامنة بياناتك ☁️' });
    return response;
  } catch (e) {
    if (e.status === 429) {
      // The server protects the free quota; the next local change will try again.
      return { rateLimited: true, retryAfterMs: e.body?.retryAfterMs || 10000 };
    }
    if (!silent) emit('fakkerny:toast', { message: e.message || 'تعذر مزامنة البيانات' });
    throw e;
  } finally {
    state.syncing = false;
    emit(AUTH_EVENT, { user: state.user, syncing: false });
  }
}

export async function loadUsage() {
  if (!state.user) return null;
  try {
    state.usage = await request('/api/usage', { method: 'GET' });
  } catch {
    state.usage = null;
  }
  emit(AUTH_EVENT, { user: state.user, usage: state.usage });
  return state.usage;
}

export async function reconcileWithCloud({ onConflict } = {}) {
  if (!state.user) return { action: 'anonymous' };
  const remote = await fetchCloudData();
  const localState = exportAllData();
  const localExists = localHasUserData();
  const m = meta();
  if (!remote.exists) {
    if (localExists) {
      await syncNow({ silent: true });
      return { action: 'uploaded_local' };
    }
    setMeta({ lastSyncedAt: Date.now(), localChangedAt: 0 });
    return { action: 'cloud_empty' };
  }

  const remoteUpdated = Number(remote.updatedAt || 0);
  const lastSynced = Number(m.lastSyncedAt || 0);
  const localChanged = Number(m.localChangedAt || 0);

  if (!localExists) {
    importAllData(remote.state);
    setMeta({ lastSyncedAt: remoteUpdated, localChangedAt: remoteUpdated });
    return { action: 'downloaded_cloud', remote };
  }

  // When both sides changed since the last known sync, do not silently destroy data.
  if (lastSynced && localChanged > lastSynced && remoteUpdated > lastSynced) {
    if (onConflict) return onConflict(remote, localState);
    return { action: 'conflict', remote };
  }

  if (localChanged > remoteUpdated) {
    await syncNow({ silent: true });
    return { action: 'uploaded_local' };
  }

  if (remoteUpdated >= localChanged) {
    importAllData(remote.state);
    setMeta({ lastSyncedAt: remoteUpdated, localChangedAt: remoteUpdated });
    return { action: 'downloaded_cloud', remote };
  }

  return { action: 'unchanged' };
}

export async function applyRemoteState(remote) {
  if (!remote?.state) return;
  importAllData(remote.state);
  const updatedAt = Number(remote.updatedAt || Date.now());
  setMeta({ userId: state.user?.id || null, lastSyncedAt: updatedAt, localChangedAt: updatedAt });
}

export function markLocalChanged() {
  if (!state.user) return;
  setMeta({ localChangedAt: Date.now(), userId: state.user.id });
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    syncNow({ silent: true }).catch(() => {});
  }, 1800);
}

export function initCloud() {
  window.addEventListener(CHANGE_EVENT, () => markLocalChanged());
  window.addEventListener('beforeunload', () => {
    if (state.user && meta().localChangedAt > (meta().lastSyncedAt || 0)) {
      // Fire-and-forget is intentionally best effort; normal changes are already debounced.
      fetch('/api/data', {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: exportAllData() })
      }).catch(() => {});
    }
  });
  return getMe()
    .then(async (user) => {
      state.ready = true;
      if (user) {
        await reconcileWithCloud({ onConflict: (remote, local) => {
          emit('fakkerny:cloud-conflict', { remote, local });
          return { action: 'conflict', remote, local };
        } });
        await loadUsage();
      }
      return user;
    })
    .catch(() => {
      state.ready = true;
      setUser(null);
      return null;
    });
}

export async function adminStats() {
  return request('/api/admin/stats', { method: 'GET' });
}

export async function adminUsers(search = '') {
  return request(`/api/admin/users?limit=60&q=${encodeURIComponent(search)}`, { method: 'GET' });
}

export async function adminFeedback() {
  return request('/api/admin/feedback', { method: 'GET' });
}

export async function adminAction(action, userId) {
  const response = await request('/api/admin/action', { method: 'POST', body: JSON.stringify({ action, userId }) });
  return response;
}

export async function adminFeedbackAction(id, status) {
  return request('/api/admin/feedback', { method: 'POST', body: JSON.stringify({ id, status }) });
}
