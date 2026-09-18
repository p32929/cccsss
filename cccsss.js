#!/usr/bin/env node
'use strict';
// cccsss — browse Claude Code sessions and get the command to resume any of them.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const D = require('./lib/data');
const T = require('./lib/term');

// ---------- styles ----------

const S = {
  title: T.style({ fg: 81, bold: true }),
  footer: T.style({ fg: 245 }),
  resume: T.style({ fg: 42, bold: true }),
  err: T.style({ fg: 203 }),
  dim: T.style({ fg: 240 }),
  user: T.style({ fg: 214, bold: true }),
  claude: T.style({ fg: 81, bold: true }),
  tool: T.style({ fg: 141 }),
  think: T.style({ fg: 244, italic: true }),
  errTurn: T.style({ fg: 203 }),
  spin: T.style({ fg: 81 }),
  load: T.style({ fg: 81, bold: true }),
  sticky: T.style({ fg: 214, bg: 236, bold: true }),
  status: T.style({ fg: 42, bold: true }),
  label: T.style({ fg: 245 }),
  value: T.style({ fg: 245, bold: true }),
  // list chrome
  listTitle: T.style({ fg: 230, bg: 62, bold: true }),
  selBar: T.style({ fg: 170 }),
  selTitle: T.style({ fg: 170, bold: true }),
  selDesc: T.style({ fg: 139 }),
  normTitle: T.style({ fg: 252 }),
  normDesc: T.style({ fg: 244 }),
  cursor: (s) => '\x1b[7m' + s + '\x1b[0m',
};

const SEP = S.dim(' · ');
const field = (name, val) => S.label(name + ': ') + S.value(val);
const pad = (s) => ' ' + s;
const atLeast = (n, min) => (n < min ? min : n);
const orDash = (s) => s || '—';
const quoteOr = (s, empty) => (s ? JSON.stringify(s) : empty);

// ---------- model ----------

const m = {
  state: 'projects',
  err: '',
  status: '',
  loading: true,
  loadWhat: 'Loading projects',
  spinFrame: 0,

  launchDir: process.cwd(),
  launchProj: null,
  projects: [],
  project: null,
  sessions: [],
  session: null,

  resumeMode: idxByName(D.RESUME_MODES, D.loadConfig().resumeMode),
  sortMode: idxByName(D.SORT_MODES, D.loadConfig().sortMode),
  projSort: idxByName(D.PROJECT_SORT_MODES, D.loadConfig().projectSortMode),

  turns: [],
  anchors: [],
  convWidth: 0,
  convPlain: [],

  // pending is the delete asked for but not yet confirmed. While it is set,
  // every key goes to the confirmation prompt.
  pending: null,

  searching: false,
  searchQ: '',
  matches: [],
  matchIdx: 0,
};

function idxByName(modes, name) {
  const i = modes.findIndex((x) => x.name === name);
  return i < 0 ? 0 : i;
}

const projList = new T.List('Claude Code Projects', S);
const sessList = new T.List('Sessions', S);
const pathIn = new T.TextInput({ prompt: '› ', placeholder: '/Users/you/path/to/project' });
const searchIn = new T.TextInput({ prompt: '/', placeholder: 'search…', limit: 200 });
const convVP = new T.Viewport();

const width = () => process.stdout.columns || 80;
const height = () => process.stdout.rows || 24;
const textWidth = () => (width() < 20 ? 20 : width() - 2);

function layout() {
  // Rows each screen spends on chrome below its body:
  //   projects      state + keys                                              = 2
  //   sessions      state + command(2) + keys                                 = 4
  //   conversation  header + sticky above; state + command(2) + keys below    = 6
  projList.setSize(width(), atLeast(height() - 2, 3));
  sessList.setSize(width(), atLeast(height() - 4, 3));
  convVP.width = width();
  convVP.height = atLeast(height() - 6, 3);
}

// ---------- items ----------

