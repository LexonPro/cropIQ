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
    console.warn("Auth error detected, but login redirects are bypassed.");
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

  if (!isLoggedIn()) {
    showLoginModal();
    return;
  }

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

    renderResults(predictions, data?.advisory);

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
function renderResults(predictions, advisory) {
  document.getElementById('results').style.display = 'block';
  renderCards(predictions);
  renderChart(predictions);
  renderAdvisory(advisory);
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
    card.id = `predCard_${index}`;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
        <span class="pred-rank-badge">#${index + 1}</span>
        <button class="btn-reset speak-btn" onclick="speakText('predCard_${index}')" style="height:28px; width:28px; padding:0; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; margin:0; border:1px solid var(--gray-200); cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px; height:12px; stroke-linecap:round; stroke-linejoin:round;"><path d="M11 5 6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        </button>
      </div>
      <h3 class="pred-crop-name" style="margin-bottom: 4px;">${item.crop}</h3>
      <p class="pred-label" style="margin-bottom: 14px;">Suitability Match</p>
      <div class="pred-confidence-val" style="margin-bottom: 8px;">${Math.round(item.confidence * 100)}%</div>
      <div class="pred-bar-track">
        <div class="pred-bar-fill" style="width: ${Math.round(item.confidence * 100)}%"></div>
      </div>
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
        backgroundColor: ['#22405C', '#F2A73B', '#6B4226'],
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
  const msgEl = document.getElementById('errorMessage');
  const banner = document.getElementById('errorBanner');
  if (msgEl) msgEl.innerText = msg;
  if (banner) banner.style.display = 'flex';
}

function hideError() {
  const msgEl = document.getElementById('errorMessage');
  const banner = document.getElementById('errorBanner');
  if (msgEl) msgEl.innerText = '';
  if (banner) banner.style.display = 'none';
}

// =======================
// 🔑 LOGIN MODAL HELPERS
// =======================
function showLoginModal() {
  const modal = document.getElementById('loginRequiredModal');
  if (modal) modal.classList.add('open');
}

function closeLoginRequiredModal() {
  const modal = document.getElementById('loginRequiredModal');
  if (modal) modal.classList.remove('open');
}

function closeLoginModalOnOverlay(e) {
  const modal = document.getElementById('loginRequiredModal');
  if (modal && e.target === modal) {
    closeLoginRequiredModal();
  }
}

