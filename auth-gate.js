/**
 * CropIQ — auth-gate.js  (v2 — JWT backend auth)
 *
 * Add as FIRST script in index.html:
 *   <script src="auth-gate.js"></script>
 *
 * Reads cropiq_token from localStorage.
 * If missing → shows lock overlay, blocks the page.
 * If present → shows user pill + logout in navbar.
 * All API calls from script.js automatically include the token.
 */

const SESSION_KEY = 'cropiq_token';
const NAME_KEY    = 'cropiq_name';
const EMAIL_KEY   = 'cropiq_email';

// =======================
// 🔍 GETTERS
// =======================
function getToken()   { return localStorage.getItem(SESSION_KEY) || ''; }
function getName()    { return localStorage.getItem(NAME_KEY)    || 'User'; }
function getEmail()   { return localStorage.getItem(EMAIL_KEY)   || ''; }
function isLoggedIn() { return !!getToken(); }

// =======================
// 🚪 LOGOUT
// =======================
function handleLogout() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem('cropiq_is_admin');
  window.location.href = 'login.html';
}

// =======================
// 🔒 AUTH GATE
// =======================
document.addEventListener('DOMContentLoaded', function () {
  if (!isLoggedIn()) {
    showSignInBtnInNavbar();
  } else {
    showUserInNavbar();
  }
});

// =======================
// 🔑 SHOW SIGN IN IN NAVBAR
// =======================
function showSignInBtnInNavbar() {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;

  const cta = navLinks.querySelector('.nav-cta');
  if (cta) {
    cta.textContent = 'Sign In';
    cta.href = 'login.html';
    cta.removeAttribute('target');
  }

  // Update mobile menu
  const mobileMenu = document.getElementById('mobileMenu');
  if (mobileMenu) {
    const gh = mobileMenu.querySelector('a[target="_blank"]');
    if (gh) {
      gh.textContent = 'Sign In';
      gh.href = 'login.html';
      gh.removeAttribute('target');
    }
  }
}

// =======================
// 👤 USER PILL IN NAVBAR
// =======================
function showUserInNavbar() {
  const name     = getName();
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;

  const initials  = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const firstName = name.split(' ')[0];

  // Remove GitHub CTA link to make room
  const cta = navLinks.querySelector('.nav-cta');
  if (cta) cta.remove();

  // User pill
  const pill = document.createElement('div');
  pill.className = 'nav-user-pill';
  pill.innerHTML = `<div class="nav-user-avatar">${initials}</div>${firstName}`;

  // Logout button
  const logoutBtn = document.createElement('button');
  logoutBtn.className   = 'nav-logout-btn';
  logoutBtn.textContent = 'Logout';
  logoutBtn.onclick     = handleLogout;

  navLinks.appendChild(pill);
  navLinks.appendChild(logoutBtn);

  // Mobile menu update
  updateMobileMenu(name);
}

function updateMobileMenu(name) {
  const mobileMenu = document.getElementById('mobileMenu');
  if (!mobileMenu) return;

  const gh = mobileMenu.querySelector('a[target="_blank"]');
  if (gh) gh.remove();

  const userEntry = document.createElement('div');
  userEntry.style.cssText =
    'font-size:.82rem;font-weight:700;color:var(--green-700);' +
    'padding:10px 0;border-bottom:1px solid var(--gray-100);';
  userEntry.textContent = `Signed in as ${name.split(' ')[0]}`;
  mobileMenu.appendChild(userEntry);

  const logoutLink = document.createElement('button');
  logoutLink.textContent = 'Logout';
  logoutLink.style.cssText =
    'background:none;border:none;text-align:left;width:100%;' +
    'font-family:var(--font-body);font-size:.95rem;font-weight:600;' +
    'color:#b91c1c;padding:10px 0;cursor:pointer;';
  logoutLink.onclick = handleLogout;
  mobileMenu.appendChild(logoutLink);
}
