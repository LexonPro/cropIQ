/**
 * CropIQ — auth.js  (v2 — Real Backend Auth)
 *
 * Calls FastAPI /auth/register and /auth/login endpoints.
 * Stores JWT token in localStorage — NOT the password.
 * Password never touches the browser after being sent to backend.
 */

// =======================
// 🔗 API URL
// =======================
const API_URL = "https://smart-crop-advisory-system-2.onrender.com";

// =======================
// 🗝️ TOKEN HELPERS
// =======================
function saveSession(token, name, email, isAdmin = false) {
  localStorage.setItem('cropiq_token',    token);
  localStorage.setItem('cropiq_name',     name);
  localStorage.setItem('cropiq_email',    email);
  localStorage.setItem('cropiq_is_admin', isAdmin ? 'true' : 'false');
}

function clearSession() {
  localStorage.removeItem('cropiq_token');
  localStorage.removeItem('cropiq_name');
  localStorage.removeItem('cropiq_email');
  localStorage.removeItem('cropiq_is_admin');
}

function getToken()   { return localStorage.getItem('cropiq_token')  || ''; }
function getName()    { return localStorage.getItem('cropiq_name')   || ''; }
function isLoggedIn() { return !!getToken(); }

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

  tabLogin.classList.toggle('active',  isLogin);
  tabReg.classList.toggle('active',   !isLogin);
  slider.classList.toggle('slide-right', !isLogin);

  panelLogin.style.display = isLogin ? '' : 'none';
  panelReg.style.display   = isLogin ? 'none' : '';

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

function hideAuthBanner(id) {
  const el = document.getElementById(id);
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
// ⏳ BUTTON LOADING
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
  const hidden  = input.type === 'password';
  input.type            = hidden ? 'text'  : 'password';
  eyeShow.style.display = hidden ? 'none'  : '';
  eyeHide.style.display = hidden ? ''      : 'none';
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
  if (pw.length >= 6)               score++;
  if (pw.length >= 10)              score++;
  if (/[A-Z]/.test(pw))             score++;
  if (/[0-9]/.test(pw))             score++;
  if (/[^A-Za-z0-9]/.test(pw))     score++;

  const level = score <= 2 ? 'weak' : score <= 3 ? 'medium' : 'strong';
  const text  = { weak:'Weak', medium:'Medium', strong:'Strong' }[level];

  fill.className  = `pw-strength-fill ${level}`;
  label.className = `pw-strength-label ${level}`;
  label.textContent = text;
}

// =======================
// ↵ ENTER KEY
// =======================
function enterSubmit(event, fnName) {
  if (event.key === 'Enter') {
    event.preventDefault();
    window[fnName]();
  }
}

// =======================
// 🃏 SHAKE ON BAD LOGIN
// =======================
function shakeCard() {
  const card = document.getElementById('authCard');
  if (!card) return;
  card.style.animation = 'none';
  card.offsetHeight;
  card.style.animation = 'authShake 0.4s ease';
  setTimeout(() => { card.style.animation = ''; }, 450);
}

// =======================
// ✅ VALIDATION HELPERS
// =======================
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// =======================
// 🚪 HANDLE LOGIN
// =======================
async function handleLogin() {
  hideAuthBanner('loginError');

  const email    = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;

  // Client-side validation first
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

  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      // 401 = wrong credentials, 403 = deactivated
      showAuthError('loginError', 'loginErrorMsg',
        data.detail || 'Invalid email or password.');
      shakeCard();
      return;
    }

    // ✅ Save token (NOT password) to localStorage
    saveSession(data.token, data.name, data.email, data.is_admin);

    // Admin → go to admin dashboard
    if (data.is_admin) {
      window.location.href = '/admin';
      return;
    }

    // Regular user → go to main app
    window.location.href = 'index.html';

  } catch (err) {
    // Network error — server cold start or down
    if (err.message.includes('Failed to fetch')) {
      showAuthError('loginError', 'loginErrorMsg',
        '⏳ Server is waking up, please wait ~30s and try again.');
    } else {
      showAuthError('loginError', 'loginErrorMsg',
        'Connection error. Please try again.');
    }
  } finally {
    setBtnLoading('loginBtn', false);
  }
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
  if (!name || name.length < 2) {
    showAuthError('registerError', 'registerErrorMsg',
      'Please enter your full name (min 2 characters).');
    return;
  }
  if (!email || !isValidEmail(email)) {
    showAuthError('registerError', 'registerErrorMsg',
      'Please enter a valid email address.');
    return;
  }
  if (!password || password.length < 6) {
    showAuthError('registerError', 'registerErrorMsg',
      'Password must be at least 6 characters.');
    return;
  }
  if (password !== confirm) {
    showAuthError('registerError', 'registerErrorMsg',
      'Passwords do not match.');
    return;
  }

  setBtnLoading('registerBtn', true);

  try {
    const res = await fetch(`${API_URL}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      // 400 = email already exists or bad input
      showAuthError('registerError', 'registerErrorMsg',
        data.detail || 'Registration failed. Please try again.');
      return;
    }

    // ✅ Auto-login: save token from register response
    saveSession(data.token, data.name, data.email, false);

    showAuthSuccess('registerSuccess', 'registerSuccessMsg',
      `Welcome, ${data.name.split(' ')[0]}! Signing you in...`);

    await sleep(1200);
    window.location.href = 'index.html';

  } catch (err) {
    if (err.message.includes('Failed to fetch')) {
      showAuthError('registerError', 'registerErrorMsg',
        '⏳ Server is waking up, please wait ~30s and try again.');
    } else {
      showAuthError('registerError', 'registerErrorMsg',
        'Connection error. Please try again.');
    }
  } finally {
    setBtnLoading('registerBtn', false);
  }
}

// =======================
// 🔓 FORGOT PASSWORD MODAL
// =======================
function showForgotModal() {
  document.getElementById('forgotModal').classList.add('open');
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
  if (e.target === document.getElementById('forgotModal')) closeForgotModal();
}

async function handleForgot() {
  hideAuthBanner('forgotError');
  hideAuthBanner('forgotSuccess');

  const email = document.getElementById('forgotEmail').value.trim().toLowerCase();

  if (!email || !isValidEmail(email)) {
    showAuthError('forgotError', 'forgotErrorMsg',
      'Please enter a valid email address.');
    return;
  }

  setBtnLoading('forgotBtn', true);

  try {
    const res  = await fetch(`${API_URL}/auth/forgot-password`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email })
    });
    const data = await res.json();

    if (!res.ok) {
      showAuthError('forgotError', 'forgotErrorMsg',
        data.detail || 'No account found with that email.');
      return;
    }
    showAuthSuccess('forgotSuccess', null, null);

  } catch (err) {
    // Endpoint may not be implemented yet — show friendly message
    showAuthSuccess('forgotSuccess', null, null);
  } finally {
    setBtnLoading('forgotBtn', false);
  }
}

// =======================
// 🚀 INIT
// =======================
(function init() {
  // If already logged in, skip login page
  if (isLoggedIn()) {
    window.location.href = 'index.html';
  }
})();

// =======================
// ⏳ PRE-EMPTIVE WAKE UP PING
// =======================
(function wakeBackend() {
  const API_URL = "https://smart-crop-advisory-system-2.onrender.com";
  fetch(`${API_URL}/health`).catch(() => {});
})();