const projItem = (p) => ({
  title: p.realPath,
  desc: `${D.plural(p.numSess, 'session')} · ${D.humanSize(p.sizeBytes)} · last used ${D.relTime(p.lastUsed)}`,
  filterValue: p.realPath,
  p,
});

const sessItem = (s) => ({
  title: s.title,
  desc: `${D.short(s.id)} · ${s.msgCount} msgs · ${D.relTime(s.end)} · ${D.humanSize(s.sizeBytes)}`,
  filterValue: s.title + ' ' + s.id,
  s,
});

function applyProjectSort() {
  D.sortBy(m.projects, D.PROJECT_SORT_MODES, m.projSort);
  projList.setItems(m.projects.map(projItem));
}

function applySessionSort() {
  D.sortBy(m.sessions, D.SORT_MODES, m.sortMode);
  sessList.setItems(m.sessions.map(sessItem));
}

// projectForDir finds the loaded project for a directory. The encoded folder
// name is matched first; the cwd recorded inside the session files is the
// fallback, because the encoding is lossy and cannot be reversed reliably.
function projectForDir(dir) {
  if (!dir) return null;
  const enc = D.encodePath(dir);
  return m.projects.find((p) => path.basename(p.encodedDir) === enc)
    || m.projects.find((p) => p.realPath === dir)
    || null;
}

// ---------- loading ----------

let spinTimer = null;
const SPIN = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];

async function startLoad(what, work) {
  m.loading = true;
  m.loadWhat = what;
  m.err = '';
  render();
  spinTimer = setInterval(() => { m.spinFrame++; render(); }, 100);
  try {
    await work();
  } catch (e) {
    m.err = e.message;
  } finally {
    clearInterval(spinTimer);
    spinTimer = null;
    m.loading = false;
    render();
  }
}

async function openProject(p) {
  await startLoad('Loading sessions', async () => {
    const ss = await D.loadSessions(p.encodedDir);
    m.err = '';
    m.status = '';
    m.project = p;
    m.sessions = ss;
    applySessionSort();
    sessList.resetSelected();
    m.state = 'sessions';
    layout();
  });
}

async function openConversation(s) {
  await startLoad('Loading conversation', async () => {
    m.turns = await D.loadConversation(s.filePath);
    m.session = s;
    m.searching = false;
    searchIn.focused = false;
    m.searchQ = '';
    m.matches = [];
    m.matchIdx = 0;
    m.status = '';
    setConversationContent(false);
    convVP.top();
    m.state = 'conversation';
  });
}

// resolvePath opens a project from a user-pasted folder path.
async function resolvePath(raw) {
  await startLoad('Resolving path', async () => {
    const p = D.expandHome(raw.trim());
    const dir = path.join(D.projectsRoot(), D.encodePath(p));
    if (!fs.existsSync(dir)) {
      m.err = `no Claude sessions found for:\n  ${p}\n(looked in ${dir})`;
      return;
    }
    const ss = await D.loadSessions(dir);
    m.err = '';
    m.status = '';
    m.project = { encodedDir: dir, realPath: p, numSess: ss.length, sizeBytes: D.totalSize(ss), lastUsed: 0 };
    m.sessions = ss;
    applySessionSort();
    sessList.resetSelected();
    m.state = 'sessions';
    layout();
  });
}

// ---------- keys ----------

async function onKey(k) {
  if (k === 'ctrl+c') return quit();

  // A pending delete swallows every other key. Only an explicit "y" goes
  // through; anything else — including a stray arrow key — cancels, so it is
  // never possible to destroy a transcript by mashing keys.
  if (m.pending) {
    if (k === 'y') return performDelete();
    m.pending = null;
    m.status = 'delete cancelled';
    return;
  }

  switch (m.state) {
    case 'start': return keyStart(k);
    case 'projects': return keyProjects(k);
    case 'pastePath': return keyPastePath(k);
    case 'sessions': return keySessions(k);
    case 'conversation': return keyConversation(k);
  }
}

