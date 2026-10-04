import { Memory, Context } from './src/memory.js';
import { Nova } from './src/nova.js';

const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];
const store = (() => { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return localStorage; } catch { return null; } })();
const get = (k, d = null) => { try { return store?.getItem(k) ?? d; } catch { return d; } };
const put = (k, v) => { try { store?.setItem(k, v); } catch { /* private mode */ } };
const memory = new Memory(store), nova = new Nova({ memory, context: new Context() });
const ico = (id, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };

let level = 0, mode = 'idle', screen = 'home';
const SCREENS = ['splash', 'home', 'chat', 'voice', 'history', 'settings'];
const IDLE = 'Tap the mic. How can I assist?';

/* ---------- talks: every conversation is kept in this browser ---------- */
const HKEY = 'nova.history';
let talks = (() => {
  try {
    const raw = JSON.parse(get(HKEY, '[]'));
    // older builds stored one row per turn: lift each into a one-turn talk
    return raw.map((t, i) => t.turns ? t : { id: `t${t.at || i}`, at: t.at || Date.now(), turns: [{ q: t.q, a: t.a, label: t.label, trace: [], route: { kind: 'saved' }, data: null, at: t.at }] });
  } catch { return []; }
})();
let cur = null;
const saveTalks = () => put(HKEY, JSON.stringify(talks.slice(0, 20).map(t => ({ ...t, turns: t.turns.slice(-30) }))));
const TOOL_LABEL = { weather: 'Weather check', translate: 'Speak Any Language', calculate: 'Quick maths', timer: 'Timer', note: 'Saved a note', listNotes: 'Your notes', time: 'Time and date' };
const labelOf = t => t.label || (t.route?.kind === 'tool' ? TOOL_LABEL[t.route.tool] || 'Smart Chat' : t.route?.kind === 'remember' ? 'Nova remembered' : 'Talk Without Limits');
const iconOf = t => t.voice ? 'i-mic' : t.route?.tool === 'translate' ? 'i-translate' : 'i-chat';

/* ---------- navigation: Home, Conversations, Voice Assistant, Settings ---------- */
function go(to, prefill) {
  if (!SCREENS.includes(to)) to = 'home';
  screen = to; closeMenu(); $('info').hidden = true; $('infoBtn').setAttribute('aria-expanded', 'false');
  for (const id of SCREENS) $(id).hidden = id !== to;
  document.body.dataset.screen = to;
  if (to === 'chat') {
    if (!$('log').children.length) openTalk(cur);
    if (prefill) $('q').value = prefill;
    if (matchMedia('(hover:hover)').matches) $('q').focus();
    $('log').scrollTop = 1e9;
  }
  if (to === 'home') renderHome();
  if (to === 'history') renderTalks();
  if (to === 'settings') renderMemory();
  if (to !== 'voice' && to !== 'chat') rec?.stop();
  if (to !== 'splash') put('nova.seen', '1');
}
document.addEventListener('click', e => {
  const m = e.target.closest('[data-menu]'); if (m) return toggleMenu();
  const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go, b.dataset.prefill);
});
function toggleMenu() { const open = $('menu').hidden; $('menu').hidden = !open; $('scrim').hidden = !open; }
function closeMenu() { $('menu').hidden = true; $('scrim').hidden = true; }
$('scrim').addEventListener('click', closeMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); $('info').hidden = true; } });
$('start').addEventListener('click', () => go('home'));
$('infoBtn').addEventListener('click', () => { const open = $('info').hidden; $('info').hidden = !open; $('infoBtn').setAttribute('aria-expanded', String(open)); });

let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 1800); }

