const $ = (id) => document.getElementById(id);
const appState = {
  readings: [],
  latest: null,
  chartMetric: 'temperature',
  polling: false,
  installPrompt: null,
  toastTimer: null,
  lastCommand: null,
  commandAt: 0,
};

const metrics = {
  temperature: { key: 'temperature', label: 'Temperature', unit: '°C', digits: 1, color: '#a9593e', min: 20, max: 55 },
  voltage: { key: 'voltage', label: 'Voltage', unit: 'V', digits: 2, color: '#607b8d', min: 4.0, max: 5.8 },
  current: { key: 'current', label: 'Current', unit: 'A', digits: 3, color: '#b27643', min: 0, max: 1.2 },
  power: { key: 'power', label: 'Power', unit: 'W', digits: 2, color: '#8d7561', min: 0, max: 6 },
};
const states = ['STARTING', 'NORMAL', 'WARNING', 'FAULT', 'SENSOR ERROR'];

function setText(id, value) { $(id).textContent = value; }
function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function displayNumber(value, digits) { return typeof value === 'number' ? value.toFixed(digits) : '--'; }
function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(appState.toastTimer);
  appState.toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}
function formatTime(value, includeSeconds = true) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString([], includeSeconds
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });
}
function setConnection(kind, label, updated = '--') {
  const pill = $('connectionPill');
  pill.classList.remove('online', 'offline', 'warning', 'config-needed', 'checking');
  pill.classList.add(kind);
  setText('connectionText', label);
  setText('updatedAt', updated);
  const dot = $('sideStatusDot');
  dot.classList.remove('online', 'offline', 'warning', 'fault');
  if (kind === 'online') dot.classList.add('online');
  else if (kind === 'warning') dot.classList.add('warning');
  else if (kind === 'offline') dot.classList.add('offline');
  dot.setAttribute('aria-label', label);
}
function percent(value, low, high) {
  if (typeof value !== 'number') return 0;
  return Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
}
function setTemperature(value, previous = null) {
  const card = $('temperatureCard');
  const level = value === null ? 'unknown' : value >= 50 ? 'critical' : value >= 40 ? 'warning' : 'normal';
  card.dataset.level = level;
  setText('temperatureValue', displayNumber(value, 1));
  const caption = level === 'critical' ? 'Local cut-off threshold reached'
    : level === 'warning' ? 'Temperature warning · limit at 50°C'
      : level === 'normal' ? 'Within the configured operating range'
        : 'No sensor reading yet';
  setText('temperatureCaption', caption);
  setText('temperatureState', level === 'critical' ? 'CUT-OFF THRESHOLD'
    : level === 'warning' ? 'TEMPERATURE HIGH'
      : level === 'normal' ? 'NORMAL'
        : 'AWAITING SENSOR');
  const fill = percent(value, 20, 55);
  $('temperatureBar').style.width = fill + '%';
  $('temperatureRing').style.strokeDasharray = String(282.74);
  $('temperatureRing').style.strokeDashoffset = String(282.74 * (1 - fill / 100));
  card.classList.remove('temp-rising');
  if (value !== null && previous !== null && value > previous + 0.15) {
    void card.offsetWidth;
    card.classList.add('temp-rising');
    setTimeout(() => card.classList.remove('temp-rising'), 650);
  }
}
function clearLiveReadings() {
  setText('chargingValue', '--');
  setText('outputValue', '--');
  setText('outputCaption', 'No live confirmation');
  setText('rssiValue', '--');
  setText('rssiCaption', 'Reported by ESP32');
  setText('voltageValue', '--');
  setText('currentValue', '--');
  setText('powerValue', '--');
  $('voltageBar').style.width = '0%';
  $('currentBar').style.width = '0%';
  $('powerBar').style.width = '0%';
  setTemperature(null);
}
function stateFor(data) {
  const value = numeric(data?.values?.state);
  const label = states[Math.round(value)] || 'WAITING';
  const stateClass = label === 'FAULT' || label === 'SENSOR ERROR' ? 'fault'
    : label === 'WARNING' ? 'warning'
      : label === 'NORMAL' ? 'good' : '';
  return { value, label, stateClass };
}
function applyStatus(data) {
  const previousTemperature = numeric(appState.latest?.values?.temperature);
  appState.latest = data;
  const stationCard = document.querySelector('.station-card');
  stationCard.classList.remove('fault', 'warning', 'good');
  setText('storageStatus', !data.storageConfigured ? 'Setup required' : data.storageOnline ? 'Connected' : 'Unavailable');

  if (!data.configured) {
    setConnection('config-needed', 'ThingSpeak setup needed');
    setText('cloudUpdatedAt', 'Waiting for channel');
    setText('safetyValue', 'Cloud setup needed');
    setText('safetyCaption', 'Add the private ThingSpeak channel settings on the server.');
    setText('lastAlert', 'No readings are shown until the ESP32 writes real sensor data to your ThingSpeak channel.');
    setText('chartEmpty', 'Connect your private ThingSpeak channel to show real sensor history.');
    clearLiveReadings();
    appState.readings = [];
    drawChart();
    updateControls(data);
    return;
  }

  if (data.error) {
    setConnection('offline', 'ThingSpeak unavailable');
    setText('cloudUpdatedAt', 'Cloud read failed');
    setText('safetyValue', 'Data unavailable');
    setText('safetyCaption', data.error);
    setText('lastAlert', data.error);
    clearLiveReadings();
    updateControls(data);
    return;
  }

  appState.readings = Array.isArray(data.feeds) ? data.feeds.map((feed) => ({
    time: feed.time,
    voltage: numeric(feed.voltage),
    current: numeric(feed.current),
    power: numeric(feed.power),
    temperature: numeric(feed.temperature),
  })).filter((reading) => reading.time) : [];

  const status = stateFor(data);
  const values = data.values || {};
  const updated = formatTime(data.lastUpdatedAt, true);
  setText('cloudUpdatedAt', data.lastUpdatedAt ? formatTime(data.lastUpdatedAt, false) : 'No cloud entries');

  if (!data.online) {
    setConnection('offline', 'ESP32 offline', data.lastUpdatedAt ? 'last seen ' + updated : 'no live telemetry');
    setText('safetyValue', 'No live signal');
    setText('safetyCaption', data.cloudMessage || (data.lastUpdatedAt ? 'Latest station entry is stale; live values are hidden.' : 'Waiting for the first ESP32 update.'));
    clearLiveReadings();
    setText('lastAlert', data.alert || 'No current station message.');
    $('alertIndicator').className = 'alert-indicator';
    updateControls(data);
    drawChart();
    return;
  }

  setConnection(status.stateClass === 'fault' ? 'offline' : status.stateClass === 'warning' ? 'warning' : 'online',
    status.stateClass === 'fault' ? 'Safety cut-off' : 'ESP32 online', updated);
  setText('safetyValue', status.label === 'STARTING' ? 'Starting' : status.label.replace('SENSOR ERROR', 'Sensor error').replace('NORMAL', 'All systems normal').replace('WARNING', 'Temperature warning').replace('FAULT', 'Safety cut-off'));
  setText('safetyCaption', status.stateClass === 'good' ? 'No active safety warning' : (data.alert || 'Local safety monitor active'));
  if (status.stateClass) stationCard.classList.add(status.stateClass);

  const voltage = numeric(values.voltage);
  const current = numeric(values.current);
  const power = numeric(values.power);
  const temperature = numeric(values.temperature);
  setText('chargingValue', values.charging === null || values.charging === undefined ? '--' : values.charging ? 'Active' : 'Idle');
  setText('outputValue', values.outputEnabled === null || values.outputEnabled === undefined ? '--' : values.outputEnabled ? 'Enabled' : 'Stopped');
  setText('outputCaption', values.outputEnabled ? 'ESP32 confirms the MOSFET is on' : 'Output remains under local safety control');
  setText('rssiValue', displayNumber(numeric(values.rssi), 0));
  const rssi = numeric(values.rssi);
  setText('rssiCaption', rssi === null ? 'Signal reported by ESP32' : rssi > -60 ? 'Strong signal' : rssi > -75 ? 'Fair signal' : 'Weak signal');
  setText('voltageValue', displayNumber(voltage, 2));
  setText('currentValue', displayNumber(current, 3));
  setText('powerValue', displayNumber(power, 2));
  $('voltageBar').style.width = percent(voltage, 4.0, 5.8) + '%';
  $('currentBar').style.width = percent(Math.abs(current), 0, 1.2) + '%';
  $('powerBar').style.width = percent(power, 0, 6) + '%';
  setTemperature(temperature, previousTemperature);
  setText('lastAlert', data.alert || 'No alert reported by the ESP32.');
  $('alertIndicator').className = 'alert-indicator' + (status.stateClass === 'fault' ? ' fault' : status.stateClass === 'warning' ? ' warning' : '');
  $('lastAlert').className = 'alert-message' + (status.stateClass === 'fault' ? ' fault' : status.stateClass === 'warning' ? ' warning' : '');
  updateControls(data);
  drawChart();
}