function keyStart(k) {
  switch (k) {
    case 't': case 'T':
      if (m.launchProj) return openProject(m.launchProj);
      return; // nothing to open; leave the chooser up
    case 'a': case 'A':
      m.state = 'projects'; m.status = ''; return;
    case 'enter':
      // Enter takes the obvious option: this folder when it has history.
      if (m.launchProj) return openProject(m.launchProj);
      m.state = 'projects'; m.status = ''; return;
    case 'q': case 'esc':
      return quit();
  }
  // Anything else is ignored: this is a question, not a confirmation, so a
  // stray key should not silently close the app.
}

function keyProjects(k) {
  if (projList.filterState !== 'filtering') {
    switch (k) {
      case 'q': return quit();
      case 'p':
        m.state = 'pastePath'; pathIn.focused = true; return;
      case 's':
        m.projSort = (m.projSort + 1) % D.PROJECT_SORT_MODES.length;
        D.saveConfig({ projectSortMode: D.PROJECT_SORT_MODES[m.projSort].name });
        applyProjectSort();
        projList.resetSelected();
        m.status = 'sorted by ' + D.PROJECT_SORT_MODES[m.projSort].name;
        return;
      case 'd': {
        const it = projList.selected();
        if (it) { m.pending = { isProject: true, project: it.p }; m.status = ''; }
        return;
      }
      case 'enter': {
        const it = projList.selected();
        if (it) return openProject(it.p);
        return;
      }
    }
  }
  m.status = '';
  projList.key(k);
}

function keyPastePath(k) {
  if (k === 'esc') { m.state = 'projects'; pathIn.focused = false; return; }
  if (k === 'enter') {
    if (!pathIn.value.trim()) return;
    return resolvePath(pathIn.value);
  }
  pathIn.key(k);
}

function keySessions(k) {
  if (sessList.filterState !== 'filtering') {
    switch (k) {
      case 'q': return quit();
      case 'esc': m.state = 'projects'; return;
      case 'm':
        m.resumeMode = (m.resumeMode + 1) % D.RESUME_MODES.length;
        D.saveConfig({ resumeMode: D.RESUME_MODES[m.resumeMode].name });
        m.status = '';
        return;
      case 's':
        m.sortMode = (m.sortMode + 1) % D.SORT_MODES.length;
        D.saveConfig({ sortMode: D.SORT_MODES[m.sortMode].name });
        applySessionSort();
        sessList.resetSelected();
        m.status = 'sorted by ' + D.SORT_MODES[m.sortMode].name;
        return;
      case 'c': m.status = copyResume(); return;
      case 'd': {
        const it = sessList.selected();
        if (it) { m.pending = { isProject: false, session: it.s }; m.status = ''; }
        return;
      }
      case 'enter': {
        const it = sessList.selected();
        if (it) return openConversation(it.s);
        return;
      }
    }
  }
  m.status = '';
  sessList.key(k);
}

function keyConversation(k) {
  // While the search field is focused, it consumes typing.
  if (m.searching) {
    if (k === 'esc') { m.searching = false; searchIn.focused = false; return; }
    if (k === 'enter') {
      m.searchQ = searchIn.value.trim();
      m.searching = false;
      searchIn.focused = false;
      recomputeMatches();
      jumpToMatch();
      return;
    }
    searchIn.key(k);
    return;
  }
  switch (k) {
    case 'q': return quit();
    case 'esc': m.state = 'sessions'; return;
    case 'm':
      m.resumeMode = (m.resumeMode + 1) % D.RESUME_MODES.length;
      D.saveConfig({ resumeMode: D.RESUME_MODES[m.resumeMode].name });
      m.status = '';
      return;
    case 'c': m.status = copyResume(); return;
    case 'd': m.pending = { isProject: false, session: m.session }; m.status = ''; return;
    case '/':
      m.searching = true;
      searchIn.set(m.searchQ);
      searchIn.focused = true;
      m.status = '';
      return;
    case 'n': if (m.matches.length) { m.matchIdx++; jumpToMatch(); } return;
    case 'N': if (m.matches.length) { m.matchIdx--; jumpToMatch(); } return;
    case ']': case '}': jumpPrompt(1); return;
    case '[': case '{': jumpPrompt(-1); return;
    case 'g': case 'home': convVP.top(); return;
    case 'G': case 'end': convVP.bottom(); return;
  }
  m.status = '';
  convVP.key(k);
}