/* ---------- conversation ---------- */
async function send(text, { fromVoice = false } = {}) {
  text = text.trim(); if (!text) return;
  if (!cur) { cur = { id: `t${Date.now()}`, at: Date.now(), turns: [] }; }
  addUser(text); setMode('thinking', 'Thinking…');
  if (fromVoice) $('said').textContent = text;
  $('voiceHow').hidden = true;
  const { say, trace, route, data } = await nova.ask(text);
  const turn = { q: text, a: say, trace, route, data: data ?? null, voice: fromVoice, at: Date.now() };
  cur.turns.push(turn); cur.at = turn.at;
  talks = [cur, ...talks.filter(t => t !== cur)]; saveTalks();
  showTrace(trace); addNova(turn, { fresh: true }); renderMemory();
  if (fromVoice || screen === 'voice') { $('said').textContent = say; $('voiceHow').hidden = false; }
  speak(say);
}

function addUser(text) { const li = el('li', 'you'); li.textContent = text; $('log').append(li); $('log').scrollTop = 1e9; }

const STEP = { understand: 'Understood', memory: 'Memory', context: 'Filled in', tool: 'Tool call', result: 'Result', error: 'Error' };
// the trace is shown as the logic wrote it; a tool result that is whole JSON is only laid out as "key: value"
function pretty(t) {
  if (t.step !== 'result') return t.detail;
  try { const o = JSON.parse(t.detail); return Object.entries(o).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') || 'none' : v}`).join(' · '); } catch { return t.detail; }
}
function stepRow(t) { const li = el('li', `s-${t.step}`, '<b></b><span></span>'); li.children[0].textContent = STEP[t.step] || t.step; li.children[1].textContent = pretty(t); return li; }

function addNova(turn, { fresh = false, intro = false } = {}) {
  const li = el('li', 'nova' + (intro ? ' intro' : ''));
  li.innerHTML = `<span class="spark">${ico('i-spark')}</span><div class="body"></div>`;
  const body = li.lastChild;
  const card = cardFor(turn); if (card) body.append(card);
  const p = el('p', 'say'); p.textContent = turn.a; body.append(p);
  if (!intro) {
    const acts = el('div', 'acts',
      `<button type="button" data-act="copy" aria-label="Copy reply">${ico('i-copy')}</button>` +
      `<button type="button" data-act="up" aria-label="Mark helpful" aria-pressed="${turn.rate === 1}">${ico('i-up')}</button>` +
      `<button type="button" data-act="down" aria-label="Mark not helpful" aria-pressed="${turn.rate === -1}">${ico('i-downv')}</button>` +
      `<button type="button" data-act="say" aria-label="Read aloud">${ico('i-speak')}</button>` +
      `<button type="button" data-act="again" aria-label="Ask again">${ico('i-retry')}</button>` +
      (turn.trace?.length ? `<button type="button" class="how" data-act="how" aria-expanded="false">How Nova got this${ico('i-down')}</button>` : ''));
    body.append(acts);
    if (turn.trace?.length) { const ol = el('ol', 'steps'); ol.hidden = true; turn.trace.forEach(t => ol.append(stepRow(t))); body.append(ol); }
    acts.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'copy') { navigator.clipboard?.writeText(turn.a).then(() => toast('Copied'), () => toast('Copy is blocked here')); }
      if (a === 'up' || a === 'down') {
        const v = a === 'up' ? 1 : -1; turn.rate = turn.rate === v ? 0 : v; saveTalks();
        acts.querySelector('[data-act=up]').setAttribute('aria-pressed', turn.rate === 1);
        acts.querySelector('[data-act=down]').setAttribute('aria-pressed', turn.rate === -1);
        if (turn.rate) toast('Noted, in this browser only');
      }
      if (a === 'say') speak(turn.a, true);
      if (a === 'again') send(turn.q);
      if (a === 'how') { const ol = body.querySelector('.steps'); ol.hidden = !ol.hidden; b.setAttribute('aria-expanded', String(!ol.hidden)); if (!ol.hidden) { showTrace(turn.trace); if (li === $('log').lastElementChild) $('log').scrollTop = 1e9; else ol.scrollIntoView({ block: 'nearest' }); } }
    });
  }
  if (!fresh) li.style.animation = 'none';
  $('log').append(li); $('log').scrollTop = 1e9;
  return li;
}

