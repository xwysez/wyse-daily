/* ===========================================================
   auth.js — mandatory email/password login gate via Firebase Auth.

   This is the single place that calls firebase.initializeApp(). Any
   other module that needs Firebase (firebase-sync.js) reuses this
   same app instance via firebase.app() rather than initializing its
   own — Firebase throws if you initialize the same app twice.

   SETUP:
   1. Paste your Firebase project's web config into FIREBASE_CONFIG below
      (Firebase Console -> Project settings -> General -> Your apps).
   2. Authentication -> Sign-in method -> enable Email/Password.
   3. Authentication -> Users -> Add user -> create the one account this
      app should log in as (e.g. brutaslouise@gmail.com) with a password.
      There is no sign-up flow in this app on purpose — it's built for a
      single personal account, not public registration.

   Until FIREBASE_CONFIG is filled in, the login screen stays up with an
   explanatory message instead of a broken form — the app never falls
   back to showing the dashboard unauthenticated.
   =========================================================== */

const Auth = (() => {

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAWyR_Jqo0cBzE0aBKhX_460ULdfynWE_U',
    authDomain: 'productivity-web-app-7d4ae.firebaseapp.com',
    projectId: 'productivity-web-app-7d4ae',
    storageBucket: 'productivity-web-app-7d4ae.firebasestorage.app',
    messagingSenderId: '572675554231',
    appId: '1:572675554231:web:c948343575e4fd5e6dc632'
  };

  const isConfigured = !!FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith('YOUR_');

  let auth = null;
  let currentUser = null;
  const listeners = [];

  function init() {
    if (!isConfigured || typeof firebase === 'undefined') {
      showLogin();
      setLoginError('Firebase isn\u2019t configured yet. Add your project keys to auth.js to enable login.');
      disableLoginForm(true);
      return;
    }

    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
    } catch (e) {
      console.error('Firebase init failed', e);
      showLogin();
      setLoginError('Sign-in is unavailable right now (config error).');
      disableLoginForm(true);
      return;
    }

    auth.onAuthStateChanged(user => {
      currentUser = user;
      listeners.forEach(fn => { try { fn(user); } catch (e) { console.error('Auth listener failed', e); } });
      if (user) showApp(); else showLogin();
    });

    bindLoginForm();
  }

  // ---------------- screen switching ----------------
  function showApp() {
    document.getElementById('authLoading').hidden = true;
    document.getElementById('loginScreen').hidden = true;
    document.getElementById('app').hidden = false;
  }

  function showLogin() {
    document.getElementById('authLoading').hidden = true;
    document.getElementById('app').hidden = true;
    document.getElementById('loginScreen').hidden = false;
  }

  // ---------------- login form ----------------
  function bindLoginForm() {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      setLoginError('');
      setLoginLoading(true);
      try {
        await auth.signInWithEmailAndPassword(email, password);
        // onAuthStateChanged above handles revealing the app.
      } catch (err) {
        console.error('Login failed', err);
        setLoginError(friendlyAuthError(err));
      } finally {
        setLoginLoading(false);
      }
    });
  }

  function friendlyAuthError(err) {
    const messages = {
      'auth/invalid-email': 'That email address doesn\u2019t look right.',
      'auth/user-not-found': 'No account found for that email.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/invalid-credential': 'Incorrect email or password.',
      'auth/too-many-requests': 'Too many attempts \u2014 please wait a moment and try again.',
      'auth/network-request-failed': 'Network error \u2014 check your connection.'
    };
    return messages[err.code] || 'Could not log in. Please try again.';
  }

  function setLoginLoading(isLoading) {
    const btn = document.getElementById('loginSubmit');
    btn.disabled = isLoading;
    btn.textContent = isLoading ? 'Logging in\u2026' : 'Log in';
  }

  function disableLoginForm(disabled) {
    document.getElementById('loginEmail').disabled = disabled;
    document.getElementById('loginPassword').disabled = disabled;
    document.getElementById('loginSubmit').disabled = disabled;
  }

  function setLoginError(message) {
    const el = document.getElementById('loginError');
    el.textContent = message || '';
    el.hidden = !message;
  }

  // ---------------- public API ----------------
  function onChange(fn) {
    listeners.push(fn);
    if (auth) fn(currentUser); // fire immediately with current state for late subscribers
  }

  function getUser() {
    return currentUser;
  }

  function logout() {
    if (auth) auth.signOut();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { onChange, getUser, logout };
})();