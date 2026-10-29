// Saxlan backend (Google Apps Script web app).
// The site itself is static (GitHub Pages); the page talks to this script with fetch: POST, Content-Type text/plain,
// body {fn, args}. doPost runs only the functions listed in RPC_ below and answers JSON {ok:true, result} or
// {ok:false, error}. No triggers, no background work.
//
// Scopes (appsscript.json, checked by push.sh): spreadsheets (all stored data) and script.external_request (a user's
// Schoology iCal import). The web app runs as the owner for anyone, so visitors never see a Google permission screen.
// The owner runs setup() once from the Apps Script editor: that grants the two scopes and creates the storage sheet.
//
// Storage is one Google Sheet owned by the script owner, created by setup() (its id is the Script Property sheetId).
// One sheet per kind, one row per record: [key, updated ms, chunk count, chunk 1, chunk 2, ...]; each chunk holds up
// to 45,000 characters (a cell holds 50,000) and every key and chunk is written with a one-letter prefix so Sheets
// never reads a value as a number, date or formula.
//   users  account name -> {s salt, h hash, i iterations, a scheme, c created, k [[sha256(token secret), created], ...], roles}
//   data   account name -> planner data, gzip + base64
//   cls    account name -> the account's class names (for the public library)
//   res    resource id  -> a resource someone wrote or imported (documents, links)
//   files  file id      -> an uploaded PDF {owner, name, b64}
//   games  key          -> game progress (per account or per guest code)
//   meta   (reserved)
//   social account name -> friends, friend requests, last message and read times (shared.js SX.social)
//   chat   "a|b"        -> one conversation's latest messages
//   sugg   id           -> a suggestion or bug report
// Script Properties keep only small settings: sheetId, owner, pepper.
// The first account signed up after setup() is the owner (administrator).

const PROPS = PropertiesService.getScriptProperties();
const CELL = 45000;
const PER_USER_MAX = 524288; // compressed characters per account (512 KB)
const KINDS = ['users', 'data', 'cls', 'res', 'files', 'games', 'meta', 'social', 'chat', 'sugg'];
const blank_ = () => ({ tasks: {}, removed: {}, advisory: {}, events: {}, calcmap: {},
  settings: { colors: {}, periods: {}, advisoryCourse: '', courses: [], ical: '' } });
function withDefaults_(raw) {
  const d = Object.assign(blank_(), raw || {});
  d.settings = Object.assign(blank_().settings, d.settings || {});
  return d;
}

// HtmlService processes .html files (it strips comments and can cut text after '//'), so the dictionary files are
// stored base64-encoded and decoded here.
function fileText_(name) {
  return Utilities.newBlob(Utilities.base64Decode(HtmlService.createHtmlOutputFromFile(name).getContent().trim())).getDataAsString('UTF-8');
}

// ---------- the sheet store ----------
let SS_ = null, IDX_ = {}, VAL_ = {}, COLS_ = {};
function resetCache_() { IDX_ = {}; VAL_ = {}; COLS_ = {}; }
function book_() {
  if (SS_) return SS_;
  const id = PROPS.getProperty('sheetId');
  if (!id) throw new Error('setup');
  SS_ = SpreadsheetApp.openById(id);
  return SS_;
}
const SHEETS_ = {};
function sheet_(kind) { if (!SHEETS_[kind]) { const b = book_(); SHEETS_[kind] = b.getSheetByName(kind) || b.insertSheet(kind); } return SHEETS_[kind]; }
const width_ = kind => COLS_[kind] || (COLS_[kind] = Math.max(3, sheet_(kind).getLastColumn()));
// key -> row number for one kind (read once per request)
function index_(kind) {
  if (IDX_[kind]) return IDX_[kind];
  const sh = sheet_(kind), last = sh.getLastRow(), idx = {};
  if (last) sh.getRange(1, 1, last, 1).getValues().forEach((r, i) => { const k = String(r[0]); if (k) idx[k.slice(1)] = i + 1; });
  IDX_[kind] = idx;
  return idx;
}
const joinRow_ = row => { const n = Number(row[2]) || 0; let s = ''; for (let i = 0; i < n; i++) s += String(row[3 + i] || '').slice(1); return s; };
function get_(kind, key) {
  const ck = kind + '\u0001' + key;
  if (Object.prototype.hasOwnProperty.call(VAL_, ck)) return VAL_[ck];
  const row = index_(kind)[key];
  let v = null;
  if (row) v = joinRow_(sheet_(kind).getRange(row, 1, 1, width_(kind)).getValues()[0]);
  VAL_[ck] = v;
  return v;
}
// every record of a kind in one read: {key: value}
function all_(kind) {
  const sh = sheet_(kind), last = sh.getLastRow(), out = {};
  if (!last) return out;
  sh.getRange(1, 1, last, width_(kind)).getValues().forEach(r => { const k = String(r[0]); if (k) out[k.slice(1)] = joinRow_(r); });
  return out;
}
// writes go through withLock_ (callers hold the script lock)
function put_(kind, key, value) {
  value = String(value);
  const sh = sheet_(kind), idx = index_(kind), chunks = [];
  for (let i = 0; i < value.length || !i; i += CELL) chunks.push('x' + value.slice(i, i + CELL));
  const width = 3 + chunks.length;
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  let row = idx[key];
  const last = width_(kind), existed = !!row;
  if (!row) { row = sh.getLastRow() + 1; idx[key] = row; }
  sh.getRange(row, 1, 1, width).setValues([['k' + key, Date.now(), chunks.length].concat(chunks)]);
  if (existed && last > width) sh.getRange(row, width + 1, 1, last - width).clearContent();
  if (width > last) COLS_[kind] = width;
  VAL_[kind + '\u0001' + key] = value;
}
function del_(kind, key) {
  const row = index_(kind)[key];
  if (row) sheet_(kind).deleteRow(row);
  delete IDX_[kind];
  delete VAL_[kind + '\u0001' + key];
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  resetCache_(); // another request may have written since this one read
  try { return fn(); } finally { if (SS_) SpreadsheetApp.flush(); lock.releaseLock(); }
}
// every rpc that touches storage first makes sure setup() has run (a clear 'setup' error otherwise)
function ensureStore_() { book_(); }

// ---------- one-time setup: run from the Apps Script editor (Run > setup) ----------
// Grants the two scopes (Google asks the owner once), creates the storage sheet, and checks that every part works.
function setup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let id = PROPS.getProperty('sheetId');
    if (id) { try { SpreadsheetApp.openById(id); } catch (e) { id = ''; } }
    if (!id) {
      const ss = SpreadsheetApp.create('Saxlan storage');
      KINDS.forEach(k => ss.insertSheet(k));
      ss.getSheets().forEach(s => { if (KINDS.indexOf(s.getName()) < 0) ss.deleteSheet(s); });
      PROPS.setProperty('sheetId', ss.getId());
    }
    SS_ = null; resetCache_();
    KINDS.forEach(k => sheet_(k));
    pepper_();
  } finally { lock.releaseLock(); }
  // the iCal import fetches calendars from outside: this asks for (and checks) that permission too
  const fetchCode = UrlFetchApp.fetch('https:' + '/' + '/www.google.com/generate_204', { muteHttpExceptions: true }).getResponseCode();
  const report = storageReport();
  report.fetch = fetchCode;
  report.owner = PROPS.getProperty('owner') || '(the next account to sign up)';
  report.dictionary = hasWord_('planner') && hasWord_('school') ? 'ok' : 'missing';
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
// run from the script editor: storage used per kind and per account
function storageReport() {
  ensureStore_();
  const out = { sheet: 'https:' + '/' + '/docs.google.com/spreadsheets/d/' + PROPS.getProperty('sheetId'), kinds: {}, accounts: {} };
  KINDS.forEach(k => { const a = all_(k); out.kinds[k] = { records: Object.keys(a).length, chars: Object.keys(a).reduce((n, x) => n + a[x].length, 0) }; });
  const data = all_('data'); Object.keys(data).forEach(n => { out.accounts[n] = data[n].length; });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// ---------- per-account data: gzip + base64 in the data sheet ----------
function pack_(d) { return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(d), 'application/json')).getBytes()); }
function unpack_(s) { return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(s), 'application/x-gzip')).getDataAsString('UTF-8')); }
function loadUser_(name) {
  let d = null;
  const s = get_('data', name);
  // a stored record that can't be read must never become an empty account (a save would overwrite it)
  if (s) { try { d = unpack_(s); } catch (e) { throw new Error('account data unreadable'); } }
  d = withDefaults_(d);
  SX.keyCourses(d.settings.courses);
  return d;
}
function saveUser_(name, d) {
  const s = pack_(d);
  if (s.length > PER_USER_MAX) throw new Error('too big');
  const prev = get_('cls', name), cls = JSON.stringify((d.settings.courses || []).map(c => c.name));
  put_('data', name, s);
  if (prev !== cls) put_('cls', name, cls);
  return s.length;
}
function mutate_(name, fn) {
  return withLock_(() => { const d = loadUser_(name); const out = fn(d); saveUser_(name, d); return out || { ok: true }; });
}

