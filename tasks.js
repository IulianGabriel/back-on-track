// The Tasks tab: Daily + Additional checklists that reset at 00:00 Romanian time.
import * as store from './db.js';
import { $, romanianDate, formatDate, toast, reportError } from './util.js';

const SECTIONS = ['daily', 'additional'];

const state = {
  uid: null,
  tasks: [],
  synced: false,     // true once we've heard from the cloud at least once
  editMode: false,
  today: romanianDate(),
  unsubscribe: null,
};

export const getTasks = () => state.tasks;
export const getUid = () => state.uid;

export function start(uid) {
  stop();
  state.uid = uid;
  state.tasks = [];
  state.synced = false;
  render();
  state.unsubscribe = store.watchTasks(uid, (tasks, { fromCache }) => {
    state.tasks = tasks;
    if (!fromCache) state.synced = true;
    render();
  }, reportError);
}

export function stop() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  state.uid = null;
}

// A task counts as checked only if it was checked on today's (Romanian) date, so all
// checkmarks "reset" automatically at midnight. Called regularly by app.js.
export function checkForNewDay() {
  const now = romanianDate();
  if (now !== state.today) {
    state.today = now;
    render();
  }
}

// ---------- Rendering ----------

const isDone = (task) => task.doneDate === state.today;

function tasksIn(section) {
  return state.tasks
    .filter((t) => t.section === section)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
}

function render() {
  if (!state.uid) return;

  // Remember which edit box had focus so a live update doesn't kick you out of it.
  const active = document.activeElement;
  const focusedId = active?.classList.contains('edit-input') ? active.dataset.id : null;
  const caret = focusedId ? active.selectionStart : null;

  $('#today-label').textContent = formatDate(state.today, { year: false });
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
  store.setDone(state.uid, task.id, state.today, done).catch(reportError);
}

function renameTask(task, value) {
  const text = value.trim();
  if (!text) { toast('A task needs some text. Use ✕ to delete it.'); render(); return; }
  if (text === task.text) return;
  task.text = text;
  store.updateText(state.uid, task.id, text).catch(reportError);
}

function deleteTask(task) {
  if (!confirm(`Delete "${task.text}"?`)) return;
  state.tasks = state.tasks.filter((t) => t !== task);
  render();
  store.removeTask(state.uid, task.id).catch(reportError);
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
  store.saveOrder(state.uid, changes).catch(reportError);
}

// "Add a task" rows: type, then tap + (or press Enter / OK on the keyboard).
for (const section of SECTIONS) {
  const form = $(`section[data-section="${section}"] .add-form`);
  const input = $('input', form);
  const button = $('.add-btn', form);

  const updateButton = () => button.classList.toggle('ready', input.value.trim() !== '');
  input.addEventListener('input', updateButton);
  // Keep the keyboard open on phones when tapping +.
  button.addEventListener('pointerdown', (e) => { if (document.activeElement === input) e.preventDefault(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const existing = tasksIn(section);
    const order = existing.length ? Math.max(...existing.map((t) => t.order ?? 0)) + 1 : 0;
    const task = { id: crypto.randomUUID(), text, section, order, doneDate: null, log: [] };
    state.tasks.push(task);
    input.value = '';
    updateButton();
    render();
    store.addTask(state.uid, task).catch(reportError);
  });
}

$('#edit-btn').addEventListener('click', () => {
  if (document.activeElement?.classList.contains('edit-input')) document.activeElement.blur();
  state.editMode = !state.editMode;
  render();
});