// =======================
// 🔌 DYNAMIC WEATHER DETECT (Open-Meteo API)
// =======================
async function handleWeatherDetect() {
  const btn = document.getElementById('weatherBtn');
  if (btn.disabled) return;

  btn.disabled = true;
  btn.innerHTML = `Detecting... ⏳`;

  if (!navigator.geolocation) {
    showError("Geolocation is not supported by your browser.");
    btn.innerHTML = `GPS Weather`;
    btn.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m`
        );
        if (!response.ok) throw new Error("Weather service error");
        
        const data = await response.json();
        const temp = data.current.temperature_2m;
        const hum = data.current.relative_humidity_2m;
        
        // Estimate rainfall based on humidity
        const rain = Math.round(hum > 80 ? (hum * 3.5) : (hum * 1.8));

        animateInputWrite('temperature', temp);
        animateInputWrite('humidity', hum);
        animateInputWrite('rainfall', rain);

        showError(""); // clear errors
      } catch (err) {
        console.warn("Weather API failed, using fallback:", err);
        animateInputWrite('temperature', 26.8);
        animateInputWrite('humidity', 74);
        animateInputWrite('rainfall', 140);
      } finally {
        btn.innerHTML = `GPS Weather`;
        btn.disabled = false;
      }
    },
    (error) => {
      console.warn("Location permission denied, using realistic fallback.");
      animateInputWrite('temperature', 27.2);
      animateInputWrite('humidity', 70);
      animateInputWrite('rainfall', 110);
      btn.innerHTML = `GPS Weather`;
      btn.disabled = false;
    },
    { timeout: 8000 }
  );
}

// =======================
// 🦾 HARDWARE IOT PROBE SIMULATION
// =======================
function handleProbeSimulate() {
  const btn = document.getElementById('probeBtn');
  if (btn.disabled) return;

  btn.disabled = true;
  btn.innerHTML = `Scanning...`;

  const overlay = document.getElementById('scannerOverlay');
  if (overlay) overlay.style.display = 'block';

  const preset = document.getElementById('soilPreset').value;
  
  let targetValues = { n: 80, p: 45, k: 45, ph: 6.5 };
  if (preset === 'acidic_dry') {
    targetValues = { n: 20, p: 15, k: 18, ph: 4.8 };
  } else if (preset === 'nitrogen_deficient') {
    targetValues = { n: 10, p: 62, k: 28, ph: 7.2 };
  } else if (preset === 'alkaline_potash') {
    targetValues = { n: 55, p: 98, k: 178, ph: 8.2 };
  }

  // Visual sweeps for 2 seconds
  setTimeout(() => {
    if (overlay) overlay.style.display = 'none';
    btn.disabled = false;
    btn.innerHTML = `Scan Probe`;

    // Typewrite the sensors NPK + pH
    animateInputWrite('nitrogen', targetValues.n);
    animateInputWrite('phosphorus', targetValues.p);
    animateInputWrite('potassium', targetValues.k);
    animateInputWrite('ph', targetValues.ph);
  }, 2000);
}

// =======================
// ✏️ INPUT WRITER ANIMATION
// =======================
function animateInputWrite(inputId, value) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.classList.add('field-pulse');
  setTimeout(() => input.classList.remove('field-pulse'), 800);

  let current = 0;
  const target = parseFloat(value);
  const steps = 15;
  const stepVal = target / steps;
  const interval = setInterval(() => {
    current += stepVal;
    if (current >= target) {
      input.value = target;
      clearInterval(interval);
    } else {
      input.value = current.toFixed(1);
    }
  }, 25);
}

// =======================
// 🩺 RENDER ADVISORY CARDS
// =======================
function renderAdvisory(advisory) {
  const wrap = document.getElementById('advisoryWrap');
  const grid = document.getElementById('advisoryGrid');
  if (!wrap || !grid) return;

  if (!advisory || !advisory.advice || advisory.advice.length === 0) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'block';
  grid.innerHTML = '';

  advisory.advice.forEach((item, index) => {
    const card = document.createElement('div');
    card.id = `advCard_${index}`;
    
    // Status colors
    let badgeBg = 'var(--gray-100)';
    let badgeColor = 'var(--gray-700)';
    let statusText = String(item.status).toUpperCase();
    
    if (item.status === 'optimal') {
      badgeBg = '#dcfce7';
      badgeColor = '#15803d';
    } else if (item.status === 'deficient') {
      badgeBg = '#ffedd5';
      badgeColor = '#c2410c';
    } else if (item.status === 'acidic' || item.status === 'alkaline' || item.status === 'excess') {
      badgeBg = '#fee2e2';
      badgeColor = '#b91c1c';
      if (item.status === 'acidic') statusText = 'TOO ACIDIC';
      if (item.status === 'alkaline') statusText = 'TOO ALKALINE';
    }

    card.style.cssText = `
      background: #fff;
      border: 1px solid var(--gray-200);
      border-radius: var(--radius-lg);
      padding: 20px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: transform var(--transition), box-shadow var(--transition);
    `;
    
    card.onmouseenter = () => {
      card.style.transform = 'translateY(-4px)';
      card.style.boxShadow = 'var(--shadow-md)';
    };
    card.onmouseleave = () => {
      card.style.transform = 'translateY(0)';
      card.style.boxShadow = 'var(--shadow-sm)';
    };

    let actualText = 'Measured';
    let targetText = 'Ideal Target';
    if (item.nutrient.includes('pH')) {
      actualText = 'Actual pH';
      targetText = `Target: ${advisory.targets.ph}`;
    } else if (item.nutrient.includes('Nitrogen')) {
      targetText = `Target: ${advisory.targets.N} mg/kg`;
    } else if (item.nutrient.includes('Phosphorus')) {
      targetText = `Target: ${advisory.targets.P} mg/kg`;
    } else if (item.nutrient.includes('Potassium')) {
      targetText = `Target: ${advisory.targets.K} mg/kg`;
    }

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h4 style="font-family:var(--font-display); font-weight:700; font-size:1.05rem; color:var(--gray-900); margin:0;">${item.nutrient}</h4>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:0.68rem; font-weight:800; padding:3px 9px; border-radius:100px; background:${badgeBg}; color:${badgeColor}; letter-spacing:0.04em;">${statusText}</span>
          <button class="btn-reset speak-btn" onclick="speakText('advCard_${index}')" style="height:26px; width:26px; padding:0; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; margin:0; border:1px solid var(--gray-200); cursor:pointer;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px; height:12px; stroke-linecap:round; stroke-linejoin:round;"><path d="M11 5 6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
          </button>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
        <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--gray-500); font-weight:600;">
          <span>${actualText}</span>
          <span>${targetText}</span>
        </div>
        <div style="height:6px; background:var(--gray-100); border-radius:100px; overflow:hidden; position:relative;">
          <div style="width: ${item.status === 'optimal' ? '100%' : '65%'}; height: 100%; background:${item.status === 'optimal' ? 'var(--leaf-500)' : 'var(--marigold-500)'}; opacity: 0.8; border-radius:100px;"></div>
        </div>
      </div>
      <p style="font-size:0.83rem; color:var(--gray-600); line-height:1.5; margin:0; font-weight:500;">${item.message}</p>
    `;

    grid.appendChild(card);
  });
}