// ---------- accounts ----------
// Passwords: HMAC-SHA256 keyed with a server-side pepper (Script Property) over a 32-byte per-user salt and the
// password, stretched 64 rounds. Session tokens are 32 random bytes; only their SHA-256 is stored, and a verified token
// is cached for 10 minutes so ordinary calls skip the sheet read.
const NAME_RE = /^[a-z0-9_.-]{3,24}$/;
const ITER2 = 64;
const SIGNUPS_PER_HOUR = 30;
const normName_ = n => String(n || '').trim().toLowerCase();
const bytes_ = s => Utilities.newBlob(String(s)).getBytes();
const hex_ = b => b.map(x => ('0' + (x & 255).toString(16)).slice(-2)).join('');
const unhex_ = h => (String(h).match(/../g) || []).map(x => { const v = parseInt(x, 16); return v > 127 ? v - 256 : v; });
const sha_ = b => Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b);
function random_(n) {
  let out = [];
  while (out.length < n) out = out.concat(sha_(bytes_(Utilities.getUuid() + Utilities.getUuid() + Date.now() + Math.random())));
  return out.slice(0, n);
}
function pepper_() {
  let p = PROPS.getProperty('pepper');
  if (!p) { p = hex_(random_(32)); PROPS.setProperty('pepper', p); }
  return unhex_(p);
}
// h0 = HMAC(pepper, salt|pw), h(i) = HMAC(pepper, h(i-1)|salt)
function hashPw2_(pw, saltHex, iter) {
  const key = pepper_(), salt = unhex_(saltHex);
  let h = Utilities.computeHmacSha256Signature(salt.concat(bytes_(pw)), key);
  for (let i = 1; i < iter; i++) h = Utilities.computeHmacSha256Signature(h.concat(salt), key);
  return hex_(h);
}
const checkPw_ = (pw, rec) => hashPw2_(pw, rec.s, rec.i || ITER2) === rec.h;
function newPwRec_(pw, rec) {
  const salt = hex_(random_(32));
  return Object.assign(rec || {}, { s: salt, i: ITER2, a: 2, h: hashPw2_(pw, salt, ITER2) });
}
const rec_ = name => { const v = get_('users', name); return v ? JSON.parse(v) : null; };
const isOwner_ = name => !!name && PROPS.getProperty('owner') === name;
function session_(name, rec) {
  const secret = hex_(random_(32)), h = hex_(sha_(bytes_(secret)));
  rec.k = (rec.k || []).concat([[h, Date.now()]]).slice(-20);
  put_('users', name, JSON.stringify(rec));
  CacheService.getScriptCache().put('sess_' + h, name, 600);
  return name + ':' + secret;
}
// every data call carries the session token; it names the account and is checked against the stored hash
function auth_(token) {
  ensureStore_();
  const m = /^([a-z0-9_.-]{3,24}):([0-9a-f]{64})$/.exec(String(token || ''));
  if (!m) throw new Error('auth');
  const h = hex_(sha_(bytes_(m[2]))), cache = CacheService.getScriptCache();
  if (cache.get('sess_' + h) === m[1]) return m[1];
  const rec = rec_(m[1]);
  if (!rec || !(rec.k || []).some(s => s[0] === h)) throw new Error('auth');
  cache.put('sess_' + h, m[1], 600);
  return m[1];
}
// the account's data rides along with a successful log in or sign up, so the page needs no second call
function withData_(name, out) {
  try { const d = loadUser_(name); d.user = out.user; out.data = d; } catch (e) {}
  return out;
}
function rpcSignup(name, pw) {
  ensureStore_();
  name = normName_(name); pw = typeof pw === 'string' ? pw : '';
  if (!name || !pw) return { error: 'empty' };
  if (!NAME_RE.test(name)) return { error: 'name' };
  if (pw.length < 6) return { error: 'short' };
  if (pw.length > 200) return { error: 'long' };
  const out = withLock_(() => {
    if (rec_(name)) return { error: 'taken' };
    // global sign-up rate limit: at most SIGNUPS_PER_HOUR new accounts per clock hour
    const cache = CacheService.getScriptCache(), hk = 'signups_' + Math.floor(Date.now() / 3600000);
    const made = Number(cache.get(hk) || 0);
    if (made >= SIGNUPS_PER_HOUR) return { error: 'busy' };
    cache.put(hk, String(made + 1), 3700);
    // the first account is the owner (administrator)
    if (!PROPS.getProperty('owner')) PROPS.setProperty('owner', name);
    const rec = newPwRec_(pw, { c: Date.now(), k: [] });
    saveUser_(name, blank_());
    const token = session_(name, rec);
    return { token: token, user: userOut_(name) };
  });
  return out.token ? withData_(name, out) : out;
}
function rpcLogin(name, pw, seq) {
  ensureStore_();
  name = normName_(name); pw = typeof pw === 'string' ? pw : '';
  if (!name || !pw) return { error: 'empty' };
  const rec = NAME_RE.test(name) && pw.length <= 200 ? rec_(name) : null;
  if (!rec) return { error: 'nouser' };
  // a wrong password only slows that one attempt down; no lockout, so nobody can lock someone else out
  if (!pwOk_(pw, rec)) { Utilities.sleep(1500); return { error: 'wrong' }; }
  const out = withLock_(() => {
    const r = rec_(name);
    const tf = tfaCheck_(r, seq); if (tf) { put_('users', name, JSON.stringify(r)); return tf; }
    if (!r.tfa && r.pic && r.pic.n) r.pic.n = 0; // the right password unlocks the picture password
    return { token: session_(name, r), user: userOut_(name) };
  });
  return out.token ? withData_(name, out) : out;
}
// ---------- passwords: after a change the old password keeps working for 3 days; security notices (password
// reset or changed, picture password, two-step login) are kept on the account for its Security page
const PW_OLD_MS_ = 3 * 864e5;
const pwOk_ = (pw, r) => checkPw_(pw, r) || !!(r.old && r.old.until > Date.now() && checkPw_(pw, r.old));
function pwSet_(r, pw) { r.old = { s: r.s, i: r.i, a: r.a, h: r.h, until: Date.now() + PW_OLD_MS_ }; newPwRec_(pw, r); }
const secNote_ = (r, m) => { r.sec = (r.sec || []).concat([[Date.now(), String(m).slice(0, 200)]]).slice(-30); };
// two-step login: an account with it on also picks its picture password at every login. 6 wrong pictures lock
// logins for an hour. Returns null when the login may go ahead, otherwise what to tell the page.
function tfaCheck_(r, seq) {
  if (!r.tfa || !r.pic || !r.pic.h) return null;
  const p = r.pic;
  if ((p.n || 0) >= PIC_TRIES_) { if (Date.now() - (p.lk || 0) < 3600000) return { error: 'tfalocked' }; p.n = 0; }
  if (seq === undefined || seq === null) return { error: 'need2fa' };
  const q = picSeq_(seq);
  if (q && picHash_(q, p.s) === p.h) { p.n = 0; return null; }
  p.n = (p.n || 0) + 1;
  if (p.n >= PIC_TRIES_) { p.lk = Date.now(); secNote_(r, 'Logins locked for an hour after 6 wrong picture passwords'); return { error: 'tfalocked' }; }
  return { error: 'tfawrong', left: PIC_TRIES_ - p.n };
}
function rpcPwChange(k, cur, next) {
  const me = auth_(k); cur = typeof cur === 'string' ? cur : ''; next = typeof next === 'string' ? next : '';
  if (next.length < 6) return { error: 'short' };
  if (next.length > 200) return { error: 'long' };
  if (!checkPw_(cur, rec_(me))) { Utilities.sleep(1500); return { error: 'wrongcur' }; }
  return withLock_(() => { const r = rec_(me); pwSet_(r, next); secNote_(r, 'Password changed. The old one still works for 3 days.'); put_('users', me, JSON.stringify(r)); return { ok: true }; });
}
function rpcTfa(k, on) {
  const me = auth_(k);
  return withLock_(() => {
    const r = rec_(me);
    if (on && !(r.pic && r.pic.h)) return { error: 'nopic' };
    if (!!r.tfa !== !!on) { r.tfa = !!on; secNote_(r, on ? 'Two-step login turned on' : 'Two-step login turned off'); put_('users', me, JSON.stringify(r)); }
    return { ok: true, tfa: !!r.tfa };
  });
}
function rpcSecurity(k) {
  const me = auth_(k), r = rec_(me), d = loadUser_(me);
  return { ok: true, pic: !!(r.pic && r.pic.h), tfa: !!r.tfa, picLocked: !!(r.pic && (r.pic.n || 0) >= PIC_TRIES_), ical: !!(d.settings && d.settings.ical),
    notices: (r.sec || []).slice().reverse() };
}
// ---------- forgot password: an account proves it is its own with its Schoology calendar link plus one assignment
// from that calendar (spelling and capitals exact), or with its picture password (3 of 12 pictures in order; 6 wrong
// tries lock the pictures until the account logs in with its password again). Either gives a one-time ticket, good
// for 15 minutes, that sets a new password and signs the account out everywhere.
const PIC_N_ = 12, PIC_TRIES_ = 6;
const picSeq_ = a => Array.isArray(a) && a.length === 3 && a.every(x => x === Math.floor(x) && x >= 0 && x < PIC_N_) && a[0] !== a[1] && a[1] !== a[2] && a[0] !== a[2] ? a.slice() : null;
const picHash_ = (seq, salt) => hex_(sha_(unhex_(salt).concat(bytes_('pic|' + seq.join(',')))));
const icalNorm_ = u => String(u || '').trim().replace(/^webcal:/i, 'https:').replace(/\/+$/, '').toLowerCase();
function rpcPicSet(k, seq) {
  const me = auth_(k);
  return withLock_(() => {
    const r = rec_(me);
    if (seq === null) { if (r.pic) secNote_(r, 'Picture password turned off' + (r.tfa ? ', and two-step login with it' : '')); delete r.pic; delete r.tfa; }
    else { const q = picSeq_(seq); if (!q) return { error: 'pic' }; secNote_(r, r.pic ? 'Picture password changed' : 'Picture password set'); const salt = hex_(random_(16)); r.pic = { s: salt, h: picHash_(q, salt), n: 0 }; }
    put_('users', me, JSON.stringify(r));
    return { ok: true, pic: !!r.pic };
  });
}
function rpcPwInfo(name) {
  ensureStore_();
  name = normName_(name);
  const r = name && NAME_RE.test(name) ? rec_(name) : null;
  if (!r) return { error: 'nouser' };
  let school = false; try { const d = loadUser_(name); school = !!(d.settings && d.settings.ical); } catch (e) {}
  return { ok: true, school: school, pic: !!(r.pic && r.pic.h), picLocked: !!(r.pic && (r.pic.n || 0) >= PIC_TRIES_) };
}
function pwTicket_(name, r, how) {
  const t = hex_(random_(24));
  r.rt = [hex_(sha_(bytes_(t))), Date.now() + 15 * 60000, how];
  put_('users', name, JSON.stringify(r));
  return t;
}
function rpcPwCheck(name, how, a, b) {
  ensureStore_();
  name = normName_(name);
  if (!name || !NAME_RE.test(name) || !rec_(name)) return { error: 'nouser' };
  if (how === 'pic') return withLock_(() => {
    const r = rec_(name), p = r.pic;
    if (!p || !p.h) return { error: 'nopic' };
    if ((p.n || 0) >= PIC_TRIES_) return { error: 'piclocked' };
    const q = picSeq_(a);
    if (!q || picHash_(q, p.s) !== p.h) {
      p.n = (p.n || 0) + 1; put_('users', name, JSON.stringify(r));
      return { error: p.n >= PIC_TRIES_ ? 'piclocked' : 'picwrong', left: PIC_TRIES_ - p.n };
    }
    p.n = 0;
    return { ok: true, ticket: pwTicket_(name, r, 'pic') };
  });
  if (how === 'school') {
    const link = icalNorm_(a), title = typeof b === 'string' ? b.trim() : '';
    if (!link || !title) return { error: 'empty' };
    const d = loadUser_(name), saved = icalNorm_(d.settings && d.settings.ical);
    if (!saved) return { error: 'nolink' };
    const titles = {};
    [d.tasks || {}, d.events || {}].forEach(m => Object.keys(m).forEach(id => {
      const t = m[id]; if (!t || !(t.ikey || t.source === 'ical')) return;
      if (t.title) titles[String(t.title).trim()] = 1;
      if (t.ikey) titles[String(t.ikey).split('|').pop().trim()] = 1;
    }));
    if (link !== saved || !titles[title]) { Utilities.sleep(1500); return { error: 'nomatch' }; }
    return withLock_(() => ({ ok: true, ticket: pwTicket_(name, rec_(name), 'school') }));
  }
  return { error: 'bad' };
}
function rpcPwReset(name, ticket, pw) {
  ensureStore_();
  name = normName_(name); pw = typeof pw === 'string' ? pw : '';
  if (pw.length < 6) return { error: 'short' };
  if (pw.length > 200) return { error: 'long' };
  return withLock_(() => {
    const r = name && NAME_RE.test(name) ? rec_(name) : null;
    if (!r || !r.rt || typeof ticket !== 'string' || hex_(sha_(bytes_(ticket))) !== r.rt[0] || Date.now() > r.rt[1]) return { error: 'expired' };
    const how = r.rt[2]; delete r.rt; pwSet_(r, pw); r.k = [];
    if (r.pic) r.pic.n = 0;
    // a Schoology reset also turns two-step login off (the pictures may be what was forgotten)
    secNote_(r, 'Password reset with Forgot my password (' + (how === 'school' ? 'Schoology link' : 'picture password') + ')' + (how === 'school' && r.tfa ? '. Two-step login was turned off.' : '') + ' The old password still works for 3 days.');
    if (how === 'school') delete r.tfa;
    put_('users', name, JSON.stringify(r));
    return { ok: true };
  });
}
function rpcLogout(token) {
  let me; try { me = auth_(token); } catch (e) { return { ok: true }; }
  const h = hex_(sha_(bytes_(String(token).split(':')[1])));
  CacheService.getScriptCache().remove('sess_' + h);
  withLock_(() => { const rec = rec_(me); rec.k = (rec.k || []).filter(s => s[0] !== h); put_('users', me, JSON.stringify(rec)); });
  return { ok: true };
}

