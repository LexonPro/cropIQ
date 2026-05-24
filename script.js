/**
 * Smart Crop Advisory System — script.js  (v2 — JWT Auth)
 *
 * Changes from v1:
 *  • Every API call now sends Authorization: Bearer <token>
 *  • If backend returns 401, user is redirected to login
 *  • getAuthHeaders() helper centralises token injection
 */

// =======================
// 🔗 API BASE URL
// =======================
const API_URL = "https://smart-crop-advisory-system-2.onrender.com";

// =======================
// 🔑 AUTH HEADER HELPER
// =======================
function getAuthHeaders() {
  const token = localStorage.getItem('cropiq_token') || '';
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${token}`
  };
}

function handleAuthError(status) {
  if (status === 401) {
    // Token expired or invalid → back to login
    localStorage.removeItem('cropiq_token');
    localStorage.removeItem('cropiq_name');
    localStorage.removeItem('cropiq_email');
    window.location.href = 'login.html';
  }
}

// =======================
// NAVBAR
// =======================
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
});

// =======================
// HAMBURGER MENU
// =======================
const hamburger  = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');

hamburger.addEventListener('click', () => {
  mobileMenu.classList.toggle('open');
});

mobileMenu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => mobileMenu.classList.remove('open'));
});

// =======================
// CHART
// =======================
let cropChart = null;

// =======================
// 🔥 FETCH WITH RETRY + TIMEOUT
// =======================
async function fetchWithRetry(url, options, retries = 6, delay = 6000) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeout);

      // Handle auth error — don't retry, redirect immediately
      if (response.status === 401) {
        handleAuthError(401);
        throw new Error('Session expired. Redirecting to login...');
      }

      return response;

    } catch (err) {
      if (err.message.includes('Session expired')) throw err;

      console.log(`Retry ${i + 1}...`);
      if (i < retries - 1) {
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw err;
      }
    }
  }
}

// =======================
// 🚀 HANDLE PREDICT
// =======================
async function handlePredict() {
  const btn = document.getElementById('predictBtn');
  if (btn.disabled) return;

  const n    = parseFloat(document.getElementById('nitrogen').value);
  const p    = parseFloat(document.getElementById('phosphorus').value);
  const k    = parseFloat(document.getElementById('potassium').value);
  const temp = parseFloat(document.getElementById('temperature').value);
  const hum  = parseFloat(document.getElementById('humidity').value);
  const ph   = parseFloat(document.getElementById('ph').value);
  const rain = parseFloat(document.getElementById('rainfall').value);

  if ([n, p, k, temp, hum, ph, rain].some(v => isNaN(v))) {
    showError('Please fill all fields correctly.');
    return;
  }

  hideError();
  setLoading(true);

  try {
    const response = await fetchWithRetry(
      `${API_URL}/predict`,
      {
        method:  'POST',
        headers: getAuthHeaders(),           // ← JWT token injected here
        body: JSON.stringify({
          N: n, P: p, K: k,
          temperature: temp,
          humidity:    hum,
          ph:          ph,
          rainfall:    rain
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.detail || 'Server error');
    }

    const predictions = normalizePredictions(data);

    if (!predictions || predictions.length === 0) {
      throw new Error('No predictions returned.');
    }

    renderResults(predictions);

  } catch (err) {
    console.error(err);

    if (err.message.includes('Session expired')) {
      showError('Session expired. Redirecting to login...');
    } else if (err.name === 'AbortError') {
      showError('Server taking too long... please retry.');
    } else if (err.message.includes('Failed to fetch')) {
      showError('⏳ Server is starting... please wait (first request may take ~30s)');
    } else {
      showError(err.message || 'Something went wrong.');
    }

  } finally {
    setLoading(false);
  }
}

// =======================
// RESET
// =======================
function handleReset() {
  ['nitrogen','phosphorus','potassium','temperature','humidity','ph','rainfall']
    .forEach(id => document.getElementById(id).value = '');

  document.getElementById('results').style.display = 'none';

  if (cropChart) {
    cropChart.destroy();
    cropChart = null;
  }

  hideError();
}

// =======================
// 🔄 NORMALIZE RESPONSE
// =======================
function normalizePredictions(data) {
  if (data?.top_predictions && data.top_predictions.length > 0) {
    return data.top_predictions.map(item => ({
      crop:       String(item.crop).toUpperCase(),
      confidence: item.confidence
    }));
  }
  if (data?.recommended_crop) {
    return [{
      crop:       String(data.recommended_crop).toUpperCase(),
      confidence: 1
    }];
  }
  return null;
}

// =======================
// 📊 RENDER RESULTS
// =======================
function renderResults(predictions) {
  document.getElementById('results').style.display = 'block';
  renderCards(predictions);
  renderChart(predictions);
}

// =======================
// 📦 CARDS
// =======================
function renderCards(predictions) {
  const grid = document.getElementById('predictionGrid');
  grid.innerHTML = '';

  const rankClass = ['rank-1', 'rank-2', 'rank-3'];

  predictions.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = `pred-card ${rankClass[index] || ''}`;

    card.innerHTML = `
      <h3>#${index + 1} ${item.crop}</h3>
      <p>${Math.round(item.confidence * 100)}%</p>
    `;

    grid.appendChild(card);
  });
}

// =======================
// 📈 CHART
// =======================
function renderChart(predictions) {
  const ctx = document.getElementById('cropChart').getContext('2d');

  if (cropChart) cropChart.destroy();

  cropChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: predictions.map(p => p.crop),
      datasets: [{
        label:           'Match %',
        data:            predictions.map(p => Math.round(p.confidence * 100)),
        backgroundColor: ['#2e7d32', '#66bb6a', '#a5d6a7'],
      }]
    }
  });
}

// =======================
// ⏳ LOADING
// =======================
function setLoading(isLoading) {
  const btn = document.getElementById('predictBtn');
  if (isLoading) {
    btn.innerText = 'Waking server... ⏳';
    btn.disabled  = true;
  } else {
    btn.innerText = 'Predict';
    btn.disabled  = false;
  }
}

// =======================
// ❌ ERROR HANDLING
// =======================
function showError(msg) {
  document.getElementById('errorMessage').innerText = msg;
}

function hideError() {
  document.getElementById('errorMessage').innerText = '';
}
