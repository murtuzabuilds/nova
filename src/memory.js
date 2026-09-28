// Long-term memory: small facts the user tells Nova, kept on their device.
// Storage is injected so the same code runs in the browser (localStorage) and in tests (a Map).

export class Memory {
  constructor(store = null, key = 'nova.memory') {
    this.key = key;
    this.store = store;
    this.facts = [];
    try { this.facts = JSON.parse(store?.getItem(key) || '[]'); } catch { this.facts = []; }
  }
  save() { try { this.store?.setItem(this.key, JSON.stringify(this.facts)); } catch { /* private mode */ } }
  remember(slot, value, source = 'user') {
    slot = slot.toLowerCase().trim(); value = value.trim().replace(/[.!]+$/, '');
    this.facts = this.facts.filter(f => f.slot !== slot);
    this.facts.push({ slot, value, source, at: Date.now() });
    this.save();
    return { slot, value };
  }
  recall(slot) { return this.facts.find(f => f.slot === slot.toLowerCase())?.value ?? null; }
  forget(slot) {
    const before = this.facts.length;
    this.facts = slot === '*' ? [] : this.facts.filter(f => f.slot !== slot.toLowerCase());
    this.save();
    return before - this.facts.length;
  }
  all() { return [...this.facts]; }
}

// Short-term context: what the conversation is about right now, so follow-ups work.
export class Context {
  constructor() { this.last = {}; this.turns = []; }
  set(tool, args) { this.last = { tool, args, at: Date.now() }; }
  push(role, text) { this.turns.push({ role, text }); if (this.turns.length > 12) this.turns.shift(); }
}
