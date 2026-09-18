'use strict';
// Reading Claude Code's session files, and the handful of preferences cccsss
// remembers between runs. Nothing here touches the terminal.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const APP = 'cccsss';
const LEGACY_APPS = ['ccss', 'ccsessions']; // pre-rename config locations, still read

// ---------- paths ----------

const projectsRoot = () => path.join(os.homedir(), '.claude', 'projects');

// configDir is the platform's standard settings location.
function configDir() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

const configPath = () => path.join(configDir(), APP, 'config.json');

function loadConfig() {
  for (const name of [APP, ...LEGACY_APPS]) {
    try {
      return JSON.parse(fs.readFileSync(path.join(configDir(), name, 'config.json'), 'utf8'));
    } catch { /* missing or invalid means "use defaults" */ }
  }
  return {};
}

function saveConfig(patch) {
  const c = { ...loadConfig(), ...patch };
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
  } catch { /* failing to save a preference is not worth interrupting anyone */ }
}

// ---------- encoding ----------

// encodePath maps a real folder path to Claude Code's encoded dir name:
// every "/", "." and "_" becomes "-".
const encodePath = (p) => p.replace(/\/+$/, '').replace(/[/._]/g, '-');

// decodeDirName is a best-effort reverse. The encoding is lossy, so the cwd
// recorded inside a session file is preferred wherever one exists.
const decodeDirName = (name) =>
  name.startsWith('-') ? '/' + name.slice(1).replace(/-/g, '/') : name.replace(/-/g, '/');

function expandHome(p) {
  return p.startsWith('~') ? os.homedir() + p.slice(1) : p;
}

// ---------- jsonl reading ----------

// eachLine walks a file's lines without ever materialising the whole thing as
// one string — session transcripts get big enough for that to matter.
function eachLine(buf, fn) {
  let start = 0;
  while (start < buf.length) {
    let end = buf.indexOf(10, start);
    if (end === -1) end = buf.length;
    if (end > start) fn(buf.toString('utf8', start, end));
    start = end + 1;
  }
}

function parseLine(text) {
  if (!text.startsWith('{')) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const parseTime = (s) => {
  const t = Date.parse(s || '');
  return Number.isNaN(t) ? 0 : t;
};

// ---------- projects ----------

// listProjects scans ~/.claude/projects and returns one entry per folder that
// holds at least one transcript.
function listProjects() {
  let entries;
  try { entries = fs.readdirSync(projectsRoot(), { withFileTypes: true }); }
  catch (e) { throw new Error(`cannot read ${projectsRoot()}: ${e.message}`); }

  const projs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(projectsRoot(), e.name);
    const { count, size, realPath, last } = scanDirQuick(dir);
    if (count === 0) continue;
    projs.push({
      encodedDir: dir,
      realPath: realPath || decodeDirName(e.name),
      numSess: count,
      sizeBytes: size,
      lastUsed: last,
    });
  }
  projs.sort((a, b) => b.lastUsed - a.lastUsed);
  return projs;
}

// scanDirQuick counts transcripts, totals their size and sniffs the real cwd
// from the newest one. Sizes come from the dir entries already being walked.
function scanDirQuick(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return { count: 0, size: 0, realPath: '', last: 0 }; }

  let count = 0, size = 0, last = 0, newest = '';
  for (const e of entries) {
    if (e.isDirectory() || !e.name.endsWith('.jsonl')) continue;
    let st;
    try { st = fs.statSync(path.join(dir, e.name)); } catch { continue; }
    count++;
    size += st.size;
    if (st.mtimeMs > last) { last = st.mtimeMs; newest = e.name; }
  }
  return { count, size, last, realPath: newest ? sniffCwd(path.join(dir, newest)) : '' };
}

// sniffCwd reads the first lines of a session file to find its cwd.
function sniffCwd(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    let found = '';
    let seen = 0;
    eachLine(buf.subarray(0, n), (text) => {
      if (found || seen++ >= 50) return;
      const l = parseLine(text);
      if (l && l.cwd) found = l.cwd;
    });
    return found;
  } catch { return ''; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

const totalProjectSize = (ps) => ps.reduce((n, p) => n + p.sizeBytes, 0);
const totalSize = (ss) => ss.reduce((n, s) => n + s.sizeBytes, 0);

// ---------- deleting ----------

// deleteSession permanently removes one transcript. This is the only call in
// the app that destroys anything, so it re-derives the projects root and
// refuses any path that is not a .jsonl file inside it — a bad path arriving
// from somewhere else must not be able to delete an unrelated file.
function deleteSession(file) {
  const root = projectsRoot();
  const abs = path.resolve(file);
  if (!abs.endsWith('.jsonl')) throw new Error(`refusing to delete ${abs}: not a .jsonl session file`);
  const rel = path.relative(root, abs);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`refusing to delete ${abs}: outside ${root}`);
  }
  fs.unlinkSync(abs);
}