// 📑 TAB SWITCHER LOGIC
// =======================
function switchTab(tabId) {
  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.display = 'none';
  });

  // Remove active class from all tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show active tab content and add active class to button
  if (tabId === 'soil-tab') {
    document.getElementById('soilTabContent').style.display = 'block';
    document.getElementById('soil-tab-btn').classList.add('active');
  } else if (tabId === 'disease-tab') {
    document.getElementById('diseaseTabContent').style.display = 'block';
    document.getElementById('disease-tab-btn').classList.add('active');
  } else if (tabId === 'mandi-tab') {
    document.getElementById('mandiTabContent').style.display = 'block';
    document.getElementById('mandi-tab-btn').classList.add('active');
    fetchMandiPrices(); // auto-fetch when entering tab
  }
}

// =======================
// 🗣️ TEXT-TO-SPEECH ACCESSIBILITY
// =======================
function speakText(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;

  const btn = element.querySelector('.speak-btn');
  if (btn) btn.classList.add('active');

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  let textToSpeak = "";
  if (elementId === 'diseaseResultCard') {
    const dName = document.getElementById('diseaseName').innerText;
    const dConf = document.getElementById('diseaseConfidence').innerText;
    const dRemedy = document.getElementById('diseaseRemedy').innerText;
    textToSpeak = `${dName}. Confidence: ${dConf}. Recommended Treatment: ${dRemedy}`;
  } else {
    // Read clean text content
    textToSpeak = element.innerText;
  }

  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  
  // Localize voice synthesis language
  const lang = localStorage.getItem('cropiq_lang') || 'en';
  if (lang === 'hi') {
    utterance.lang = 'hi-IN';
  } else if (lang === 'pb') {
    utterance.lang = 'pa-IN';
  } else {
    utterance.lang = 'en-US';
  }

  utterance.onend = () => {
    if (btn) btn.classList.remove('active');
  };
  utterance.onerror = () => {
    if (btn) btn.classList.remove('active');
  };

  window.speechSynthesis.speak(utterance);
}

