// The assistant: route → (tool call) → reply, with a trace of every decision.
import { route } from './router.js';
import { makeTools } from './tools.js';

export class Nova {
  constructor({ memory, context, fetchImpl, now } = {}) {
    this.memory = memory; this.context = context;
    this.tools = makeTools({ fetchImpl, now, memory });
  }

  async ask(text) {
    const trace = [];
    const r = route(text, { memory: this.memory, context: this.context });
    trace.push({ step: 'understand', detail: r.kind === 'tool' ? `intent: ${r.tool}` : `intent: ${r.kind}` });
    this.context.push('user', text);
    let say;
    const name = this.memory.recall('name');

    switch (r.kind) {
      case 'remember':
        this.memory.remember(r.slot, r.value);
        trace.push({ step: 'memory', detail: `saved ${r.slot} = ${r.value}` });
        say = r.slot === 'name' ? `Nice to meet you, ${r.value}. I'll remember that.` : `Got it, I'll remember your ${r.slot} is ${r.value}.`;
        break;
      case 'forget': {
        const k = this.memory.forget(r.slot);
        trace.push({ step: 'memory', detail: `forgot ${r.slot} (${k})` });
        say = r.slot === '*' ? 'Done. I have forgotten everything about you.' : `Done, I forgot your ${r.slot}.`;
        break;
      }
      case 'recall':
        say = name ? `You're ${name}.` : "You haven't told me your name yet.";
        trace.push({ step: 'memory', detail: `read name → ${name ?? 'empty'}` });
        break;
      case 'profile': {
        const facts = this.memory.all().filter(f => f.slot !== 'notes');
        say = facts.length ? `Here's what I know: ${facts.map(f => `your ${f.slot} is ${f.value}`).join(', ')}.` : "Nothing yet. Tell me your name or where you live.";
        break;
      }
      case 'tool': {
        if (r.filled?.length) trace.push({ step: 'context', detail: `filled ${r.filled.join(', ')} from ${this.context.last.tool === r.tool ? 'the last turn' : 'memory'}` });
        trace.push({ step: 'tool', detail: `${r.tool}(${Object.entries(r.args).map(([k, v]) => `${k}=${v}`).join(', ')})` });
        try {
          const out = await this.tools[r.tool](r.args);
          say = out.say;
          this.context.set(r.tool, r.args);
          trace.push({ step: 'result', detail: out.data ? JSON.stringify(out.data).slice(0, 120) : 'no data' });
        } catch (e) {
          say = "That tool didn't answer. Check your connection and try again.";
          trace.push({ step: 'error', detail: String(e.message || e) });
        }
        break;
      }
      case 'ask': say = r.say; break;
      case 'greet': say = name ? `Hey ${name}, what can I do?` : 'Hi, I am Nova. Ask about the weather, set a timer, or tell me your name.'; break;
      default: say = "I can check the weather, tell the time, do math, set timers and remember things. Try: \"what's the weather tomorrow?\"";
    }
    this.context.push('nova', say);
    return { say, trace, route: r };
  }
}
