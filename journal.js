// The Journal tab: one entry per day (Romanian date). Entries are never reset or deleted.
import * as store from './db.js';
import { $, romanianDate, formatDate, reportError } from './util.js';

const SAVE_DELAY_MS = 700;

const state = {
  uid: null,
  today: romanianDate(),
  viewDate: null,       // the day shown in the editor
  ready: false,         // editor loaded and safe to type in
  dirty: false,         // typed text not yet saved
  saveTimer: null,
  saveSeq: 0,
  unsubscribe: null,
  entries: null,        // all entries [{date, text}], newest first; loaded when the tab opens
  loadingEntries: false,
};

const textarea = $('#journal-text');

export function start(uid) {
  stop();
  state.uid = uid;
  state.entries = null;
  openDate(romanianDate());
}

export function stop() {
  flush();
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  state.uid = null;
}

// Called when the Journal tab becomes visible.
export function onShow() {
  if (!state.uid) return;
  if (!state.entries && !state.loadingEntries) loadEntries();
  autoGrow();
}

export async function getAllEntries() {
  flush();
  return store.getJournal(state.uid);
}

export function checkForNewDay() {
  const now = romanianDate();
  if (now === state.today) return;
  const wasViewingToday = state.viewDate === state.today;
  state.today = now;
  // Move to the new day, unless you're in the middle of writing.
  if (wasViewingToday && !state.dirty && document.activeElement !== textarea) openDate(now);
  else renderHeader();
}

// ---------- Editor ----------

function openDate(date) {
  flush();
  if (state.unsubscribe) state.unsubscribe();
  state.viewDate = date;
  state.ready = false;
  state.dirty = false;
  textarea.value = '';
  textarea.disabled = true;
  setStatus('Loading…');
  renderHeader();
  renderOnThisDay();
  renderList();

  // Don't let you type until we know what's already saved for this day, so nothing
  // you wrote earlier (maybe on another device) can be overwritten by accident.
  const offlineFallback = setTimeout(() => { if (!state.ready) enableEditor('Offline. Changes will sync later.'); }, 4000);
  const uid = state.uid;
  state.unsubscribe = store.watchJournalEntry(uid, date, (text, { fromCache }) => {
    if (state.viewDate !== date || state.uid !== uid) return;
    if (!state.dirty) {
      if (textarea.value !== text) { textarea.value = text; autoGrow(); }
      updateLocalEntry(date, text);
    }
    if (!state.ready && (!fromCache || text)) {
      clearTimeout(offlineFallback);
      enableEditor(text ? 'Saved' : '');
    }
  }, (err) => { clearTimeout(offlineFallback); reportError(err); });
}

function enableEditor(status) {
  state.ready = true;
  textarea.disabled = false;
  setStatus(status);
  autoGrow();
}

textarea.addEventListener('input', () => {
  if (!state.ready) return;
  state.dirty = true;
  setStatus('Saving…');
  autoGrow();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, SAVE_DELAY_MS);
});
textarea.addEventListener('blur', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('pagehide', flush);

function flush() {
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; save(); }
}

function save() {
  state.saveTimer = null;
  if (!state.uid || !state.ready || !state.dirty) return;
  const { uid, viewDate: date } = state;
  const text = textarea.value;
  const seq = ++state.saveSeq;
  updateLocalEntry(date, text);
  if (!navigator.onLine) setStatus('Offline. Saved on this device, will sync later.');
  store.saveJournalEntry(uid, date, text).then(() => {
    if (seq === state.saveSeq && state.viewDate === date) {
      state.dirty = false;
      setStatus('Saved');
    }
  }).catch(reportError);
}

function setStatus(text) {
  $('#journal-status').textContent = text;
}

function autoGrow() {
  textarea.style.height = 'auto';
  textarea.style.height = Math.max(textarea.scrollHeight, 220) + 'px';
}