// ---------- delete ----------

function performDelete() {
  const t = m.pending;
  m.pending = null;
  if (t.isProject) return deleteProjectRow(t.project);

  const s = t.session;
  try { D.deleteSession(s.filePath); }
  catch (e) { m.err = 'delete failed: ' + e.message; return; }
  m.err = '';

  m.sessions = m.sessions.filter((c) => c.filePath !== s.filePath);
  applySessionSort();
  if (m.project) {
    m.project.numSess = m.sessions.length;
    m.project.sizeBytes = D.totalSize(m.sessions);
    syncProjectRow();
  }
  // The list may have been sitting on the last row, which no longer exists.
  if (sessList.index >= m.sessions.length) sessList.select(m.sessions.length - 1);

  m.status = 'deleted ✓  ' + D.oneLine(s.title, 60);
  // Nothing left to read once the transcript on screen is gone.
  if (m.state === 'conversation') m.state = 'sessions';
}

function deleteProjectRow(p) {
  let removed;
  try { removed = D.deleteProject(p.encodedDir); }
  catch (e) {
    // Report what did go before the failure, so a partial delete is never
    // silent — the row's count would otherwise still look untouched.
    const n = e.removed || 0;
    m.err = `delete failed after ${D.plural(n, 'file')}: ${e.message}`;
    if (n > 0) { try { m.projects = D.listProjects(); applyProjectSort(); } catch {} }
    return;
  }
  m.err = '';
  m.projects = m.projects.filter((row) => row.encodedDir !== p.encodedDir);
  applyProjectSort();
  // Anything loaded from the project just deleted is stale now.
  if (m.project && m.project.encodedDir === p.encodedDir) {
    m.project = null;
    m.sessions = [];
    applySessionSort();
  }
  m.status = `deleted ✓  ${D.plural(removed, 'session')} (${D.humanSize(p.sizeBytes)}) in ${p.realPath}`;
}

// syncProjectRow writes the current project's count and size back into the
// projects list, so stepping back after a delete does not show a total that
// includes a file no longer on disk.
function syncProjectRow() {
  const row = m.projects.find((p) => p.encodedDir === m.project.encodedDir);
  if (!row) return;
  row.numSess = m.project.numSess;
  row.sizeBytes = m.project.sizeBytes;
  applyProjectSort(); // under "size"/"sessions" the row has genuinely moved
}

// ---------- copy ----------

function copyResume() {
  let s = m.session;
  if (m.state !== 'conversation') {
    const it = sessList.selected();
    if (!it) return 'nothing to copy';
    s = it.s;
  }
  if (!s) return 'nothing to copy';
  const err = T.copyToClipboard(D.resumeCommandCd(s, D.RESUME_MODES[m.resumeMode]));
  if (err) return 'copy failed: ' + err;
  // The command itself is already on screen right above this line, so report
  // only what the clipboard adds to it: the cd that makes it runnable anywhere.
  return s.cwd ? 'copied ✓  prefixed with cd ' + s.cwd : 'copied ✓';
}

// ---------- search / prompt jumping ----------

function recomputeMatches() {
  m.matches = [];
  m.matchIdx = 0;
  const q = m.searchQ.trim().toLowerCase();
  if (!q) return;
  m.convPlain.forEach((ln, i) => { if (ln.includes(q)) m.matches.push(i); });
}

function jumpToMatch() {
  if (!m.matches.length) return;
  if (m.matchIdx < 0) m.matchIdx = m.matches.length - 1;
  if (m.matchIdx >= m.matches.length) m.matchIdx = 0;
  convVP.setOffset(m.matches[m.matchIdx]);
}

