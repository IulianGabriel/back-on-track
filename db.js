// Everything that talks to Firebase (Google login + the cloud database) lives in this file.
// Data layout:
// users/{yourUserId}/tasks/{taskId}
//   text      – what the task says
//   section   – "daily" or "additional"
//   order     – position in its list
//   doneDate  – the Romanian date (YYYY-MM-DD) it was last checked, or null
//   log       – every date it was ever checked (kept for future stats, e.g. "3× this week")
// users/{yourUserId}/journal/{YYYY-MM-DD}
//   text      – what you wrote that day (only removed if you delete it yourself)
//   updatedAt – when it was last saved
// users/{yourUserId}/meta/profile
//   name      – your username
//   photo     – your profile photo (a small image, stored as text)
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, getDocs, getDoc,
  query, where, orderBy, limit, startAfter, documentId, getCountFromServer,
  arrayUnion, arrayRemove, serverTimestamp, increment,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';

export const configured = !!firebaseConfig;

let auth, db;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Keeps a copy of your data on the device, so the app opens instantly and works offline.
  // Changes made offline are uploaded automatically when you're back online.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
}

export function onUserChanged(callback) {
  if (!configured) { callback(null); return; }
  onAuthStateChanged(auth, callback);
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else {
      throw err;
    }
  }
}

export const signOutUser = () => signOut(auth);

const tasksCol = (uid) => collection(db, 'users', uid, 'tasks');
const taskDoc = (uid, id) => doc(db, 'users', uid, 'tasks', id);

export function watchTasks(uid, onChange, onError) {
  return onSnapshot(tasksCol(uid), { includeMetadataChanges: true }, (snap) => {
    const tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(tasks, { fromCache: snap.metadata.fromCache });
  }, onError);
}

export function addTask(uid, { id, text, section, order }) {
  return setDoc(taskDoc(uid, id), {
    text, section, order, doneDate: null, log: [], createdAt: serverTimestamp(),
  });
}

export function setDone(uid, id, date, done) {
  return updateDoc(taskDoc(uid, id), done
    ? { doneDate: date, log: arrayUnion(date) }
    : { doneDate: null, log: arrayRemove(date) });
}

export const updateText = (uid, id, text) => updateDoc(taskDoc(uid, id), { text });

export const removeTask = (uid, id) => deleteDoc(taskDoc(uid, id));

export function saveOrder(uid, items /* [{id, order}] */) {
  const batch = writeBatch(db);
  items.forEach(({ id, order }) => batch.update(taskDoc(uid, id), { order }));
  return batch.commit();
}

// ---------- Journal ----------

const journalCol = (uid) => collection(db, 'users', uid, 'journal');
const journalDoc = (uid, date) => doc(db, 'users', uid, 'journal', date);

// Live updates for one day's entry (so an entry written on the phone shows up on the PC).
export function watchJournalEntry(uid, date, onChange, onError) {
  return onSnapshot(journalDoc(uid, date), (snap) => {
    onChange(snap.exists() ? snap.data().text || '' : '', { fromCache: snap.metadata.fromCache });
  }, onError);
}

// Saving an empty entry removes that day, so blank days never clutter the list.
export function saveJournalEntry(uid, date, text) {
  if (!text.trim()) return deleteDoc(journalDoc(uid, date));
  return setDoc(journalDoc(uid, date), { text, updatedAt: serverTimestamp() }, { merge: true });
}

export const deleteJournalEntry = (uid, date) => deleteDoc(journalDoc(uid, date));

// A page of entries, newest first: those before `before` (a date), continuing after `after`.
export async function getJournalPage(uid, { before, after = null, size = 7 }) {
  const parts = [where(documentId(), '<', before), orderBy(documentId(), 'desc')];
  if (after) parts.push(startAfter(after));
  parts.push(limit(size));
  const snap = await getDocs(query(journalCol(uid), ...parts));
  return snap.docs.map((d) => ({ date: d.id, text: d.data().text || '' }));
}