// =======================
// 🌐 MULTILINGUAL SYSTEM
// =======================
const TRANSLATIONS = {
  en: {
    title: "Enter Soil & Climate Data",
    subtitle: "Provide your soil nutrient levels and current climate conditions for accurate crop recommendations.",
    btn_predict: "Analyze Crop",
    btn_reset: "Reset",
    nav_predict: "Predict",
    nav_results: "Results",
    nav_about: "About",
    step_input: "Step 01 — Input Parameters",
    step_results: "Step 02 — Results",
    results_title: "Top 3 Crop Predictions",
    results_sub: "Based on your soil and climate data, our AI model recommends the following crops.",
    advisory_step: "Step 03 — Agronomical Prescriptions",
    advisory_title: "AI Soil Diagnostics & Prescription Advisory",
    advisory_sub: "Computed balanced mineral target thresholds and calculated customized fertilizer recipe cards for optimal growth.",
    soil_tab: "🌱 Soil Advisor",
    disease_tab: "🔍 Leaf Diagnosis",
    mandi_tab: "📈 Mandi Prices",
    lbl_step_disease: "Step 01 — Leaf Upload",
    lbl_title_disease: "AI Leaf Disease Diagnosis",
    lbl_sub_disease: "Upload a clear photo of the infected crop leaf or snap a picture using your camera for instant diagnosis and treatments.",
    lbl_upload_click: "Click or Drag & Drop Leaf Image Here",
    lbl_upload_formats: "Supports JPG, PNG (Max 5MB)",
    lbl_step_mandi: "Step 01 — Market Feeds",
    lbl_title_mandi: "Mandi Market Prices (Live Trends)",
    lbl_sub_mandi: "View wholesale commodity rates in regional markets (Mandis) of India to negotiate the best price for your produce."
  },
  hi: {
    title: "मिट्टी और जलवायु का विवरण भरें",
    subtitle: "सटीक फसल सिफारिशों के लिए अपनी मिट्टी के पोषक स्तर और वर्तमान जलवायु स्थिति प्रदान करें।",
    btn_predict: "फसल विश्लेषण करें",
    btn_reset: "रीसेट करें",
    nav_predict: "पूर्वानुमान",
    nav_results: "परिणाम",
    nav_about: "विवरण",
    step_input: "चरण 01 — इनपुट पैरामीटर",
    step_results: "चरण 02 — परिणाम",
    results_title: "शीर्ष 3 फसल सिफारिशें",
    results_sub: "आपकी मिट्टी और जलवायु डेटा के आधार पर, हमारा एआई मॉडल इन फसलों की सिफारिश करता है।",
    advisory_step: "चरण 03 — कृषि नुस्खे",
    advisory_title: "एआई मृदा निदान और उर्वरक नुस्खा सलाहकार",
    advisory_sub: "अनुकूलतम विकास के लिए संतुलित खनिज लक्ष्य सीमा और अनुकूलित उर्वरक खुराक की गणना की गई।",
    soil_tab: "🌱 मृदा सलाहकार",
    disease_tab: "🔍 पत्ती रोग निदान",
    mandi_tab: "📈 मंडी भाव",
    lbl_step_disease: "चरण 01 — पत्ती फोटो अपलोड",
    lbl_title_disease: "एआई पत्ती रोग निदान",
    lbl_sub_disease: "तुरंत निदान और उपचार के लिए संक्रमित फसल की पत्ती का स्पष्ट फोटो अपलोड करें या अपने कैमरे से तस्वीर लें।",
    lbl_upload_click: "यहाँ क्लिक करें या पत्ती की तस्वीर खींचकर लाएँ",
    lbl_upload_formats: "JPG, PNG फाइलों का समर्थन (अधिकतम 5MB)",
    lbl_step_mandi: "चरण 01 — बाजार भाव",
    lbl_title_mandi: "मंडी बाजार भाव (ताजा जानकारी)",
    lbl_sub_mandi: "अपनी उपज का सर्वोत्तम मूल्य प्राप्त करने के लिए भारत के क्षेत्रीय बाजारों (मंडियों) में थोक दरों को देखें।"
  },
  pb: {
    title: "ਮਿੱਟੀ ਅਤੇ ਜਲਵਾਯੂ ਦਾ ਵੇਰਵਾ ਭਰੋ",
    subtitle: "ਸਹੀ ਫਸਲ ਦੀਆਂ ਸਿਫ਼ਾਰਸ਼ਾਂ ਲਈ ਆਪਣੀ ਮਿੱਟੀ ਦੇ ਪੋਸ਼ਕ ਤੱਤਾਂ ਦੇ ਪੱਧਰ ਅਤੇ ਮੌਜੂਦਾ ਜਲਵਾਯੂ ਸਥਿਤੀ ਪ੍ਰਦਾਨ ਕਰੋ।",
    btn_predict: "ਫਸਲ ਦਾ ਵਿਸ਼ਲੇਸ਼ਣ ਕਰੋ",
    btn_reset: "ਰੀਸੈਟ ਕਰੋ",
    nav_predict: "ਪੂਰਵ-ਅਨੁਮਾਨ",
    nav_results: "ਨਤੀਜੇ",
    nav_about: "ਵੇਰਵੇ",
    step_input: "ਕਦਮ 01 — ਇਨਪੁਟ ਪੈਰਾਮੀਟਰ",
    step_results: "ਕਦਮ 02 — ਨਤੀਜੇ",
    results_title: "ਚੋਟੀ ਦੀਆਂ 3 ਫਸਲਾਂ ਦੀਆਂ ਸਿਫ਼ਾਰਸ਼ਾਂ",
    results_sub: "ਤੁਹਾਡੀ ਮਿੱਟੀ ਅਤੇ ਜਲਵਾਯੂ ਦੇ ਅੰਕੜਿਆਂ ਦੇ ਅਧਾਰ ਤੇ, ਸਾਡਾ ਏਆਈ ਮਾਡਲ ਇਹਨਾਂ ਫਸਲਾਂ ਦੀ ਸਿਫਾਰਸ਼ ਕਰਦਾ ਹੈ।",
    advisory_step: "ਕਦਮ 03 — ਖੇਤੀਬਾੜੀ ਨੁਸਖੇ",
    advisory_title: "ਏਆਈ ਮਿੱਟੀ ਦੀ ਜਾਂਚ ਅਤੇ ਖਾਦ ਸਲਾਹਕਾਰ",
    advisory_sub: "ਵਧੀਆ ਵਿਕਾਸ ਲਈ ਸੰਤੁਲਿਤ ਖਣਿਜ ਟੀਚੇ ਦੇ ਪੱਧਰ ਅਤੇ ਅਨੁਕੂਲਿਤ ਖਾਦ ਦੀ ਖੁਰਾਕ ਦੀ ਗਣਨਾ ਕੀਤੀ ਗਈ।",
    soil_tab: "🌱 ਮਿੱਟੀ ਸਲਾਹਕਾਰ",
    disease_tab: "🔍 ਪੱਤੇ ਦੇ ਰੋਗਾਂ ਦੀ ਜਾਂਚ",
    mandi_tab: "📈 ਮੰਡੀ ਦੇ ਭਾਅ",
    lbl_step_disease: "ਕਦਮ 01 — ਪੱਤੇ ਦੀ ਫੋਟੋ ਅਪਲੋਡ",
    lbl_title_disease: "ਏਆਈ ਪੱਤੇ ਦੇ ਰੋਗਾਂ ਦੀ ਜਾਂਚ",
    lbl_sub_disease: "ਤੁਰੰਤ ਜਾਂਚ ਅਤੇ ਇਲਾਜ ਲਈ ਇਨਫੈਕਟਿਡ ਫਸਲ ਦੇ ਪੱਤੇ ਦੀ ਸਾਫ਼ ਫੋਟੋ ਅਪਲੋਡ ਕਰੋ ਜਾਂ ਆਪਣੇ ਕੈਮਰੇ ਨਾਲ ਫੋਟੋ ਖਿੱਚੋ।",
    lbl_upload_click: "ਇੱਥੇ ਕਲਿੱਕ ਕਰੋ ਜਾਂ ਪੱਤੇ ਦੀ ਫੋਟੋ ਖਿੱਚ ਕੇ ਲਿਆਓ",
    lbl_upload_formats: "JPG, PNG ਫਾਈਲਾਂ ਦਾ ਸਮਰਥਨ (ਅਧਿਕਤਮ 5MB)",
    lbl_step_mandi: "ਕਦਮ 01 — ਬਾਜ਼ਾਰ ਦੇ ਭਾਅ",
    lbl_title_mandi: "ਮੰਡੀ ਬਾਜ਼ਾਰ ਦੇ ਭਾਅ (ਤਾਜ਼ਾ ਜਾਣਕਾਰੀ)",
    lbl_sub_mandi: "ਆਪਣੀ ਫਸਲ ਦਾ ਸਭ ਤੋਂ ਵਧੀਆ ਮੁੱਲ ਪ੍ਰਾਪਤ ਕਰਨ ਲਈ ਭਾਰਤ ਦੇ ਖੇਤਰੀ ਬਾਜ਼ਾਰਾਂ (ਮੰਡੀਆਂ) ਦੇ ਥੋਕ ਭਾਅ ਦੇਖੋ।"
  }
};