function jumpPrompt(dir) {
  if (!m.anchors.length) return;
  const off = convVP.offset;
  if (dir > 0) {
    const next = m.anchors.find((a) => a.line > off);
    if (next) convVP.setOffset(next.line);
    return;
  }
  let target = -1;
  for (const a of m.anchors) { if (a.line < off) target = a.line; else break; }
  if (target >= 0) convVP.setOffset(target);
}

// ---------- conversation rendering ----------

// setConversationContent (re-)wraps the stored transcript to the current width
// and loads it into the viewport. With preserve, the scroll position is kept as
// close as possible so a resize doesn't jump the reader around.
function setConversationContent(preserve) {
  const off = convVP.offset;
  const { body, anchors } = renderConversation(m.turns, width());
  convVP.setContent(body);
  m.anchors = anchors;
  m.convWidth = width();
  // A lowercased, un-styled copy of each rendered line, so search runs against
  // plain text. Line count matches the viewport 1:1 (styling adds no newlines
  // and the transcript is pre-wrapped).
  m.convPlain = T.stripANSI(body).split('\n').map((l) => l.toLowerCase());
  if (preserve) convVP.setOffset(off);
  // A width change re-numbers every line, so any active search must be redone.
  if (m.searchQ) recomputeMatches();
}

function renderConversation(turns, w) {
  if (w <= 0) w = 80;
  const wrap = Math.max(20, w - 2);
  const parts = [];
  const anchors = [];
  let lineCount = 0;
  // write keeps a running line count so anchors point at the exact line a
  // prompt begins on.
  const write = (s) => { parts.push(s); lineCount += (s.match(/\n/g) || []).length; };

  for (const t of turns) {
    switch (t.kind) {
      case 'text':
        if (t.role === 'user') {
          // Kept long; the sticky header trims it to the terminal width.
          anchors.push({ line: lineCount, text: D.oneLine(t.text, 1024) });
          write(S.user('▶ You') + '\n');
        } else {
          write(S.claude('● Claude') + '\n');
        }
        write(wrapText(t.text, wrap) + '\n\n');
        break;
      case 'thinking':
        write(S.think('· thinking') + '\n');
        write(S.think(wrapText(t.text, wrap)) + '\n\n');
        break;
      case 'tool_use': {
        const line = `⚙ ${t.name}(${D.oneLine(t.text, Math.max(4, wrap - t.name.length - 4))})`;
        write(S.tool(wrapText(line, wrap)) + '\n\n');
        break;
      }
      case 'tool_result': {
        const st = t.isError ? S.errTurn : S.dim;
        write(st(t.isError ? '⤷ error' : '⤷ result') + '\n');
        write(st(wrapText(lineBudget(t.text, 12), wrap)) + '\n\n');
        break;
      }
    }
  }
  if (!parts.length) return { body: S.label(' (no displayable messages in this session)'), anchors: [] };
  // Indent to the same column as the header, state and footer rows. Done after
  // the fact so it can't disturb the line counts the anchors were built from.
  return { body: indent(parts.join('')), anchors };
}

// indent shifts every line one column right. Safe on styled text: a leading
// plain space can't land inside an escape sequence.
const indent = (s) => ' ' + s.replace(/\n/g, '\n ');

// lineBudget caps a tool result to at most maxLines lines.
function lineBudget(s, maxLines) {
  const lines = s.split('\n');
  if (lines.length <= maxLines) return s;
  return lines.slice(0, maxLines).concat(`… (${lines.length - maxLines} more lines)`).join('\n');
}

// wrapText hard-wraps to the given width, preserving existing newlines.
const wrapText = (s, w) => s.split('\n').map((l) => wrapLine(l, w).join('\n')).join('\n');

function wrapLine(line, w) {
  if (w <= 0) return [line];
  const words = line.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const res = [];
  let cur = '';
  for (let word of words) {
    // Break a single over-long word.
    while ([...word].length > w) {
      if (cur) { res.push(cur); cur = ''; }
      const r = [...word];
      res.push(r.slice(0, w).join(''));
      word = r.slice(w).join('');
    }
    if (!cur) cur = word;
    else if ([...cur].length + 1 + [...word].length <= w) cur += ' ' + word;
    else { res.push(cur); cur = word; }
  }
  if (cur) res.push(cur);
  return res;
}

