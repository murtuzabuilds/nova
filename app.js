import { Memory, Context } from './src/memory.js';
import { Nova } from './src/nova.js';

const $ = id => document.getElementById(id);
const store = (() => { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return localStorage; } catch { return null; } })();
const memory = new Memory(store), nova = new Nova({ memory, context: new Context() });
let level = 0, mode = 'idle', screen = 'home';
const HKEY = 'nova.history';
let history = (() => { try { return JSON.parse(store?.getItem(HKEY) || '[]'); } catch { return []; } })();

/* ---------- navigation between the three screens ---------- */
function go(to, prefill) {
  screen = to;
  for (const id of ['home', 'chat', 'voice']) $(id).hidden = id !== to;
  if (to === 'chat') { if (prefill) { $('q').value = prefill; } $('q').focus(); }
  if (to === 'home') renderHome();
  if (to !== 'voice') { rec?.stop(); }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go, b.dataset.prefill); });
$('menuBtn').addEventListener('click', () => $('side').classList.toggle('open'));

/* ---------- conversation ---------- */
async function send(text, { fromVoice = false } = {}) {
  text = text.trim(); if (!text) return;
  add('you', text); setMode('thinking', 'Thinking…');
  if (fromVoice) $('said').textContent = text;
  const { say, trace, route } = await nova.ask(text);
  showTrace(trace); add('nova', say); renderMemory(); remember(text, say, route);
  if (fromVoice || screen === 'voice') $('said').textContent = say;
  speak(say);
}
function remember(q, a, r) {
  const label = r.kind === 'tool' ? { weather: 'Weather check', translate: 'Speak Any Language', calculate: 'Quick math', timer: 'Timer', note: 'Saved a note', listNotes: 'Your notes', time: 'Time and date' }[r.tool] || 'Smart Chat'
    : r.kind === 'remember' ? 'Nova remembered' : 'Talk Without Limits';
  history.unshift({ label, q, a, at: Date.now() }); history = history.slice(0, 12);
  try { store?.setItem(HKEY, JSON.stringify(history)); } catch {}
}
function add(who, text) { const li = document.createElement('li'); li.className = who; li.textContent = text; $('log').append(li); $('log').scrollTop = 1e9; }
function showTrace(trace) {
  $('trace').innerHTML = '';
  trace.forEach((t, i) => setTimeout(() => { const li = document.createElement('li'); li.innerHTML = '<b></b>'; li.firstChild.textContent = t.step; li.append(t.detail); $('trace').append(li); }, i * 110));
}
function renderMemory() {
  const facts = memory.all();
  $('mem').innerHTML = facts.length ? '' : '<li class="empty">Nothing yet. Tell Nova your name or where you live.</li>';
  for (const f of facts) { const li = document.createElement('li'); li.innerHTML = '<span></span><b></b>'; li.children[0].textContent = f.slot; li.children[1].textContent = f.slot === 'notes' ? `${JSON.parse(f.value).length} saved` : f.value; $('mem').append(li); }
  renderHome();
}
function renderHome() {
  const name = memory.recall('name');
  $('hi').textContent = name ? `Hi, ${name}` : 'Hi there';
  $('avatar').textContent = (name || 'N')[0].toUpperCase();
  const seed = [{ label: 'Talk Without Limits', q: 'Converse naturally, Nova keeps the context' }, { label: 'Speak Any Language', q: 'Translate a phrase into 12 languages' }, { label: 'Say It, Know Instantly', q: 'Weather, time and quick math by voice' }];
  const rows = history.length ? history.slice(0, 4) : seed;
  $('histCount').textContent = history.length ? `${history.length} recent` : 'Try these';
  $('hist').innerHTML = '';
  for (const h of rows) {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button'; b.innerHTML = '<span class="hi2">◌</span><span><b></b><small></small></span><span class="ar">↗</span>';
    b.querySelector('b').textContent = h.label; b.querySelector('small').textContent = h.q;
    b.addEventListener('click', () => go('chat', history.length ? h.q : ''));
    li.append(b); $('hist').append(li);
  }
}