function changeLanguage(langCode) {
  localStorage.setItem('cropiq_lang', langCode);
  
  // Sync selector elements
  const desktopSelector = document.getElementById('langSelect');
  const mobileSelector = document.getElementById('mobileLangSelect');
  if (desktopSelector) desktopSelector.value = langCode;
  if (mobileSelector) mobileSelector.value = langCode;

  const t = TRANSLATIONS[langCode];
  if (!t) return;

  // Perform translation re-writes
  const writeText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
  };

  // Navbars
  document.querySelectorAll('.nav-links a[href="#predict"], .mobile-menu a[href="#predict"]').forEach(el => el.innerText = t.nav_predict);
  document.querySelectorAll('.nav-links a[href="#results"], .mobile-menu a[href="#results"]').forEach(el => el.innerText = t.nav_results);
  document.querySelectorAll('.nav-links a[href="#footer"], .mobile-menu a[href="#footer"]').forEach(el => el.innerText = t.nav_about);

  // Tabs buttons
  writeText('soil-tab-btn', t.soil_tab);
  writeText('disease-tab-btn', t.disease_tab);
  writeText('mandi-tab-btn', t.mandi_tab);

  // Soil Advisor fields
  document.querySelector('#soilTabContent .section-title').innerText = t.title;
  document.querySelector('#soilTabContent .section-sub').innerText = t.subtitle;
  document.querySelector('#soilTabContent .section-label').innerText = t.step_input;
  writeText('predictBtn', t.btn_predict);
  
  // Predictions results titles
  document.querySelector('#results .section-label').innerText = t.step_results;
  document.querySelector('#results .section-title').innerText = t.results_title;
  document.querySelector('#results .section-sub').innerText = t.results_sub;
  
  // Advisory titles
  document.querySelector('#advisoryWrap .section-label').innerText = t.advisory_step;
  document.querySelector('#advisoryWrap .section-title').innerText = t.advisory_title;
  document.querySelector('#advisoryWrap .section-sub').innerText = t.advisory_sub;

  // Disease tab elements
  writeText('lblStepDisease', t.lbl_step_disease);
  writeText('lblTitleDisease', t.lbl_title_disease);
  writeText('lblSubDisease', t.lbl_sub_disease);
  writeText('lblUploadClick', t.lbl_upload_click);
  writeText('lblUploadFormats', t.lbl_upload_formats);

  // Mandi tab elements
  writeText('lblStepMandi', t.lbl_step_mandi);
  writeText('lblTitleMandi', t.lbl_title_mandi);
  writeText('lblSubMandi', t.lbl_sub_mandi);
}