function renderHeader() {
  const isToday = state.viewDate === state.today;
  $('#journal-date').textContent = isToday ? 'Today' : formatDate(state.viewDate, { weekday: false });
  $('#journal-subtitle').textContent = isToday
    ? formatDate(state.viewDate)
    : formatDate(state.viewDate, { day: false, month: false, year: false });
  $('#journal-today-btn').hidden = isToday;
  textarea.placeholder = isToday
    ? 'How was today? What are you thinking about?'
    : 'Nothing was written on this day.';
}

$('#journal-today-btn').addEventListener('click', () => {
  openDate(state.today);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#journal-goto').addEventListener('change', (e) => {
  const date = e.target.value;
  if (!date) return;
  e.target.value = '';
  openDate(date > state.today ? state.today : date);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------- Past entries ----------

async function loadEntries() {
  state.loadingEntries = true;
  renderList();
  try {
    const loaded = await store.getJournal(state.uid);
    // Keep anything typed locally since the load started.
    const local = new Map((state.entries || []).map((e) => [e.date, e]));
    state.entries = loaded.map((e) => local.get(e.date) || e);
    for (const [date, e] of local) if (!state.entries.some((x) => x.date === date)) state.entries.push(e);
    state.entries.sort((a, b) => b.date.localeCompare(a.date));
  } catch (err) {
    reportError(err);
  } finally {
    state.loadingEntries = false;
    renderOnThisDay();
    renderList();
  }
}

function updateLocalEntry(date, text) {
  if (!state.entries) return;
  const existing = state.entries.find((e) => e.date === date);
  const changed = !existing || existing.text !== text;
  if (existing) existing.text = text;
  else { state.entries.push({ date, text }); state.entries.sort((a, b) => b.date.localeCompare(a.date)); }
  if (changed) { clearTimeout(updateLocalEntry.t); updateLocalEntry.t = setTimeout(renderList, 400); }
}

const written = () => (state.entries || []).filter((e) => e.text.trim());

// Entries written on this same day in earlier years.
function renderOnThisDay() {
  const box = $('#on-this-day');
  const monthDay = state.viewDate.slice(5);
  const year = Number(state.viewDate.slice(0, 4));
  const matches = written().filter((e) => e.date.slice(5) === monthDay && e.date < state.viewDate);
  box.replaceChildren();
  box.hidden = !matches.length;
  if (!matches.length) return;
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = 'On this day';
  box.append(title);
  for (const e of matches) {
    const yearsAgo = year - Number(e.date.slice(0, 4));
    const card = entryButton(e, 'memory');
    card.querySelector('.entry-date').textContent =
      `${yearsAgo === 1 ? '1 year ago' : `${yearsAgo} years ago`} · ${formatDate(e.date, { weekday: 'short', month: 'short' })}`;
    box.append(card);
  }
}

function renderList() {
  const list = $('#journal-list');
  if (!state.entries) {
    list.innerHTML = `<p class="empty">${state.loadingEntries ? 'Loading your entries…' : ''}</p>`;
    return;
  }
  const entries = written().filter((e) => e.date < state.today); // today is the editor above
  if (!entries.length) {
    list.innerHTML = '<p class="empty">Your past entries will appear here.</p>';
    return;
  }
  const groups = new Map();
  for (const e of entries) {
    const key = e.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const nodes = [];
  for (const [ym, items] of groups) {
    const h = document.createElement('h3');
    h.className = 'month';
    h.textContent = formatDate(`${ym}-01`, { weekday: false, day: false });
    const card = document.createElement('div');
    card.className = 'card entries';
    card.append(...items.map((e) => entryButton(e)));
    nodes.push(h, card);
  }
  list.replaceChildren(...nodes);
}

function entryButton(entry, extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `entry ${extraClass}` + (entry.date === state.viewDate ? ' current' : '');
  const date = document.createElement('div');
  date.className = 'entry-date';
  date.textContent = formatDate(entry.date, { weekday: 'short', month: false, year: false });
  const preview = document.createElement('div');
  preview.className = 'entry-preview';
  preview.textContent = entry.text.trim();
  b.append(date, preview);
  b.addEventListener('click', () => {
    openDate(entry.date);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  return b;
}