/* tool results as cards, the way the Talk with Nova AI board shows visual replies */
const SKY = [[/storm/, 'w-storm'], [/snow/, 'w-snow'], [/rain|drizzl|shower/, 'w-rain'], [/fog/, 'w-fog'], [/partly/, 'w-part'], [/overcast|mixed/, 'w-cloud'], [/clear/, 'w-sun']];
const LANG = { es: 'Spanish', fr: 'French', de: 'German', hi: 'Hindi', ar: 'Arabic', ja: 'Japanese', zh: 'Chinese', it: 'Italian', pt: 'Portuguese', ko: 'Korean', ur: 'Urdu', bn: 'Bengali' };
function cardFor(turn) {
  const d = turn.data, r = turn.route; if (!d || r?.kind !== 'tool') return null;
  const c = el('div', `tcard tc-${r.tool}`);
  const set = (sel, v) => { c.querySelector(sel).textContent = v; };
  if (r.tool === 'weather') {
    const u = d.units === 'celsius' ? '°C' : '°F', g = SKY.find(([re]) => re.test(d.sky))?.[1] || 'w-cloud';
    c.innerHTML = `<svg class="wx" aria-hidden="true"><use href="#${g}"/></svg><div><small></small><b></b><em></em></div><div class="hl"><span><i>High</i><b></b></span><span><i>Low</i><b></b></span></div><p class="src">Forecast from Open-Meteo</p>`;
    set('div small', r.args.day === 'tomorrow' ? 'Tomorrow' : 'Today'); set('div b', d.city); set('div em', d.sky);
    const hl = c.querySelectorAll('.hl b'); hl[0].textContent = `${d.hi}${u}`; hl[1].textContent = `${d.lo}${u}`;
  } else if (r.tool === 'translate') {
    c.innerHTML = `<div class="pair"><small>English</small><p></p></div><div class="pair to"><small></small><p></p></div><p class="src">Translation from MyMemory</p>`;
    const ps = c.querySelectorAll('.pair p'); ps[0].textContent = d.text; ps[1].textContent = d.out; set('.to small', LANG[d.lang] || d.lang);
  } else if (r.tool === 'calculate') {
    c.innerHTML = `<small>Quick maths</small><p class="big"><span></span><b></b></p>`;
    set('.big span', `${d.expr.replace(/\*/g, '×').replace(/\//g, '÷')} =`); set('.big b', d.value.toLocaleString());
  } else if (r.tool === 'time') {
    const t = new Date(d.iso);
    c.innerHTML = `<small></small><p class="big"><b></b></p>`;
    set('small', t.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })); set('.big b', t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  } else if (r.tool === 'timer') {
    c.innerHTML = `<small>Timer</small><p class="big"><b class="count"></b></p>`;
    c.querySelector('.count').dataset.ends = d.endsAt; tick();
  } else if (r.tool === 'note' || r.tool === 'listNotes') {
    if (!d.notes.length) return null;
    c.innerHTML = `<small>Notes</small><ul></ul>`;
    for (const n of d.notes) { const li = el('li'); li.textContent = n; c.querySelector('ul').append(li); }
  } else return null;
  return c;
}
function tick() {
  for (const n of $$('.count')) {
    const left = Math.max(0, Math.round((+n.dataset.ends - Date.now()) / 1000));
    n.textContent = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Done';
  }
}
setInterval(tick, 1000);

/* open a talk in the chat screen; null starts a fresh one */
function openTalk(talk) {
  cur = talk || null; $('log').innerHTML = '';
  nova.context = new Context();
  if (!cur) {
    const name = memory.recall('name');
    addNova({ a: name ? `Welcome back, ${name}.` : 'Hi, I am Nova. I remember what you tell me and I can use tools. Try a suggestion below.' }, { intro: true });
    return;
  }
  for (const t of cur.turns) {
    addUser(t.q); addNova(t);
    nova.context.push('user', t.q); nova.context.push('nova', t.a);
    if (t.route?.kind === 'tool' && t.data) nova.context.set(t.route.tool, t.route.args);   // follow-ups keep working after reopening
  }
  const last = cur.turns.at(-1); if (last?.trace?.length) showTrace(last.trace);
}