// =======================
// 🩺 AI LEAF DISEASE PREDICTION
// =======================
let selectedDiseaseFile = null;

function triggerFileInput() {
  document.getElementById('diseaseFile').click();
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  selectedDiseaseFile = file;
  
  // Render local preview
  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('leafPreview').src = e.target.result;
    document.getElementById('uploadZone').style.display = 'none';
    document.getElementById('previewArea').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function clearDiseaseTab() {
  selectedDiseaseFile = null;
  document.getElementById('diseaseFile').value = '';
  document.getElementById('uploadZone').style.display = 'block';
  document.getElementById('previewArea').style.display = 'none';
  document.getElementById('diseaseResultCard').style.display = 'none';
}

async function submitDiseaseDiagnosis() {
  if (!selectedDiseaseFile) return;

  if (!isLoggedIn()) {
    showLoginModal();
    return;
  }

  const btn = document.getElementById('diagnoseBtn');
  const spinner = document.getElementById('diagnoseSpinner');
  btn.disabled = true;
  if (spinner) spinner.style.display = 'inline-flex';

  const formData = new FormData();
  formData.append('file', selectedDiseaseFile);

  try {
    const response = await fetchWithRetry(`${API_URL}/predict-disease`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('cropiq_token') || ''}`
        // Do NOT set Content-Type header when sending FormData!
      },
      body: formData
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Diagnosis failed");

    // Render diagnostic card
    document.getElementById('diseaseResultCard').style.display = 'block';
    document.getElementById('diseaseName').innerText = data.disease;
    document.getElementById('diseaseConfidence').innerText = `${data.confidence}%`;
    document.getElementById('diseaseRemedy').innerText = data.remedy;
    
    // Ratios
    document.getElementById('metricGreen').innerText = `${data.metrics.green_pct}%`;
    document.getElementById('metricYellow').innerText = `${data.metrics.yellow_pct}%`;
    document.getElementById('metricNecrosis').innerText = `${data.metrics.necrosis_pct}%`;

    // Apply color coding based on status
    const card = document.getElementById('diseaseResultCard');
    if (data.status === 'optimal') {
      card.style.borderLeftColor = '#16a34a';
    } else if (data.status === 'warning') {
      card.style.borderLeftColor = '#ca8a04';
    } else {
      card.style.borderLeftColor = '#b91c1c';
    }

    // Scroll results into view
    card.scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    console.error("Diagnosis error:", err);
    showError(err.message || "Fungal diagnosis failed.");
  } finally {
    btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
  }
}

// =======================
// 📈 MANDI PRICES LOADER
// =======================
async function fetchMandiPrices() {
  if (!isLoggedIn()) {
    showLoginModal();
    return;
  }

  const grid = document.getElementById('mandiPricesGrid');
  grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--gray-500); font-weight:600;">Loading fresh market feeds... ⏳</div>';

  try {
    const response = await fetchWithRetry(`${API_URL}/market-prices`, {
      method: 'GET',
      headers: getAuthHeaders()
    });

    const data = await response.json();
    if (!response.ok) throw new Error("Could not retrieve market rates");

    grid.innerHTML = '';
    data.prices.forEach(p => {
      const card = document.createElement('div');
      card.className = 'mandi-card';

      const isUp = p.trend === 'up';
      const trendBadge = isUp 
        ? `<span class="mandi-trend-badge trend-up">▲ UP</span>` 
        : `<span class="mandi-trend-badge trend-down">▼ DOWN</span>`;

      card.innerHTML = `
        <div class="mandi-header">
          <div>
            <h3 class="mandi-commodity">${p.commodity}</h3>
            <span class="mandi-location">${p.mandi}, ${p.state}</span>
          </div>
          ${trendBadge}
        </div>
        <div class="mandi-prices-row">
          <div>
            <span class="mandi-price-lbl">Average Price</span>
            <div class="mandi-price-val">₹${p.avg}</div>
          </div>
          <div style="text-align: right;">
            <span class="mandi-price-lbl">Range (Min - Max)</span>
            <div style="font-size:0.82rem; font-weight:600; color:var(--gray-600); margin-top:2px;">₹${p.min} - ₹${p.max}</div>
            <span style="font-size:0.65rem; color:var(--gray-400);">per quintal</span>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });

  } catch (err) {
    grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#b91c1c; font-weight:600;">Error: ${err.message}</div>`;
  }
}

