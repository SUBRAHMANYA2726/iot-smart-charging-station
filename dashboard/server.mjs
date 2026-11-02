import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
await loadEnv(path.join(ROOT, '.env'));

let firebaseDb = null;
let firebaseConfigError = false;
let lastStoredEntryId = null;
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || '';
try {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (rawServiceAccount) {
    const serviceAccount = JSON.parse(rawServiceAccount);
    const app = initializeApp({
      credential: cert(serviceAccount),
      ...(firebaseProjectId || serviceAccount.project_id
        ? { projectId: firebaseProjectId || serviceAccount.project_id }
        : {}),
    });
    firebaseDb = getFirestore(app);
  } else if (process.env.FIREBASE_USE_ADC === 'true') {
    const app = initializeApp({
      credential: applicationDefault(),
      ...(firebaseProjectId ? { projectId: firebaseProjectId } : {}),
    });
    firebaseDb = getFirestore(app);
  }
} catch {
  firebaseConfigError = true;
  console.error('Firebase configuration could not be loaded.');
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const API_BASE = (process.env.THINGSPEAK_API_BASE || 'https://api.thingspeak.com').replace(/\/$/, '');
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const TELEMETRY_CHANNEL_ID = process.env.THINGSPEAK_TELEMETRY_CHANNEL_ID || '';
const TELEMETRY_READ_KEY = process.env.THINGSPEAK_TELEMETRY_READ_API_KEY || '';
const CONTROL_CHANNEL_ID = process.env.THINGSPEAK_CONTROL_CHANNEL_ID || '';
const CONTROL_READ_KEY = process.env.THINGSPEAK_CONTROL_READ_API_KEY || '';
const CONTROL_WRITE_KEY = process.env.THINGSPEAK_CONTROL_WRITE_API_KEY || '';
const COMMAND_INTERVAL_MS = Number(process.env.THINGSPEAK_COMMAND_INTERVAL_MS || 15000);
const TELEMETRY_STALE_MS = Number(process.env.TELEMETRY_STALE_MS || 45000);
const telemetryConfigured = () => Boolean(TELEMETRY_CHANNEL_ID && TELEMETRY_READ_KEY);
const controlConfigured = () => Boolean(CONTROL_CHANNEL_ID && CONTROL_READ_KEY && CONTROL_WRITE_KEY);
const sessions = new Map();
const attempts = new Map();
let statusCache = { at: 0, value: null };
let nextCommandAt = 0;
const MAX_BODY = 4096;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function loadEnv(filename) {
  return readFile(filename, 'utf8').then((text) => {
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }).catch(() => {});
}
function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key, value]) => key && value));
}
function sessionFor(req) {
  const id = parseCookies(req.headers.cookie).station_session;
  const session = id && sessions.get(id);
  if (!session || session.expires < Date.now()) {
    if (id) sessions.delete(id);
    return null;
  }
  session.expires = Date.now() + SESSION_TTL_MS;
  return session;
}
function isSecureRequest(req) {
  return process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' || Boolean(req.socket.encrypted);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    const originValue = new URL(origin).origin;
    const allowedOrigins = (process.env.PUBLIC_APP_ORIGINS || '')
      .split(',').map((value) => value.trim()).filter(Boolean);
    if (allowedOrigins.includes(originValue)) return true;
    const expected = (isSecureRequest(req) ? 'https://' : 'http://') + req.headers.host;
    return originValue === expected;
  } catch { return false; }
}
function requireSameOrigin(req, res) {
  if (sameOrigin(req)) return true;
  json(res, 403, { error: 'Request origin was not accepted.' });
  return false;
}
function requireSession(req, res) {
  if (sessionFor(req) || (!DASHBOARD_PASSWORD && !telemetryConfigured())) return true;
  json(res, 401, { error: 'Sign in to view this private station.' });
  return false;
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new Error('Request too large');
  }
  return JSON.parse(body || '{}');
}
function secureEquals(a, b) {
  const left = createHash('sha256').update(String(a)).digest();
  const right = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(left, right);
}
async function fetchJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    const text = await response.text();
    if (!response.ok) throw new Error('ThingSpeak returned HTTP ' + response.status);
    try { return JSON.parse(text); } catch { throw new Error('ThingSpeak returned an unreadable response.'); }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('ThingSpeak Cloud request timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}
function numeric(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function mapFeed(feed) {
  return {
    entryId: numeric(feed.entry_id),
    time: feed.created_at || null,
    voltage: numeric(feed.field1),
    current: numeric(feed.field2),
    power: numeric(feed.field3),
    temperature: numeric(feed.field4),
    charging: numeric(feed.field5),
    state: numeric(feed.field6),
    outputEnabled: numeric(feed.field7) === null ? null : numeric(feed.field7) > 0,
    rssi: numeric(feed.field8),
    alert: typeof feed.status === 'string' ? feed.status : '',
  };
}
function telemetryCollection() {
  return firebaseDb?.collection('stations').doc('station-01').collection('telemetry') || null;
}
async function persistTelemetry(feeds) {
  const collection = telemetryCollection();
  if (!collection) return false;

  if (lastStoredEntryId === null) {
    const latest = await collection.orderBy('entryId', 'desc').limit(1).get();
    lastStoredEntryId = numeric(latest.docs[0]?.get('entryId')) || 0;
  }

  const pending = feeds.filter((feed) => feed.entryId && feed.entryId > lastStoredEntryId);
  for (let offset = 0; offset < pending.length; offset += 450) {
    const batch = firebaseDb.batch();
    for (const feed of pending.slice(offset, offset + 450)) {
      batch.set(collection.doc(String(feed.entryId)), feed);
    }
    await batch.commit();
  }
  if (pending.length) lastStoredEntryId = Math.max(lastStoredEntryId, ...pending.map((feed) => feed.entryId));
  return true;
}
async function readStoredTelemetry(limit = 90) {
  const collection = telemetryCollection();
  if (!collection) return [];
  const snapshot = await collection.orderBy('entryId', 'desc').limit(limit).get();
  return snapshot.docs.map((doc) => doc.data()).reverse();
}
async function readTelemetry() {
  const url = new URL('/channels/' + encodeURIComponent(TELEMETRY_CHANNEL_ID) + '/feeds.json', API_BASE);
  url.searchParams.set('api_key', TELEMETRY_READ_KEY);
  url.searchParams.set('results', '90');
  return fetchJson(url);
}
async function readControl() {
  if (!controlConfigured()) return { desiredEnabled: null, createdAt: null, entryId: null };
  const url = new URL('/channels/' + encodeURIComponent(CONTROL_CHANNEL_ID) + '/feeds/last.json', API_BASE);
  url.searchParams.set('api_key', CONTROL_READ_KEY);
  const feed = await fetchJson(url);
  return {
    desiredEnabled: numeric(feed.field1) === null ? false : numeric(feed.field1) > 0,
    createdAt: feed.created_at || null,
    entryId: numeric(feed.entry_id),
  };
}
async function getStatus(force = false) {
  if (!telemetryConfigured()) {
    return {
      configured: false, controlConfigured: controlConfigured(), online: false,
      values: {}, feeds: [], lastUpdatedAt: null, fetchedAt: new Date().toISOString(),
    };
  }
  if (!force && statusCache.value && Date.now() - statusCache.at < 2500) return statusCache.value;

  const results = await Promise.all([readTelemetry(), readControl()]);
  const telemetry = results[0];
  const control = results[1];
  const rawFeeds = Array.isArray(telemetry.feeds) ? telemetry.feeds : [];
  const feeds = rawFeeds.map(mapFeed);
  const latest = feeds.length ? feeds[feeds.length - 1] : null;
  let storageOnline = false;
  let historyFeeds = feeds;
  if (firebaseDb) {
    try {
      await persistTelemetry(feeds);
      historyFeeds = await readStoredTelemetry();
      storageOnline = true;
    } catch {
      storageOnline = false;
    }
  }
  const parsedTime = latest?.time ? new Date(latest.time).getTime() : NaN;
  const online = Number.isFinite(parsedTime) && Date.now() - parsedTime <= TELEMETRY_STALE_MS;
  const value = {
    configured: true,
    controlConfigured: controlConfigured(),
    storageConfigured: Boolean(firebaseDb) && !firebaseConfigError,
    storageOnline,
    online,
    values: latest ? {
      voltage: latest.voltage, current: latest.current, power: latest.power,
      temperature: latest.temperature, charging: latest.charging,
      state: latest.state, outputEnabled: latest.outputEnabled, rssi: latest.rssi,
    } : {},
    feeds: historyFeeds,
    alert: latest?.alert || '',
    lastUpdatedAt: latest?.time || null,
    fetchedAt: new Date().toISOString(),
    control,
  };
  statusCache = { at: Date.now(), value };
  return value;
}
async function offlineStatus() {
  let feeds = [];
  let storageOnline = false;
  if (firebaseDb) {
    try {
      feeds = await readStoredTelemetry();
      storageOnline = true;
    } catch { storageOnline = false; }
  }
  const latest = feeds.at(-1) || null;
  return {
    configured: telemetryConfigured(),
    controlConfigured: controlConfigured(),
    storageConfigured: Boolean(firebaseDb) && !firebaseConfigError,
    storageOnline,
    online: false,
    values: {},
    feeds,
    alert: latest?.alert || '',
    lastUpdatedAt: latest?.time || null,
    fetchedAt: new Date().toISOString(),
    control: null,
  };
}
async function writeControl(enabled) {
  const url = new URL('/update.json', API_BASE);
  const body = new URLSearchParams({
    api_key: CONTROL_WRITE_KEY,
    field1: enabled ? '1' : '0',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    const text = await response.text();
    if (!response.ok) throw new Error('ThingSpeak returned HTTP ' + response.status);
    let result;
    try { result = JSON.parse(text); } catch { result = numeric(text); }
    const entryId = numeric(typeof result === 'object' ? result.entry_id : result);
    if (!entryId) throw new Error('ThingSpeak did not accept the command. Check the command channel and its 15 second update interval.');
    return { entryId, createdAt: typeof result === 'object' ? result.created_at || null : null };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('ThingSpeak command timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.ico': 'image/x-icon',
};
async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filename = path.resolve(PUBLIC, '.' + requested);
  if (!filename.startsWith(PUBLIC + path.sep) && filename !== path.join(PUBLIC, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const body = await readFile(filename);
    const headers = {
      'Content-Type': mime[path.extname(filename)] || 'application/octet-stream',
      'Cache-Control': filename.endsWith('index.html') ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'self'; frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
    if (isSecureRequest(req)) headers['Strict-Transport-Security'] = 'max-age=15552000; includeSubDomains';
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, storageConfigured: Boolean(firebaseDb) && !firebaseConfigError });
    if (req.method === 'GET' && url.pathname === '/api/me') {
      const publicSetupOnly = !DASHBOARD_PASSWORD && !telemetryConfigured();
      return json(res, 200, {
        authenticated: Boolean(sessionFor(req)) || publicSetupOnly,
        passwordConfigured: Boolean(DASHBOARD_PASSWORD),
        cloudConfigured: telemetryConfigured(),
        controlConfigured: controlConfigured(),
        storageConfigured: Boolean(firebaseDb) && !firebaseConfigError,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      if (!requireSameOrigin(req, res)) return;
      if (!DASHBOARD_PASSWORD) return json(res, 503, { error: 'Set DASHBOARD_PASSWORD in the server environment before signing in.' });
      const ip = req.socket.remoteAddress || 'unknown';
      const attempt = attempts.get(ip) || { count: 0, until: 0 };
      if (attempt.until > Date.now() && attempt.count >= 8) return json(res, 429, { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
      const body = await readBody(req);
      if (!secureEquals(body.password || '', DASHBOARD_PASSWORD)) {
        const next = attempt.until > Date.now() ? attempt : { count: 0, until: Date.now() + 15 * 60 * 1000 };
        next.count++;
        attempts.set(ip, next);
        return json(res, 401, { error: 'That password did not match.' });
      }
      attempts.delete(ip);
      const id = randomBytes(32).toString('base64url');
      sessions.set(id, { expires: Date.now() + SESSION_TTL_MS });
      const cookie = 'station_session=' + id + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + (SESSION_TTL_MS / 1000) + (isSecureRequest(req) ? '; Secure' : '');
      return json(res, 200, { authenticated: true }, { 'Set-Cookie': cookie });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      if (!requireSameOrigin(req, res)) return;
      const id = parseCookies(req.headers.cookie).station_session;
      if (id) sessions.delete(id);
      return json(res, 200, { authenticated: false }, { 'Set-Cookie': 'station_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      if (!requireSession(req, res)) return;
      try { return json(res, 200, await getStatus(url.searchParams.has('refresh'))); }
      catch { return json(res, telemetryConfigured() ? 200 : 503, await offlineStatus()); }
    }
    if (req.method === 'POST' && url.pathname === '/api/control') {
      if (!requireSameOrigin(req, res) || !requireSession(req, res)) return;
      if (!controlConfigured()) return json(res, 503, { error: 'The private ThingSpeak command channel is not configured.' });
      const body = await readBody(req);
      if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'Choose Start output or Stop output.' });
      if (Date.now() < nextCommandAt) {
        const waitSeconds = Math.ceil((nextCommandAt - Date.now()) / 1000);
        return json(res, 429, { error: 'ThingSpeak command channel is rate-limited. Try again in ' + waitSeconds + ' seconds.' });
      }
      if (body.enabled) {
        let status;
        try { status = await getStatus(true); }
        catch { return json(res, 503, { error: 'Cannot start while live ThingSpeak readings are unavailable.' }); }
        const values = status.values || {};
        const safe = status.online && numeric(values.state) === 1
          && numeric(values.temperature) !== null && numeric(values.temperature) < 40
          && numeric(values.voltage) !== null && numeric(values.voltage) >= 4.5 && numeric(values.voltage) <= 5.5
          && numeric(values.current) !== null && Math.abs(numeric(values.current)) <= 1;
        if (!safe) return json(res, 409, { error: 'Start is locked. The ESP32 must report fresh normal sensor readings first.' });
      }
      try {
        const written = await writeControl(body.enabled);
        nextCommandAt = Date.now() + COMMAND_INTERVAL_MS;
        const control = { desiredEnabled: body.enabled, createdAt: written.createdAt, entryId: written.entryId };
        if (statusCache.value) statusCache.value.control = control;
        return json(res, 200, {
          accepted: true,
          requestedEnabled: body.enabled,
          commandEntryId: written.entryId,
          message: body.enabled
            ? 'Start command sent. The ESP32 will enable the output only if its local safety checks pass.'
            : 'Stop command sent to ThingSpeak. The ESP32 will switch the output off when it receives it.',
        });
      } catch (error) {
        const rateLimited = /15 second|update interval|command channel/i.test(error.message);
        return json(res, rateLimited ? 429 : 502, { error: error.message });
      }
    }
    if (req.method === 'GET' && url.pathname === '/privacy') return await serveStatic(req, res, '/privacy.html');
    if (req.method === 'GET' && url.pathname === '/terms') return await serveStatic(req, res, '/terms.html');
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown API route.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
    return await serveStatic(req, res, url.pathname);
  } catch (error) { return json(res, 400, { error: error.message || 'Request failed.' }); }
});

server.listen(PORT, HOST, () => console.log('ChargeSense dashboard listening on ' + HOST + ':' + PORT));