// Specific days only, e.g. "18 November" in earlier years. Days with nothing written are skipped.
export async function getJournalDays(uid, dates) {
  const snaps = await Promise.all(dates.map((date) => getDoc(journalDoc(uid, date))));
  return snaps.filter((s) => s.exists() && (s.data().text || '').trim())
    .map((s) => ({ date: s.id, text: s.data().text }));
}

export async function countJournal(uid) {
  return (await getCountFromServer(journalCol(uid))).data().count;
}

// Every entry (only used for backups), newest first.
export async function getJournal(uid) {
  const snap = await getDocs(journalCol(uid));
  return snap.docs
    .map((d) => ({ date: d.id, text: d.data().text || '' }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- Finance ----------
// users/{uid}/finance/{id}: one money movement
//   type    – "add", "spend" or "move" (move = cash → card)
//   account – "card" or "cash" (for "move" it's where the money comes from: "cash")
//   amount  – in bani (1 RON = 100 bani), so there are no rounding errors
//   note    – optional, e.g. "from Mom" or "groceries"
//   date    – the Romanian date it belongs to; key = date + time, used for sorting
// users/{uid}/meta/finance: the current totals { card, cash }, updated together with every entry.

const financeCol = (uid) => collection(db, 'users', uid, 'finance');
const financeTotalsDoc = (uid) => doc(db, 'users', uid, 'meta', 'finance');

// How an entry changes the two balances.
export function financeEffect(tx) {
  if (tx.type === 'move') return { card: tx.amount, cash: -tx.amount };
  const sign = tx.type === 'spend' ? -1 : 1;
  return tx.account === 'card' ? { card: sign * tx.amount, cash: 0 } : { card: 0, cash: sign * tx.amount };
}

export function watchFinanceTotals(uid, onChange, onError) {
  return onSnapshot(financeTotalsDoc(uid), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    onChange({ card: d.card || 0, cash: d.cash || 0 });
  }, onError);
}

export function addFinanceEntry(uid, tx) {
  const { id, ...data } = tx;
  const e = financeEffect(tx);
  const batch = writeBatch(db);
  batch.set(doc(financeCol(uid), id), { ...data, createdAt: serverTimestamp() });
  batch.set(financeTotalsDoc(uid), { card: increment(e.card), cash: increment(e.cash) }, { merge: true });
  return batch.commit();
}

export function deleteFinanceEntry(uid, tx) {
  const e = financeEffect(tx);
  const batch = writeBatch(db);
  batch.delete(doc(financeCol(uid), tx.id));
  batch.set(financeTotalsDoc(uid), { card: increment(-e.card), cash: increment(-e.cash) }, { merge: true });
  return batch.commit();
}

const txFrom = (d) => { const { createdAt, ...data } = d.data(); return { id: d.id, ...data }; };

// Newest first, a page at a time.
export async function getFinancePage(uid, { afterKey = null, size = 20 }) {
  const parts = [orderBy('key', 'desc')];
  if (afterKey) parts.push(startAfter(afterKey));
  parts.push(limit(size));
  return (await getDocs(query(financeCol(uid), ...parts))).docs.map(txFrom);
}

// Everything from a date onwards (for the chart and "this month"), newest first.
export async function getFinanceSince(uid, date) {
  const q = query(financeCol(uid), where('key', '>=', date), orderBy('key', 'desc'));
  return (await getDocs(q)).docs.map(txFrom);
}

export async function getAllFinance(uid) {
  return (await getDocs(query(financeCol(uid), orderBy('key', 'desc')))).docs.map(txFrom);
}

// Restore: add entries that aren't there yet, then recount the totals from every entry.
export async function importFinance(uid, entries) {
  const existing = new Set((await getAllFinance(uid)).map((t) => t.id));
  const fresh = entries.filter((t) => !existing.has(t.id));
  for (let i = 0; i < fresh.length; i += 400) {
    const batch = writeBatch(db);
    fresh.slice(i, i + 400).forEach(({ id, ...data }) => batch.set(doc(financeCol(uid), id), data));
    await batch.commit();
  }
  const totals = { card: 0, cash: 0 };
  for (const t of await getAllFinance(uid)) {
    const e = financeEffect(t);
    totals.card += e.card;
    totals.cash += e.cash;
  }
  await setDoc(financeTotalsDoc(uid), totals);
  return fresh.length;
}

// ---------- Achievements ----------
// users/{uid}/achievementCategories/{id}: { name, emoji, createdAt }
// users/{uid}/achievements/{id}:          { title, date, categoryId, description, createdAt }

const categoriesCol = (uid) => collection(db, 'users', uid, 'achievementCategories');
const achievementsCol = (uid) => collection(db, 'users', uid, 'achievements');
const plain = (d) => { const { createdAt, ...data } = d.data(); return { id: d.id, ...data }; };

// Live updates for both lists; calls back with { categories, achievements } whenever either changes.
export function watchAchievements(uid, onChange, onError) {
  const latest = { categories: null, achievements: null };
  const send = () => { if (latest.categories && latest.achievements) onChange({ ...latest }); };
  const stopCats = onSnapshot(categoriesCol(uid), (s) => { latest.categories = s.docs.map(plain); send(); }, onError);
  const stopAch = onSnapshot(achievementsCol(uid), (s) => { latest.achievements = s.docs.map(plain); send(); }, onError);
  return () => { stopCats(); stopAch(); };
}

export function saveCategory(uid, { id, ...data }, isNew = false) {
  return setDoc(doc(categoriesCol(uid), id), isNew ? { ...data, createdAt: serverTimestamp() } : data, { merge: true });
}
// Deletes a category together with the achievements in it, all at once.
export async function deleteCategory(uid, id, achievementIds = []) {
  const refs = [doc(categoriesCol(uid), id), ...achievementIds.map((a) => doc(achievementsCol(uid), a))];
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

export function saveAchievement(uid, { id, ...data }, isNew = false) {
  return setDoc(doc(achievementsCol(uid), id), isNew ? { ...data, createdAt: serverTimestamp() } : data, { merge: true });
}
export const deleteAchievement = (uid, id) => deleteDoc(doc(achievementsCol(uid), id));

export async function getAllAchievements(uid) {
  const [cats, ach] = await Promise.all([getDocs(categoriesCol(uid)), getDocs(achievementsCol(uid))]);
  return { categories: cats.docs.map(plain), achievements: ach.docs.map(plain) };
}

// Restore: only adds categories/achievements that aren't in the app yet (never overwrites).
export async function importAchievements(uid, { categories, achievements }) {
  const current = await getAllAchievements(uid);
  const haveCat = new Set(current.categories.map((c) => c.id));
  const haveAch = new Set(current.achievements.map((a) => a.id));
  const writes = [
    ...categories.filter((c) => !haveCat.has(c.id)).map(({ id, ...d }) => [doc(categoriesCol(uid), id), d]),
    ...achievements.filter((a) => !haveAch.has(a.id)).map(({ id, ...d }) => [doc(achievementsCol(uid), id), d]),
  ];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach(([ref, data]) => batch.set(ref, data));
    await batch.commit();
  }
  return writes.length;
}

// ---------- Profile ----------

const profileDoc = (uid) => doc(db, 'users', uid, 'meta', 'profile');

export function watchProfile(uid, onChange, onError) {
  return onSnapshot(profileDoc(uid), (snap) => onChange(snap.exists() ? snap.data() : {}), onError);
}

export const saveProfile = (uid, fields) => setDoc(profileDoc(uid), fields, { merge: true });

export async function importJournal(uid, entries) {
  for (let i = 0; i < entries.length; i += 400) {
    const batch = writeBatch(db);
    entries.slice(i, i + 400).forEach(({ date, text }) => {
      batch.set(journalDoc(uid, date), { text, updatedAt: serverTimestamp() }, { merge: true });
    });
    await batch.commit();
  }
}

// ---------- Restore ----------

export async function importTasks(uid, tasks) {
  // Firestore batches are limited to 500 writes, so write in chunks.
  for (let i = 0; i < tasks.length; i += 400) {
    const batch = writeBatch(db);
    tasks.slice(i, i + 400).forEach(({ id, ...data }) => {
      delete data.createdAt;
      batch.set(taskDoc(uid, id), data, { merge: true });
    });
    await batch.commit();
  }
}