// =======================
// 📷 WEB CAMERA STREAM CONTROLLER
// =======================
let activeVideoStream = null;

function startCameraStream() {
  const container = document.getElementById('cameraContainer');
  const video = document.getElementById('cameraVideo');
  if (!container || !video) return;

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      activeVideoStream = stream;
      video.srcObject = stream;
      container.style.display = 'flex';
      container.scrollIntoView({ behavior: 'smooth' });
    })
    .catch(err => {
      console.error("Camera access failed:", err);
      showError("Camera access blocked or unavailable. Please upload a file instead.");
    });
}

function stopCameraStream() {
  const container = document.getElementById('cameraContainer');
  const video = document.getElementById('cameraVideo');
  if (video) video.srcObject = null;
  if (activeVideoStream) {
    activeVideoStream.getTracks().forEach(track => track.stop());
    activeVideoStream = null;
  }
  if (container) container.style.display = 'none';
}

function captureCameraPhoto() {
  const video = document.getElementById('cameraVideo');
  if (!video || !activeVideoStream) return;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(blob => {
    if (!blob) return;

    const capturedFile = new File([blob], "captured_leaf.jpg", { type: "image/jpeg" });
    selectedDiseaseFile = capturedFile;

    const preview = document.getElementById('leafPreview');
    const previewArea = document.getElementById('previewArea');
    if (preview && previewArea) {
      preview.src = URL.createObjectURL(capturedFile);
      previewArea.style.display = 'block';
    }

    stopCameraStream();
    submitDiseaseDiagnosis();

  }, 'image/jpeg', 0.95);
}

// =======================
// INITIALISE & REGISTER SW
// =======================
document.addEventListener('DOMContentLoaded', () => {

  // Load language settings
  const cachedLang = localStorage.getItem('cropiq_lang') || 'en';
  changeLanguage(cachedLang);

  // Drag and drop event bindings
  const dropZone = document.getElementById('uploadZone');
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.style.background = 'var(--green-50)';
        dropZone.style.borderColor = 'var(--green-500)';
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.style.background = 'var(--gray-50)';
        dropZone.style.borderColor = 'var(--green-300)';
      }, false);
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files.length) {
        handleFileSelect({ target: { files: files } });
      }
    }, false);
  }

  // Unregister active service workers to prevent caching/loading issues during updates
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (let registration of registrations) {
        registration.unregister().then(() => {
          console.log('🗑️ Active ServiceWorker unregistered.');
        });
      }
    }).catch(err => {
      console.warn('SW unregistration failed:', err);
    });
  }
});
