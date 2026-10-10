// Understands a turn, decides which tool to call, and fills in missing details from
// memory (who you are, where you live) and context (what we were just talking about).
// A real model can replace `route` without the rest of the app changing.

const n = s => s.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();

export function route(text, { memory, context }) {
  const t = n(text);
  let m;

  // memory writes: one fact ("my name is Sam") or several in one breath
  // ("my name is Sam and I live in Madison", "I'm Sam from Chicago")
  const facts = parseFacts(text);
  if (facts.length) return { kind: 'remember', slot: facts[0].slot, value: facts[0].value, facts };
  if ((m = t.match(/\b(?:use|i prefer|in) (celsius|fahrenheit)\b/))) return { kind: 'remember', slot: 'units', value: m[1] };
  if (/^remember /.test(t)) { const raw = text.trim().replace(/^remember (?:that )?/i, '').replace(/[.!]+$/, ''); return { kind: 'tool', tool: 'note', args: { text: raw } }; }
  if ((m = t.match(/^forget (?:my )?(name|city|units|notes|everything)$/))) return { kind: 'forget', slot: m[1] === 'everything' ? '*' : m[1] };

  // memory reads
  if (/what(?:'s| is) my name|who am i/.test(t)) return { kind: 'recall', slot: 'name' };
  if (/what do you (?:know|remember) about me/.test(t)) return { kind: 'profile' };
  if (/(?:what are|read|list) my notes/.test(t)) return { kind: 'tool', tool: 'listNotes', args: {} };

  // tools
  const followUp = /^(and|what about|how about)\b/.test(t);
  const day = /\btomorrow\b/.test(t) ? 'tomorrow' : 'today';
  // a weather follow-up after a lookup that did not work: say what is missing instead of guessing
  if (followUp && context.last.tool !== 'weather' && (context.failed?.tool === 'weather' || context.pending?.tool === 'weather') && !/\b(?:in|for|at) [a-z]/.test(t)) {
    const city = context.failed?.args?.city;
    if (context.failed?.reason === 'error' && city) return { kind: 'tool', tool: 'weather', args: { city, day }, filled: ['city'] };
    return { kind: 'ask', tool: 'weather', day, say: city
      ? `I couldn't find ${city} earlier, so I don't have a place for ${day}'s forecast. Which city should I check?`
      : `I still need a city for ${day}'s forecast. Try "weather in Chicago ${day}", or tell me "I live in ..." and I'll remember it.` };
  }
  // the answer to "Which city?": a bare place name
  if (context.pending?.tool === 'weather' && (m = t.match(/^(?:in |for |it's |its )?([a-z][a-z .'-]{1,30})$/)) && t.split(' ').length <= 4 && !/\b(no|nevermind|never mind|cancel|stop|hi|hey|hello|what|how|who|when|why|time|date|timer|remind|translate|remember|forget|my|i|me|you|is|are|use|set|call)\b/.test(t))
    return { kind: 'tool', tool: 'weather', args: { city: cap(m[1].replace(/ (today|tomorrow)$/, '')), day: /\btomorrow\b/.test(t) ? 'tomorrow' : context.pending.day || 'today' }, filled: [] };
  if (/\b(weather|forecast|temperature|rain|snow|hot|cold)\b/.test(t) || (context.last.tool === 'weather' && followUp)) {
    const cityM = t.match(/\b(?:in|for|at) ([a-z .'-]+?)(?: and)?(?: today| tomorrow|$)/);
    const city = cityM ? cap(cityM[1]) : context.last.tool === 'weather' ? context.last.args.city : memory.recall('city');
    if (!city) return { kind: 'ask', tool: 'weather', day, say: 'Which city? You can also tell me "I live in ..." and I\'ll remember it.' };
    return { kind: 'tool', tool: 'weather', args: { city, day }, filled: cityM ? [] : ['city'] };
  }
  if ((m = text.trim().match(/^(?:translate|how do (?:you|i) say)\s+["“']?(.+?)["”']?\s+(?:to|in|into)\s+([a-z]+)\s*\??$/i)))
    return { kind: 'tool', tool: 'translate', args: { text: m[1], lang: m[2].toLowerCase() } };
  if ((m = t.match(/(?:timer|remind me) (?:for |in )?(\d+) ?(?:min|minute)/))) return { kind: 'tool', tool: 'timer', args: { minutes: +m[1] } };
  if ((m = t.match(/^(?:what is |what's |calculate |compute )?([\d\s.+\-*/()%x]+)$/)) && /\d\s*[+\-*/x%]\s*\d/.test(m[1]))
    return { kind: 'tool', tool: 'calculate', args: { expr: m[1].replace(/x/g, '*').trim() } };
  if (/\b(time|date|day is it)\b/.test(t)) return { kind: 'tool', tool: 'time', args: {} };
  if (/^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/.test(t)) return { kind: 'greet' };
  if (followUp && /\b(today|tomorrow|tonight|there)\b/.test(t))
    return { kind: 'ask', say: 'Tell me a bit more and I can help. For example: "weather in Madison tomorrow".' };
  return { kind: 'fallback' };
}

const cap = s => s.trim().replace(/\b[a-z]/g, c => c.toUpperCase());

// Words that follow "I'm" without being a name ("I'm tired", "I'm back").
const NOT_NAMES = new Set('a an the not so very really just still also here there back home fine good great ok okay well tired hungry sleepy bored busy ready done sure sorry new lost looking going trying thinking working planning free cold hot sick happy sad excited'.split(' '));
const NAME = "([a-z][a-z.'-]*(?: [a-z][a-z.'-]*){0,2})";
const PLACE = "([a-z][a-z .'-]{1,30})";

// One clause → the facts in it. "i'm sam from chicago" gives a name and a city.
function parseClause(c) {
  let m;
  if ((m = c.match(new RegExp(`^(?:my name is|my name's|call me|i am|i'm|im|this is) ${NAME} (?:from|in) ${PLACE}$`)))) {
    const name = nameOf(m[1]); return name ? [{ slot: 'name', value: name }, { slot: 'city', value: cap(m[2]) }] : [];
  }
  if ((m = c.match(new RegExp(`^(?:i live|i am based|i'm based|im based|i'm living|i am living) in ${PLACE}$`))) || (m = c.match(new RegExp(`^(?:i am|i'm|im) from ${PLACE}$`))) || (m = c.match(new RegExp(`^my (?:city|hometown|home town) is ${PLACE}$`))))
    return [{ slot: 'city', value: cap(m[1]) }];
  if ((m = c.match(/^(?:use|i prefer|i like) (celsius|fahrenheit)$/))) return [{ slot: 'units', value: m[1] }];
  if ((m = c.match(new RegExp(`^(?:my name is|my name's|call me|i am|i'm|im) ${NAME}$`)))) {
    const name = nameOf(m[1]); return name ? [{ slot: 'name', value: name }] : [];
  }
  return [];
}
function nameOf(s) {
  const w = s.trim().split(' ');
  if (NOT_NAMES.has(w[0]) || w.some(x => /^(in|from|at|and|to|the)$/.test(x))) return null;
  return cap(s);
}
// Split a turn into clauses on "and" and commas; keep the facts from every clause that has one.
export function parseFacts(text) {
  const t = text.toLowerCase().replace(/[’]/g, "'").replace(/[?!]/g, ' ').replace(/\.(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^remember\b/.test(t)) return [];
  const clauses = t.split(/\s*,\s*(?:and\s+)?|\s+and\s+(?:also\s+)?/).map(c => c.trim()).filter(Boolean);
  const first = parseClause(clauses[0]);
  if (!first.length) return [];   // only treat it as "about me" when it starts that way
  const out = [...first];
  for (const c of clauses.slice(1)) {
    // "my name is Sam and Madison is home" stays partial; "... and I live in Madison" adds the city
    const tail = c.match(new RegExp(`^(?:from|living in|based in) ${PLACE}$`));
    for (const f of tail ? [{ slot: 'city', value: cap(tail[1]) }] : parseClause(c)) { const i = out.findIndex(x => x.slot === f.slot); if (i >= 0) out[i] = f; else out.push(f); }
  }
  return out;
}
