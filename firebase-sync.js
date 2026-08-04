/* ===========================================================
   firebase-sync.js — cross-device sync via Firestore.

   Piggybacks on auth.js's login: since this app now requires signing
   in with the one Firebase account before you can use it at all, sync
   just starts automatically the moment Auth reports a signed-in user —
   there's no separate "connect sync" step or button anymore. This file
   does not call firebase.initializeApp() itself; it reuses the app
   instance auth.js already created (Firebase throws if you initialize
   the same app twice).

   Firestore setup (same as before): Firestore Database -> Create
   database -> Rules:

     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /signalboard_users/{uid} {
           allow read, write: if request.auth != null && request.auth.uid == uid;
         }
       }
     }
   =========================================================== */

const FirebaseSync = (() => {

  const COLLECTION = 'signalboard_users';

  // Identifies pushes made by *this* browser tab/device, so its own
  // Firestore snapshot echo can be ignored instead of re-merging into itself.
  const deviceId = Utils.uid();

  let db = null;
  let unsubscribeSnapshot = null;
  let applyingRemote = false; // true while we're writing remote data into Storage
  let pushTimer = null;

  function init() {
    Auth.onChange(user => {
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }
      if (!user) {
        setStatus('');
        return;
      }
      if (!db) {
        try {
          db = firebase.firestore();
        } catch (e) {
          console.error('Firestore init failed', e);
          setStatus('Sync unavailable');
          return;
        }
      }
      attachRemoteListener(user.uid);
    });

    // Any local write to items/categories gets pushed up (debounced),
    // unless the write we're reacting to IS the remote data we just applied.
    Storage.subscribe(() => {
      if (applyingRemote) return;
      schedulePush();
    });
  }

  function docRef(uid) {
    return db.collection(COLLECTION).doc(uid);
  }

  async function attachRemoteListener(uid) {
    setStatus('Syncing…');
    const ref = docRef(uid);

    // One-time merge on login: combine whatever is already on this
    // device with whatever is already in the cloud. Nothing is dropped —
    // items that exist on only one side are kept, items that exist on
    // both keep whichever copy was edited more recently.
    try {
      const snap = await ref.get();
      if (snap.exists) mergeRemoteIntoLocal(snap.data());
      await pushNow(); // write the merged result back so the cloud catches up
    } catch (e) {
      console.error('Initial sync failed', e);
      setStatus('Sync error — check Firestore rules');
    }

    // Live updates from other devices from here on.
    unsubscribeSnapshot = ref.onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();
      if (data.__writtenBy === deviceId) return; // ignore our own echo
      mergeRemoteIntoLocal(data);
      setStatus('Synced just now');
    }, err => {
      console.error('Snapshot listener error', err);
      setStatus('Sync error — check Firestore rules');
    });
  }

  function mergeRemoteIntoLocal(remote) {
    applyingRemote = true;
    try {
      const mergedItems = mergeItemsById(Storage.getItems(), remote.items || []);
      const mergedCategories = Array.from(new Set([
        ...Storage.getCategories(),
        ...(remote.categories || [])
      ]));
      Storage.saveItems(mergedItems);
      Storage.saveCategories(mergedCategories);
    } finally {
      applyingRemote = false;
    }
    if (window.SignalboardApp) window.SignalboardApp.refreshAll();
  }

  function mergeItemsById(localItems, remoteItems) {
    const map = new Map();
    localItems.forEach(it => map.set(it.id, it));
    remoteItems.forEach(remoteIt => {
      const local = map.get(remoteIt.id);
      if (!local || (remoteIt.updatedAt || 0) > (local.updatedAt || 0)) {
        map.set(remoteIt.id, remoteIt);
      }
    });
    return Array.from(map.values());
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 800);
  }

  async function pushNow() {
    const user = Auth.getUser();
    if (!user || !db) return;
    setStatus('Syncing…');
    try {
      await docRef(user.uid).set({
        items: Storage.getItems(),
        categories: Storage.getCategories(),
        dataVersion: Storage.getDataVersion(),
        __writtenBy: deviceId,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setStatus('Synced');
    } catch (e) {
      console.error('Push failed', e);
      setStatus('Sync error — check Firestore rules');
    }
  }

  function setStatus(text) {
    const el = document.getElementById('syncStatus');
    if (el) el.textContent = text;
  }

  document.addEventListener('DOMContentLoaded', init);

  return {};
})();
