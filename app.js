import { Memory, Context } from './src/memory.js';
import { Nova } from './src/nova.js';

const $ = id => document.getElementById(id);
const store = (() => { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return localStorage; } catch { return null; } })();
const memory = new Memory(store), nova = new Nova({ memory, context: new Context() });
let level = 0, mode = 'idle'; // idle | listening | thinking | speaking

/* ---------- conversation ---------- */
async function send(text) {
  text = text.trim(); if (!text) return;
  add('you', text); setMode('thinking', 'Thinking');
  const { say, trace } = await nova.ask(text);
  showTrace(trace); add('nova', say); renderMemory();
  speak(say);
}
function add(who, text) {
  const li = document.createElement('li'); li.className = who; li.textContent = text;
  $('log').append(li); $('log').scrollTop = 1e9;
}
function showTrace(trace) {
  $('trace').innerHTML = '';
  trace.forEach((t, i) => setTimeout(() => {
    const li = document.createElement('li'); li.innerHTML = `<b>${t.step}</b>`; li.append(t.detail); $('trace').append(li);
  }, i * 120));
}
function renderMemory() {
  const facts = memory.all();
  $('mem').innerHTML = facts.length ? '' : '<li class="empty">Nothing yet. Tell Nova your name or where you live.</li>';
  for (const f of facts) {
    const li = document.createElement('li');
    const v = f.slot === 'notes' ? `${JSON.parse(f.value).length} saved` : f.value;
    li.innerHTML = `<span></span><b></b>`; li.children[0].textContent = f.slot; li.children[1].textContent = v;
    $('mem').append(li);
  }
}

/* ---------- voice out ---------- */
function speak(text) {
  if (!$('speak').checked || !('speechSynthesis' in window)) return setMode('idle', 'Tap the mic or type below');
  const u = new SpeechSynthesisUtterance(text); u.rate = 1.03;
  u.onstart = () => setMode('speaking', 'Speaking');
  u.onboundary = () => { level = .9; };
  u.onend = u.onerror = () => setMode('idle', 'Tap the mic or type below');
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

/* ---------- voice in ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, meter = null;
if (!SR) { $('mic').title = 'Voice input needs Chrome, Edge or Safari. Typing works everywhere.'; }
$('mic').addEventListener('click', async () => {
  if (!SR) { setMode('idle', 'Voice input is not supported in this browser, type instead'); return; }
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
  rec.onresult = e => { const r = e.results[e.results.length - 1]; $('q').value = r[0].transcript; if (r.isFinal) { const t = $('q').value; $('q').value = ''; send(t); } };
  rec.onend = () => { rec = null; $('mic').classList.remove('on'); meter?.stop(); if (mode === 'listening') setMode('idle', 'Tap the mic or type below'); };
  rec.onerror = e => setMode('idle', e.error === 'not-allowed' ? 'Microphone blocked. Allow it in the address bar.' : 'Didn\'t catch that');
  $('mic').classList.add('on'); setMode('listening', 'Listening'); rec.start();
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

/* ---------- UI wiring ---------- */
function setMode(m, label) { mode = m; $('state').textContent = label; }
$('bar').addEventListener('submit', e => { e.preventDefault(); const t = $('q').value; $('q').value = ''; send(t); });
$('chips').addEventListener('click', e => { if (e.target.tagName === 'BUTTON') send(e.target.textContent); });
$('forget').addEventListener('click', () => { memory.forget('*'); renderMemory(); add('nova', 'Done. I have forgotten everything about you.'); });
renderMemory();
add('nova', memory.recall('name') ? `Welcome back, ${memory.recall('name')}.` : 'Hi, I am Nova. I remember what you tell me and I can use tools. Try a suggestion below.');

/* ---------- the orb: a particle sphere that breathes with the conversation ---------- */
const cv = $('orb'), c = cv.getContext('2d'), N = 900, pts = [];
for (let i = 0; i < N; i++) { const z = 1 - 2 * (i + .5) / N, r = Math.sqrt(1 - z * z), t = i * Math.PI * (3 - Math.sqrt(5)); pts.push([r * Math.cos(t), r * Math.sin(t), z]); }
let smooth = 0;
function frame(ts) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const t = ts / 1000; level *= .92; smooth += (level - smooth) * .15;
  const energy = { idle: .05, listening: .25, thinking: .5, speaking: .35 }[mode] + smooth;
  const R = Math.min(w, h) * .34 * (1 + energy * .12), ay = t * (.25 + energy * .8), ax = .35;
  for (const [x0, y0, z0] of pts) {
    let x = x0 * Math.cos(ay) + z0 * Math.sin(ay), z = -x0 * Math.sin(ay) + z0 * Math.cos(ay);
    let y = y0 * Math.cos(ax) - z * Math.sin(ax); z = y0 * Math.sin(ax) + z * Math.cos(ax);
    const wob = 1 + energy * .18 * Math.sin(t * 6 + x0 * 7 + y0 * 5);
    const px = w / 2 + x * R * wob, py = h / 2 + y * R * wob, d = (z + 1) / 2;
    c.globalAlpha = .15 + d * .85; c.fillStyle = mode === 'thinking' && (x0 * 13 + t * 4) % 2 < .2 ? '#fff' : d > .6 ? '#8FB4FF' : '#4F8BFF';
    const s = .7 + d * 1.6; c.fillRect(px - s / 2, py - s / 2, s, s);
  }
  c.globalAlpha = 1; requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