/* ---------- the larger trace and memory view beside the phone ---------- */
function showTrace(trace) {
  $('trace').innerHTML = '';
  trace.forEach((t, i) => { const li = stepRow(t); li.style.animationDelay = `${i * 90}ms`; $('trace').append(li); });
}
const SLOT = { name: ['Name', 's-person'], city: ['City', 's-pin'], units: ['Units', 's-temp'], notes: ['Notes', 's-note'] };
function renderMemory() {
  const facts = memory.all();
  $('mem').innerHTML = facts.length ? '' : '<li class="empty">Nothing yet. Tell Nova your name or where you live.</li>';
  $('setMem').innerHTML = facts.length ? '' : `<li class="none">${ico('s-person', 'g')}<span>Nothing yet</span><em>Tell Nova your name or where you live</em></li>`;
  for (const f of facts) {
    const [label, glyph] = SLOT[f.slot] || [f.slot, 's-note'];
    const value = f.slot === 'notes' ? `${JSON.parse(f.value).length} saved` : f.value;
    const li = el('li', '', '<span></span><b></b>'); li.children[0].textContent = label; li.children[1].textContent = value; $('mem').append(li);
    const row = el('li', '', `${ico(glyph, 'g')}<span></span><em></em><button type="button" class="x">${ico('i-close')}</button>`);
    row.children[1].textContent = label; row.children[2].textContent = value;
    row.lastChild.setAttribute('aria-label', `Forget ${label.toLowerCase()}`);
    row.lastChild.addEventListener('click', () => { memory.forget(f.slot); renderMemory(); toast(`${label} forgotten`); });
    $('setMem').append(row);
  }
  $('forget').disabled = $('forgetSide').disabled = !facts.length && !talks.length;
  $('clearHist').disabled = !talks.length;
  greet();
}
function greet() {
  const name = memory.recall('name');
  for (const n of $$('[data-hi]')) n.textContent = name ? `Hi, ${name}` : 'Hi there';
  for (const n of $$('[data-avatar]')) n.textContent = (name || 'N')[0].toUpperCase();
}

/* ---------- home ---------- */
const SEED = [
  { label: 'Talk Without Limits', q: 'Converse naturally, Nova keeps the context', icon: 'i-chat', to: 'chat' },
  { label: 'Speak Any Language', q: 'Break language barriers with a phrase in 12 languages', icon: 'i-translate', to: 'chat', prefill: 'Translate "Where is the train station?" to Spanish' },
  { label: 'Say It, Know Instantly', q: 'Speak in your language and hear weather, time and quick maths', icon: 'i-mic', to: 'voice' },
  { label: 'Seamless Talk', q: 'Follow-ups carry over from the last turn', icon: 'i-chat', to: 'chat', prefill: 'And tomorrow?' },
];
function renderHome() {
  greet();
  const rows = talks.length ? talks.slice(0, 4).map(t => ({ talk: t, label: labelOf(t.turns.at(-1)), q: t.turns.at(-1).q, icon: iconOf(t.turns.at(-1)) })) : SEED;
  $('hist').innerHTML = '';
  for (const h of rows) {
    const li = el('li'), b = el('button', '', `<span class="hi2">${ico(h.icon)}</span><span class="tx"><b></b><small></small></span>${ico('i-arrowlg', 'i ar')}`);
    b.type = 'button'; b.querySelector('b').textContent = h.label; b.querySelector('small').textContent = h.q;
    b.addEventListener('click', () => { if (h.talk) { openTalk(h.talk); go('chat'); } else { if (h.to === 'chat') openTalk(null); go(h.to, h.prefill); } });
    li.append(b); $('hist').append(li);
  }
}