// ---------- web app ----------
// GET: a small status answer (the page itself is on GitHub Pages)
function doGet() {
  let setup = false;
  try { setup = !!PROPS.getProperty('sheetId'); } catch (e) {}
  return ContentService.createTextOutput(JSON.stringify({ ok: true, app: 'Saxlan', setup: setup })).setMimeType(ContentService.MimeType.JSON);
}
// POST {fn, args}: one allowlisted rpc. Every answer is JSON {ok:true, result} or {ok:false, error}.
const POST_MAX_ = 3000000;
function doPost(e) {
  let out;
  try {
    const body = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    if (!body) throw new Error('empty');
    if (body.length > POST_MAX_) throw new Error('too big');
    const m = JSON.parse(body);
    if (!m || typeof m !== 'object' || typeof m.fn !== 'string' || !Object.prototype.hasOwnProperty.call(RPC_, m.fn)) throw new Error('bad request');
    const args = Array.isArray(m.args) ? m.args.slice(0, 6) : [];
    out = { ok: true, result: RPC_[m.fn].apply(null, args) };
  } catch (err) {
    const msg = String(err && err.message || err);
    if (!/^(auth|setup|too big|bad request|empty|owner only)$/.test(msg)) console.error(msg, err && err.stack);
    out = { ok: false, error: msg.slice(0, 120) };
  }
  let text;
  try { text = JSON.stringify(out === undefined ? { ok: true, result: null } : out); } catch (e) { text = '{"ok":false,"error":"bad result"}'; }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
function rpcPing() { ensureStore_(); return { ok: true }; }
// ---------- update notes: one short message to every account's inbox, from the site. Only callable with the secret
// kept on the owner's computer (backend/announce-token, never committed); the same text is not sent twice.
const ANNOUNCE_H_ = '9eda495126dc17c140db9f08add6b15efce0835a40a34c42ca9cd6b21c0b7faf';
// owner only (the announce secret): the suggestion list, and removing finished ones
function rpcSuggOwner(secret, done) {
  if (typeof secret !== 'string' || hex_(sha_(bytes_(secret))) !== ANNOUNCE_H_) throw new Error('owner only');
  ensureStore_();
  return withLock_(() => {
    (Array.isArray(done) ? done : []).forEach(id => { if (get_('sugg', String(id))) { suggDoneNotify_(id); del_('sugg', String(id)); } });
    const sg = all_('sugg');
    return Object.keys(sg).map(x => { try { return JSON.parse(sg[x]); } catch (e) { return null; } }).filter(Boolean);
  });
}
function rpcMemeDrop(secret, match) {
  if (typeof secret !== 'string' || hex_(sha_(bytes_(secret))) !== ANNOUNCE_H_) throw new Error('owner only');
  ensureStore_();
  return memeDrop_(match);
}
function rpcAnnounce(secret, text, force) {
  if (typeof secret !== 'string' || hex_(sha_(bytes_(secret))) !== ANNOUNCE_H_) throw new Error('owner only');
  text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!text) return { error: 'empty' };
  ensureStore_();
  return withLock_(() => {
    if (!force && get_('meta', 'lastAnnounce') === text) return { error: 'already sent' };
    const io = socIO_(); let n = 0;
    io.users().forEach(u => { try { if (SX.inboxAdd(io, u, text, SITE_NAME_)) n++; } catch (e) {} });
    put_('meta', 'lastAnnounce', text);
    return { ok: true, sent: n };
  });
}

