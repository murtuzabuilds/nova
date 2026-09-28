// Tools Nova can call. Each returns { say, data } so the UI can speak and show the trace.
// fetchImpl and clock are injectable so every tool is testable offline.

const WMO = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'foggy', 48: 'foggy', 51: 'drizzly', 53: 'drizzly', 55: 'drizzly', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'showers', 81: 'showers', 82: 'heavy showers', 95: 'stormy' };

export function makeTools({ fetchImpl = globalThis.fetch, now = () => new Date(), memory, timers = [] } = {}) {
  return {
    async weather({ city, day = 'today' }) {
      const geo = await (await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`)).json();
      const place = geo.results?.[0];
      if (!place) return { say: `I couldn't find ${city}.`, data: null };
      const units = memory?.recall('units') === 'celsius' ? 'celsius' : 'fahrenheit';
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=${units}&timezone=auto&forecast_days=2`;
      const f = await (await fetchImpl(url)).json();
      const i = day === 'tomorrow' ? 1 : 0, u = units === 'celsius' ? '°C' : '°F';
      const hi = Math.round(f.daily.temperature_2m_max[i]), lo = Math.round(f.daily.temperature_2m_min[i]);
      const sky = WMO[f.daily.weather_code[i]] ?? 'mixed';
      return { say: `${day === 'tomorrow' ? 'Tomorrow' : 'Today'} in ${place.name}: ${sky}, high of ${hi}${u}, low of ${lo}${u}.`, data: { city: place.name, hi, lo, sky, units } };
    },
    time() {
      const d = now();
      return { say: `It's ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} on ${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}.`, data: { iso: d.toISOString() } };
    },
    calculate({ expr }) {
      if (!/^[\d\s.+\-*/()%]+$/.test(expr)) return { say: "I can only do plain arithmetic.", data: null };
      const value = Function(`"use strict"; return (${expr})`)();
      const rounded = Math.round(value * 1e6) / 1e6;
      return { say: `That's ${rounded.toLocaleString()}.`, data: { expr, value: rounded } };
    },
    timer({ minutes }) {
      const t = { id: timers.length + 1, minutes, endsAt: now().getTime() + minutes * 60000 };
      timers.push(t);
      return { say: `Timer set for ${minutes} minute${minutes === 1 ? '' : 's'}.`, data: t };
    },
    note({ text }) {
      const notes = JSON.parse(memory?.recall('notes') || '[]');
      notes.push(text);
      memory?.remember('notes', JSON.stringify(notes), 'tool');
      return { say: `Noted. You have ${notes.length} note${notes.length === 1 ? '' : 's'}.`, data: { notes } };
    },
    listNotes() {
      const notes = JSON.parse(memory?.recall('notes') || '[]');
      return { say: notes.length ? `Your notes: ${notes.join('; ')}.` : 'You have no notes yet.', data: { notes } };
    },
  };
}
