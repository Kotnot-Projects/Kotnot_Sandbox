/**
 * nord-sdk.js — Kotnot edition
 * @version 2.0.1
 */
const NordCore = (() => {
  const cache = new Map();
  const now = () => performance.now();
  function memo(key, ttlMs, factory) {
    const hit = cache.get(key);
    if (hit && now() - hit.ts < ttlMs) return hit.value;
    const value = factory();
    cache.set(key, { ts: now(), value });
    return value;
  }
  function throttle(fn, ms) {
    let last = 0, timer = null;
    return (...args) => {
      const t = now();
      if (t - last >= ms) { last = t; fn(...args); }
      else { clearTimeout(timer); timer = setTimeout(() => { last = now(); fn(...args); }, ms - (t - last)); }
    };
  }
  function debounce(fn, ms) {
    let timer = null;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }
  return { memo, throttle, debounce };
})();

export class CheatDetectedError extends Error {
  constructor(reason, details = {}) {
    super(`[Nord AntiCheat] ${reason}`);
    this.name = 'CheatDetectedError';
    this.reason = reason;
    this.details = details;
  }
}

const AC_DEFAULT = {
  devtools: true, automation: true, headless: true, globals: true,
  interval: 5000, minSeverityToThrow: 3, onViolation: null, firebaseRef: null,
};

const _AC_SUSPICIOUS_GLOBALS = [
  '__selenium_unwrapped', '__webdriver_evaluate', '_Selenium_IDE_Recorder',
  '__playwright', '__puppeteer_evaluation_script__', 'callPhantom', '_phantom',
  '__nightmare', 'domAutomation', 'domAutomationController',
];

export class AntiCheat {
  constructor(config = {}) {
    this.config = { ...AC_DEFAULT, ...config };
    this.violations = [];
    this._timer = null;
    this._ua = navigator.userAgent;
    this._isChrome = /Chrome/.test(this._ua);
    this._lastEmit = new Map();
  }
  fullScan() {
    const out = [];
    if (this.config.devtools)   out.push(...this._checkDevtools());
    if (this.config.automation) out.push(...this._checkAutomation());
    if (this.config.headless)   out.push(...this._checkHeadless());
    if (this.config.globals)    out.push(...this._checkGlobals());
    if (out.length) { this.violations.push(...out); this._emit(out); }
    return out;
  }
  isClean() { return this.fullScan().length === 0; }
  _checkDevtools() {
    const out = [];
    const dw = window.outerWidth - window.innerWidth;
    const dh = window.outerHeight - window.innerHeight;
    if (dw > 160 || dh > 160) out.push({ reason: 'devtools_open', severity: 1, ts: Date.now() });
    return out;
  }
  _checkAutomation() {
    const out = [];
    if (navigator.webdriver) out.push({ reason: 'navigator.webdriver', severity: 3, ts: Date.now() });
    if (window.callPhantom || window._phantom || window.__nightmare)
      out.push({ reason: 'phantom_nightmare', severity: 3, ts: Date.now() });
    if (window.domAutomation || window.domAutomationController)
      out.push({ reason: 'chrome_automation', severity: 3, ts: Date.now() });
    if (this._isChrome && navigator.plugins.length === 0)
      out.push({ reason: 'plugins_empty', severity: 2, ts: Date.now() });
    return out;
  }
  _checkHeadless() {
    const ua = this._ua.toLowerCase();
    const out = [];
    if (ua.includes('headless') || ua.includes('phantomjs'))
      out.push({ reason: 'headless_ua', severity: 3, ts: Date.now() });
    return out;
  }
  _checkGlobals() {
    const out = [];
    for (const name of _AC_SUSPICIOUS_GLOBALS) {
      if (name in window) out.push({ reason: `global:${name}`, severity: 3, ts: Date.now() });
    }
    return out;
  }
  _emit(violations) {
    for (const v of violations) {
      const last = this._lastEmit.get(v.reason) || 0;
      if (Date.now() - last < 30000) continue;
      this._lastEmit.set(v.reason, Date.now());
      if (typeof this.config.onViolation === 'function') {
        try { this.config.onViolation(v); } catch (_) {}
      }
      if (this.config.firebaseRef) {
        try { this.config.firebaseRef.push({ type: v.reason, severity: v.severity, ts: v.ts, ua: this._ua }).catch(() => {}); } catch (_) {}
      }
    }
  }
  _tick() {
    const v = this.fullScan();
    const critical = v.find(x => x.severity >= this.config.minSeverityToThrow);
    if (critical) { this.stop(); throw new CheatDetectedError(critical.reason, critical); }
  }
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      try { this._tick(); } catch (e) {
        if (e instanceof CheatDetectedError) {
          this.stop();
          if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nord:cheat', { detail: e }));
        }
      }
    }, this.config.interval);
  }
  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
}