// ---------- the meme of the day: one safe meme from r/wholesomememes (via meme-api.com), fetched once a day and kept in the
// sheet so every visitor that day gets the same one. The image comes back as a data URL, so the visitor's browser never
// loads reddit (school filters may block it). A failed fetch keeps the last good meme; with none at all the page uses its
// bundled pictures. Retries after a failure at most every 30 minutes.
function memeToday_() { return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd'); }
function memeLoad_() { try { return JSON.parse(get_('meta', 'meme') || 'null'); } catch (e) { return null; } }
// Memes come from r/wholesomememes in a stock of saved ones: each day (midnight Eastern) takes the next, and when
// the stock is down to its last one, 6 more are fetched (one per request, so no visitor waits long) and the owner
// gets an inbox message listing them. Links already used are skipped.
function memeFetch_(skip, n) {
  const r = UrlFetchApp.fetch(SX.MEME_API, { muteHttpExceptions: true, followRedirects: true, headers: { Accept: 'application/json' } });
  if (r.getResponseCode() !== 200) throw new Error('meme api ' + r.getResponseCode());
  const picks = SX.memePick(JSON.parse(r.getContentText())), out = [];
  for (let i = 0; i < picks.length && out.length < (n || 1); i++) {
    if (skip && skip.indexOf(picks[i].link) >= 0) continue;
    const urls = picks[i].urls;
    for (let j = 0; j < urls.length; j++) {
      try {
        const g = UrlFetchApp.fetch(urls[j], { muteHttpExceptions: true, followRedirects: true });
        if (g.getResponseCode() !== 200) continue;
        const b = g.getContent(), mime = SX.memeMime(b);
        if (!mime || b.length > SX.MEME_MAX) continue;
        out.push({ title: picks[i].title, mime: mime, data: Utilities.base64Encode(b), link: picks[i].link });
        break;
      } catch (e) { /* try the next one */ }
    }
  }
  if (!out.length) throw new Error('no meme');
  return n ? out : out[0];
}
const memeJ_ = (k, d) => { try { return JSON.parse(get_('meta', k) || 'null') || d; } catch (e) { return d; } };
// one more meme into the stock while a refill is owed; the owner hears about the batch when it is complete
function memeRefillStep_() {
  let owed = Number(get_('meta', 'memeOwed') || 0);
  const q = memeJ_('memeQ', []);
  if (!owed && q.length <= 1) { owed = q.length ? 6 : 7; put_('meta', 'memeOwed', String(owed)); put_('meta', 'memeNew', '[]'); }
  if (!owed || Date.now() - Number(get_('meta', 'memeTry') || 0) < 60000) return;
  const seen = memeJ_('memeSeen', []), fresh = memeJ_('memeNew', []);
  try {
    const f = memeFetch_(seen, 1)[0], key = 'mq_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    put_('meta', key, JSON.stringify(f));
    q.push(key); put_('meta', 'memeQ', JSON.stringify(q));
    seen.push(f.link); put_('meta', 'memeSeen', JSON.stringify(seen.slice(-80)));
    fresh.push(f.title || '(untitled)'); put_('meta', 'memeNew', JSON.stringify(fresh));
    owed--; put_('meta', 'memeOwed', String(owed));
    if (!owed) {
      const owner = PROPS.getProperty('owner');
      if (owner) try {
        SX.inboxAdd(socIO_(), owner, fresh.length + (fresh.length === 1 ? ' new meme is' : ' new memes are') + ' saved for the days ahead: ' +
          fresh.map((t, i) => (i + 1) + ') ' + String(t).slice(0, 60)).join('; '), SITE_NAME_);
      } catch (e) {}
    }
  } catch (e) { put_('meta', 'memeTry', String(Date.now())); console.error('meme', e && e.message); }
}
// owner only: take saved memes whose title contains `match` out of the stock and fetch replacements right away
function memeDrop_(match) {
  match = String(match || '').toLowerCase().trim();
  if (!match) return { error: 'empty' };
  return withLock_(() => {
    const q = memeJ_('memeQ', []), keep = [], removed = [];
    q.forEach(key => {
      const m = memeJ_(key, null);
      if (m && String(m.title || '').toLowerCase().indexOf(match) >= 0) { removed.push(m.title); try { del_('meta', key); } catch (e) {} }
      else keep.push(key);
    });
    // today's meme too: the next saved one takes its place
    let cur = memeLoad_();
    if (cur && String(cur.title || '').toLowerCase().indexOf(match) >= 0) {
      removed.push(cur.title + ' (today)');
      while (keep.length) {
        const key = keep.shift(), next = memeJ_(key, null);
        try { del_('meta', key); } catch (e) {}
        if (next && next.data) { cur = { date: memeToday_(), title: next.title, mime: next.mime, data: next.data, link: next.link }; put_('meta', 'meme', JSON.stringify(cur)); break; }
      }
    }
    put_('meta', 'memeQ', JSON.stringify(keep));
    if (removed.length) {
      put_('meta', 'memeOwed', String(removed.length)); put_('meta', 'memeNew', '[]');
      for (let i = 0; i < removed.length; i++) { put_('meta', 'memeTry', '0'); memeRefillStep_(); }
    }
    cur = memeLoad_();
    return { removed: removed, today: cur && cur.title, stock: memeJ_('memeQ', []).map(key => (memeJ_(key, {}) || {}).title) };
  });
}
function rpcDailyMeme() {
  ensureStore_();
  const day = memeToday_();
  let m = memeLoad_();
  if (!m || m.date !== day) {
    m = withLock_(() => {
      let cur = memeLoad_();
      if (cur && cur.date === day) return cur;
      const q = memeJ_('memeQ', []);
      while (q.length) {
        // the next saved meme becomes today's (never the same one twice in a row)
        const key = q.shift(), next = memeJ_(key, null);
        put_('meta', 'memeQ', JSON.stringify(q));
        try { del_('meta', key); } catch (e) {}
        if (next && next.data && cur && next.link && next.link === cur.link) continue;
        if (next && next.data) { cur = { date: day, title: next.title, mime: next.mime, data: next.data, link: next.link }; put_('meta', 'meme', JSON.stringify(cur)); return cur; }
      }
      // nothing saved: fetch one straight away
      if (Date.now() - Number(get_('meta', 'memeTry') || 0) < 30 * 60000) return cur;
      try {
        const f = memeFetch_(memeJ_('memeSeen', []));
        cur = { date: day, title: f.title, mime: f.mime, data: f.data, link: f.link };
        put_('meta', 'meme', JSON.stringify(cur));
        const seen = memeJ_('memeSeen', []); seen.push(f.link); put_('meta', 'memeSeen', JSON.stringify(seen.slice(-80)));
      } catch (e) { put_('meta', 'memeTry', String(Date.now())); console.error('meme', e && e.message); }
      return cur;
    });
  } else {
    // a quiet moment: top up the stock when it is running low
    try { withLock_(() => memeRefillStep_()); } catch (e) {}
  }
  if (!m || !m.data) return null;
  return { date: m.date, title: m.title || '', link: m.link || '', dataUrl: 'data:' + m.mime + ';base64,' + m.data };
}
// ---------- game progress: a small JSON blob per game per account, size-capped and validated ----------
function gameKey_(id, name) {
  if (ROOM_GAMES.indexOf(id) < 0) throw new Error('unknown game');
  return id + '_u_' + name;
}
function rpcLoadGame(k, id) { const me = auth_(k); return get_('games', gameKey_(id, me)) || ''; }
function rpcSaveGame(k, id, data) {
  const me = auth_(k), key = gameKey_(id, me);
  if (typeof data !== 'string' || data.length > 150000) throw new Error('bad data');
  const o = JSON.parse(data);
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('bad data');
  withLock_(() => put_('games', key, data));
  return { ok: true };
}
// guests (not signed in) save under a random guest code their browser makes. Signed in, they can redeem the
// code once: its saves move to the account and the code stops working, so progress can't be passed around
const GUEST_RE_ = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const guestUsed_ = g => !!get_('games', 'used_' + g);
const guestKey_ = (id, g) => gameKey_(id, '').slice(0, -3) + '_g_' + g;
function rpcLoadGuestGame(g, id) {
  ensureStore_();
  if (typeof g !== 'string' || !GUEST_RE_.test(g)) throw new Error('bad guest');
  if (guestUsed_(g)) return { used: true };
  return get_('games', guestKey_(id, g)) || '';
}
function rpcSaveGuestGame(g, id, data) {
  ensureStore_();
  if (typeof g !== 'string' || !GUEST_RE_.test(g)) throw new Error('bad guest');
  if (typeof data !== 'string' || data.length > 150000) throw new Error('bad data');
  const o = JSON.parse(data);
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('bad data');
  const key = guestKey_(id, g);
  return withLock_(() => { if (guestUsed_(g)) return { used: true }; put_('games', key, data); return { ok: true }; });
}
function rpcRedeemGuest(k, g) {
  const me = auth_(k);
  g = String(g || '').trim().toLowerCase();
  if (!GUEST_RE_.test(g)) return { error: 'bad' };
  return withLock_(() => {
    if (guestUsed_(g)) return { error: 'used' };
    const end = '_g_' + g, keys = Object.keys(index_('games')).filter(x => x.slice(-end.length) === end);
    if (!keys.length) return { error: 'none' };
    const moved = [];
    keys.forEach(key => {
      const id = key.slice(0, -end.length);
      if (ROOM_GAMES.indexOf(id) < 0) return;
      put_('games', gameKey_(id, me), get_('games', key));
      moved.push(id);
    });
    keys.forEach(key => del_('games', key));
    put_('games', 'used_' + g, String(Date.now()));
    return { ok: true, games: moved };
  });
}
// account roles: stored on the user record. The owner and game-admins are administrators; moderators approve resources
const ROLES_ = ['game-admin', 'moderator'];
const roles_ = name => { const r = rec_(name); return r && Array.isArray(r.roles) ? r.roles.filter(x => ROLES_.indexOf(x) >= 0) : []; };
const userOut_ = name => { const r = rec_(name) || {}; return { name: name, av: avMap_()[name] || '', created: r.c || 0, pic: !!(r.pic && r.pic.h), owner: isOwner_(name), roles: roles_(name) }; };

// ---------- multiplayer rooms (games reach this only through the page's room bridge) ----------
// Rooms live in the script cache. Only the seq increment (with the event or room change it carries) takes the lock;
// polls take none. Polls with args.wait are long polls (roomLongPoll_).
// shared levels (Metrica editors): a level is stored once under a 6 letter code anyone can load
const LVL_GAMES_ = ['geodash', 'appel'];
const LVL_ABC_ = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LVL_MAX_ = 120000;
const LVL_RATE_ = 40; // shares per hour per account or guest
function lvlCode_(v) { const c = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!/^[A-Z0-9]{6}$/.test(c)) throw new Error('bad code'); return c; }
function rpcLevelShare(k, g, game, data) {
  if (LVL_GAMES_.indexOf(game) < 0) throw new Error('unknown game');
  if (typeof data !== 'string' || data.length > LVL_MAX_) throw new Error('too big');
  const o = JSON.parse(data);
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('bad level');
  let by = 'Guest';
  if (k) by = auth_(k);
  else { g = String(g || '').trim().toLowerCase(); if (!GUEST_RE_.test(g)) throw new Error('auth'); }
  ensureStore_();
  const h = hex_(sha_(bytes_(game + '\n' + data))).slice(0, 32);
  const known = get_('games', 'lvlh_' + h);
  if (known) return { ok: true, code: known };
  const cache = CacheService.getScriptCache(), rk = 'lvlr_' + (k ? 'u_' + by : 'g_' + g), n = Number(cache.get(rk) || 0);
  if (n >= LVL_RATE_) throw new Error('slow down');
  cache.put(rk, String(n + 1), 3600);
  return withLock_(() => {
    let code = '';
    for (let i = 0; i < 30; i++) {
      code = ''; for (let j = 0; j < 6; j++) code += LVL_ABC_.charAt(Math.floor(Math.random() * LVL_ABC_.length));
      if (!get_('games', 'lvl_' + code)) break;
    }
    put_('games', 'lvl_' + code, JSON.stringify({ g: game, d: data, by: by, t: Date.now() }));
    put_('games', 'lvlh_' + h, code);
    return { ok: true, code: code };
  });
}
function rpcLevelGet(code) {
  code = lvlCode_(code);
  ensureStore_();
  const v = get_('games', 'lvl_' + code);
  if (!v) return { ok: false, error: 'not found' };
  const o = JSON.parse(v);
  return { ok: true, code: code, game: o.g, data: o.d, by: o.by || '' };
}
function roomIO_() {
  const cache = CacheService.getScriptCache();
  return {
    getAll: keys => keys.length ? cache.getAll(keys) : {},
    put: (k, v) => cache.put(k, v, ROOM_TTL),
    putAll: o => cache.putAll(o, ROOM_TTL),
    lock: fn => {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(8000)) throw roomErr_('rate');
      try { return fn(); } finally { lock.releaseLock(); }
    },
    now: () => Date.now(),
    rand: n => { let s = ''; while (s.length < n) s += Utilities.getUuid().replace(/-/g, ''); return s.slice(0, n).toLowerCase(); },
    // a waiting poll holds an execution, and the owner's executions are capped (about 30 at once): at most ROOM_SLOTS wait
    slot: ms => {
      const keys = []; for (let i = 0; i < ROOM_SLOTS; i++) keys.push('lp_' + i);
      const got = cache.getAll(keys), now = Date.now(), me = Utilities.getUuid();
      const free = keys.filter(k => !(Number(String(got[k] || '').split(':')[1]) > now));
      if (!free.length) return null;
      const k = free[Math.floor(Math.random() * free.length)];
      cache.put(k, me + ':' + (now + ms + 3000), 60);
      return () => { try { const v = cache.get(k); if (v && v.indexOf(me) === 0) cache.remove(k); } catch (e) {} };
    }
  };
}
const ROOM_SLOTS = 12;
// creating or joining a room of a Multiplayer game needs a signed-in account
function roomGate_(op, args, k) {
  if ((op !== 'create' && op !== 'join') || !args || typeof args !== 'object' || SX.MP_GAMES.indexOf(args.game) < 0) return;
  try { auth_(k); } catch (e) { if (e && e.message === 'setup') throw e; throw roomErr_('signin'); }
}
function rpcRoom(op, args, k) {
  try {
    roomGate_(String(op || ''), args, k);
    const io = roomIO_();
    if (op === 'poll' && args && typeof args === 'object' && args.wait) {
      const it = roomLongPoll_(io, args);
      let r = it.next();
      while (!r.done) { Utilities.sleep(r.value); r = it.next(); }
      return { ok: true, result: r.value };
    }
    return { ok: true, result: roomCore_(io, String(op || ''), args) };
  }
  catch (e) { if (e && e.room) return { ok: false, error: e.room }; console.error('room', e && e.stack || e); return { ok: false, error: 'conn' }; }
}

// ROOM-CORE-BEGIN
// io: getAll(keys) -> {key: string}, put(key, str), putAll({key: str}), lock(fn), now() ms, rand(n) -> n chars [a-z0-9].
// Keys per room (all expire 6 h after the last write): rm_<CODE>_m meta {g game, max, host, np next player number,
// st state seq, tc last refresh}, _p players [{id, name, at}], _t tokens {token: id}, _s seq, _e<n> one event each,
// _st state snapshot, _a<id> when that player last polled. Rate counters: rl_*.
// the games on the site (same ids as GAMES in index.html); saves are keyed by them too
const ROOM_GAMES = ['pipworks', 'lander', 'geohunter', 'chess', 'geodash', 'appel', 'metrica-wave', 'krillion'];
const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_TTL = 21600;          // seconds (6 h, the cache maximum)
const ROOM_MAX_DATA = 92160;     // 90 KB per message or snapshot (UTF-8 bytes of the JSON)
const ROOM_PAGE = 200;           // events per poll
const ROOM_BACKLOG = 1000;       // a poll never reaches further back than this many seqs
const ROOM_STALE = 30000;        // a player not seen this long can be replaced by a join under the same name
const ROOM_AWAY = 30000;         // a player whose page has not polled this long (closed tab, lost connection) is left out of
                                 // the player list (the host passes on) until it polls again