/* ---------- conversations, grouped the way the board groups them ---------- */
function renderTalks() {
  const box = $('talks'); box.innerHTML = '';
  if (!talks.length) { box.innerHTML = '<p class="none">No talks yet. Start one with New Talk and it will be kept here, in this browser.</p>'; return; }
  const now = new Date(), day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), D = 864e5;
  const groups = [['Today', t => t.at >= day0], ['Last week', t => t.at >= day0 - 7 * D], ['Last month', t => t.at >= day0 - 31 * D], ['Earlier', () => true]];
  const left = [...talks];
  for (const [name, test] of groups) {
    const mine = left.filter(test); if (!mine.length) continue;
    mine.forEach(t => left.splice(left.indexOf(t), 1));
    box.append(el('h2', 'grp', name));
    const ul = el('ul', 'rows');
    for (const t of mine) {
      const li = el('li', '', `<button type="button" class="open">${ico(t.turns.some(x => x.voice) ? 'i-mic' : 'i-chat')}<span></span></button><button type="button" class="del" hidden>Delete</button><button type="button" class="more" aria-label="More">${ico('i-dots')}</button>`);
      const title = t.turns[0].q; li.querySelector('span').textContent = title[0].toUpperCase() + title.slice(1);
      li.querySelector('.open').addEventListener('click', () => { openTalk(t); go('chat'); });
      li.querySelector('.more').addEventListener('click', () => { const d = li.querySelector('.del'); d.hidden = !d.hidden; });
      li.querySelector('.del').addEventListener('click', () => { talks = talks.filter(x => x !== t); if (cur === t) { cur = null; $('log').innerHTML = ''; } saveTalks(); renderTalks(); renderMemory(); toast('Talk deleted'); });
      ul.append(li);
    }
    box.append(ul);
  }
}
$('newTalk').addEventListener('click', () => { openTalk(null); go('chat'); });

/* ---------- settings: memory, speech, history ---------- */
function clearHistory() { talks = []; cur = null; $('log').innerHTML = ''; saveTalks(); try { store?.removeItem(HKEY); } catch { /* private mode */ } }
function forgetAll() {
  memory.forget('*'); clearHistory(); nova.context = new Context();
  $('trace').innerHTML = '<li class="empty">Every step of the last reply appears here: what Nova understood, what it filled in from memory or the last turn, and which tool it called.</li>';
  renderMemory(); renderHome(); if (screen === 'history') renderTalks();
  addNova({ a: 'Done. I have forgotten everything about you.' }, { intro: true });
  toast('Memory and history cleared');
}
$('forget').addEventListener('click', forgetAll);
$('forgetSide').addEventListener('click', forgetAll);
$('clearHist').addEventListener('click', () => { clearHistory(); renderMemory(); renderHome(); toast('History deleted'); });
$('speak').checked = get('nova.speak', '1') === '1';
$('speak').addEventListener('change', () => { put('nova.speak', $('speak').checked ? '1' : '0'); if (!$('speak').checked) speechSynthesis?.cancel(); });
$('lang').value = get('nova.lang', 'en-US'); if (!$('lang').value) $('lang').value = 'en-US';
$('lang').addEventListener('change', () => put('nova.lang', $('lang').value));

