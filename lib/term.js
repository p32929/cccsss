'use strict';
// Terminal plumbing: ANSI styling, key decoding, and the three widgets the app
// needs (list, text input, viewport). No dependencies — just escape sequences
// and raw-mode stdin, kept to the small surface cccsss actually uses.

const { spawnSync } = require('node:child_process');

// ---------- ANSI ----------

const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

const stripANSI = (s) => s.replace(ANSI_RE, '');

// style builds a renderer for one look. Styles are not nested anywhere in the
// app, so a plain prefix/reset pair is enough.
function style({ fg, bg, bold, italic } = {}) {
  let pre = '';
  if (fg != null) pre += `${ESC}[38;5;${fg}m`;
  if (bg != null) pre += `${ESC}[48;5;${bg}m`;
  if (bold) pre += `${ESC}[1m`;
  if (italic) pre += `${ESC}[3m`;
  if (!pre) return (s) => s;
  return (s) => pre + s + RESET;
}

// visLen counts printable characters, ignoring escape sequences.
const visLen = (s) => [...stripANSI(s)].length;

// truncVis cuts a styled string to max visible characters, keeping the escape
// sequences intact so colour never bleeds past the cut.
function truncVis(s, max) {
  if (max <= 0) return '';
  if (visLen(s) <= max) return s;
  let out = '';
  let seen = 0;
  let i = 0;
  let styled = false;
  while (i < s.length) {
    if (s[i] === ESC) {
      const end = s.indexOf('m', i);
      if (end === -1) break;
      out += s.slice(i, end + 1);
      styled = true;
      i = end + 1;
      continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(i));
    if (seen >= max) break;
    out += ch;
    seen++;
    i += ch.length;
  }
  return styled ? out + RESET : out;
}

// padVis right-pads to an exact visible width.
const padVis = (s, w) => s + ' '.repeat(Math.max(0, w - visLen(s)));

// ---------- screen ----------

const alt = {
  enter: () => process.stdout.write(`${ESC}[?1049h${ESC}[?25l`),
  exit: () => process.stdout.write(`${ESC}[?25h${ESC}[?1049l`),
};

// draw paints one full frame: every line truncated to the terminal width and
// cleared to the right, so no stale pixels survive between frames.
function draw(body) {
  const rows = process.stdout.rows || 24;
  const cols = process.stdout.columns || 80;
  const lines = body.split('\n').slice(0, rows).map((l) => truncVis(l, cols) + `${ESC}[K`);
  while (lines.length < rows) lines.push(`${ESC}[K`);
  process.stdout.write(`${ESC}[H` + lines.join('\r\n'));
}

// ---------- keys ----------

const SEQ = {
  '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left',
  '\x1bOA': 'up', '\x1bOB': 'down', '\x1bOC': 'right', '\x1bOD': 'left',
  '\x1b[5~': 'pgup', '\x1b[6~': 'pgdn',
  '\x1b[H': 'home', '\x1b[F': 'end', '\x1b[1~': 'home', '\x1b[4~': 'end',
  '\x1bOH': 'home', '\x1bOF': 'end',
  '\x1b[3~': 'delete',
};

// decode turns one stdin chunk into key names. A chunk can hold several keys
// (key repeat, paste), so it is consumed in a loop rather than matched once.
function decode(chunk) {
  const s = chunk.toString('utf8');
  const keys = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\x1b') {
      let matched = null;
      for (const seq of Object.keys(SEQ)) {
        if (s.startsWith(seq, i) && (!matched || seq.length > matched.length)) matched = seq;
      }
      if (matched) { keys.push(SEQ[matched]); i += matched.length; continue; }
      keys.push('esc'); i++; continue;
    }
    if (c === '\x03') { keys.push('ctrl+c'); i++; continue; }
    if (c === '\r' || c === '\n') { keys.push('enter'); i++; continue; }
    if (c === '\x7f' || c === '\b') { keys.push('backspace'); i++; continue; }
    if (c === '\t') { keys.push('tab'); i++; continue; }
    if (c < ' ') { i++; continue; } // other control bytes: ignore
    const ch = String.fromCodePoint(s.codePointAt(i));
    keys.push(ch);
    i += ch.length;
  }
  return keys;
}

// printable is true for keys that should be typed into a text field.
const printable = (k) => [...k].length === 1 && k >= ' ';

// ---------- clipboard ----------

// Shells out to whatever the platform ships; there is no dependency-free way
// to reach the clipboard from Node itself.
function copyToClipboard(text) {
  const tools = process.platform === 'darwin'
    ? [['pbcopy', []]]
    : process.platform === 'win32'
      ? [['clip', []]]
      : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const [cmd, args] of tools) {
    const r = spawnSync(cmd, args, { input: text });
    if (!r.error && r.status === 0) return null;
  }
  return 'no clipboard tool available';
}

// ---------- widgets ----------

// fuzzy is a subsequence match: every character of the query appears in order.
function fuzzy(query, target) {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return q.length === 0;
}