const ROOM_DROP = 600000;        // after this long away the player is removed from the room
const ROOM_REFRESH = 600000;     // rewrite the room keys (pushing back expiry) at most every 10 min
const ROOM_RATE = 50;            // requests per token per 10 s window
const ROOM_JOIN_RATE = 20;       // joins per code per 10 s window
const ROOM_CREATE_RATE = 60;     // rooms created per minute, all players together
function roomErr_(code) { const e = new Error(code); e.room = code; return e; }
function roomBytes_(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c < 0xdc00) ? 4 : (c >= 0xdc00 && c < 0xe000) ? 0 : 3; }
  return n;
}
function roomName_(v) {
  if (typeof v !== 'string') throw roomErr_('bad');
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length < 1 || s.length > 16) throw roomErr_('bad');
  return s;
}
function roomCode_(v) {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!/^[A-HJ-NP-Z]{4}$/.test(s)) throw roomErr_('bad');
  return s;
}
function roomGame_(v) { if (ROOM_GAMES.indexOf(v) < 0) throw roomErr_('bad'); return v; }
function roomJson_(v) {
  let s;
  try { s = JSON.stringify(v === undefined ? null : v); } catch (e) { throw roomErr_('bad'); }
  if (s.length > ROOM_MAX_DATA || roomBytes_(s) > ROOM_MAX_DATA) throw roomErr_('big');
  return s;
}
function roomRate_(io, key, limit, windowMs) {
  const k = 'rl_' + key + '_' + Math.floor(io.now() / windowMs);
  const n = Number(io.getAll([k])[k]) || 0;
  if (n >= limit) throw roomErr_('rate');
  io.put(k, String(n + 1));
}
function roomCore_(io, op, args) {
  args = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const now = io.now();
  const K = (code, s) => 'rm_' + code + '_' + s;
  const parse = s => { try { return s == null ? null : JSON.parse(s); } catch (e) { return null; } };
  const load = (code, extra) => {
    const keys = ['m', 'p', 't', 's'].map(s => K(code, s)).concat(extra || []);
    const got = io.getAll(keys);
    const r = { m: parse(got[K(code, 'm')]), p: parse(got[K(code, 'p')]), t: parse(got[K(code, 't')]), s: Number(got[K(code, 's')]), got: got };
    if (!r.m || !Array.isArray(r.p) || !r.t || !(r.s >= 0)) return null;
    return r;
  };
  // every write bumps the seq and stores one event under the lock; the room keys are rewritten when due
  const commit = (code, r, ev, extra) => {
    const seq = r.s + 1, out = Object.assign({}, extra || {});
    ev.seq = seq; ev.at = now;
    out[K(code, 'e' + seq)] = JSON.stringify(ev);
    out[K(code, 's')] = String(seq);
    if (ev.k !== 'm' || !(now - (r.m.tc || 0) < ROOM_REFRESH)) {
      r.m.tc = now;
      out[K(code, 'm')] = JSON.stringify(r.m);
      out[K(code, 'p')] = JSON.stringify(r.p);
      out[K(code, 't')] = JSON.stringify(r.t);
      const st = K(code, 'st');
      if (r.m.st && !(st in out)) { const v = io.getAll([st])[st]; if (v != null) out[st] = v; }
    }
    io.putAll(out);
    return seq;
  };
  const token = v => { if (typeof v !== 'string' || !/^[a-z0-9]{24}$/.test(v)) throw roomErr_('badtoken'); return v; };
  const member = (r, tok) => { const id = r.t[tok]; if (!id || !r.p.some(x => x.id === id)) throw roomErr_('badtoken'); return id; };

  if (op === 'create') {
    const game = roomGame_(args.game), name = roomName_(args.name), max = args.max === undefined ? 16 : args.max;
    if (typeof max !== 'number' || Math.floor(max) !== max || max < 2 || max > 16) throw roomErr_('bad');
    roomRate_(io, 'create', ROOM_CREATE_RATE, 60000);
    return io.lock(() => {
      let code = '';
      for (let i = 0; i < 20 && !code; i++) {
        let c = ''; const r = io.rand(8);
        for (let j = 0; j < 4; j++) c += ROOM_LETTERS[parseInt(r.slice(j * 2, j * 2 + 2), 36) % ROOM_LETTERS.length];
        if (io.getAll([K(c, 'm')])[K(c, 'm')] == null) code = c;
      }
      if (!code) throw roomErr_('rate');
      const tok = io.rand(24), id = 'p1';
      const r = { m: { g: game, max: max, host: id, np: 2, st: 0, tc: 0 }, p: [{ id: id, name: name, at: now }], t: {}, s: 0 };
      r.t[tok] = id;
      const extra = {}; extra[K(code, 'a' + id)] = String(now);
      commit(code, r, { k: 'j', from: id }, extra);
      return { code: code, token: tok, playerId: id, host: true };
    });
  }
  if (op === 'join') {
    const game = roomGame_(args.game), code = roomCode_(args.code), name = roomName_(args.name);
    roomRate_(io, 'join_' + code, ROOM_JOIN_RATE, 10000);
    return io.lock(() => {
      const r = load(code);
      if (!r) throw roomErr_('noroom');
      if (r.m.g !== game) throw roomErr_('wronggame');
      const lower = name.toLowerCase(), same = r.p.filter(x => x.name.toLowerCase() === lower)[0];
      let id;
      if (same) {
        // a player who vanished (closed the tab without leaving) can be taken over under the same name
        const ak = K(code, 'a' + same.id), seen = Number(io.getAll([ak])[ak]) || 0;
        if (now - seen < ROOM_STALE) throw roomErr_('taken');
        id = same.id;
        Object.keys(r.t).forEach(t => { if (r.t[t] === id) delete r.t[t]; });
        same.name = name;
      } else {
        if (r.p.length >= r.m.max) throw roomErr_('full');
        id = 'p' + r.m.np; r.m.np += 1;
        r.p.push({ id: id, name: name, at: now });
      }
      if (!r.m.host || !r.p.some(x => x.id === r.m.host)) r.m.host = id;
      const tok = io.rand(24); r.t[tok] = id;
      const extra = {}; extra[K(code, 'a' + id)] = String(now);
      commit(code, r, { k: 'j', from: id }, extra);
      return { code: code, token: tok, playerId: id, host: r.m.host === id };
    });
  }
  if (op === 'send' || op === 'poll' || op === 'leave' || op === 'state') {
    const code = roomCode_(args.code), tok = token(args.token);
    roomRate_(io, tok, ROOM_RATE, 10000);
    if (op === 'send') {
      const data = roomJson_(args.data);
      const to = args.to === undefined || args.to === null || args.to === '' ? null : args.to;
      if (to !== null && (typeof to !== 'string' || !/^p\d{1,6}$/.test(to))) throw roomErr_('bad');
      // except: players who should not get this one (the page's room bridge already sent it to them directly)
      const ex = args.except === undefined || args.except === null ? [] : args.except;
      if (!Array.isArray(ex) || ex.length > 16 || !ex.every(x => typeof x === 'string' && /^p\d{1,6}$/.test(x))) throw roomErr_('bad');
      return io.lock(() => {
        const r = load(code); if (!r) throw roomErr_('noroom');
        const id = member(r, tok), ev = { k: 'm', from: id, d: JSON.parse(data) };
        if (to) ev.to = to;
        if (ex.length) ev.ex = ex;
        const seenNow = {}; seenNow[K(code, 'a' + id)] = String(now);  // sending counts as being here
        return { seq: commit(code, r, ev, seenNow) };
      });
    }
    if (op === 'state') {
      const data = roomJson_(args.state);
      return io.lock(() => {
        const r = load(code); if (!r) throw roomErr_('noroom');
        const id = member(r, tok);
        if (r.m.host !== id) throw roomErr_('nothost');
        r.m.st = r.s + 1;
        const extra = {}; extra[K(code, 'st')] = data;
        commit(code, r, { k: 's', from: id }, extra);
        return {};
      });
    }
    if (op === 'leave') {
      return io.lock(() => {
        const r = load(code); if (!r) throw roomErr_('noroom');
        const id = member(r, tok);
        r.p = r.p.filter(x => x.id !== id);
        Object.keys(r.t).forEach(t => { if (r.t[t] === id) delete r.t[t]; });
        if (r.m.host === id) r.m.host = r.p.length ? r.p[0].id : '';
        commit(code, r, { k: 'l', from: id });
        return {};
      });
    }
    // poll: no lock; reads the room, then the missing events in one getAll per page
    const since = args.since === undefined ? 0 : args.since;
    if (typeof since !== 'number' || Math.floor(since) !== since || since < 0) throw roomErr_('bad');
    const r = load(code); if (!r) throw roomErr_('noroom');
    const id = member(r, tok);
    io.put(K(code, 'a' + id), String(now));
    // players who stopped polling are left out of the list (so the others see them leave) and the host passes on;
    // they come back when they poll again, and are removed after ROOM_DROP
    const ak = r.p.map(x => K(code, 'a' + x.id));
    const idleFor = (got, x) => x.id === id ? 0 : now - Math.max(Number(got[K(code, 'a' + x.id)]) || 0, x.at || 0);
    let seen = io.getAll(ak);
    const hostAway = q => !q.p.some(x => x.id === q.m.host && idleFor(seen, x) <= ROOM_AWAY);
    if (r.p.some(x => idleFor(seen, x) > ROOM_DROP) || hostAway(r)) {
      try {
        io.lock(() => {
          const q = load(code, ak); if (!q) return;
          seen = q.got;
          const gone = q.p.filter(x => idleFor(seen, x) > ROOM_DROP).map(x => x.id);
          q.p = q.p.filter(x => gone.indexOf(x.id) < 0);
          Object.keys(q.t).forEach(t => { if (gone.indexOf(q.t[t]) >= 0) delete q.t[t]; });
          const moveHost = hostAway(q);
          if (!gone.length && !moveHost) return;
          if (moveHost) { const h = q.p.filter(x => idleFor(seen, x) <= ROOM_AWAY)[0]; q.m.host = h ? h.id : id; }
          q.s = commit(code, q, { k: 'l', from: gone[0] || id, gone: gone });
          r.p = q.p; r.m = q.m; r.t = q.t; r.s = q.s;
        });
      } catch (e) { if (!e || e.room !== 'rate') throw e; }
    }
    const events = [];
    let at = Math.max(since, r.s - ROOM_BACKLOG), covered = Math.min(since, r.s);
    let gap = false;
    while (at < r.s && events.length < ROOM_PAGE && !gap) {
      const keys = [];
      for (let q = at + 1; q <= Math.min(r.s, at + ROOM_PAGE); q++) keys.push(K(code, 'e' + q));
      const got = io.getAll(keys);
      let q = at;
      for (; q < at + keys.length && events.length < ROOM_PAGE;) {
        // polls take no lock: a recent event can be missing while its write is still landing, so stop before it and get it next poll
        if (got[K(code, 'e' + (q + 1))] == null && q + 1 > r.s - 20) { gap = true; break; }
        q++;
        const ev = parse(got[K(code, 'e' + q)]);
        if (!ev || ev.k !== 'm' || (ev.to && ev.to !== id && ev.from !== id) || (ev.ex && ev.from !== id && ev.ex.indexOf(id) >= 0)) continue;
        const out = { seq: q, from: ev.from, data: ev.d, at: ev.at };
        if (ev.to) out.to = ev.to;
        events.push(out);
      }
      at = q; covered = q;
    }
    const res = { seq: covered, events: events,
      players: r.p.filter(x => idleFor(seen, x) <= ROOM_AWAY).map(x => ({ id: x.id, name: x.name, host: x.id === r.m.host })), host: r.m.host === id, me: id };
    if (r.m.st && r.m.st > since) {
      const sk = K(code, 'st'), v = io.getAll([sk])[sk];
      if (v != null) { res.state = parse(v); res.stateSeq = r.m.st; }
    }
    return res;
  }
  throw roomErr_('bad');
}
// long polls: a poll with args.wait (ms) that finds nothing new waits for the room's seq to move, so a message reaches
// the other players as soon as it is written instead of on their next poll. args.pk is the player list the page knows
// (roomPk_), so a change to it also ends the wait. io.slot(ms) (optional) caps how many polls wait at once: it returns a
// release function, or null when all are taken (the poll then answers at once with lw 0). Written as a generator that
// yields the ms to sleep: Apps Script sleeps in place, node awaits a timer.
const ROOM_WAIT_MAX = 6000;      // longest a poll waits
const ROOM_WAIT_STEP = 150;      // how often a waiting poll looks at the seq
function roomPk_(res) { return res.players.map(x => x.id + (x.host ? '*' : '')).join(',') + (res.host ? '!' : ''); }
// worth answering: news from someone else (the page already has its own messages and snapshots), or a new player list
function roomWorth_(io, res, args) {
  if (typeof args.pk !== 'string' || args.pk !== roomPk_(res) || res.events.some(e => e.from !== res.me)) return true;
  if (!('state' in res)) return false;
  const k = 'rm_' + roomCode_(args.code) + '_e' + res.stateSeq, ev = io.getAll([k])[k];
  try { return JSON.parse(ev).from !== res.me; } catch (e) { return true; }
}
function* roomLongPoll_(io, args) {
  const wait = Math.min(Math.max(Number(args.wait) || 0, 0), ROOM_WAIT_MAX), until = io.now() + wait;
  let res = roomCore_(io, 'poll', args);
  res.lw = 1;
  if (!wait || roomWorth_(io, res, args)) return res;
  const sk = 'rm_' + roomCode_(args.code) + '_s';
  let last = Number(io.getAll([sk])[sk]);
  if (last !== res.seq) return res; // an event is still landing: the next poll gets it
  const release = io.slot ? io.slot(wait) : () => {};
  if (!release) { res.lw = 0; return res; }
  // re-reads inside one request do not count against the rate limit again
  const quiet = Object.assign({}, io, {
    getAll: keys => keys.length === 1 && /^rl_/.test(keys[0]) ? {} : io.getAll(keys),
    put: (k, v) => { if (!/^rl_/.test(k)) io.put(k, v); }
  });
  try {
    while (io.now() + ROOM_WAIT_STEP < until) {
      yield ROOM_WAIT_STEP;
      const v = Number(io.getAll([sk])[sk]);
      if (!(v >= 0)) return res;
      if (v <= last) continue;
      last = v;
      res = roomCore_(quiet, 'poll', Object.assign({}, args, { since: res.seq }));
      res.lw = 1;
      if (roomWorth_(io, res, args) || res.seq < v) return res;
    }
    return res;
  } finally { release(); }
}
// ROOM-CORE-END

