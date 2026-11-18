// Everything that talks to Firebase (Google login + the cloud database) lives in this file.
// Data layout: users/{yourUserId}/tasks/{taskId}
//   text      – what the task says
//   section   – "daily" or "additional"
//   order     – position in its list
//   doneDate  – the Romanian date (YYYY-MM-DD) it was last checked, or null
//   log       – every date it was ever checked (kept for future stats, e.g. "3× this week")
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch,
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
