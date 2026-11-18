import * as store from './db.js';

const TIME_ZONE = 'Europe/Bucharest';
const SECTIONS = ['daily', 'additional'];

const state = {
  user: null,
  tasks: [],
  synced: false,     // true once we've heard from the cloud at least once
  editMode: false,
  today: romanianDate(),
  unsubscribe: null,
};

const $ = (sel, root = document) => root.querySelector(sel);

// ---------- Dates (everything uses Romanian time) ----------

// Today's date in Romania as "YYYY-MM-DD". A task counts as checked only if it was
// checked on this date, so all checkmarks "reset" automatically at 00:00 Romanian time.
function romanianDate(when = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(when);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function prettyToday() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date());
}

// Check every 20 seconds (and whenever the app comes back to the screen) whether
// midnight has passed, and if so redraw with everything unchecked.
function checkForNewDay() {
  const now = romanianDate();
  if (now !== state.today) {
    state.today = now;
    render();
  }
}
setInterval(checkForNewDay, 20_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForNewDay(); });
window.addEventListener('focus', checkForNewDay);

// ---------- Screens ----------

function show(id) {
  for (const s of ['loading', 'login', 'app']) $('#' + s).hidden = s !== id;
}

function toast(message, ms = 3000) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}

function reportError(err) {
  console.error(err);
  toast('Something went wrong: ' + (err?.message || err), 6000);
}

// ---------- Login ----------

store.onUserChanged((user) => {
  if (state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }
  state.user = user;
  state.tasks = [];
  state.synced = false;

  if (!user) {
    show('login');
    if (!store.configured) {
      showLoginError('The app is not connected to Firebase yet (firebase-config.js is empty).');
      $('#signin-btn').disabled = true;
    }
    return;
  }

  $('#user-label').textContent = `Signed in as ${user.email || user.displayName || 'you'}`;
  show('app');
  render();
  state.unsubscribe = store.watchTasks(user.uid, (tasks, { fromCache }) => {
    state.tasks = tasks;
    if (!fromCache) state.synced = true;
    render();
  }, reportError);
});

function showLoginError(text) {
  const el = $('#login-error');
  el.textContent = text;
  el.hidden = false;
}

$('#signin-btn').addEventListener('click', async () => {
  $('#login-error').hidden = true;
  try {
    await store.signIn();
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      showLoginError('Sign-in failed: ' + (err.message || err.code));
    }
  }
});

$('#signout-btn').addEventListener('click', () => {
  if (confirm('Sign out? Your tasks stay safely saved in your account.')) store.signOutUser();
});

// ---------- Rendering ----------

const isDone = (task) => task.doneDate === state.today;

function tasksIn(section) {
  return state.tasks
    .filter((t) => t.section === section)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
}

function render() {
  if (!state.user) return;

  // Remember which edit box had focus so a live update doesn't kick you out of it.
  const active = document.activeElement;
  const focusedId = active?.classList.contains('edit-input') ? active.dataset.id : null;
  const caret = focusedId ? active.selectionStart : null;

  $('#today-label').textContent = prettyToday();
  const daily = tasksIn('daily');
  const dailyDone = daily.filter(isDone).length;
  $('#progress-label').textContent = !daily.length ? 'Add your first daily task below'
    : dailyDone === daily.length ? 'All daily tasks done. Well done.'
    : `${dailyDone} of ${daily.length} daily tasks done`;
  $('#progress-bar').style.width = daily.length ? `${(dailyDone / daily.length) * 100}%` : '0';

  $('#edit-btn').textContent = state.editMode ? 'Done' : 'Edit';
  $('#edit-btn').classList.toggle('active', state.editMode);

  for (const section of SECTIONS) {
    const list = $(`section[data-section="${section}"] .tasks`);
    const tasks = tasksIn(section);
    list.replaceChildren(...tasks.map((t, i) => renderTask(t, i, tasks.length)));
    $(`section[data-section="${section}"] .count`).textContent =
      tasks.length ? `${tasks.filter(isDone).length}/${tasks.length}` : '';
    if (!tasks.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = state.synced ? 'Nothing here yet.' : 'Syncing…';
      list.append(li);
    }
  }

  if (focusedId) {
    const input = document.querySelector(`.edit-input[data-id="${focusedId}"]`);
    if (input) { input.focus(); input.setSelectionRange(caret, caret); }
  }
}