// ---------- per-account data rpcs: each takes the session token and touches only that account ----------
const small_ = (x, max) => { if (JSON.stringify(x === undefined ? null : x).length > (max || 20000)) throw new Error('too big'); return x; };
const okId_ = id => typeof id === 'string' && id.length > 0 && id.length <= 80;
function rpcGetData(k) {
  const me = auth_(k), d = loadUser_(me);
  d.user = userOut_(me);
  return d;
}
function rpcSaveTask(k, t) {
  const me = auth_(k); small_(t);
  if (!t || !okId_(t.id)) throw new Error('task id required');
  return mutate_(me, d => {
    if (d.removed) { delete d.removed[[t.course, t.date, t.title].join('|')]; if (t.ikey) delete d.removed[t.ikey]; }
    const before = d.tasks[t.id];
    d.tasks[t.id] = t;
    // filing an unassigned imported item under a class teaches a rule and files its look-alikes too
    return { ok: true, rerouted: SX.taskSaved(d, before, t) };
  });
}
function rpcDeleteTask(k, id) {
  const me = auth_(k);
  return mutate_(me, d => {
    const t = d.tasks[id];
    if (t) { d.removed = d.removed || {}; d.removed[[t.course, t.date, t.title].join('|')] = Date.now(); if (t.ikey) d.removed[t.ikey] = Date.now(); }
    delete d.tasks[id];
  });
}
const cleanStr_ = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '';
function cleanSettings_(s) {
  s = s && typeof s === 'object' ? s : {};
  const courses = (Array.isArray(s.courses) ? s.courses.slice(0, 12) : []).map(c => c && typeof c === 'object' && /^[a-z0-9]{1,16}$/.test(c.id) ? {
    id: c.id, name: cleanStr_(c.name, 80), abbr: cleanStr_(c.abbr, 12), raw: cleanStr_(c.raw, 80),
    keys: (Array.isArray(c.keys) ? c.keys.slice(0, 16) : []).map(x => cleanStr_(x, 80).toLowerCase()).filter(Boolean)
  } : null).filter(c => c && c.name);
  SX.keyCourses(courses);
  const colors = {}, periods = {};
  Object.keys(s.colors && typeof s.colors === 'object' ? s.colors : {}).slice(0, 40).forEach(k => { const v = s.colors[k]; if (/^[a-z0-9]{1,16}$/.test(k) && /^#[0-9a-f]{6}$/i.test(v)) colors[k] = v; });
  Object.keys(s.periods && typeof s.periods === 'object' ? s.periods : {}).slice(0, 40).forEach(k => { const p = Number(s.periods[k]); if (/^[a-z0-9]{1,16}$/.test(k) && p >= 1 && p <= 8 && p === Math.floor(p)) periods[k] = p; });
  const ical = cleanStr_(s.ical, 600);
  return { colors: colors, periods: periods, advisoryCourse: cleanStr_(s.advisoryCourse, 16), courses: courses, coursesSet: true, fullNames: !!s.fullNames, hideGames: !!s.hideGames, hideChat: !!s.hideChat, faqNew: !!s.faqNew, gamesIntro: !!s.gamesIntro, hidePages: (Array.isArray(s.hidePages) ? s.hidePages : []).filter(x => typeof x === 'string' && /^[a-z]{3,12}$/.test(x)).slice(0, 12), gameStar: (Array.isArray(s.gameStar) ? s.gameStar : []).filter(x => typeof x === 'string' && /^[a-z0-9-]{1,40}$/.test(x)).slice(0, 60), tutorialNew: !!s.tutorialNew, lunch: ['5', '6'].reduce((o, p) => { const v = s.lunch && s.lunch[p]; if (/^[ABCD]$/.test(v)) o[p] = v; return o; }, {}),
    ical: /^(https|webcal):\/\/[^\s"'<>]+$/i.test(ical) ? ical : '' };
}
// a class list that slid against its ids (a class keeps its id but now has the name of another saved class whose id
// is gone): the page's rows got out of step with the classes, so the save is refused instead of renaming classes
function classShift_(prev, next) {
  const key = c => SX.courseKey(c && c.name || '');
  const nextIds = {}; (next || []).forEach(c => { nextIds[c.id] = 1; });
  return (next || []).some(c => {
    const p = (prev || []).find(x => x.id === c.id), k = key(c);
    if (!p || !k || key(p) === k) return false;
    return (prev || []).some(q => q.id !== c.id && !nextIds[q.id] && key(q) === k);
  });
}
function rpcSaveSettings(k, s) {
  const me = auth_(k); small_(s); const c = cleanSettings_(s);
  // imported assignments without a class get one once the classes they belong to exist
  return mutate_(me, d => {
    // a page that saves before the account has loaded sends an empty class list: never let that wipe saved classes
    const prev = d.settings || {};
    if (classShift_(prev.courses, c.courses)) throw new Error('classes-shift');
    if (!(c.courses || []).length && (prev.courses || []).length) {
      c.courses = prev.courses;
      ['colors', 'periods', 'lunch'].forEach(x => { if (prev[x] && !Object.keys(c[x] || {}).length) c[x] = prev[x]; });
      ['advisoryCourse', 'ical'].forEach(x => { if (prev[x] && !c[x]) c[x] = prev[x]; });
    }
    d.settings = c; return { ok: true, rerouted: SX.rerouteIcal(d) };
  });
}
function rpcSaveNote(k, n) { const me = auth_(k); small_(n); if (!n || !okId_(n.id)) throw new Error('id required'); return mutate_(me, d => { d.advisory[n.id] = n; }); }
function rpcDeleteNote(k, id) { const me = auth_(k); return mutate_(me, d => { delete d.advisory[id]; }); }
function rpcSaveEvent(k, ev) { const me = auth_(k); small_(ev); if (!ev || !okId_(ev.id)) throw new Error('id required'); return mutate_(me, d => { d.events = d.events || {}; d.events[ev.id] = ev; }); }
function rpcDeleteEvent(k, id) {
  const me = auth_(k);
  // an imported school event leaves a tombstone so a resync doesn't bring it back
  return mutate_(me, d => { const e = d.events && d.events[id]; if (e && e.ikey) { d.removed = d.removed || {}; d.removed[e.ikey] = Date.now(); } if (d.events) delete d.events[id]; });
}

// ---------- Schoology iCal import (calendar events only), on demand from the resync button ----------
// calendar imports: Monday of this week through Sunday of next week (tests reach 4 weeks past today, in shared.js)
function icalWindow_() {
  const tz = Session.getScriptTimeZone(), t = new Date();
  const back = (Number(Utilities.formatDate(t, tz, 'u')) + 6) % 7;
  const f = n => Utilities.formatDate(new Date(t.getTime() + n * 864e5), tz, 'yyyy-MM-dd');
  return [f(-back), f(13 - back), f(0)];
}
// shared.js does the parsing, class matching and the add-only merge
function rpcImportIcal(k, opts) {
  const me = auth_(k);
  opts = opts && typeof opts === 'object' ? opts : {};
  if (typeof opts.url === 'string') {
    const url = cleanStr_(opts.url, 600);
    if (!/^(https|webcal):\/\/[^\s"'<>]+$/i.test(url)) throw new Error('bad url');
    mutate_(me, d => { d.settings.ical = url; });
  }
  const url = loadUser_(me).settings.ical;
  if (!url) return { ok: true, added: 0 };
  const r = UrlFetchApp.fetch(url.replace(/^webcal:/i, 'https:'), { muteHttpExceptions: true, followRedirects: true });
  if (r.getResponseCode() !== 200) throw new Error('fetch');
  const text = r.getContentText('UTF-8');
  if (text.length > 3e6 || !/BEGIN:VCALENDAR/.test(text)) throw new Error('not a calendar');
  const events = SX.parseIcal(text, t => Utilities.formatDate(t, 'America/New_York', 'yyyy-MM-dd'));
  return mutate_(me, d => {
    const win = icalWindow_();
    const out = SX.importIcal(d, events, { from: win[0], until: win[1], today: win[2], detect: !!opts.detect, clean: cleanStr_,
      newId: () => 'ical' + Utilities.getUuid().replace(/-/g, '').slice(0, 10) });
    d.icalAt = Date.now();
    return { ok: true, added: out.added, created: out.created, events: out.events };
  });
}

// ---------- resources people write (documents, links, small PDFs) and the public library ----------
// shared.js cleans every resource (document HTML whitelist, https links) and runs the word filter, so a resource
// with flagged words is saved but never published. PDFs are kept base64 in the files sheet (1 MB each, 5 per account).
const rid_ = p => p + Utilities.getUuid().replace(/-/g, '').slice(0, 18);
const resAll_ = () => { const a = all_('res'), out = []; Object.keys(a).forEach(k => { try { out.push(JSON.parse(a[k])); } catch (e) {} }); return out; };
// your resources: the ones you wrote, the ones you contribute to, and your downloaded copies (shared.js decides)
const myRes_ = me => resAll_().filter(r => SX.mine(r, me));
const ownedCount_ = (all, me) => all.filter(r => r.owner === me).length;
// ---------- built-in resources: the shared Latin and Spanish sets (backend/builtin.json, pushed as builtin.html) ----------
// each set goes to every class whose canonical key matches its pattern (Latin 1 to AP Latin, Spanish 1 to AP Spanish)
let BUILTIN_ = null;
function builtIn_() {
  if (!BUILTIN_) { try { BUILTIN_ = JSON.parse(fileText_('builtin')); } catch (e) { BUILTIN_ = { sets: [] }; } }
  return BUILTIN_;
}
function builtInItems_(name) {
  const key = SX.courseKey(name || '');
  return key ? builtIn_().sets.filter(s => new RegExp(s.match).test(key)).reduce((a, s) => a.concat(s.items), []) : [];
}
function rpcGetResources(k) {
  const me = auth_(k), out = { courses: {} };
  (loadUser_(me).settings.courses || []).forEach(c => {
    const items = c && c.id ? builtInItems_(c.name) : [];
    if (items.length) out.courses[c.id] = { items: items };
  });
  return out;
}
// the sets as library entries, once under each registered class they match (shared.js builds the entries)
function builtInLib_() {
  const cls = all_('cls'), seen = {}, courses = [], res = { courses: {} };
  Object.keys(cls).forEach(n => { try { JSON.parse(cls[n]).forEach(name => {
    const key = SX.courseKey(name);
    if (!key || seen[key]) return;
    seen[key] = 1;
    const items = builtInItems_(name);
    if (!items.length) return;
    const id = key.replace(/[^a-z0-9]+/g, '-');
    courses.push({ id: id, name: name });
    res.courses[id] = { items: items.map(it => Object.assign({}, it, { public: true })) };
  }); } catch (e) {} });
  return SX.builtInLibrary(res, courses, PROPS.getProperty('owner') || 'Saxlan');
}
function libSource_(id) {
  const v = get_('res', id);
  if (v) return JSON.parse(v);
  return /^b-/.test(id) ? SX.builtInById(builtInLib_(), id) : null;
}
function rpcListMyRes(k) { const me = auth_(k); return { resources: myRes_(me) }; }
function savePdf_(me, p) {
  const b64 = typeof p.b64 === 'string' ? p.b64.replace(/\s+/g, '') : '';
  if (!/^[A-Za-z0-9+\/]+=*$/.test(b64) || b64.length * 3 / 4 > SX.PDF_MAX) return { error: 'size' };
  if (Utilities.newBlob(Utilities.base64Decode(b64.slice(0, 12))).getDataAsString('ISO-8859-1').indexOf('%PDF') !== 0) return { error: 'not a pdf' };
  const id = rid_('f');
  put_('files', id, JSON.stringify({ owner: me, name: String(p.name || 'document.pdf').slice(0, 120), b64: b64, created: Date.now() }));
  return { id: id };
}
const copyFile_ = (id, me) => { const v = id && get_('files', id); if (!v) return ''; const f = JSON.parse(v), n = rid_('f'); f.owner = me; f.created = Date.now(); put_('files', n, JSON.stringify(f)); return n; };
// authors and their contributors may edit; only the author sets Public/Private, contributors, or deletes
function rpcSaveRes(k, input) {
  const me = auth_(k);
  const c = SX.cleanResource(input);
  if (c.error) return { error: c.error };
  return withLock_(() => {
    const all = resAll_(), ov = input.id ? get_('res', String(input.id)) : null, old = ov ? JSON.parse(ov) : null;
    if (input.id && !old) return { error: 'gone' };
    const m = SX.mergeEdit(old, c.res, me, input, n => !!get_('users', n));
    if (m.error) return m;
    const author = m.res.owner;
    if (!old && ownedCount_(all, me) >= SX.RES_MAX) return { error: 'limit' };
    if (input.pdfData && m.res.type === 'link') {
      if (!(old && old.pdf) && all.filter(r => r.owner === author && r.pdf).length >= SX.PDF_PER_USER) return { error: 'pdf limit' };
      const f = savePdf_(author, input.pdfData); if (f.error) return f;
      m.res.pdf = f.id; m.res.pdfName = String(input.pdfData.name || 'document.pdf').slice(0, 120); m.res.url = '';
    } else if (m.res.pdf && !(old && old.pdf === m.res.pdf)) return { error: 'pdf' };
    const r = SX.reviewMark(old, Object.assign(m.res, { id: old ? old.id : rid_('r') }));
    /* publishing: word and typo checks, then a moderator's approval (shared.js) */
    const pub = SX.modMark(old, r, hasWord_);
    if (old && old.pdf && old.pdf !== r.pdf) del_('files', old.pdf);
    put_('res', r.id, JSON.stringify(r));
    return { ok: true, res: r, publish: pub };
  });
}
// the author deletes a resource; anyone deletes their own downloaded copy
function rpcDeleteRes(k, id) {
  const me = auth_(k);
  return withLock_(() => {
    const v = get_('res', String(id || '')), r = v ? JSON.parse(v) : null;
    if (!r) return { ok: true };
    if (r.owner !== me) return { error: 'not yours' };
    if (r.pdf) del_('files', r.pdf);
    del_('res', r.id);
    return { ok: true };
  });
}
// downloaded copies (all, one class's, or one) follow their source's latest published version; a copy whose source
// went private or away keeps its last version
function rpcResyncRes(k, o) {
  const me = auth_(k), course = String(o && o.course || ''), id = String(o && o.id || '');
  return withLock_(() => {
    let updated = 0;
    resAll_().forEach(r => {
      if (r.owner !== me || !r.from || (course && r.course !== course) || (id && r.id !== id)) return;
      const src = libSource_(r.from.id), f = SX.resyncFields(r, src);
      if (!f) return;
      if ((src.pdf || '') !== (r.srcPdf || '')) { if (r.pdf) del_('files', r.pdf); f.pdf = copyFile_(src.pdf, me); f.srcPdf = src.pdf || ''; }
      Object.assign(r, f, { updated: Date.now() });
      put_('res', r.id, JSON.stringify(r));
      updated++;
    });
    return { ok: true, updated: updated };
  });
}
// your own, a contributor's, or a published resource's PDF (by resource id)
function rpcGetPdf(k, id) {
  const me = auth_(k), rv = get_('res', String(id || '')), r = rv ? JSON.parse(rv) : null;
  const v = r && r.pdf && SX.canSee(r, me) ? get_('files', r.pdf) : null;
  if (!v) return { error: 'gone' };
  const f = JSON.parse(v);
  return { name: f.name, b64: f.b64 };
}
function rpcGetLibrary(k) {
  const me = auth_(k), res = resAll_();
  /* open to everyone; until two of your own are published, downloads have a cooldown (shared.js) */
  const cls = all_('cls'), lists = Object.keys(cls).map(n => { try { return JSON.parse(cls[n]); } catch (e) { return []; } });
  return Object.assign(SX.library(lists, res.concat(builtInLib_())), { wait: isOwner_(me) ? 0 : SX.libWait(res, me, Date.now()) });
}
function rpcImportRes(k, o) {
  const me = auth_(k), id = String(o && o.id || ''), course = String(o && o.course || '');
  const c = (loadUser_(me).settings.courses || []).filter(x => x.id === course)[0];
  if (!c) return { error: 'course' };
  return withLock_(() => {
    const src = libSource_(id);
    if (!SX.published(src)) return { error: 'gone' };
    const all = resAll_();
    if (ownedCount_(all, me) >= SX.RES_MAX) return { error: 'limit' };
    const wait = isOwner_(me) ? 0 : SX.libWait(all, me, Date.now());
    if (wait) return { error: 'cooldown', wait: wait };
    const r = Object.assign({}, src, { id: rid_('r'), owner: me, contributors: [], course: c.id, courseName: c.name, public: false, flagged: [],
      pdf: copyFile_(src.pdf, me), srcPdf: src.pdf || '', srcVer: src.updated, from: { author: src.owner, id: src.id }, created: Date.now(), updated: Date.now() });
    delete r.editedBy; delete r.builtin;
    put_('res', r.id, JSON.stringify(r));
    return { ok: true, res: r };
  });
}

// ---------- dictionary for the publish typo check (dict_<letter>.html, made by push.sh; one lowercase word per line) ----------
const DICT_ = {};
const hasWord_ = w => {
  const l = w.charAt(0);
  if (!/^[a-z]$/.test(l)) return false;
  if (!DICT_[l]) { try { DICT_[l] = new Set(fileText_('dict_' + l).split('\n')); } catch (e) { DICT_[l] = new Set(); } }
  return DICT_[l].has(w);
};
// ---------- administration and moderation ----------
// admins (game-admin) and the owner manage moderators; moderators, admins and the owner approve resources
const isAdmin_ = name => isOwner_(name) || roles_(name).indexOf('game-admin') >= 0;
const isMod_ = name => isAdmin_(name) || roles_(name).indexOf('moderator') >= 0;
function rpcRoles(k, o) {
  const me = auth_(k); o = o || {};
  if (!isMod_(me)) return { error: 'not allowed' };
  if (o.op === 'set') {
    if (!isAdmin_(me)) return { error: 'not allowed' };
    const role = String(o.role || '');
    if (role !== 'moderator' && !(role === 'game-admin' && isOwner_(me))) return { error: 'not allowed' };
    const name = normName_(o.name);
    if (!NAME_RE.test(name) || !rec_(name)) return { error: 'nouser' };
    return withLock_(() => {
      const r = rec_(name), set = (r.roles || []).filter(x => x !== role);
      if (!o.remove) set.push(role);
      r.roles = set; put_('users', name, JSON.stringify(r));
      return rolesList_(me);
    });
  }
  // suggestions and bug reports: administrators (owner and game-admin) only; done deletes them
  if (o.op === 'suggestions' || o.op === 'suggDone') {
    if (!isAdmin_(me)) return { error: 'not allowed' };
    const list = () => { const sg = all_('sugg');
      return { ok: true, suggestions: Object.keys(sg).map(x => { try { const s = JSON.parse(sg[x]); s.user = s.user || 'guest'; return s; } catch (e) { return null; } })
        .filter(Boolean).sort((a, b) => (b.created || 0) - (a.created || 0)) }; };
    if (o.op === 'suggDone') return withLock_(() => {
      (Array.isArray(o.ids) ? o.ids : []).forEach(id => { if (get_('sugg', String(id))) { if (!o.silent) suggDoneNotify_(id); del_('sugg', String(id)); } });
      return list();
    });
    return list();
  }
  return rolesList_(me);
}
function rolesList_(me) {
  const u = all_('users'), admins = [], mods = [], recent = [], owner = PROPS.getProperty('owner') || '';
  Object.keys(u).forEach(n => {
    let r; try { r = JSON.parse(u[n]); } catch (e) { return; }
    const rl = Array.isArray(r.roles) ? r.roles : [];
    if (n === owner || rl.indexOf('game-admin') >= 0) admins.push(n);
    else if (rl.indexOf('moderator') >= 0) mods.push(n);
    recent.push({ name: n, created: r.c || 0, mod: rl.indexOf('moderator') >= 0, admin: n === owner || rl.indexOf('game-admin') >= 0 });
  });
  recent.sort((a, b) => b.created - a.created);
  return { ok: true, admins: admins.sort(), moderators: mods.sort(), recent: recent.slice(0, 30), canEdit: isAdmin_(me), owner: owner };
}
// o: {op:'list'} the documents waiting for approval | {op:'decide', id, ok} approve or turn one down
function rpcModerate(k, o) {
  const me = auth_(k); o = o || {};
  if (!isMod_(me)) return { error: 'not allowed' };
  if (o.op === 'decide') return withLock_(() => {
    const v = get_('res', String(o.id || '')), r = v ? JSON.parse(v) : null;
    if (!r || r.from || r.mod !== 'pending') return { error: 'gone' };
    r.mod = o.ok ? 'ok' : 'no'; r.modBy = me; r.modAt = Date.now();
    put_('res', r.id, JSON.stringify(r));
    return { ok: true };
  });
  const queue = resAll_().filter(r => !r.from && r.mod === 'pending' && r.public)
    .sort((a, b) => (a.updated || 0) - (b.updated || 0))
    .map(r => ({ id: r.id, owner: r.owner, title: r.title, course: r.courseName, type: r.type, url: r.url || '', desc: r.desc || '', pdfName: r.pdfName || '',
      html: r.type === 'doc' ? r.html : '', words: r.type === 'doc' ? SX.wordCount(SX.docText(r.html)) : 0, updated: r.updated || 0 }));
  return { ok: true, queue: queue };
}
// ---------- friends and chat (rules in shared.js) ----------
// chat records are read on every poll, so they are kept in the script cache too (written through on every change)
const SOC_TTL_ = 21600;
const socCacheKey_ = (kind, key) => 'sc_' + kind + '_' + hex_(sha_(bytes_(key))).slice(0, 32);
const socIO_ = () => ({
  get: (kind, key) => {
    const c = CacheService.getScriptCache(), ck = socCacheKey_(kind, key), hit = c.get(ck);
    if (hit !== null) return hit === '\u0000' ? null : hit;
    const v = get_(kind, key);
    if (v === null) c.put(ck, '\u0000', SOC_TTL_); else if (v.length < 90000) c.put(ck, v, SOC_TTL_);
    return v;
  },
  put: (kind, key, v) => { put_(kind, key, v); const c = CacheService.getScriptCache(), ck = socCacheKey_(kind, key); if (v.length < 90000) c.put(ck, v, SOC_TTL_); else c.remove(ck); },
  exists: n => !!get_('users', n), now: () => Date.now(), rand: n => Utilities.getUuid().replace(/-/g, '').slice(0, n),
  isAdmin: n => isAdmin_(n), users: () => Object.keys(all_('users')), site: SITE_NAME_ });
// the name the inbox shows as the sender of the site's own messages
const SITE_NAME_ = 'Saxlan';
// a suggestion marked done: its sender gets a message in their inbox
const suggDoneNotify_ = id => { const v = get_('sugg', String(id)); if (!v) return;
  try { SX.suggDoneNotify(socIO_(), JSON.parse(v), SITE_NAME_); } catch (e) {} };
// avatars: one map of account name to avatar id ('m0'..'m15' modern, 'a0'..'a15' antiques); chat replies carry it
const avMap_ = () => { try { return JSON.parse(get_('meta', 'avatars') || '{}') || {}; } catch (e) { return {}; } };
function rpcAvatar(k, id) {
  const me = auth_(k);
  id = typeof id === 'string' && /^[ma]([0-9]|1[0-5])$/.test(id) ? id : '';
  return withLock_(() => { const m = avMap_(); if (id) m[me] = id; else delete m[me]; put_('meta', 'avatars', JSON.stringify(m)); return { ok: true, av: id }; });
}
function rpcSocial(k, op, args) {
  const me = auth_(k);
  op = String(op || '');
  const run = () => { try { return SX.social(socIO_(), me, op, args); } catch (e) { if (e && e.social) return { error: e.social }; throw e; } };
  /* plain reads skip the lock; reading a conversation marks it read, so it takes the lock like any write */
  const r = op === 'state' ? run() : withLock_(run);
  if (r && typeof r === 'object' && !r.error) r.avs = avMap_();
  return r;
}
// ---------- suggestions and bug reports: work signed out too; a session, if any, names the sender ----------
function rpcSuggest(k, input) {
  ensureStore_();
  let me = ''; try { if (k) me = auth_(k); } catch (e) { me = ''; }
  const c = SX.cleanSuggestion(input);
  if (c.error) return { error: c.error, words: c.words };
  const cache = CacheService.getScriptCache(), n = Number(cache.get('suggN') || 0);
  if (n >= 60) return { error: 'busy' };
  cache.put('suggN', String(n + 1), 3600);
  const id = rid_('s');
  // the sender: the signed-in account, or 'guest' with the device's guest id when signed out
  const dev = !me && input && typeof input.device === 'string' && GUEST_RE_.test(input.device) ? input.device : '';
  withLock_(() => put_('sugg', id, JSON.stringify({ id: id, user: me || 'guest', device: dev, created: Date.now(), status: 'new', kind: c.kind, text: c.text })));
  return { ok: true };
}

// ---------- the functions the page may call (doPost runs nothing else) ----------
const RPC_ = {
  rpcPing: rpcPing, rpcDailyMeme: rpcDailyMeme,
  rpcLevelShare: rpcLevelShare, rpcLevelGet: rpcLevelGet,
  rpcSignup: rpcSignup, rpcLogin: rpcLogin, rpcLogout: rpcLogout, rpcPicSet: rpcPicSet, rpcAvatar: rpcAvatar, rpcPwChange: rpcPwChange, rpcTfa: rpcTfa, rpcSecurity: rpcSecurity, rpcPwInfo: rpcPwInfo, rpcPwCheck: rpcPwCheck, rpcPwReset: rpcPwReset,
  rpcGetData: rpcGetData, rpcSaveTask: rpcSaveTask, rpcDeleteTask: rpcDeleteTask, rpcSaveSettings: rpcSaveSettings,
  rpcSaveNote: rpcSaveNote, rpcDeleteNote: rpcDeleteNote, rpcSaveEvent: rpcSaveEvent, rpcDeleteEvent: rpcDeleteEvent,
  rpcImportIcal: rpcImportIcal,
  rpcListMyRes: rpcListMyRes, rpcSaveRes: rpcSaveRes, rpcDeleteRes: rpcDeleteRes, rpcResyncRes: rpcResyncRes, rpcGetPdf: rpcGetPdf,
  rpcGetLibrary: rpcGetLibrary, rpcImportRes: rpcImportRes, rpcGetResources: rpcGetResources,
  rpcRoles: rpcRoles, rpcModerate: rpcModerate, rpcSocial: rpcSocial, rpcSuggest: rpcSuggest, rpcAnnounce: rpcAnnounce, rpcMemeDrop: rpcMemeDrop, rpcSuggOwner: rpcSuggOwner,
  rpcLoadGame: rpcLoadGame, rpcSaveGame: rpcSaveGame, rpcLoadGuestGame: rpcLoadGuestGame, rpcSaveGuestGame: rpcSaveGuestGame,
  rpcRedeemGuest: rpcRedeemGuest, rpcRoom: rpcRoom
};
