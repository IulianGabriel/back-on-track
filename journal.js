// The Journal tab: one entry per day (Romanian date). Entries stay forever unless you delete them.
import * as store from './db.js';
import { $, romanianDate, addDays, formatDate, toast, reportError } from './util.js';

const SAVE_DELAY_MS = 700;
const FIRST_PAGE = 7;       // past entries shown at first
const MORE_PAGE = 14;       // loaded each time you tap "Show older entries"
const YEARS_BACK = 10;      // how far back "On this day" looks

const state = {
  uid: null,
  today: romanianDate(),
  viewDate: null,       // the day shown in the editor
  ready: false,         // editor loaded and safe to type in
  dirty: false,         // typed text not yet saved
  saveTimer: null,
  saveSeq: 0,
  unsubscribe: null,
  recent: null,         // loaded past entries [{date, text}], newest first
  hasMore: false,
  loadingRecent: false,
  onThisDay: [],
};

const textarea = $('#journal-text');

export function start(uid) {
  stop();
  state.uid = uid;
  state.recent = null;
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
  if (!state.recent && !state.loadingRecent) loadRecent();
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
  state.recent = null;          // yesterday's entry is now a "past" entry
  if (!$('#tab-journal').hidden) loadRecent();
  // Move to the new day, unless you're in the middle of writing.
  if (wasViewingToday && !state.dirty && document.activeElement !== textarea) openDate(now);
  else renderHeader();
}

// ---------- Editor ----------

function openDate(date) {
  if (date > state.today) date = state.today;
  flush();
  if (state.unsubscribe) state.unsubscribe();
  state.viewDate = date;
  state.ready = false;
  state.dirty = false;
  textarea.value = '';
  textarea.disabled = true;
  setStatus('Loading…');
  renderHeader();
  renderRecent();
  updateDeleteButton();
  loadOnThisDay(date);

  // Don't let you type until we know what's already saved for this day, so nothing
  // you wrote earlier (maybe on another device) can be overwritten by accident.
  const offlineFallback = setTimeout(() => { if (!state.ready) enableEditor('Offline. Changes will sync later.'); }, 4000);
  const uid = state.uid;
  state.unsubscribe = store.watchJournalEntry(uid, date, (text, { fromCache }) => {
    if (state.viewDate !== date || state.uid !== uid) return;
    if (!state.dirty && textarea.value !== text) { textarea.value = text; autoGrow(); }
    if (!state.ready && (!fromCache || text)) {
      clearTimeout(offlineFallback);
      enableEditor(text ? 'Saved' : '');
    }
    updateDeleteButton();
  }, (err) => { clearTimeout(offlineFallback); reportError(err); });
}

function enableEditor(status) {
  state.ready = true;
  textarea.disabled = false;
  setStatus(status);
  autoGrow();
  updateDeleteButton();
}