// TextInput is a single-line field: value plus a cursor.
class TextInput {
  constructor({ prompt = '> ', placeholder = '', limit = 4096 } = {}) {
    this.prompt = prompt;
    this.placeholder = placeholder;
    this.limit = limit;
    this.value = '';
    this.cursor = 0;
    this.focused = false;
  }
  set(v) { this.value = v; this.cursor = [...v].length; }
  clear() { this.set(''); }
  key(k) {
    const r = [...this.value];
    if (k === 'backspace') {
      if (this.cursor > 0) { r.splice(this.cursor - 1, 1); this.value = r.join(''); this.cursor--; }
    } else if (k === 'delete') {
      if (this.cursor < r.length) { r.splice(this.cursor, 1); this.value = r.join(''); }
    } else if (k === 'left') { this.cursor = Math.max(0, this.cursor - 1); }
    else if (k === 'right') { this.cursor = Math.min(r.length, this.cursor + 1); }
    else if (k === 'home') { this.cursor = 0; }
    else if (k === 'end') { this.cursor = r.length; }
    else if (printable(k) && r.length < this.limit) {
      r.splice(this.cursor, 0, k); this.value = r.join(''); this.cursor++;
    }
  }
  view(dim, cursorStyle) {
    if (this.value === '') return this.prompt + dim(this.placeholder);
    const r = [...this.value];
    const at = r[this.cursor] ?? ' ';
    if (!this.focused) return this.prompt + this.value;
    return this.prompt + r.slice(0, this.cursor).join('') + cursorStyle(at) + r.slice(this.cursor + 1).join('');
  }
}

// Viewport is a scrollable window over pre-rendered lines.
class Viewport {
  constructor() { this.lines = []; this.offset = 0; this.height = 10; this.width = 80; }
  setContent(s) { this.lines = s.split('\n'); this.clampOffset(); }
  get max() { return Math.max(0, this.lines.length - this.height); }
  clampOffset() { this.offset = Math.min(Math.max(0, this.offset), this.max); }
  setOffset(n) { this.offset = n; this.clampOffset(); }
  top() { this.offset = 0; }
  bottom() { this.offset = this.max; }
  scrollPercent() {
    if (this.lines.length <= this.height) return 1;
    return this.offset / this.max;
  }
  key(k) {
    switch (k) {
      case 'up': case 'k': this.setOffset(this.offset - 1); break;
      case 'down': case 'j': this.setOffset(this.offset + 1); break;
      case 'pgup': case 'b': this.setOffset(this.offset - this.height); break;
      case 'pgdn': case ' ': case 'f': this.setOffset(this.offset + this.height); break;
    }
  }
  view() {
    const out = this.lines.slice(this.offset, this.offset + this.height);
    while (out.length < this.height) out.push('');
    return out.join('\n');
  }
}

// List is a scrolling, filterable list of two-line items.
// Filter states: 'off', 'filtering' (typing a query), 'applied'.
class List {
  constructor(title, styles) {
    this.title = title;
    this.st = styles;
    this.items = [];
    this.index = 0;
    this.offset = 0;
    this.width = 80;
    this.height = 20;
    this.filterState = 'off';
    this.filter = new TextInput({ prompt: 'Filter: ', placeholder: '…', limit: 200 });
  }
  setItems(items) {
    this.items = items;
    if (this.index >= this.visible().length) this.index = Math.max(0, this.visible().length - 1);
  }
  setSize(w, h) { this.width = w; this.height = h; }
  resetSelected() { this.index = 0; this.offset = 0; }
  visible() {
    const q = this.filter.value.trim();
    if (this.filterState === 'off' || q === '') return this.items;
    return this.items.filter((it) => fuzzy(q, it.filterValue));
  }
  selected() { return this.visible()[this.index] ?? null; }
  select(i) { this.index = Math.max(0, Math.min(i, this.visible().length - 1)); }
  // rows available for items, after the title block
  get perPage() { return Math.max(1, Math.floor((Math.max(0, this.height - 2) + 1) / 3)); }
  key(k) {
    if (this.filterState === 'filtering') {
      if (k === 'enter') { this.filterState = this.filter.value.trim() ? 'applied' : 'off'; this.filter.focused = false; this.index = 0; return; }
      if (k === 'esc') { this.filterState = 'off'; this.filter.clear(); this.filter.focused = false; this.index = 0; return; }
      this.filter.key(k);
      this.index = 0;
      return;
    }
    const n = this.visible().length;
    switch (k) {
      case '/': this.filterState = 'filtering'; this.filter.focused = true; break;
      case 'up': case 'k': this.index = Math.max(0, this.index - 1); break;
      case 'down': case 'j': this.index = Math.min(n - 1, this.index + 1); break;
      case 'pgup': this.index = Math.max(0, this.index - this.perPage); break;
      case 'pgdn': this.index = Math.min(n - 1, this.index + this.perPage); break;
      case 'home': case 'g': this.index = 0; break;
      case 'end': case 'G': this.index = n - 1; break;
    }
    if (this.index < 0) this.index = 0;
  }
  view() {
    const s = this.st;
    const items = this.visible();
    const per = this.perPage;
    if (this.index < this.offset) this.offset = this.index;
    if (this.index >= this.offset + per) this.offset = this.index - per + 1;
    if (this.offset > Math.max(0, items.length - per)) this.offset = Math.max(0, items.length - per);

    const head = this.filterState === 'filtering'
      ? ' ' + this.filter.view(s.dim, s.cursor)
      : s.listTitle(' ' + this.title + ' ');
    const out = [head, ''];
    if (items.length === 0) {
      out.push(' ' + s.dim('  no items'));
    }
    const win = items.slice(this.offset, this.offset + per);
    win.forEach((it, i) => {
      const sel = this.offset + i === this.index;
      const w = Math.max(10, this.width - 4);
      const bar = sel ? s.selBar('│') + ' ' : '  ';
      out.push(' ' + bar + (sel ? s.selTitle : s.normTitle)(truncVis(it.title, w)));
      out.push(' ' + bar + (sel ? s.selDesc : s.normDesc)(truncVis(it.desc, w)));
      if (i < win.length - 1) out.push('');
    });
    while (out.length < this.height) out.push('');
    return out.slice(0, this.height).join('\n');
  }
}

module.exports = {
  ESC, RESET, style, stripANSI, visLen, truncVis, padVis,
  alt, draw, decode, printable, copyToClipboard, fuzzy,
  TextInput, Viewport, List,
};
