// Everything that talks to Firebase (Google login + the cloud database) lives in this file.
// Data layout:
// users/{yourUserId}/tasks/{taskId}
//   text      – what the task says
//   section   – "daily" or "additional"
//   order     – position in its list
//   doneDate  – the Romanian date (YYYY-MM-DD) it was last checked, or null
//   log       – every date it was ever checked (kept for future stats, e.g. "3× this week")
// users/{yourUserId}/journal/{YYYY-MM-DD}
//   text      – what you wrote that day (never deleted by the app)
//   updatedAt – when it was last saved
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, getDocs,
  arrayUnion, arrayRemove, serverTimestamp,
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

export function saveJournalEntry(uid, date, text) {
  return setDoc(journalDoc(uid, date), { text, updatedAt: serverTimestamp() }, { merge: true });
}

// All entries, as [{ date, text }], newest first.
export async function getJournal(uid) {
  const snap = await getDocs(journalCol(uid));
  return snap.docs
    .map((d) => ({ date: d.id, text: d.data().text || '' }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

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