textarea.addEventListener('input', () => {
  if (!state.ready) return;
  state.dirty = true;
  setStatus('Saving…');
  autoGrow();
  updateDeleteButton();
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
  rememberLocally(date, text);
  if (!navigator.onLine) setStatus('Offline. Saved on this device, will sync later.');
  store.saveJournalEntry(uid, date, text).then(() => {
    if (seq === state.saveSeq && state.viewDate === date) {
      state.dirty = false;
      setStatus(text.trim() ? 'Saved' : '');
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

function updateDeleteButton() {
  $('#journal-delete').hidden = !(state.ready && textarea.value.trim());
}

$('#journal-delete').addEventListener('click', async () => {
  const date = state.viewDate;
  if (!confirm(`Delete your journal entry for ${formatDate(date)}?\n\nThis can't be undone.`)) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.saveSeq++;
  state.dirty = false;
  textarea.value = '';
  autoGrow();
  updateDeleteButton();
  rememberLocally(date, '');
  try {
    await store.deleteJournalEntry(state.uid, date);
    setStatus('');
    toast('Entry deleted.');
  } catch (err) { reportError(err); }
});

// ---------- Moving between days ----------

function renderHeader() {
  const isToday = state.viewDate === state.today;
  $('#journal-date').textContent = isToday ? 'Today' : formatDate(state.viewDate, { weekday: false });
  $('#journal-subtitle').textContent = isToday
    ? formatDate(state.viewDate)
    : formatDate(state.viewDate, { day: false, month: false, year: false });
  $('#journal-today-btn').hidden = isToday;
  $('#journal-next').disabled = isToday;
  textarea.placeholder = isToday
    ? 'How was today? What are you thinking about?'
    : 'Nothing written on this day. You can still write something.';
}

const goTo = (date) => openDate(date);

$('#journal-prev').addEventListener('click', () => goTo(addDays(state.viewDate, -1)));
$('#journal-next').addEventListener('click', () => goTo(addDays(state.viewDate, +1)));
$('#journal-today-btn').addEventListener('click', () => goTo(state.today));

// ← → keys on a computer (only when you're not typing).
document.addEventListener('keydown', (e) => {
  if ($('#tab-journal').hidden || e.altKey || e.ctrlKey || e.metaKey) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(addDays(state.viewDate, -1)); }
  if (e.key === 'ArrowRight' && state.viewDate < state.today) { e.preventDefault(); goTo(addDays(state.viewDate, +1)); }
});

$('#journal-goto').addEventListener('change', (e) => {
  const date = e.target.value;
  if (!date) return;
  e.target.value = '';
  e.target.blur();
  goTo(date);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------- On this day (same date, earlier years) ----------

async function loadOnThisDay(date) {
  state.onThisDay = [];
  renderOnThisDay();
  const year = Number(date.slice(0, 4));
  const dates = [];
  for (let y = year - 1; y >= year - YEARS_BACK; y--) {
    const d = `${y}${date.slice(4)}`;
    if (addDays(d, 0) === d) dates.push(d);   // skips 29 February in non-leap years
  }
  try {
    const found = await store.getJournalDays(state.uid, dates);
    if (state.viewDate !== date) return;
    state.onThisDay = found;
    renderOnThisDay();
  } catch (err) { console.warn('On this day failed', err); }
}

function renderOnThisDay() {
  const box = $('#on-this-day');
  box.replaceChildren();
  box.hidden = !state.onThisDay.length;
  if (!state.onThisDay.length) return;
  const title = document.createElement('h2');
  title.className = 'section-title';
  title.textContent = 'On this day';
  box.append(title);
  const year = Number(state.viewDate.slice(0, 4));
  for (const e of state.onThisDay) {
    const yearsAgo = year - Number(e.date.slice(0, 4));
    const card = entryButton(e, 'memory');
    card.querySelector('.entry-date').textContent =
      `${yearsAgo === 1 ? '1 year ago' : `${yearsAgo} years ago`} · ${formatDate(e.date, { weekday: 'short', month: 'short' })}`;
    box.append(card);
  }
}

// ---------- Past entries (only the most recent, more on request) ----------

async function loadRecent(more = false) {
  if (state.loadingRecent) return;
  state.loadingRecent = true;
  renderRecent();
  try {
    const size = more ? MORE_PAGE : FIRST_PAGE;
    const after = more && state.recent?.length ? state.recent[state.recent.length - 1].date : null;
    const page = await store.getJournalPage(state.uid, { before: state.today, after, size });
    const items = page.filter((e) => e.text.trim());
    state.recent = more ? [...(state.recent || []), ...items] : items;
    state.hasMore = page.length === size;
  } catch (err) {
    reportError(err);
  } finally {
    state.loadingRecent = false;
    renderRecent();
  }
}

// Keep the lists in step with what you type or delete, without reloading.
function rememberLocally(date, text) {
  const memory = state.onThisDay.find((e) => e.date === date);
  if (memory) {
    memory.text = text;
    state.onThisDay = state.onThisDay.filter((e) => e.text.trim());
    renderOnThisDay();
  }
  if (!state.recent || date >= state.today) return;
  const i = state.recent.findIndex((e) => e.date === date);
  if (!text.trim()) { if (i >= 0) state.recent.splice(i, 1); }
  else if (i >= 0) state.recent[i].text = text;
  else {
    const oldest = state.recent[state.recent.length - 1]?.date;
    if (!state.hasMore || !oldest || date > oldest) {
      state.recent.push({ date, text });
      state.recent.sort((a, b) => b.date.localeCompare(a.date));
    }
  }
  clearTimeout(rememberLocally.t);
  rememberLocally.t = setTimeout(renderRecent, 400);
}

function renderRecent() {
  const list = $('#journal-list');
  if (!state.recent) {
    list.innerHTML = `<p class="empty">${state.loadingRecent ? 'Loading your entries…' : ''}</p>`;
    return;
  }
  if (!state.recent.length) {
    list.innerHTML = '<p class="empty">Your past entries will appear here.</p>';
    return;
  }
  const groups = new Map();
  for (const e of state.recent) {
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
  if (state.hasMore) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more-btn';
    more.textContent = state.loadingRecent ? 'Loading…' : 'Show older entries';
    more.disabled = state.loadingRecent;
    more.addEventListener('click', () => loadRecent(true));
    nodes.push(more);
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
    goTo(entry.date);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  return b;
}