/* ---------- voice out ---------- */
function speak(text, force = false) {
  if ((!force && !$('speak').checked) || !('speechSynthesis' in window)) return setMode('idle', IDLE);
  const u = new SpeechSynthesisUtterance(text); u.rate = 1.03; u.lang = $('lang').value;
  u.onstart = () => setMode('speaking', 'Speaking…'); u.onboundary = () => { level = .9; };
  u.onend = u.onerror = () => setMode('idle', IDLE);
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
for (const b of $$('[data-stop]')) b.addEventListener('click', () => { speechSynthesis?.cancel(); rec?.stop(); setMode('idle', IDLE); });

/* ---------- voice in ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, meter = null;
const micOn = on => { for (const b of $$('[data-mic]')) b.classList.toggle('on', on); };
for (const b of $$('[data-mic]')) b.addEventListener('click', async () => {
  if (!SR) { setMode('idle', 'Voice needs Chrome, Edge or Safari. Typing works everywhere.'); if (screen === 'chat') { toast('Voice needs Chrome, Edge or Safari'); $('q').focus(); } return; }
  if (rec) { rec.stop(); return; }
  const heard = t => { if (screen === 'voice') $('said').textContent = t; else $('q').value = t; };
  rec = new SR(); rec.lang = $('lang').value; rec.interimResults = true;
  rec.onresult = e => { const r = e.results[e.results.length - 1]; heard(r[0].transcript); if (r.isFinal) { if (screen !== 'voice') $('q').value = ''; send(r[0].transcript, { fromVoice: true }); } };
  rec.onend = () => { rec = null; micOn(false); meter?.stop(); if (mode === 'listening') setMode('idle', IDLE); };
  rec.onerror = e => setMode('idle', e.error === 'not-allowed' ? 'Microphone blocked. Allow it in the address bar.' : "Didn't catch that. Try again?");
  micOn(true); setMode('listening', "I'm listening. How can I assist?"); rec.start();
  meter = await micLevel();
});
async function micLevel() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 256; ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount); let on = true;
    (function loop() { if (!on) return; an.getByteFrequencyData(buf); level = Math.max(level, buf.reduce((a, b) => a + b, 0) / buf.length / 90); requestAnimationFrame(loop); })();
    return { stop() { on = false; stream.getTracks().forEach(t => t.stop()); ctx.close(); } };
  } catch { return null; }
}

function setMode(m, label) {
  mode = m;
  if (label) $('state').textContent = label;
  $('q').placeholder = m === 'listening' ? "I'm listening" : m === 'thinking' ? 'Thinking…' : 'Ask Nova anything';
}
$('bar').addEventListener('submit', e => { e.preventDefault(); const t = $('q').value; $('q').value = ''; send(t); });
$('chips').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') send(e.target.textContent); });
$('voiceHow').addEventListener('click', () => {
  go('chat');
  const b = [...$('log').querySelectorAll('.how')].at(-1);
  if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
  $('log').scrollTop = 1e9;
});

/* ---------- the Nova orb: an indigo sphere with a ribbon of light, as on the Voice Assistant board ---------- */
const cv = $('orb'), c = cv.getContext('2d');
let smooth = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (screen !== 'voice') return;
  const dpr = Math.min(3, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t = still ? 2.4 : ts / 1000; level *= .92; smooth += (level - smooth) * .15;
  const energy = { idle: .34, listening: .6, thinking: .8, speaking: .7 }[mode] + smooth * .6;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * .395;

  // soft halo behind the sphere
  const halo = c.createRadialGradient(cx, cy, R * .94, cx, cy, R * 1.14);
  halo.addColorStop(0, 'rgba(84,74,214,.34)'); halo.addColorStop(.45, 'rgba(64,59,161,.1)'); halo.addColorStop(1, 'rgba(64,59,161,0)');
  c.fillStyle = halo; c.fillRect(0, 0, w, h);
  // the sphere: dark core, lighter glass towards the rim
  const body = c.createRadialGradient(cx, cy + R * .12, R * .05, cx, cy, R);
  body.addColorStop(0, '#120F46'); body.addColorStop(.5, '#1A1568'); body.addColorStop(.8, '#27208C'); body.addColorStop(.94, '#352CB0'); body.addColorStop(1, '#4A40D0');
  c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fillStyle = body; c.fill();
  c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip();
  const top = c.createRadialGradient(cx - R * .55, cy - R * .8, 0, cx - R * .55, cy - R * .8, R * 1.1);
  top.addColorStop(0, 'rgba(120,110,255,.15)'); top.addColorStop(.6, 'rgba(96,88,235,.05)'); top.addColorStop(1, 'rgba(96,88,235,0)');
  c.fillStyle = top; c.fillRect(cx - R, cy - R, R * 2, R * 2);
  const rim = c.createRadialGradient(cx - R * .95, cy + R * .45, 0, cx - R * .95, cy + R * .45, R * .9);
  rim.addColorStop(0, 'rgba(96,86,255,.5)'); rim.addColorStop(1, 'rgba(96,86,255,0)');
  c.fillStyle = rim; c.fillRect(cx - R, cy - R, R * 2, R * 2);

  // waveform: translucent lobes above and below the line, fine outlines, then the white core
  c.globalCompositeOperation = 'lighter';
  const env = x => Math.max(0, Math.cos(((x + R * .08) / R) * Math.PI / 2)) ** 1.1;
  const bump = (x, f, ph, sp) => Math.max(0, Math.sin(x / R * f + ph + t * sp));
  const LOBE = [[4.6, .4, .9, 'rgba(150,140,255,.26)', 'rgba(255,255,255,.75)'], [6.2, 2.1, -.7, 'rgba(116,128,255,.22)', 'rgba(196,202,255,.6)'], [3.4, 3.6, .55, 'rgba(166,109,212,.2)', 'rgba(214,190,255,.5)'], [7.6, 5.0, -1.1, 'rgba(127,180,255,.16)', 'rgba(170,205,255,.45)']];
  LOBE.forEach(([f, ph, sp, fill, line], k) => {
    const amp = R * (.27 + energy * .3) * (1 - k * .1);
    const up = x => -env(x) * amp * bump(x, f, ph, sp) * (.65 + .35 * Math.sin(x / R * 1.3 + k));
    const dn = x => env(x) * amp * .8 * bump(x, f * .9, ph + 2.2, -sp * .8);
    c.beginPath();
    for (let x = -R; x <= R; x += 2) x === -R ? c.moveTo(cx + x, cy + up(x)) : c.lineTo(cx + x, cy + up(x));
    for (let x = R; x >= -R; x -= 2) c.lineTo(cx + x, cy + dn(x));
    c.closePath(); c.fillStyle = fill; c.fill();
    const fade = c.createLinearGradient(cx - R, 0, cx + R, 0);
    fade.addColorStop(.08, 'rgba(255,255,255,0)'); fade.addColorStop(.3, line); fade.addColorStop(.72, line); fade.addColorStop(.94, 'rgba(255,255,255,0)');
    c.strokeStyle = fade; c.lineWidth = k ? .8 : 1.1; c.shadowColor = '#9D95FF'; c.shadowBlur = 6; c.stroke();
  });
  c.shadowBlur = 0;
  const flare = (ox, rx, ry, a) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(.3, `rgba(228,224,255,${a * .55})`); g.addColorStop(1, 'rgba(160,150,255,0)');
    c.save(); c.translate(cx + ox, cy); c.scale(rx, ry); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 1, 0, 7); c.fill(); c.restore();
  };
  flare(R * .05, R * .8, R * (.014 + energy * .01), .6);              // the thin line across
  flare(-R * .36, R * .52, R * (.05 + energy * .035), 1);             // the bright core, left of centre
  flare(-R * .46, R * .26, R * (.1 + energy * .07), .75);
  c.restore();
  c.globalCompositeOperation = 'source-over';
  c.beginPath(); c.arc(cx, cy, R - .5, 0, 7); c.strokeStyle = 'rgba(150,140,255,.4)'; c.lineWidth = 1; c.stroke();
}
requestAnimationFrame(frame);

/* ---------- start ---------- */
renderMemory();
const first = location.hash.slice(1);
go(SCREENS.includes(first) ? first : get('nova.seen') ? 'home' : 'splash');