// ---------- views ----------

function render() {
  layout();
  T.draw(screenBody());
}

function screenBody() {
  if (m.loading) return loaderView();
  switch (m.state) {
    case 'projects': return viewProjects();
    case 'start': return viewStart();
    case 'pastePath': return viewPastePath();
    case 'sessions': return viewSessions();
    case 'conversation': return viewConversation();
  }
  return '';
}

// loaderView centres a spinner and its label while work is in flight.
function loaderView() {
  const content = S.spin(SPIN[m.spinFrame % SPIN.length]) + ' ' + S.load(m.loadWhat + ' …');
  const left = Math.max(0, Math.floor((width() - T.visLen(content)) / 2));
  const top = Math.max(0, Math.floor((height() - 1) / 2));
  return '\n'.repeat(top) + ' '.repeat(left) + content;
}

// Screens are stacked the same way everywhere, so your eye learns one shape:
//   body    the list or transcript
//   state   what's currently set (sort / filter / search) — always present
//   detail  the resume command, on screens where one applies
//   keys    what you can press
function screen(body, state, detail, keys) {
  let out = body;
  for (const s of [state, detail]) if (s) out += '\n' + s;
  if (m.pending) return out + '\n' + confirmLine();
  if (m.err) return out + '\n' + S.err(pad(D.oneLine(m.err, textWidth())));
  // Screens with a command block show transient status there; the ones without
  // (projects) put it in place of the keys, so feedback is never swallowed.
  if (!detail && m.status) return out + '\n' + S.status(pad(m.status));
  return out + '\n' + S.footer(pad(keys));
}

// fitKeys picks the fullest hint that fits, so the footer never ends in a word
// chopped in half. Pass them longest first.
function fitKeys(...options) {
  for (const o of options) if (T.visLen(o) + 2 <= width()) return o;
  return options[options.length - 1];
}

const statusLine = (...fields) => pad(fields.join(SEP));

// filterStatus describes a list's filter in every state, including the
// unfiltered one, so the indicator never blinks out of existence. It carries
// the item count too, which is why the list has no status bar of its own.
function filterStatus(l, noun) {
  const total = l.items.length;
  const shown = l.visible().length;
  if (l.filterState === 'filtering') {
    return field('filter', quoteOr(l.filter.value, '…')) + SEP + field('showing', `${shown} of ${total}`);
  }
  if (l.filterState === 'applied') {
    return field('filter', quoteOr(l.filter.value.trim(), '—')) + SEP + field('showing', `${shown} of ${total}`);
  }
  return field('filter', 'off') + SEP + S.label(D.plural(total, noun));
}

function viewProjects() {
  return screen(
    projList.view(),
    statusLine(field('sort', D.PROJECT_SORT_MODES[m.projSort].name),
      filterStatus(projList, 'project'),
      field('on disk', D.humanSize(D.totalProjectSize(m.projects)))),
    '',
    fitKeys('↑/↓ move · enter open · s sort · / filter · p paste path · d delete · q quit',
      '↑/↓ move · enter open · s sort · / filter · d delete · q quit',
      'enter open · s sort · d delete · q quit'),
  );
}

