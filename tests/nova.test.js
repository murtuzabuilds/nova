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

test('a tool call also returns its structured result, so the UI can draw a card', async () => {
  const nova = make();
  await nova.ask('I live in Madison');
  const r = await nova.ask("what's the weather?");
  assert.deepEqual(r.data, { city: 'Madison', hi: 71, lo: 52, sky: 'partly cloudy', units: 'fahrenheit' });
  assert.equal((await nova.ask('hey')).data, null);
});

test('remembers several facts said in one sentence', async () => {
  const nova = make();
  const a = await nova.ask('My name is Sam and I live in Madison');
  assert.equal(a.say, "Nice to meet you, Sam. I'll remember that, and that you live in Madison.");
  assert.equal(a.trace.filter(s => s.step === 'memory').length, 2);
  assert.equal((await nova.ask("what's my name?")).say, "You're Sam.");
  assert.match((await nova.ask("what's the weather?")).say, /Today in Madison/);
});

test('"I am X from Y" and "I\'m X from Y" give a name and a city', async () => {
  for (const line of ['I am Sam from Chicago', "I'm Sam from Chicago", 'I’m Sam, from Chicago.']) {
    const nova = make();
    assert.match((await nova.ask(line)).say, /Sam.*Chicago/);
    assert.equal(nova.memory.recall('name'), 'Sam');
    assert.equal(nova.memory.recall('city'), 'Chicago');
  }
  const nova = make();
  await nova.ask("I'm from Boston");
  assert.equal(nova.memory.recall('city'), 'Boston');
  assert.equal(nova.memory.recall('name'), null);
});

test('keeps the facts it understood and ignores the rest', async () => {
  const nova = make();
  await nova.ask('I am Sam and I like pizza');
  assert.equal(nova.memory.recall('name'), 'Sam');
  await nova.ask('my name is Ana Lopez and I prefer celsius');
  assert.equal(nova.memory.recall('name'), 'Ana Lopez');
  assert.equal(nova.memory.recall('units'), 'celsius');
});

test('does not mistake feelings or plans for a name', () => {
  const ctx = { memory: new Memory(), context: new Context() };
  for (const line of ["I'm tired", 'I am in a meeting', "I'm going to the store"]) assert.notEqual(route(line, ctx).kind, 'remember', line);
});

test('a follow-up after a weather question with no city asks for one, then accepts a bare city', async () => {
  const nova = make();
  assert.match((await nova.ask("what's the weather?")).say, /Which city/);
  const b = await nova.ask('And tomorrow?');
  assert.match(b.say, /need a city for tomorrow's forecast/);
  assert.equal(b.route.kind, 'ask');
  const c = await nova.ask('Chicago');
  assert.match(c.say, /Tomorrow in Chicago: light rain/);
});

test('a follow-up after a city that was not found says so instead of repeating the miss', async () => {
  const memory = new Memory(mapStore());
  const noPlace = async url => ({ json: async () => (url.includes('geocoding') ? { results: [] } : {}) });
  const nova = new Nova({ memory, context: new Context(), fetchImpl: noPlace });
  assert.match((await nova.ask('weather in Atlantis')).say, /couldn't find Atlantis/);
  const b = await nova.ask('And tomorrow?');
  assert.match(b.say, /couldn't find Atlantis earlier.*Which city/);
});

test('a follow-up after a network error retries the same city', async () => {
  let down = true;
  const flaky = async url => { if (down) throw new Error('offline'); return fakeFetch(url); };
  const nova = new Nova({ memory: new Memory(mapStore()), context: new Context(), fetchImpl: flaky });
  assert.match((await nova.ask('weather in Chicago')).say, /didn't answer/);
  down = false;
  assert.match((await nova.ask('And tomorrow?')).say, /Tomorrow in Chicago/);
});

test('a follow-up with nothing before it gets a helpful nudge, not the generic fallback', async () => {
  const r = await make().ask('And tomorrow?');
  assert.equal(r.route.kind, 'ask');
  assert.match(r.say, /weather in Madison tomorrow/);
});

test('"weather in Chicago and tomorrow" keeps the city clean', () => {
  const r = route('weather in Chicago and tomorrow', { memory: new Memory(), context: new Context() });
  assert.deepEqual(r.args, { city: 'Chicago', day: 'tomorrow' });
});
