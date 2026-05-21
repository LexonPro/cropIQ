/**
 * CropIQ — auth-gate.js
 *
 * Add <script src="auth-gate.js"></script> as the FIRST script
 * in index.html (before script.js).
 *
 * What it does:
 * 1. Checks localStorage for a valid session.
 * 2. If NO session → shows the auth-gate overlay (blurred page + login CTA).
 * 3. If session EXISTS → shows user name in navbar, shows logout button.
 * 4. Handles logout cleanly.
 */

const SESSION_KEY = 'cropiq_session';

// =======================
// 🔍 GET SESSION
// =======================
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
  catch { return null; }
}

// =======================
// 🚪 CHECK AUTH ON LOAD
// =======================
document.addEventListener('DOMContentLoaded', function () {
  const session = getSession();

  if (!session) {
    showAuthGate();
  } else {
    showUserInNavbar(session);
  }
});

// =======================
// 🔒 SHOW AUTH GATE OVERLAY
// =======================
function showAuthGate() {
  // Create the gate overlay element
  const gate = document.createElement('div');
  gate.className = 'auth-gate-overlay show';
  gate.id = 'authGate';
  gate.innerHTML = `
    <div class="gate-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25
             0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0
             00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
      </svg>
    </div>
    <h2>Sign in to CropIQ</h2>
    <p>Create a free account or sign in to access AI-powered crop recommendations tailored to your soil and climate.</p>
    <a href="login.html">
      <svg viewBox="0 0 20 20" fill="currentColor" style="width:16px;height:16px;">
        <path fill-rule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707
          3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1
          0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z"
          clip-rule="evenodd"/>
      </svg>
      Sign In / Create Account
    </a>
  `;
  document.body.appendChild(gate);

  // Also blur the content behind (body content is still there, just visually locked)
  document.body.style.overflow = 'hidden';
}

// =======================
// 👤 SHOW USER PILL IN NAVBAR
// =======================
function showUserInNavbar(session) {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;

  // Get initials (up to 2 letters) from the stored name
  const initials = session.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  // First name only for greeting
  const firstName = session.name.split(' ')[0];

  // Build the user pill and logout button
  const pill = document.createElement('div');
  pill.className = 'nav-user-pill';
  pill.innerHTML = `
    <div class="nav-user-avatar">${initials}</div>
    ${firstName}
  `;

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'nav-logout-btn';
  logoutBtn.textContent = 'Logout';
  logoutBtn.setAttribute('aria-label', 'Logout');
  logoutBtn.onclick = handleLogout;

  // Remove the GitHub link to make room, add user pill + logout
  const githubLink = navLinks.querySelector('.nav-cta');
  if (githubLink) githubLink.remove();

  navLinks.appendChild(pill);
  navLinks.appendChild(logoutBtn);

  // Also update mobile menu
  updateMobileMenu(session.name, handleLogout);
}

// =======================
// 📱 UPDATE MOBILE MENU WITH USER INFO
// =======================
function updateMobileMenu(name, logoutFn) {
  const mobileMenu = document.getElementById('mobileMenu');
  if (!mobileMenu) return;

  // Remove GitHub link from mobile menu
  const githubLink = mobileMenu.querySelector('a[target="_blank"]');
  if (githubLink) githubLink.remove();

  // Add user name as non-link
  const userEntry = document.createElement('div');
  userEntry.style.cssText = `
    font-size:0.82rem; font-weight:700; color:var(--green-700);
    padding:10px 0; border-bottom:1px solid var(--gray-100);
  `;
  userEntry.textContent = `Signed in as ${name.split(' ')[0]}`;
  mobileMenu.appendChild(userEntry);

  // Add logout link
  const logoutLink = document.createElement('button');
  logoutLink.textContent = 'Logout';
  logoutLink.style.cssText = `
    background:none; border:none; text-align:left; width:100%;
    font-family:var(--font-body); font-size:0.95rem; font-weight:600;
    color:#b91c1c; padding:10px 0; cursor:pointer;
  `;
  logoutLink.onclick = logoutFn;
  mobileMenu.appendChild(logoutLink);
}

// =======================
// 🚪 LOGOUT
// =======================
function handleLogout() {
  localStorage.removeItem(SESSION_KEY);
  window.location.href = 'login.html';
}