// viewStart is the chooser shown on launch. It always asks rather than
// guessing, and says plainly when the folder you are in has no history — that
// absence is information, not an error.
function viewStart() {
  const out = [];
  out.push(S.title(pad('cccsss — where do you want to start?')), '');

  let key = S.value('t');
  let detail;
  if (m.launchProj) {
    detail = `${D.plural(m.launchProj.numSess, 'session')} · ${D.humanSize(m.launchProj.sizeBytes)}`;
  } else {
    key = S.dim('–');
    detail = 'no Claude Code sessions in this folder';
  }
  out.push(pad(key + '  ' + S.label('this folder   ') + S.value(orDash(m.launchDir))));
  out.push(pad('   ' + S.label('              ') + S.dim(detail)), '');

  const all = m.projects.length
    ? `${D.plural(m.projects.length, 'project')} · ${D.humanSize(D.totalProjectSize(m.projects))}`
    : 'nothing recorded yet';
  out.push(pad(S.value('a') + '  ' + S.label('all projects  ') + S.dim(all)), '');

  // Don't offer "t" when there is nothing for it to open.
  out.push(S.footer(pad(m.launchProj
    ? fitKeys('t this folder · a all projects · enter this folder · q quit', 't this folder · a all · q quit')
    : fitKeys('a all projects · enter all projects · q quit', 'a all projects · q quit'))));
  if (m.err) out.push(S.err(pad(D.oneLine(m.err, textWidth()))));
  return out.join('\n');
}

function viewPastePath() {
  const out = [];
  out.push(S.title(pad('Open a project by path')), '');
  out.push(pad(pathIn.view(S.dim, S.cursor)), '');
  out.push(S.dim(pad('Looks the folder up in ~/.claude/projects/<encoded>')));
  if (m.err) { out.push(''); for (const l of m.err.split('\n')) out.push(S.err(pad(l))); }
  out.push('', S.footer(pad('enter open · esc back · ctrl+c quit')));
  return out.join('\n');
}

function viewSessions() {
  sessList.title = 'Sessions in ' + (m.project ? m.project.realPath : '—');
  const state = statusLine(field('sort', D.SORT_MODES[m.sortMode].name),
    filterStatus(sessList, 'session'),
    field('on disk', D.humanSize(D.totalSize(m.sessions))));
  const it = sessList.selected();
  if (!it) {
    return screen(sessList.view(), state, '',
      fitKeys('s sort · / filter · esc back · q quit', 'esc back · q quit'));
  }
  return screen(sessList.view(), state, commandBlock(it.s),
    fitKeys('↑/↓ move · enter read · c copy · m mode · s sort · / filter · d delete · esc back · q quit',
      '↑/↓ move · enter read · c copy · m mode · s sort · d delete · esc back · q quit',
      'enter read · c copy · d delete · esc back · q quit'));
}

// commandBlock renders the resume command and, under it, what the active mode
// does — or the transient status ("copied ✓") right where you just acted. The
// mode is not spelled out anywhere else: the command carries the flag, this
// line explains it.
function commandBlock(s) {
  const mode = D.RESUME_MODES[m.resumeMode];
  const cmd = S.resume(pad('resume:  ' + D.resumeCommand(s, mode)));
  if (m.status) return cmd + '\n' + S.status(pad(m.status));
  return cmd + '\n' + S.dim(pad(` mode: ${mode.name} — ${mode.desc}`));
}

function viewConversation() {
  // The header carries the session identity and how far down you are; the
  // sticky row carries which prompt you're reading under.
  const head = S.title(pad(`${D.short(m.session.id)}  ·  ${D.oneLine(m.session.title, atLeast(textWidth() - 20, 8))}`))
    + S.dim(`  ${Math.round(convVP.scrollPercent() * 100)}%`);

  let footer = S.footer(pad(fitKeys(
    '↑/↓ scroll · [ ] prev/next prompt · / search · n/N matches · g/G top/bottom · c copy · m mode · d delete · esc back · q quit',
    '↑/↓ scroll · [ ] prompt · / search · n/N match · g/G ends · c copy · m mode · d delete · esc back · q quit',
    '↑/↓ scroll · / search · c copy · m mode · d delete · esc back · q quit')));
  if (m.pending) footer = confirmLine();
  else if (m.searching) footer = S.footer(pad('enter jump to first match · esc cancel'));
  else if (m.err) footer = S.err(pad(D.oneLine(m.err, textWidth())));

  return [head, stickyHeader(), convVP.view(), statusLine(searchLine()), commandBlock(m.session), footer].join('\n');
}

// searchLine is the field itself while you type and the search state
// otherwise — the same row either way, so the layout never shifts.
const searchLine = () => (m.searching ? searchIn.view(S.dim, S.cursor) : searchStatus());