function updateControls(data) {
  const controlConfigured = Boolean(data?.controlConfigured);
  const online = Boolean(data?.online);
  const values = data?.values || {};
  const actual = typeof values.outputEnabled === 'boolean' ? values.outputEnabled : null;
  const state = stateFor(data);
  const safeToStart = online && state.label === 'NORMAL' && numeric(values.temperature) !== null && numeric(values.temperature) < 40
    && numeric(values.voltage) !== null && numeric(values.voltage) >= 4.5 && numeric(values.voltage) <= 5.5
    && numeric(values.current) !== null && Math.abs(numeric(values.current)) <= 1;
  const pending = appState.lastCommand !== null && Date.now() - appState.commandAt < 45000
    && actual !== appState.lastCommand;
  if (actual === appState.lastCommand && appState.lastCommand !== null) appState.lastCommand = null;
  if (appState.lastCommand !== null && Date.now() - appState.commandAt >= 45000) appState.lastCommand = null;

  $('startButton').disabled = !controlConfigured || !safeToStart || actual === true || pending;
  $('stopButton').disabled = !controlConfigured || Boolean(data?.controlBusy);
  const panel = document.querySelector('.control-panel');
  panel.classList.remove('enabled', 'pending', 'fault');
  if (pending) {
    panel.classList.add('pending');
    setText('controlStateLabel', 'Command sent · waiting for station');
    setText('controlMessage', 'ThingSpeak has the command; the ESP32 applies it only after its local checks pass.');
  } else if (!data?.configured) {
    setText('controlStateLabel', 'ThingSpeak is not configured');
    setText('controlMessage', 'Connect the telemetry and command channels before controlling the output.');
  } else if (!controlConfigured) {
    setText('controlStateLabel', 'Command channel not configured');
    setText('controlMessage', 'A private ThingSpeak command channel is required for remote control.');
  } else if (!online) {
    setText('controlStateLabel', 'No live device confirmation');
    setText('controlMessage', 'Stop commands can still be queued; starting is disabled until fresh safe readings arrive.');
  } else if (state.stateClass === 'fault') {
    panel.classList.add('fault');
    setText('controlStateLabel', 'Safety lockout · reset locally');
    setText('controlMessage', 'The app cannot clear a latched fault. Restore safe readings and use the physical reset button.');
  } else if (actual === true) {
    panel.classList.add('enabled');
    setText('controlStateLabel', 'Output enabled · local cut-off active');
    setText('controlMessage', 'The ESP32 confirms the output is enabled. Temperature and current cut-offs remain local.');
  } else {
    setText('controlStateLabel', safeToStart ? 'Output stopped · ready when commanded' : 'Start waits for normal, fresh readings');
    setText('controlMessage', 'Start is available only with a fresh normal sample; stop is always available.');
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed (' + response.status + ')'), { status: response.status });
  return data;
}
function showLogin(message = '') {
  $('authOverlay').hidden = false;
  $('authError').textContent = message;
  setTimeout(() => $('passwordInput').focus(), 30);
}
function hideLogin() { $('authOverlay').hidden = true; $('authError').textContent = ''; }

async function refreshStatus(force = false) {
  if (window.location.protocol === 'file:' || appState.polling || $('authOverlay').hidden === false) return;
  appState.polling = true;
  try {
    const data = await request('/api/status' + (force ? '?refresh=1' : ''));
    applyStatus(data);
  } catch (error) {
    if (error.status === 401) { showLogin(); return; }
    setConnection('offline', 'Dashboard unavailable');
    setText('safetyValue', 'Connection error');
    setText('safetyCaption', error.message);
    setText('lastAlert', error.message);
  } finally { appState.polling = false; }
}
async function checkSession() {
  if (window.location.protocol === 'file:') {
    setConnection('config-needed', 'Server connection required');
    setText('safetyValue', 'Preview only');
    setText('safetyCaption', 'Open Start-Dashboard.bat to run the real cloud-connected app.');
    setText('lastAlert', 'This file preview has no sensor readings. Open the dashboard from its secure server.');
    setText('chartEmpty', 'No cloud history in a local file preview');
    clearLiveReadings();
    drawChart();
    return;
  }
  try {
    const me = await request('/api/me');
    if (!me.authenticated) {
      showLogin(me.passwordConfigured ? '' : 'Set DASHBOARD_PASSWORD on the server before signing in.');
      return;
    }
    hideLogin();
    if (!me.cloudConfigured) {
      applyStatus({ configured: false, controlConfigured: false, feeds: [], values: {} });
      return;
    }
    appState.account = me;
    refreshStatus(true);
  } catch (error) {
    setConnection('offline', 'Dashboard unavailable');
    setText('safetyValue', 'Server unavailable');
    setText('safetyCaption', error.message);
  }
}

function formatAxisTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function drawChart() {
  const canvas = $('historyChart');
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(box.width * ratio);
  canvas.height = Math.round(box.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = box.width;
  const height = box.height;
  const pad = { top: 12, right: 13, bottom: 10, left: 40 };
  const config = metrics[appState.chartMetric];
  const valid = appState.readings
    .map((reading) => ({ time: reading.time, value: numeric(reading[config.key]) }))
    .filter((point) => point.value !== null && !Number.isNaN(new Date(point.time).getTime()));
  $('chartEmpty').hidden = valid.length > 0;
  setText('chartUnit', config.unit);
  setText('chartLatest', valid.length ? valid[valid.length - 1].value.toFixed(config.digits) : '--');
  setText('chartStart', valid.length ? formatAxisTime(valid[0].time) : '--');
  setText('chartEnd', valid.length ? formatAxisTime(valid[valid.length - 1].time) : '--');
  ctx.clearRect(0, 0, width, height);

  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const low = Math.min(config.min, ...valid.map((point) => point.value));
  const high = Math.max(config.max, ...valid.map((point) => point.value));
  const range = high - low || 1;
  ctx.lineWidth = 1;
  ctx.font = '9px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const fraction = i / 4;
    const y = pad.top + plotHeight * fraction;
    const value = high - (high - low) * fraction;
    ctx.beginPath();
    ctx.setLineDash(i === 0 || i === 4 ? [] : [2, 5]);
    ctx.strokeStyle = i === 0 || i === 4 ? '#e4e0d8' : '#e9e5dd';
    ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#98938a';
    ctx.fillText(value.toFixed(config.digits), pad.left - 8, y);
  }

  if (appState.chartMetric === 'temperature') {
    for (const threshold of [{ value: 40, label: '40° warning', color: '#c18a4d' }, { value: 50, label: '50° cut-off', color: '#b36656' }]) {
      const y = pad.top + plotHeight - ((threshold.value - low) / range) * plotHeight;
      if (y < pad.top || y > height - pad.bottom) continue;
      ctx.beginPath(); ctx.setLineDash([4, 5]); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y);
      ctx.strokeStyle = threshold.color; ctx.globalAlpha = .48; ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
      ctx.fillStyle = threshold.color; ctx.font = '9px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
      ctx.textAlign = 'right'; ctx.fillText(threshold.label, width - pad.right - 2, Math.max(10, y - 4));
    }
  }
  if (!valid.length) return;
  const points = valid.map((point, index) => ({
    x: pad.left + (valid.length === 1 ? plotWidth / 2 : plotWidth * index / (valid.length - 1)),
    y: pad.top + plotHeight - ((point.value - low) / range) * plotHeight,
  }));
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = config.color; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(points[0].x, height - pad.bottom);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, height - pad.bottom); ctx.closePath();
  const fill = ctx.createLinearGradient(0, pad.top, 0, height);
  fill.addColorStop(0, config.color + '28'); fill.addColorStop(1, config.color + '00');
  ctx.fillStyle = fill; ctx.fill();
  const last = points[points.length - 1];
  ctx.beginPath(); ctx.arc(last.x, last.y, 3.2, 0, Math.PI * 2); ctx.fillStyle = config.color; ctx.fill();
  ctx.beginPath(); ctx.arc(last.x, last.y, 6, 0, Math.PI * 2); ctx.strokeStyle = config.color; ctx.globalAlpha = .24; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
}

