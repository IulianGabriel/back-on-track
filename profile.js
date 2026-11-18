// The Profile tab: your name and photo, a few stats, backups and sign-out.
import * as store from './db.js';
import * as tasks from './tasks.js';
import { $, romanianDate, dayOf, addDays, formatDate, toast, reportError } from './util.js';

const PHOTO_SIZE = 256;   // profile photos are shrunk to 256×256 so they're tiny to store

const state = { user: null, profile: {}, unsubscribe: null };

export function start(user) {
  stop();
  state.user = user;
  state.profile = {};
  $('#profile-email').textContent = `Signed in with Google as ${user.email}`;
  const since = user.metadata?.creationTime ? romanianDate(new Date(user.metadata.creationTime)) : null;
  $('#member-since').textContent = since ? `Member since ${formatDate(since, { weekday: false })}` : '';
  render();
  state.unsubscribe = store.watchProfile(user.uid, (profile) => {
    state.profile = profile;
    render();
  }, reportError);
}

export function stop() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  state.user = null;
}

export function onShow() {
  if (state.user) loadStats();
}

// ---------- Name and photo ----------

const displayName = () => state.profile.name || state.user?.displayName || '';
const photo = () => state.profile.photo || state.user?.photoURL || '';

function render() {
  if (!state.user) return;
  const nameInput = $('#profile-name');
  if (document.activeElement !== nameInput) nameInput.value = displayName();
  setAvatar($('#avatar'), photo(), displayName());
  setAvatar($('#nav-avatar'), photo(), displayName());
  $('#nav-avatar').hidden = false;
  $('#nav-profile-icon').setAttribute('hidden', '');   // SVGs need the attribute, not .hidden
  $('#photo-reset').hidden = !state.profile.photo;
}

function setAvatar(el, src, name) {
  const img = el.querySelector('img');
  const initial = el.querySelector('.initial');
  initial.textContent = (name || '?').trim().charAt(0).toUpperCase();
  if (src) {
    img.src = src;
    img.hidden = false;
    initial.hidden = true;
    img.onerror = () => { img.hidden = true; initial.hidden = false; };
  } else {
    img.hidden = true;
    initial.hidden = false;
  }
}

$('#profile-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#profile-name').addEventListener('change', (e) => {
  const name = e.target.value.trim().slice(0, 40);
  state.profile.name = name;
  render();
  store.saveProfile(state.user.uid, { name }).then(() => toast('Name saved.')).catch(reportError);
});

$('#avatar').addEventListener('click', () => $('#photo-file').click());
$('#photo-change').addEventListener('click', () => $('#photo-file').click());

$('#photo-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const dataUrl = await shrinkPhoto(file);
    state.profile.photo = dataUrl;
    render();
    await store.saveProfile(state.user.uid, { photo: dataUrl });
    toast('Photo saved.');
  } catch (err) {
    reportError(err);
  }
});

$('#photo-reset').addEventListener('click', () => {
  state.profile.photo = '';
  render();
  store.saveProfile(state.user.uid, { photo: '' }).catch(reportError);
});

// Crop to a square from the centre and shrink, so the photo is only a few KB.
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PHOTO_SIZE;
  canvas.getContext('2d').drawImage(
    bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE,
  );
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ---------- Stats ----------

async function loadStats() {
  const uid = state.user.uid;
  const today = romanianDate();

  // From your tasks (already on the device).
  const all = tasks.getTasks();
  const daily = all.filter((t) => t.section === 'daily');
  $('#stat-today').textContent = daily.length ? `${daily.filter((t) => t.doneDate === today).length}/${daily.length}` : '–';
  $('#stat-perfect').textContent = perfectDayStreak(daily, today);

  // From your journal.
  try {
    $('#stat-entries').textContent = (await store.countJournal(uid)).toLocaleString('en-GB');
  } catch { $('#stat-entries').textContent = '–'; }
  try {
    $('#stat-streak').textContent = await journalStreak(uid, today);
  } catch { $('#stat-streak').textContent = '–'; }
}

// Days in a row on which every daily task was checked. A task only counts from the day it was
// added, so adding a new task never breaks an existing streak. Today counts once it's complete,
// and doesn't break the streak while it's still in progress.
function perfectDayStreak(daily, today) {
  const items = daily.map((t) => ({
    since: t.createdAt?.toDate ? dayOf(t.createdAt.toDate()) : today,
    log: new Set(t.log || []),
  }));
  const perfect = (d) => {
    const active = items.filter((t) => t.since <= d);
    return active.length > 0 && active.every((t) => t.log.has(d));
  };
  let streak = perfect(today) ? 1 : 0;
  for (let d = addDays(today, -1); perfect(d) && streak < 3650; d = addDays(d, -1)) streak++;
  return streak;
}

// Days in a row you've written in your journal. Today doesn't break the streak until it's over.
async function journalStreak(uid, today) {
  let streak = 0;
  let day = today;
  const first = await store.getJournalDays(uid, [today]);
  if (!first.length) day = addDays(today, -1); else { streak = 1; day = addDays(today, -1); }
  for (;;) {
    const batch = Array.from({ length: 7 }, (_, i) => addDays(day, -i));
    const found = new Set((await store.getJournalDays(uid, batch)).map((e) => e.date));
    for (const d of batch) {
      if (!found.has(d)) return streak;
      streak++;
    }
    day = addDays(day, -7);
    if (streak > 3650) return streak;
  }
}