function renderTask(task, index, count) {
  const li = document.createElement('li');
  li.className = 'task' + (isDone(task) ? ' done' : '');

  if (!state.editMode) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = isDone(task);
    box.addEventListener('change', () => toggleTask(task, box.checked));
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = task.text;
    label.append(box, text);
    li.append(label);
    return li;
  }

  const input = document.createElement('input');
  input.className = 'edit-input';
  input.value = task.text;
  input.maxLength = 300;
  input.dataset.id = task.id;
  input.setAttribute('enterkeyhint', 'done');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('change', () => renameTask(task, input.value));

  const tools = document.createElement('div');
  tools.className = 'tools';
  tools.append(
    toolButton('↑', 'Move up', index === 0, () => moveTask(task, -1)),
    toolButton('↓', 'Move down', index === count - 1, () => moveTask(task, +1)),
    toolButton('✕', 'Delete', false, () => deleteTask(task), 'delete'),
  );
  li.append(input, tools);
  return li;
}

function toolButton(label, title, disabled, onClick, className = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.disabled = disabled;
  b.className = className;
  if (disabled) b.style.visibility = 'hidden';
  b.addEventListener('click', onClick);
  return b;
}

// ---------- Actions ----------
// Each action updates the screen immediately and saves in the background.
// (Saving works offline too: it uploads once you're back online.)

function toggleTask(task, done) {
  checkForNewDay();
  task.doneDate = done ? state.today : null;
  render();
  store.setDone(state.user.uid, task.id, state.today, done).catch(reportError);
}

function renameTask(task, value) {
  const text = value.trim();
  if (!text) { toast('A task needs some text. Use ✕ to delete it.'); render(); return; }
  if (text === task.text) return;
  task.text = text;
  store.updateText(state.user.uid, task.id, text).catch(reportError);
}

function deleteTask(task) {
  if (!confirm(`Delete "${task.text}"?`)) return;
  state.tasks = state.tasks.filter((t) => t !== task);
  render();
  store.removeTask(state.user.uid, task.id).catch(reportError);
}

function moveTask(task, direction) {
  const list = tasksIn(task.section);
  const from = list.indexOf(task);
  const to = from + direction;
  if (to < 0 || to >= list.length) return;
  [list[from], list[to]] = [list[to], list[from]];
  const changes = [];
  list.forEach((t, i) => { if (t.order !== i) { t.order = i; changes.push({ id: t.id, order: i }); } });
  render();
  store.saveOrder(state.user.uid, changes).catch(reportError);
}

for (const section of SECTIONS) {
  const form = $(`section[data-section="${section}"] .add-form`);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('input', form);
    const text = input.value.trim();
    if (!text) return;
    const existing = tasksIn(section);
    const order = existing.length ? Math.max(...existing.map((t) => t.order ?? 0)) + 1 : 0;
    const task = { id: crypto.randomUUID(), text, section, order, doneDate: null, log: [] };
    state.tasks.push(task);
    input.value = '';
    render();
    store.addTask(state.user.uid, task).catch(reportError);
  });
}

$('#edit-btn').addEventListener('click', () => {
  if (document.activeElement?.classList.contains('edit-input')) document.activeElement.blur();
  state.editMode = !state.editMode;
  render();
});

// ---------- Backup ----------

$('#export-btn').addEventListener('click', () => {
  const data = {
    app: 'back-on-track',
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: state.tasks.map(({ createdAt, ...t }) => t),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `back-on-track-backup-${state.today}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast('Backup downloaded.');
});

$('#import-btn').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const tasks = (data.tasks || []).filter(
      (t) => t && typeof t.id === 'string' && typeof t.text === 'string' && SECTIONS.includes(t.section),
    );
    if (!tasks.length) throw new Error('No tasks found in that file.');
    if (!confirm(`Restore ${tasks.length} task(s) from this backup? Tasks already in the app are kept; tasks from the backup are added back or updated.`)) return;
    await store.importTasks(state.user.uid, tasks.map((t) => ({
      id: t.id, text: t.text, section: t.section, order: Number(t.order) || 0,
      doneDate: t.doneDate ?? null, log: Array.isArray(t.log) ? t.log : [],
    })));
    toast(`Restored ${tasks.length} task(s).`);
  } catch (err) {
    reportError(err);
  }
});

// ---------- Offline support / installable app ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
}
