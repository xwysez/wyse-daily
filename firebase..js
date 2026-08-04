/* ===========================================================
   firebase-sync.js — optional cross-device sync via Firebase.

   SETUP (required before this does anything):
   1. Create a project at https://console.firebase.google.com
   2. Add a Web App to it, copy the config object it gives you,
      and paste it into FIREBASE_CONFIG below.
   3. In the console: Authentication -> Sign-in method -> enable Google.
   4. In the console: Firestore Database -> Create database (production
      mode is fine) -> then set rules so users can only read/write their
      own document, e.g.:

        rules_version = '2';
        service cloud.firestore {
          match /databases/{database}/documents {
            match /signalboard_users/{uid} {
              allow read, write: if request.auth != null && request.auth.uid == uid;
            }
          }
        }

   Until FIREBASE_CONFIG is filled in, the app runs exactly as before —
   fully local, nothing breaks — and the sidebar just shows a note that
   sync isn't configured yet.
   =========================================================== */

const FirebaseSync = (() => {

  const FIREBASE_CONFIG = {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID'
  };

  const COLLECTION = 'signalboard_users';
  const isConfigured = !!FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith('YOUR_');

  // Identifies pushes made by *this* browser tab/device, so its own
  // Firestore snapshot echo can be ignored instead of re-merging into itself.
  const deviceId = Utils.uid();

  let auth = null;
  let db = null;
  let currentUser = null;
  let unsubscribeSnapshot = null;
  let applyingRemote = false; // true while we're writing remote data into Storage
  let pushTimer = null;

  // ---------------- init ----------------
  function init() {
    if (!isConfigured) {
      setStatus('Add Firebase config to enable sync');
      bindStaticUI();
      return;
    }
    if (typeof firebase === 'undefined') {
      setStatus('Sync unavailable (SDK failed to load)');
      return;
    }

    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
    } catch (e) {
      console.error('Firebase init failed', e);
      setStatus('Sync unavailable (config error)');
      return;
    }

    auth.onAuthStateChanged(user => {
      currentUser = user;
      renderAuthUI();
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }
      if (user) attachRemoteListener(user.uid);
      else setStatus('Not synced');
    });

    // Any local write to items/categories gets pushed up (debounced),
    // unless the write we're reacting to IS the remote data we just applied.
    Storage.subscribe(() => {
      if (applyingRemote) return;
      schedulePush();
    });

    bindStaticUI();
  }

  function bindStaticUI() {
    const signInBtn = document.getElementById('syncSignIn');
    const signOutBtn = document.getElementById('syncSignOut');
    if (signInBtn) signInBtn.addEventListener('click', signIn);
    if (signOutBtn) signOutBtn.addEventListener('click', signOut);
  }

  // ---------------- auth ----------------
  async function signIn() {
    if (!isConfigured || !auth) return;
    setStatus('Signing in…');
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    } catch (e) {
      console.error('Sign-in failed', e);
      setStatus('Sign-in failed');
    }
  }

  function signOut() {
    if (auth) auth.signOut();
  }

  // ---------------- sync ----------------
  function docRef(uid) {
    return db.collection(COLLECTION).doc(uid);
  }

  async function attachRemoteListener(uid) {
    setStatus('Syncing…');
    const ref = docRef(uid);

    // One-time merge on sign-in: combine whatever is already on this
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
    if (!currentUser || !db) return;
    setStatus('Syncing…');
    try {
      await docRef(currentUser.uid).set({
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

  // ---------------- UI ----------------
  function renderAuthUI() {
    const signedOutEl = document.getElementById('syncSignedOut');
    const signedInEl = document.getElementById('syncSignedIn');
    if (!signedOutEl || !signedInEl) return;
    if (currentUser) {
      signedOutEl.hidden = true;
      signedInEl.hidden = false;
      const label = document.getElementById('syncUserLabel');
      if (label) label.textContent = currentUser.displayName || currentUser.email || 'Signed in';
    } else {
      signedOutEl.hidden = false;
      signedInEl.hidden = true;
    }
  }

  function setStatus(text) {
    const el = document.getElementById('syncStatus');
    if (el) el.textContent = text;
  }

  document.addEventListener('DOMContentLoaded', init);

  return { signIn, signOut, isConfigured: () => isConfigured };
})();