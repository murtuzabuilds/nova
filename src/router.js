// Understands a turn, decides which tool to call, and fills in missing details from
// memory (who you are, where you live) and context (what we were just talking about).
// A real model can replace `route` without the rest of the app changing.

const n = s => s.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();

export function route(text, { memory, context }) {
  const t = n(text);

  // memory writes
  let m;
  if ((m = t.match(/^(?:my name is|call me|i am|i'm) ([a-z][a-z .'-]{1,30})$/)) && !/\b(in|from|at)\b/.test(m[1]))
    return { kind: 'remember', slot: 'name', value: cap(m[1]) };
  if ((m = t.match(/^i (?:live|am based|'m based) in ([a-z .'-]+)$/)) || (m = t.match(/^my city is ([a-z .'-]+)$/)))
    return { kind: 'remember', slot: 'city', value: cap(m[1]) };
  if ((m = t.match(/\b(?:use|i prefer|in) (celsius|fahrenheit)\b/))) return { kind: 'remember', slot: 'units', value: m[1] };
  if (/^remember /.test(t)) { const raw = text.trim().replace(/^remember (?:that )?/i, '').replace(/[.!]+$/, ''); return { kind: 'tool', tool: 'note', args: { text: raw } }; }
  if ((m = t.match(/^forget (?:my )?(name|city|units|notes|everything)$/))) return { kind: 'forget', slot: m[1] === 'everything' ? '*' : m[1] };

  // memory reads
  if (/what(?:'s| is) my name|who am i/.test(t)) return { kind: 'recall', slot: 'name' };
  if (/what do you (?:know|remember) about me/.test(t)) return { kind: 'profile' };
  if (/(?:what are|read|list) my notes/.test(t)) return { kind: 'tool', tool: 'listNotes', args: {} };

  // tools
  if (/\b(weather|forecast|temperature|rain|snow|hot|cold)\b/.test(t) || (context.last.tool === 'weather' && /^(and |what about |how about )/.test(t))) {
    const cityM = t.match(/\b(?:in|for|at) ([a-z .'-]+?)(?: today| tomorrow|$)/);
    const city = cityM ? cap(cityM[1]) : context.last.tool === 'weather' ? context.last.args.city : memory.recall('city');
    const day = /\btomorrow\b/.test(t) ? 'tomorrow' : 'today';
    if (!city) return { kind: 'ask', say: 'Which city? You can also tell me "I live in ..." and I\'ll remember it.' };
    return { kind: 'tool', tool: 'weather', args: { city, day }, filled: cityM ? [] : ['city'] };
  }
  if ((m = text.trim().match(/^(?:translate|how do (?:you|i) say)\s+["“']?(.+?)["”']?\s+(?:to|in|into)\s+([a-z]+)\s*\??$/i)))
    return { kind: 'tool', tool: 'translate', args: { text: m[1], lang: m[2].toLowerCase() } };
  if ((m = t.match(/(?:timer|remind me) (?:for |in )?(\d+) ?(?:min|minute)/))) return { kind: 'tool', tool: 'timer', args: { minutes: +m[1] } };
  if ((m = t.match(/^(?:what is |what's |calculate |compute )?([\d\s.+\-*/()%x]+)$/)) && /\d\s*[+\-*/x%]\s*\d/.test(m[1]))
    return { kind: 'tool', tool: 'calculate', args: { expr: m[1].replace(/x/g, '*').trim() } };
  if (/\b(time|date|day is it)\b/.test(t)) return { kind: 'tool', tool: 'time', args: {} };
  if (/^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/.test(t)) return { kind: 'greet' };
  return { kind: 'fallback' };
}

const cap = s => s.trim().replace(/\b[a-z]/g, c => c.toUpperCase());