/* ---------- voice out ---------- */
function speak(text) {
  if (!$('speak').checked || !('speechSynthesis' in window)) return setMode('idle', 'Tap the mic. How can I assist?');
  const u = new SpeechSynthesisUtterance(text); u.rate = 1.03;
  u.onstart = () => setMode('speaking', 'Speaking…'); u.onboundary = () => { level = .9; };
  u.onend = u.onerror = () => setMode('idle', 'Tap the mic. How can I assist?');
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
$('pause').addEventListener('click', () => { speechSynthesis?.cancel(); setMode('idle', 'Tap the mic. How can I assist?'); });

/* ---------- voice in ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, meter = null;
$('mic').addEventListener('click', async () => {
  if (!SR) { setMode('idle', 'Voice needs Chrome, Edge or Safari. Typing works everywhere.'); return; }
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
  rec.onresult = e => { const r = e.results[e.results.length - 1]; $('said').textContent = r[0].transcript; if (r.isFinal) send(r[0].transcript, { fromVoice: true }); };
  rec.onend = () => { rec = null; $('mic').classList.remove('on'); meter?.stop(); if (mode === 'listening') setMode('idle', 'Tap the mic. How can I assist?'); };
  rec.onerror = e => setMode('idle', e.error === 'not-allowed' ? 'Microphone blocked. Allow it in the address bar.' : "Didn't catch that. Try again?");
  $('mic').classList.add('on'); setMode('listening', "I'm listening. How can I assist?"); rec.start();
  meter = await micLevel();
});
async function micLevel() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 256; ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount); let on = true;
    (function tick() { if (!on) return; an.getByteFrequencyData(buf); level = Math.max(level, buf.reduce((a, b) => a + b, 0) / buf.length / 90); requestAnimationFrame(tick); })();
    return { stop() { on = false; stream.getTracks().forEach(t => t.stop()); ctx.close(); } };
  } catch { return null; }
}

function setMode(m, label) { mode = m; if (label) $('state').textContent = label; }
$('bar').addEventListener('submit', e => { e.preventDefault(); const t = $('q').value; $('q').value = ''; send(t); });
$('chips').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') send(e.target.textContent); });
$('forget').addEventListener('click', () => { memory.forget('*'); history = []; try { store?.removeItem(HKEY); } catch {} renderMemory(); add('nova', 'Done. I have forgotten everything about you.'); });
renderMemory();
add('nova', memory.recall('name') ? `Welcome back, ${memory.recall('name')}.` : 'Hi, I am Nova. I remember what you tell me and I can use tools. Try a suggestion below.');

/* ---------- the Nova orb: an indigo-to-blue sphere with a voice wave running through it ---------- */
const cv = $('orb'), c = cv.getContext('2d');
let smooth = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (screen !== 'voice') return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const t = ts / 1000; level *= .92; smooth += (level - smooth) * .15;
  const energy = { idle: .15, listening: .45, thinking: .7, speaking: .6 }[mode] + smooth;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * .4;
  const glow = c.createRadialGradient(cx, cy, R * .2, cx, cy, R * 1.25);
  glow.addColorStop(0, 'rgba(166,109,212,.55)'); glow.addColorStop(.6, 'rgba(64,59,161,.35)'); glow.addColorStop(1, 'transparent');
  c.fillStyle = glow; c.fillRect(0, 0, w, h);
  const body = c.createRadialGradient(cx - R * .3, cy - R * .35, R * .1, cx, cy, R);
  body.addColorStop(0, '#6E7BFF'); body.addColorStop(.55, '#403BA1'); body.addColorStop(1, '#1A1650');
  c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fillStyle = body; c.fill();
  c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip(); c.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 5; k++) {
    c.beginPath();
    const amp = R * (.08 + energy * .22) * (1 - k * .15), ph = t * (1.6 + k * .4) + k;
    for (let x = -R; x <= R; x += 3) {
      const env = Math.cos((x / R) * Math.PI / 2) ** 2;
      const y = Math.sin(x / R * (3 + k) + ph) * amp * env;
      x === -R ? c.moveTo(cx + x, cy + y) : c.lineTo(cx + x, cy + y);
    }
    c.strokeStyle = ['rgba(255,255,255,.85)', 'rgba(143,196,255,.7)', 'rgba(0,199,190,.5)', 'rgba(166,109,212,.6)', 'rgba(255,255,255,.35)'][k];
    c.lineWidth = k ? 1.6 : 2.4; c.shadowColor = '#8FC4FF'; c.shadowBlur = 12; c.stroke();
  }
  c.restore();
  c.beginPath(); c.arc(cx, cy, R, 0, 7); c.strokeStyle = 'rgba(184,168,240,.35)'; c.lineWidth = 1; c.stroke();
}
requestAnimationFrame(frame);