// deleteProject removes every transcript in a project folder, then the folder
// itself — but only if that leaves it empty, so anything else kept in there
// survives rather than a whole directory going on the strength of its name.
// Returns how many files went.
function deleteProject(encodedDir) {
  const root = projectsRoot();
  const abs = path.resolve(encodedDir);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || rel.includes(path.sep) || path.isAbsolute(rel)) {
    throw new Error(`refusing to delete ${abs}: not a project folder directly under ${root}`);
  }
  let removed = 0;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory() || !e.name.endsWith('.jsonl')) continue;
    try { fs.unlinkSync(path.join(abs, e.name)); }
    catch (err) { err.removed = removed; throw err; }
    removed++;
  }
  try { fs.rmdirSync(abs); } catch { /* something else lives there; leave it */ }
  return removed;
}

// ---------- sessions ----------

const MAX_STORED_TITLE = 1024; // guard against a pathological prompt, not a display width

async function loadSessions(encodedDir) {
  const entries = await fsp.readdir(encodedDir, { withFileTypes: true });
  const sessions = [];
  for (const e of entries) {
    if (e.isDirectory() || !e.name.endsWith('.jsonl')) continue;
    try { sessions.push(await readSessionMeta(path.join(encodedDir, e.name))); }
    catch { /* an unreadable file is skipped, not fatal */ }
  }
  sessions.sort((a, b) => b.end - a.end);
  return sessions;
}

async function readSessionMeta(file) {
  const st = await fsp.stat(file);
  // ponytail: whole file into one Buffer. Node caps that at 2GiB; a transcript
  // that big fails to load and gets skipped. Stream it if that ever happens.
  const buf = await fsp.readFile(file);
  const s = {
    id: path.basename(file, '.jsonl'),
    filePath: file,
    cwd: '', gitBranch: '', version: '', title: '',
    msgCount: 0, start: 0, end: 0, sizeBytes: st.size,
  };
  eachLine(buf, (text) => {
    const l = parseLine(text);
    if (!l) return;
    if (!s.cwd && l.cwd) s.cwd = l.cwd;
    if (!s.gitBranch && l.gitBranch) s.gitBranch = l.gitBranch;
    if (!s.version && l.version) s.version = l.version;
    const ts = parseTime(l.timestamp);
    if (ts) {
      if (!s.start || ts < s.start) s.start = ts;
      if (ts > s.end) s.end = ts;
    }
    if (l.type === 'user' || l.type === 'assistant') s.msgCount++;
    if (!s.title && l.type === 'user' && l.message) {
      const t = firstPromptText(l);
      if (t) s.title = t;
    }
  });
  if (!s.end) s.end = st.mtimeMs;
  if (!s.title) s.title = '(no prompt text)';
  return s;
}

// firstPromptText pulls a human prompt out of a user line, ignoring sidechain
// turns, tool results and pure command metadata.
function firstPromptText(l) {
  if (l.isSidechain) return '';
  let text = messageText(l.message.content).trim();
  if (!text) return '';
  if (text.startsWith('<') && text.includes('>')) {
    text = stripTags(text).trim();
    if (!text) return '';
  }
  return oneLine(text, MAX_STORED_TITLE);
}

// messageText flattens a message content (string or block array) to plain text.
function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join(' ');
}

// ---------- full conversation ----------

// loadConversation parses a session file into ordered display turns.
async function loadConversation(file) {
  const buf = await fsp.readFile(file);
  const turns = [];
  let lastTS = 0;
  eachLine(buf, (text) => {
    const l = parseLine(text);
    if (!l || !l.message || (l.type !== 'user' && l.type !== 'assistant')) return;
    // Some lines carry no timestamp; inherit the previous one so a turn never
    // sorts to the very top just because its time is zero.
    let ts = parseTime(l.timestamp);
    if (ts) lastTS = ts; else ts = lastTS;
    const role = l.message.role || l.type;
    for (const b of decodeBlocks(l.message.content)) {
      switch (b.type) {
        case 'text':
          if (!(b.text || '').trim()) break;
          turns.push({ role, kind: 'text', text: b.text, time: ts });
          break;
        case 'thinking':
          if (!(b.thinking || '').trim()) break;
          turns.push({ role, kind: 'thinking', text: b.thinking, time: ts });
          break;
        case 'tool_use':
          turns.push({ role, kind: 'tool_use', name: b.name || '', text: compactJSON(b.input), time: ts });
          break;
        case 'tool_result':
          turns.push({ role: 'tool', kind: 'tool_result', text: rawContentText(b.content), time: ts, isError: !!b.is_error });
          break;
      }
    }
  });
  // Order by time. The sort is stable, so blocks that share a timestamp (a
  // thinking block, its text, the tool calls from the same message) keep their
  // original order while genuinely out-of-order lines get fixed.
  turns.sort((a, b) => a.time - b.time);
  return turns;
}

function decodeBlocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content.filter(Boolean) : [];
}

function rawContentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b && b.text).map((b) => b.text).join('\n');
  return content == null ? '' : JSON.stringify(content);
}

const compactJSON = (v) => (v === undefined ? '' : JSON.stringify(v));

// ---------- resume commands ----------

// Order matches Claude Code's escalation from safest to most permissive.
const RESUME_MODES = [
  { name: 'normal', flag: '', desc: 'permissions work normally (asks before acting)' },
  { name: 'plan', flag: '--permission-mode plan', desc: 'read-only; plans before making changes' },
  { name: 'accept edits', flag: '--permission-mode acceptEdits', desc: 'auto-accepts file edits' },
  { name: 'auto', flag: '--permission-mode auto', desc: 'auto-approves allowed actions' },
  { name: "don't ask", flag: '--permission-mode dontAsk', desc: 'does not prompt for permissions' },
  { name: 'bypass permissions', flag: '--dangerously-skip-permissions', desc: 'skips ALL permission checks' },
];

const resumeCommand = (s, mode) =>
  mode.flag ? `claude --resume ${s.id} ${mode.flag}` : `claude --resume ${s.id}`;

// resumeCommandCd prefixes the cd that makes the command runnable from
// anywhere: claude --resume only finds a session from its own directory.
const resumeCommandCd = (s, mode) =>
  s.cwd ? `cd ${shellQuote(s.cwd)} && ${resumeCommand(s, mode)}` : resumeCommand(s, mode);

function shellQuote(s) {
  if (!/[ \t'"\\$`*?()[\]{}&;|<>#~]/.test(s)) return s;
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

// ---------- sorting ----------

const byStr = (f) => (a, b) => f(a).toLowerCase().localeCompare(f(b).toLowerCase());

const SORT_MODES = [
  { name: 'recent', cmp: (a, b) => b.end - a.end },
  { name: 'messages', cmp: (a, b) => b.msgCount - a.msgCount },
  { name: 'size', cmp: (a, b) => b.sizeBytes - a.sizeBytes },
  { name: 'title', cmp: byStr((s) => s.title) },
];

const PROJECT_SORT_MODES = [
  { name: 'recent', cmp: (a, b) => b.lastUsed - a.lastUsed },
  { name: 'sessions', cmp: (a, b) => b.numSess - a.numSess },
  { name: 'size', cmp: (a, b) => b.sizeBytes - a.sizeBytes },
  { name: 'path', cmp: byStr((p) => p.realPath) },
];

const sortBy = (arr, modes, i) => arr.sort((modes[i] || modes[0]).cmp);

// ---------- string helpers ----------

function oneLine(s, max) {
  return truncate(s.replace(/[\r\n]+/g, ' ').trim().split(/\s+/).join(' '), max);
}

function truncate(s, max) {
  if (max <= 0) return '';
  const r = [...s];
  if (r.length <= max) return s;
  if (max === 1) return r[0];
  return r.slice(0, max - 1).join('') + '…';
}

// stripTags drops <tag>…</tag> markup, keeping only depth-zero text.
function stripTags(s) {
  let out = '', depth = 0;
  for (const ch of s) {
    if (ch === '<') depth++;
    else if (ch === '>') { if (depth > 0) depth--; }
    else if (depth === 0) out += ch;
  }
  return out;
}

function humanSize(n) {
  if (n < 1024) return `${n}B`;
  let div = 1024, exp = 0;
  for (let m = Math.floor(n / 1024); m >= 1024; m = Math.floor(m / 1024)) { div *= 1024; exp++; }
  return `${(n / div).toFixed(1)}${'KMGT'[exp]}B`;
}

function relTime(ms) {
  if (!ms) return 'unknown';
  const d = Date.now() - ms;
  const min = 60e3, hour = 60 * min, day = 24 * hour;
  if (d < min) return 'just now';
  if (d < hour) return `${Math.floor(d / min)}m ago`;
  if (d < day) return `${Math.floor(d / hour)}h ago`;
  if (d < 30 * day) return `${Math.floor(d / day)}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const short = (id) => (id.length >= 8 ? id.slice(0, 8) : id);

module.exports = {
  APP, projectsRoot, configDir, configPath, loadConfig, saveConfig,
  encodePath, decodeDirName, expandHome, eachLine, parseLine,
  listProjects, scanDirQuick, sniffCwd, totalProjectSize, totalSize,
  deleteSession, deleteProject,
  loadSessions, readSessionMeta, firstPromptText, messageText,
  loadConversation, rawContentText,
  RESUME_MODES, resumeCommand, resumeCommandCd, shellQuote,
  SORT_MODES, PROJECT_SORT_MODES, sortBy,
  oneLine, truncate, stripTags, humanSize, relTime, plural, short,
};
