// App shell: sign-in, bottom navigation, backups, and the midnight check.
import * as store from './db.js';
import * as tasks from './tasks.js';
import * as journal from './journal.js';
import * as finance from './finance.js';
import * as achievements from './achievements.js';
import * as profile from './profile.js';
import { $, romanianDate, toast, reportError } from './util.js';

const TABS = ['tasks', 'journal', 'finance', 'achievements', 'profile'];

// ---------- Screens ----------

function show(id) {
  for (const s of ['loading', 'login', 'app']) $('#' + s).hidden = s !== id;
}

// ---------- Login ----------

store.onUserChanged((user) => {
  tasks.stop();
  journal.stop();
  finance.stop();
  achievements.stop();
  profile.stop();

  if (!user) {
    show('login');
    if (!store.configured) {
      showLoginError('The app is not connected to Firebase yet (firebase-config.js is empty).');
      $('#signin-btn').disabled = true;
    }
    return;
  }

  show('app');
  tasks.start(user.uid);
  journal.start(user.uid);
  finance.start(user.uid);
  achievements.start(user.uid);
  profile.start(user);
  showTab(currentTab());
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
  if (confirm('Sign out? Everything stays safely saved in your account.')) store.signOutUser();
});

// ---------- Bottom navigation ----------

function currentTab() {
  const tab = location.hash.slice(1);
  return TABS.includes(tab) ? tab : 'tasks';
}

function showTab(tab) {
  for (const t of TABS) {
    $(`#tab-${t}`).hidden = t !== tab;
    const btn = $(`.nav-btn[data-tab="${t}"]`);
    btn.classList.toggle('active', t === tab);
    btn.setAttribute('aria-current', t === tab ? 'page' : 'false');
  }
  if (tab === 'journal') journal.onShow();
  if (tab === 'finance') finance.onShow();
  if (tab === 'profile') profile.onShow();
}

for (const btn of document.querySelectorAll('.nav-btn')) {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    history.replaceState(null, '', tab === 'tasks' ? location.pathname : '#' + tab);
    showTab(tab);
    window.scrollTo(0, 0);
  });
}
window.addEventListener('hashchange', () => showTab(currentTab()));

// The savings card on the Profile tab opens Finance.
$('#pf-savings').addEventListener('click', () => $('.nav-btn[data-tab="finance"]').click());

// ---------- Midnight (Romanian time) ----------
// Check every 20 seconds, and whenever the app comes back to the screen.

function checkForNewDay() {
  tasks.checkForNewDay();
  journal.checkForNewDay();
  finance.checkForNewDay();
}
setInterval(checkForNewDay, 20_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForNewDay(); });
window.addEventListener('focus', checkForNewDay);

// ---------- Backup ----------

$('#export-btn').addEventListener('click', async () => {
  try {
    const data = {
      app: 'on-track',
      version: 4,
      exportedAt: new Date().toISOString(),
      tasks: tasks.getTasks().map(({ createdAt, ...t }) => t),
      journal: await journal.getAllEntries(),
      finance: await finance.getAllEntries(),
      achievements: await achievements.getAll(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `on-track-backup-${romanianDate()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast('Backup downloaded.');
  } catch (err) {
    reportError(err);
  }
});

$('#import-btn').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const uid = tasks.getUid();
    const backupTasks = (data.tasks || []).filter(
      (t) => t && typeof t.id === 'string' && typeof t.text === 'string' && ['daily', 'additional'].includes(t.section),
    );
    const backupJournal = (data.journal || []).filter(
      (j) => j && /^\d{4}-\d{2}-\d{2}$/.test(j.date) && typeof j.text === 'string' && j.text.trim(),
    );
    const backupFinance = (data.finance || []).filter(
      (t) => t && typeof t.id === 'string' && ['add', 'spend', 'move'].includes(t.type)
        && ['card', 'cash'].includes(t.account) && Number.isInteger(t.amount) && t.amount > 0
        && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && typeof t.key === 'string',
    ).map(({ id, type, account, amount, note, date, at, key }) => ({ id, type, account, amount, note: note || '', date, at: at || 0, key }));
    const ach = data.achievements || {};
    const backupCategories = (ach.categories || []).filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
      .map(({ id, name, emoji, order }) => ({ id, name, emoji: emoji || '', order: Number(order) || 0 }));
    const backupAchievements = (ach.achievements || []).filter((a) => a && typeof a.id === 'string' && typeof a.title === 'string'
      && typeof a.categoryId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.date))
      .map(({ id, title, date, categoryId, description }) => ({ id, title, date, categoryId, description: description || '' }));
    if (!backupTasks.length && !backupJournal.length && !backupFinance.length && !backupAchievements.length && !backupCategories.length) {
      throw new Error('Nothing to restore in that file.');
    }

    // Never overwrite a journal entry that already has text in the app.
    const current = new Map((await journal.getAllEntries()).map((j) => [j.date, j.text]));
    const journalToRestore = backupJournal.filter((j) => !(current.get(j.date) || '').trim());

    if (!confirm(`Restore from this backup?\n\n• ${backupTasks.length} task(s)\n• ${journalToRestore.length} journal entr${journalToRestore.length === 1 ? 'y' : 'ies'}\n• finance entries that are missing (out of ${backupFinance.length})\n• achievements that are missing (out of ${backupAchievements.length})\n\nNothing already in the app is deleted, and journal entries you've already written are never replaced.`)) return;

    if (backupTasks.length) {
      await store.importTasks(uid, backupTasks.map((t) => ({
        id: t.id, text: t.text, section: t.section, order: Number(t.order) || 0,
        doneDate: t.doneDate ?? null, log: Array.isArray(t.log) ? t.log : [],
      })));
    }
    if (journalToRestore.length) await store.importJournal(uid, journalToRestore);
    if (backupFinance.length) {
      await store.importFinance(uid, backupFinance);
      finance.start(uid);
      if (currentTab() === 'finance') finance.onShow();
    }
    if (backupCategories.length || backupAchievements.length) {
      await store.importAchievements(uid, { categories: backupCategories, achievements: backupAchievements });
    }
    toast('Backup restored.');
    if (journalToRestore.length) { journal.start(uid); if (currentTab() === 'journal') journal.onShow(); }
  } catch (err) {
    reportError(err);
  }
});

// ---------- Offline support / installable app ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
}
