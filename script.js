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

  advisory.advice.forEach(item => {
    const card = document.createElement('div');
    
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
        <span style="font-size:0.68rem; font-weight:800; padding:3px 9px; border-radius:100px; background:${badgeBg}; color:${badgeColor}; letter-spacing:0.04em;">${statusText}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
        <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--gray-500); font-weight:600;">
          <span>${actualText}</span>
          <span>${targetText}</span>
        </div>
        <div style="height:6px; background:var(--gray-100); border-radius:100px; overflow:hidden; position:relative;">
          <div style="width: ${item.status === 'optimal' ? '100%' : '65%'}; height: 100%; background:${item.status === 'optimal' ? '#22c55e' : '#f59e0b'}; opacity: 0.8; border-radius:100px;"></div>
        </div>
      </div>
      <p style="font-size:0.83rem; color:var(--gray-600); line-height:1.5; margin:0; font-weight:500;">${item.message}</p>
    `;

    grid.appendChild(card);
  });
}

// =======================
// 🗺️ INDIA WATERMARK MAP & STATE CULTURE lookup
// =======================
const STATE_CULTURES = {
  "punjab": {
    "dance": "Bhangra & Gidha",
    "festival": "Lohri & Baisakhi",
    "art": "Phulkari Embroidery",
    "icon": "Golden Temple & Wheat Fields"
  },
  "rajasthan": {
    "dance": "Ghoomar & Kalbelia",
    "festival": "Gangaur & Teej",
    "art": "Kathputli (Puppetry) & Bandhani",
    "icon": "Palaces, Forts & Thar Desert"
  },
  "maharashtra": {
    "dance": "Lavani & Koli",
    "festival": "Ganesh Utsav & Gudi Padwa",
    "art": "Warli Painting & Paithani Weaving",
    "icon": "Shivaji Maharaj Forts & Gateway of India"
  },
  "uttar pradesh": {
    "dance": "Kathak & Charkula",
    "festival": "Deepawali & Braj Holi",
    "art": "Chikankari Embroidery & Brassware",
    "icon": "Taj Mahal & Varanasi Ghats"
  },
  "gujarat": {
    "dance": "Garba & Dandiya Raas",
    "festival": "Uttarayan (Kite Festival) & Navratri",
    "art": "Patola Weaving & Lipan Kaam",
    "icon": "Sabarmati Ashram & Statue of Unity"
  },
  "west bengal": {
    "dance": "Chhau & Kushan",
    "festival": "Durga Puja & Poila Boishakh",
    "art": "Alpana Art & Kantha Embroidery",
    "icon": "Victoria Memorial & Howrah Bridge"
  },
  "tamil nadu": {
    "dance": "Bharatanatyam & Karakattam",
    "festival": "Pongal & Puthandu",
    "art": "Tanjore Paintings & Kanchipuram Silk",
    "icon": "Dravidian Temples & Marina Beach"
  },
  "kerala": {
    "dance": "Kathakali & Mohiniyattam",
    "festival": "Onam & Vishu",
    "art": "Kalaripayattu & Mural Paintings",
    "icon": "Backwaters, Houseboats & Kathakali Masks"
  },
  "assam": {
    "dance": "Bihu & Sattriya",
    "festival": "Rongali Bihu & Ambubachi Mela",
    "art": "Muga Silk & Cane Crafts",
    "icon": "Kaziranga (One-horned Rhino) & Tea Gardens"
  },
  "jammu & kashmir": {
    "dance": "Rouf & Kud",
    "festival": "Navreh & Tulip Festival",
    "art": "Pashmina Weaving & Paper Mache",
    "icon": "Dal Lake Shikaras & snow capped peaks"
  },
  "jammu and kashmir": {
    "dance": "Rouf & Kud",
    "festival": "Navreh & Tulip Festival",
    "art": "Pashmina Weaving & Paper Mache",
    "icon": "Dal Lake Shikaras & snow capped peaks"
  },
  "madhya pradesh": {
    "dance": "Matki & Grida",
    "festival": "Lokranjan & Khajuraho Dance Festival",
    "art": "Gond & Chanderi Art",
    "icon": "Sanchi Stupa & Khajuraho Temples"
  },
  "odisha": {
    "dance": "Odissi & Ghumura",
    "festival": "Ratha Yatra & Raja Parba",
    "art": "Pattachitra Paintings & Filigree Work",
    "icon": "Jagannath Temple & Konark Sun Temple"
  },
  "bihar": {
    "dance": "Jat-Jatin & Bideshiya",
    "festival": "Chhath Puja & Sama Chakeva",
    "art": "Madhubani Painting & Sikki Grass Craft",
    "icon": "Mahabodhi Temple (Bodh Gaya)"
  },
  "karnataka": {
    "dance": "Yakshagana & Dollu Kunitha",
    "festival": "Mysore Dasara & Ugadi",
    "art": "Channapatna Toys & Sandalwood Carving",
    "icon": "Hampi Ruins & Mysore Palace"
  },
  "andhra pradesh": {
    "dance": "Kuchipudi & Vilasini Natyam",
    "festival": "Ugadi & Tirupati Brahmotsavam",
    "art": "Kalamkari Painting & Kondapalli Toys",
    "icon": "Tirumala Venkateswara Temple"
  },
  "telangana": {
    "dance": "Perini Sivatandavam",
    "festival": "Bathukamma & Bonalu",
    "art": "Bidriware & Pochampally Ikat",
    "icon": "Charminar & Kakatiya Kala Thoranam"
  },
  "himachal pradesh": {
    "dance": "Nati & Dangi",
    "festival": "Kullu Dussehra & Minjar",
    "art": "Chamba Rumal & Pahari Paintings",
    "icon": "Himalayan Apples & Kalka-Shimla Toy Train"
  },
  "haryana": {
    "dance": "Saang & Phag",
    "festival": "Surajkund Crafts Mela & Teej",
    "art": "Dhurrie Weaving & Clay Pottery",
    "icon": "Kurukshetra Heritage Sites"
  },
  "chhattisgarh": {
    "dance": "Panthi & Raut Nacha",
    "festival": "Bastar Dussehra & Hareli",
    "art": "Dokra Metal Craft",
    "icon": "Chitrakote Waterfalls"
  },
  "jharkhand": {
    "dance": "Jhumar & Paika",
    "festival": "Sarhul & Karam",
    "art": "Sohrai and Khovar Paintings",
    "icon": "Baidyanath Temple"
  },
  "uttarakhand": {
    "dance": "Choliya & Jhora",
    "festival": "Ganga Dussehra & Phool Dei",
    "art": "Aipan Ritual Art",
    "icon": "Kedarnath Temple & Valley of Flowers"
  },
  "goa": {
    "dance": "Fugdi & Dekhni",
    "festival": "Goa Carnival & Shigmo",
    "art": "Coconut Shell Carvings",
    "icon": "Colonial Churches & Beaches"
  }
};

async function initIndiaMap() {
  const container = document.getElementById('indiaMapContainer');
  const tooltip = document.getElementById('cultureTooltip');
  if (!container || !tooltip) return;

  try {
    // Fetch optimized SVG map of India
    const response = await fetch('https://cdn.jsdelivr.net/npm/@svg-maps/india@1.0.1/india.svg');
    if (!response.ok) throw new Error("Failed to load map data");

    const svgText = await response.text();
    container.innerHTML = svgText;

    const svgElement = container.querySelector('svg');
    if (!svgElement) return;

    svgElement.removeAttribute('width');
    svgElement.removeAttribute('height');

    const paths = container.querySelectorAll('path');
    paths.forEach(path => {
      path.addEventListener('mouseenter', () => {
        const stateName = path.getAttribute('name') || '';
        const stateKey = stateName.toLowerCase().trim();
        const info = STATE_CULTURES[stateKey];

        tooltip.style.display = 'block';
        if (info) {
          tooltip.innerHTML = `
            <h4>🎉 ${stateName}</h4>
            <p><strong>Traditional Dance:</strong> ${info.dance}</p>
            <p><strong>Key Festival:</strong> ${info.festival}</p>
            <p><strong>Art & Craft:</strong> ${info.art}</p>
            <p><strong>Iconic Landmark:</strong> ${info.icon}</p>
          `;
        } else {
          tooltip.innerHTML = `<h4>🎉 ${stateName}</h4><p>Cultural heritage loaded.</p>`;
        }
      });

      path.addEventListener('mousemove', (e) => {
        const offset = 18;
        tooltip.style.left = (e.pageX + offset) + 'px';
        tooltip.style.top = (e.pageY + offset) + 'px';
      });

      path.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });
    });

  } catch (err) {
    console.warn("India Map loading bypassed:", err);
    container.style.display = 'none';
  }
}

// Initialise on load
document.addEventListener('DOMContentLoaded', () => {
  initIndiaMap();
});
