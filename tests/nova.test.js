import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Memory, Context } from '../src/memory.js';
import { route } from '../src/router.js';
import { Nova } from '../src/nova.js';

const mapStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const fakeFetch = async url => ({
  json: async () => url.includes('geocoding')
    ? { results: [{ name: decodeURIComponent(url.match(/name=([^&]+)/)[1]).replace(/\b\w/g, c => c.toUpperCase()), latitude: 43.07, longitude: -89.4 }] }
    : url.includes('mymemory') ? { responseData: { translatedText: 'Hola, ¿cómo estás?' } }
    : { daily: { temperature_2m_max: [71.4, 64.2], temperature_2m_min: [52.1, 48.9], weather_code: [2, 61] } },
});
const make = () => { const memory = new Memory(mapStore()); return new Nova({ memory, context: new Context(), fetchImpl: fakeFetch, now: () => new Date('2026-09-28T15:30:00') }); };

test('remembers a name and uses it later', async () => {
  const nova = make();
  assert.match((await nova.ask('My name is Murtuza')).say, /Murtuza/);
  assert.equal((await nova.ask("what's my name?")).say, "You're Murtuza.");
  assert.match((await nova.ask('hey')).say, /Hey Murtuza/);
});

test('fills the city from memory, then handles a follow-up from context', async () => {
  const nova = make();
  await nova.ask('I live in Madison');
  const a = await nova.ask("what's the weather?");
  assert.match(a.say, /Today in Madison: partly cloudy, high of 71°F/);
  assert.ok(a.trace.some(s => s.step === 'context' && /memory/.test(s.detail)));
  const b = await nova.ask('and tomorrow?');
  assert.match(b.say, /Tomorrow in Madison: light rain/);
  assert.ok(b.trace.some(s => /last turn/.test(s.detail)));
});

test('asks for a city when it has none', async () => {
  assert.match((await make().ask('will it rain today')).say, /Which city/);
});

test('unit preference changes the forecast units', async () => {
  const nova = make();
  await nova.ask('use celsius');
  assert.match((await nova.ask('weather in Chicago')).say, /°C/);
});

test('math, timers and notes are tool calls', async () => {
  const nova = make();
  assert.equal((await nova.ask('what is 12 x 7')).say, "That's 84.");
  assert.match((await nova.ask('set a timer for 5 minutes')).say, /5 minutes/);
  await nova.ask('remember that the demo is on Friday');
  assert.match((await nova.ask('what are my notes')).say, /demo is on friday/i);
});

test('forget clears memory', async () => {
  const nova = make();
  await nova.ask('call me Mo');
  await nova.ask('forget everything');
  assert.match((await nova.ask('who am i')).say, /haven't told me/);
});

test('router refuses code in the calculator', () => {
  assert.equal(route('alert(1)', { memory: new Memory(), context: new Context() }).kind, 'fallback');
});

test('memory persists across sessions through the store', () => {
  const store = mapStore();
  new Memory(store).remember('city', 'Madison');
  assert.equal(new Memory(store).recall('city'), 'Madison');
});

test('translate is a tool call with language detection', async () => {
  const r = await make().ask('Translate "Hello, how are you?" to Spanish');
  assert.equal(r.say, 'In Spanish: Hola, ¿cómo estás?');
  assert.ok(r.trace.some(s => /translate\(text=Hello, how are you\?, lang=spanish\)/.test(s.detail)));
});