const CAPTCHA_MATH = () => {
  const a = 2 + Math.floor(Math.random() * 18);
  const b = 2 + Math.floor(Math.random() * 18);
  const ops = ['+', '-', '*'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let answer, question;
  if (op === '+') { answer = a + b; question = `${a} + ${b}`; }
  else if (op === '-') { answer = a - b; question = `${a} - ${b}`; }
  else { answer = a * b; question = `${a} × ${b}`; }
  return { id: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), question, answer };
};

export class Captcha {
  constructor(opts = {}) {
    this.endpoint = opts.endpoint || null;
    this.mode = opts.endpoint ? 'server' : 'local';
    this.mouseMoves = 0;
    this.keystrokes = 0;
    this.startedAt = 0;
    this.challenge = null;
    this._bind();
  }
  _bind() {
    if (typeof window === 'undefined') return;
    window.addEventListener('mousemove', () => { this.mouseMoves++; }, { passive: true });
    window.addEventListener('keydown', () => { this.keystrokes++; }, { passive: true });
  }
  async fetchChallenge(kind = 'math') {
    if (this.mode === 'local') { this.challenge = CAPTCHA_MATH(); this.startedAt = performance.now(); return this.challenge; }
    const res = await fetch(`${this.endpoint}/new?kind=${kind}`);
    if (!res.ok) throw new Error('captcha: fetch failed');
    this.challenge = await res.json();
    this.startedAt = performance.now();
    return this.challenge;
  }
  async submit(answer) {
    if (!this.challenge) throw new Error('captcha: no challenge');
    const solveTime = Math.round(performance.now() - this.startedAt);
    const meta = { mouse_moves: this.mouseMoves, keystrokes: this.keystrokes, ua: navigator.userAgent };
    if (this.mode === 'local') {
      const ok = String(answer).trim() === String(this.challenge.answer);
      const suspicious = solveTime < 400 || this.mouseMoves < 3;
      return { ok, token: ok ? 'local-' + Date.now().toString(36) : null, reason: ok ? null : 'wrong_answer', suspicious, solve_time_ms: solveTime };
    }
    const res = await fetch(`${this.endpoint}/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: this.challenge.id, answer, solve_time_ms: solveTime, meta }),
    });
    return res.json();
  }
}

const _AV_XSS = [/<script[\s>]/i, /javascript:/i, /on\w+\s*=/i, /<iframe/i, /<object/i, /<embed/i, /eval\s*\(/i, /document\.cookie/i];
const _AV_URL = [/bit\.ly/i, /tinyurl\.com/i, /[a-z0-9-]+\.tk\//i, /[a-z0-9-]+\.ml\//i];

export class Antivirus {
  constructor(opts = {}) { this.onThreat = opts.onThreat || null; this.threats = []; }
  scanString(value) {
    const found = [];
    for (const re of _AV_XSS) if (re.test(value)) found.push({ name: 'XSS.Pattern', source: String(re), severity: 2 });
    for (const re of _AV_URL) if (re.test(value)) found.push({ name: 'Suspicious.URL', source: String(re), severity: 1 });
    if (found.length) { this.threats.push(...found); if (this.onThreat) found.forEach(t => this.onThreat(t)); }
    return found;
  }
  sanitizeHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,link,style,meta').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(a => {
        if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) el.removeAttribute(a.name);
      });
    });
    return doc.body.innerHTML;
  }
  scanForm(formEl) {
    const results = [];
    formEl.querySelectorAll('input,textarea').forEach(el => { results.push(...this.scanString(el.value || '')); });
    return results;
  }
}

export class Presence {
  constructor(database, uid, firebaseNamespace = null) {
    this.db = database;
    this.uid = uid;
    this.ref = database.ref('presence/' + uid);
    this.ServerValue =
      (firebaseNamespace && firebaseNamespace.database && firebaseNamespace.database.ServerValue) ||
      (typeof firebase !== 'undefined' && firebase.database && firebase.database.ServerValue) ||
      null;
    if (!this.ServerValue) console.warn('[Presence] ServerValue недоступен');
  }
  _ts() { return this.ServerValue ? this.ServerValue.TIMESTAMP : Date.now(); }
  start() {
    this._conRef = this.db.ref('.info/connected');
    this._onValue = this._conRef.on('value', snap => {
      if (snap.val() === false) return;
      this.ref.onDisconnect().set({ online: false, lastSeen: this._ts() });
      this.ref.set({ online: true, lastSeen: this._ts() });
    });
  }
  stop() {
    if (this._conRef && this._onValue) { this._conRef.off('value', this._onValue); this._conRef = null; this._onValue = null; }
    if (this.ref) { try { this.ref.onDisconnect().cancel(); } catch (_) {} }
  }
  async get(uid) {
    const snap = await this.db.ref('presence/' + uid).once('value');
    return snap.val();
  }
}

export const VERSION = '2.0.1';