async function sendControl(enabled) {
  const start = $('startButton');
  const stop = $('stopButton');
  start.disabled = true;
  stop.disabled = true;
  const message = enabled ? 'Sending start request…' : 'Sending stop request…';
  setText('controlStateLabel', message);
  try {
    const result = await request('/api/control', { method: 'POST', body: JSON.stringify({ enabled }) });
    appState.lastCommand = enabled;
    appState.commandAt = Date.now();
    setText('controlMessage', result.message || 'The ESP32 will apply the command after checking local sensor readings.');
    showToast(result.message || 'Command sent to ThingSpeak');
    refreshStatus(true);
  } catch (error) {
    setText('controlStateLabel', 'Command not accepted');
    setText('controlMessage', error.message);
    showToast(error.message);
    if (error.status === 401) showLogin();
  } finally {
    if (appState.latest) updateControls(appState.latest);
    else { start.disabled = false; stop.disabled = false; }
  }
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('authError').textContent = '';
  const button = $('loginForm').querySelector('button');
  button.disabled = true;
  button.innerHTML = 'Signing in…';
  try {
    await request('/api/login', { method: 'POST', body: JSON.stringify({ password: $('passwordInput').value }) });
    $('passwordInput').value = '';
    $('signOutButton').hidden = false;
    hideLogin();
    showToast('Signed in securely');
    refreshStatus(true);
  } catch (error) { $('authError').textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = 'Continue <span aria-hidden="true">→</span>'; }
});
$('refreshButton').addEventListener('click', () => refreshStatus(true));
$('startButton').addEventListener('click', () => sendControl(true));
$('stopButton').addEventListener('click', () => sendControl(false));
document.querySelectorAll('[data-metric]').forEach((button) => {
  button.addEventListener('click', () => {
    appState.chartMetric = button.dataset.metric;
    document.querySelectorAll('[data-metric]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    drawChart();
  });
});
$('signOutButton').addEventListener('click', async () => {
  try { await request('/api/logout', { method: 'POST' }); } catch {}
  $('signOutButton').hidden = true;
  showLogin('You are signed out.');
});
window.addEventListener('resize', drawChart);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  appState.installPrompt = event;
  $('installButton').hidden = false;
});
$('installButton').addEventListener('click', async () => {
  if (!appState.installPrompt) {
    showToast('In Android Chrome, open the menu and choose Install app.');
    return;
  }
  appState.installPrompt.prompt();
  await appState.installPrompt.userChoice;
  appState.installPrompt = null;
  $('installButton').hidden = true;
});
if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
checkSession();
setInterval(() => refreshStatus(false), 3500);
