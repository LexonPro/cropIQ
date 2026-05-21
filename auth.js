/**
 * CropIQ — auth.js
 *
 * HOW AUTH WORKS (no backend needed — localStorage based):
 * ─────────────────────────────────────────────────────────
 * Users are stored in localStorage as:
 *   cropiq_users  → JSON array of { name, email, password (hashed-like), createdAt }
 *
 * Active session stored as:
 *   cropiq_session → JSON { name, email, loggedInAt, remember }
 *
 * On index.html load → auth-gate.js checks session.
 * If no session → shows blur gate overlay with "Go to Login" button.
 * If session exists → shows user pill in navbar, hides gate.
 *
 * NOTE: This is a frontend-only auth system. For production,
 * replace localStorage with real backend /register and /login
 * endpoints using JWT tokens (see backend/app.py comments).
 * ─────────────────────────────────────────────────────────
 */

// =======================
// 🔑 CONSTANTS
// =======================
const USERS_KEY   = 'cropiq_users';
const SESSION_KEY = 'cropiq_session';

// =======================
// 🗃️ STORAGE HELPERS
// =======================
function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
  catch { return []; }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
  catch { return null; }
}

function saveSession(user, remember) {
  const session = {
    name: user.name,
    email: user.email,
    loggedInAt: Date.now(),
    remember: !!remember
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// Minimal one-way hash using djb2 — not cryptographic,
// but prevents plaintext passwords in localStorage.
function hashPassword(pw) {
  let h = 5381;
  for (let i = 0; i < pw.length; i++) {
    h = ((h << 5) + h) ^ pw.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

// =======================
// 🔀 TAB SWITCHER
// =======================
function switchTab(tab) {
  const isLogin    = tab === 'login';
  const slider     = document.getElementById('tabSlider');
  const tabLogin   = document.getElementById('tabLogin');
  const tabReg     = document.getElementById('tabRegister');
  const panelLogin = document.getElementById('panelLogin');
  const panelReg   = document.getElementById('panelRegister');

  tabLogin.classList.toggle('active', isLogin);
  tabReg.classList.toggle('active', !isLogin);
  slider.classList.toggle('slide-right', !isLogin);

  if (isLogin) {
    panelLogin.style.display = '';
    panelReg.style.display   = 'none';
  } else {
    panelLogin.style.display = 'none';
    panelReg.style.display   = '';
  }

  // Clear banners on switch
  hideAuthBanner('loginError');
  hideAuthBanner('registerError');
  hideAuthBanner('registerSuccess');
}

// =======================
// 🔔 BANNER HELPERS
// =======================
function showAuthError(bannerId, msgId, msg) {
  const banner = document.getElementById(bannerId);
  const span   = document.getElementById(msgId);
  if (!banner) return;
  if (span) span.textContent = msg;
  banner.classList.add('show');
}

function hideAuthBanner(bannerId) {
  const el = document.getElementById(bannerId);
  if (el) el.classList.remove('show');
}

function showAuthSuccess(bannerId, msgId, msg) {
  const banner = document.getElementById(bannerId);
  const span   = document.getElementById(msgId);
  if (!banner) return;
  if (span && msg) span.textContent = msg;
  banner.classList.add('show');
}

// =======================
// ⏳ BUTTON LOADING STATE
// =======================
function setBtnLoading(btnId, isLoading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = isLoading;
  btn.classList.toggle('loading', isLoading);
}

// =======================
// 👁️ TOGGLE PASSWORD
// =======================
function togglePassword(inputId, btn) {
  const input   = document.getElementById(inputId);
  const eyeShow = btn.querySelector('.eye-show');
  const eyeHide = btn.querySelector('.eye-hide');
  const isHidden = input.type === 'password';

  input.type        = isHidden ? 'text' : 'password';
  eyeShow.style.display = isHidden ? 'none'  : '';
  eyeHide.style.display = isHidden ? ''      : 'none';
}

// =======================
// 🔐 PASSWORD STRENGTH
// =======================
function checkPasswordStrength(pw) {
  const wrap  = document.getElementById('pwStrengthWrap');
  const fill  = document.getElementById('pwStrengthFill');
  const label = document.getElementById('pwStrengthLabel');
  if (!wrap) return;

  if (!pw) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';

  let score = 0;
  if (pw.length >= 6)                        score++;
  if (pw.length >= 10)                       score++;
  if (/[A-Z]/.test(pw))                      score++;
  if (/[0-9]/.test(pw))                      score++;
  if (/[^A-Za-z0-9]/.test(pw))              score++;

  const level = score <= 2 ? 'weak' : score <= 3 ? 'medium' : 'strong';
  const text  = { weak: 'Weak', medium: 'Medium', strong: 'Strong' }[level];

  fill.className  = `pw-strength-fill ${level}`;
  label.className = `pw-strength-label ${level}`;
  label.textContent = text;
}

// =======================
// ↵ ENTER KEY SHORTCUT
// =======================
function enterSubmit(event, fnName) {
  if (event.key === 'Enter') {
    event.preventDefault();
    window[fnName]();
  }
}

// =======================
// 🚪 HANDLE LOGIN
// =======================
async function handleLogin() {
  hideAuthBanner('loginError');

  const email    = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  const remember = document.getElementById('rememberMe').checked;

  // Client-side validation
  if (!email) {
    showAuthError('loginError', 'loginErrorMsg', 'Please enter your email address.');
    return;
  }
  if (!isValidEmail(email)) {
    showAuthError('loginError', 'loginErrorMsg', 'Please enter a valid email address.');
    return;
  }
  if (!password) {
    showAuthError('loginError', 'loginErrorMsg', 'Please enter your password.');
    return;
  }

  setBtnLoading('loginBtn', true);

  // Simulate network delay (remove when using real backend)
  await sleep(600);

  const users   = getUsers();
  const hashed  = hashPassword(password);
  const matched = users.find(u => u.email === email && u.password === hashed);

  setBtnLoading('loginBtn', false);

  if (!matched) {
    showAuthError('loginError', 'loginErrorMsg',
      'Incorrect email or password. Please try again.');
    shakeCard();
    return;
  }

  // Save session
  saveSession(matched, remember);

  // Redirect to main app
  window.location.href = 'index.html';
}

// =======================
// 📝 HANDLE REGISTER
// =======================
async function handleRegister() {
  hideAuthBanner('registerError');
  hideAuthBanner('registerSuccess');

  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim().toLowerCase();
  const password = document.getElementById('regPassword').value;
  const confirm  = document.getElementById('regConfirm').value;

  // Validation
  if (!name) {
    showAuthError('registerError', 'registerErrorMsg', 'Please enter your full name.');
    return;
  }
  if (name.length < 2) {
    showAuthError('registerError', 'registerErrorMsg', 'Name must be at least 2 characters.');
    return;
  }
  if (!email) {
    showAuthError('registerError', 'registerErrorMsg', 'Please enter your email address.');
    return;
  }
  if (!isValidEmail(email)) {
    showAuthError('registerError', 'registerErrorMsg', 'Please enter a valid email address.');
    return;
  }
  if (!password) {
    showAuthError('registerError', 'registerErrorMsg', 'Please create a password.');
    return;
  }
  if (password.length < 6) {
    showAuthError('registerError', 'registerErrorMsg', 'Password must be at least 6 characters.');
    return;
  }
  if (password !== confirm) {
    showAuthError('registerError', 'registerErrorMsg', 'Passwords do not match.');
    return;
  }

  // Check if email already registered
  const users = getUsers();
  if (users.find(u => u.email === email)) {
    showAuthError('registerError', 'registerErrorMsg',
      'An account with this email already exists. Try signing in.');
    return;
  }

  setBtnLoading('registerBtn', true);
  await sleep(700);

  // Create and save new user
  const newUser = {
    name,
    email,
    password: hashPassword(password),
    createdAt: Date.now()
  };
  users.push(newUser);
  saveUsers(users);

  setBtnLoading('registerBtn', false);

  // Show success, auto-login, redirect
  showAuthSuccess('registerSuccess', 'registerSuccessMsg',
    `Welcome, ${name.split(' ')[0]}! Signing you in...`);

  await sleep(1200);

  saveSession(newUser, false);
  window.location.href = 'index.html';
}

// =======================
// 🔓 FORGOT PASSWORD MODAL
// =======================
function showForgotModal() {
  const modal = document.getElementById('forgotModal');
  modal.classList.add('open');
  setTimeout(() => document.getElementById('forgotEmail')?.focus(), 100);
}

function closeForgotModal() {
  document.getElementById('forgotModal').classList.remove('open');
  hideAuthBanner('forgotError');
  hideAuthBanner('forgotSuccess');
  const inp = document.getElementById('forgotEmail');
  if (inp) inp.value = '';
}

function closeForgotOnOverlay(e) {
  // Close only if click is on the dim overlay, not the card
  if (e.target === document.getElementById('forgotModal')) {
    closeForgotModal();
  }
}

async function handleForgot() {
  hideAuthBanner('forgotError');
  hideAuthBanner('forgotSuccess');

  const email = document.getElementById('forgotEmail').value.trim().toLowerCase();

  if (!email) {
    showAuthError('forgotError', 'forgotErrorMsg', 'Please enter your email address.');
    return;
  }
  if (!isValidEmail(email)) {
    showAuthError('forgotError', 'forgotErrorMsg', 'Please enter a valid email address.');
    return;
  }

  setBtnLoading('forgotBtn', true);
  await sleep(800);
  setBtnLoading('forgotBtn', false);

  const users = getUsers();
  const found = users.find(u => u.email === email);

  if (!found) {
    showAuthError('forgotError', 'forgotErrorMsg',
      'No account found with that email address.');
    return;
  }

  // In a real system: call POST /auth/forgot-password API here.
  // For demo: just show success message.
  showAuthSuccess('forgotSuccess', null, null);
}

// =======================
// 🔧 UTILITIES
// =======================
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Card shake animation on bad login
function shakeCard() {
  const card = document.getElementById('authCard');
  if (!card) return;
  card.style.animation = 'none';
  card.offsetHeight;  // reflow
  card.style.animation = 'authShake 0.4s ease';
  setTimeout(() => { card.style.animation = ''; }, 450);
}

// =======================
// 🚀 INIT — redirect if already logged in
// =======================
(function init() {
  const session = getSession();
  if (session) {
    // Already logged in — go straight to main app
    window.location.href = 'index.html';
  }
})();