function searchStatus() {
  if (m.searchQ === '') return field('search', 'off');
  if (!m.matches.length) return field('search', JSON.stringify(m.searchQ)) + SEP + S.label('no matches');
  return field('search', JSON.stringify(m.searchQ)) + SEP + field('match', `${m.matchIdx + 1} of ${m.matches.length}`);
}

// stickyHeader pins the user prompt the current scroll position sits under
// above the transcript, so you always know which turn you're in.
function stickyHeader() {
  const w = width() || 80;
  let label = '▶ You';
  if (m.anchors.length) {
    let cur = m.anchors[0];
    for (const a of m.anchors) { if (a.line <= convVP.offset) cur = a; else break; }
    if (cur.text) label = '▶ You: ' + cur.text;
  }
  return S.sticky(T.padVis(D.oneLine(label, w - 1), w));
}

// confirmLine is the delete prompt, shown in place of the key hints. It names
// what is about to go and says plainly that it does not come back.
function confirmLine() {
  // The tail — what confirms and what cancels — must never be cut off, so the
  // shorter phrasings drop the subject before the instructions.
  if (m.pending.isProject) {
    const p = m.pending.project;
    const n = D.plural(p.numSess, 'session');
    const sz = D.humanSize(p.sizeBytes);
    return S.err(pad(fitKeys(
      `delete ALL ${n} (${sz}) in ${p.realPath}? this cannot be undone — y to delete, any other key cancels`,
      `delete ALL ${n} (${sz}) in ${D.oneLine(p.realPath, 30)}? y delete · any key cancels`,
      `delete ALL ${n} (${sz})? y delete · any key cancels`,
      'delete whole project? y · any key cancels')));
  }
  const s = m.pending.session;
  const sz = D.humanSize(s.sizeBytes);
  return S.err(pad(fitKeys(
    `delete ${D.short(s.id)} "${D.oneLine(s.title, 40)}" (${sz}) permanently? this cannot be undone — y to delete, any other key cancels`,
    `delete ${D.short(s.id)} "${D.oneLine(s.title, 24)}" (${sz})? cannot be undone — y delete · any key cancels`,
    `delete ${D.short(s.id)} permanently? y delete · any key cancels`,
    'delete? y · any key cancels')));
}

// ---------- main ----------

function quit() {
  T.alt.exit();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
}

async function main() {
  if (!process.stdout.isTTY) {
    console.error('cccsss needs an interactive terminal.');
    process.exit(1);
  }
  T.alt.enter();
  process.on('exit', () => T.alt.exit());

  process.stdin.setRawMode(true);
  process.stdin.resume();

  // Keys are handled one at a time: a load is async, and a second keypress
  // landing mid-load would act on a half-built screen.
  let busy = Promise.resolve();
  process.stdin.on('data', (chunk) => {
    for (const k of T.decode(chunk)) {
      // ctrl+c is not queued: it has to work while a slow load is in flight.
      if (k === 'ctrl+c') return quit();
      busy = busy.then(async () => {
        if (m.loading) return;
        await onKey(k);
        render();
      });
    }
  });

  process.stdout.on('resize', () => {
    layout();
    // The transcript is pre-wrapped to a fixed width, so it only needs a
    // (potentially expensive) re-wrap when the WIDTH changes. Height-only
    // resizes just re-size the viewport, which is cheap.
    if (m.state === 'conversation' && width() !== m.convWidth) setConversationContent(true);
    render();
  });

  await startLoad('Loading projects', async () => {
    m.projects = D.listProjects();
    applyProjectSort();
    // Always ask where to start. Guessing would be wrong often enough to be
    // annoying, and the answer costs one keystroke.
    m.launchProj = projectForDir(m.launchDir);
    m.state = 'start';
  });
}

if (require.main === module) {
  main().catch((e) => {
    T.alt.exit();
    console.error('error:', e.message);
    process.exit(1);
  });
}

module.exports = { renderConversation, wrapLine, lineBudget, fitKeys, m };
