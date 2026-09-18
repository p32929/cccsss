'use strict';
// One runnable check over the logic that can actually break: transcript
// parsing, the delete path guards, wrapping and the small formatters.
// Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const D = require('./lib/data');
const T = require('./lib/term');
const App = require('./cccsss');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cccsss-test-'));

test('encodePath / decodeDirName', () => {
  assert.equal(D.encodePath('/Users/me/dev/my_app.v2/'), '-Users-me-dev-my-app-v2');
  assert.equal(D.decodeDirName('-Users-me-dev'), '/Users/me/dev');
});

test('shellQuote only quotes when it has to', () => {
  assert.equal(D.shellQuote('/tmp/plain'), '/tmp/plain');
  assert.equal(D.shellQuote("/tmp/it's here"), `'/tmp/it'\\''s here'`);
});

test('humanSize', () => {
  assert.equal(D.humanSize(512), '512B');
  assert.equal(D.humanSize(1536), '1.5KB');
  assert.equal(D.humanSize(5 * 1024 ** 3), '5.0GB');
});

test('session metadata comes from the transcript', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'proj-'));
  const file = path.join(dir, 'abc12345-0000.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'summary', summary: 'ignored' }),
    'not json at all',
    JSON.stringify({ type: 'user', cwd: '/work/app', gitBranch: 'main', timestamp: '2026-01-01T10:00:00Z',
      message: { role: 'user', content: '<local-command-stdout></local-command-stdout>' } }),
    JSON.stringify({ type: 'user', timestamp: '2026-01-01T10:01:00Z',
      message: { role: 'user', content: [{ type: 'text', text: 'first real\nprompt' }] } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T10:02:00Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
  ].join('\n') + '\n');

  const s = await D.readSessionMeta(file);
  assert.equal(s.id, 'abc12345-0000');
  assert.equal(s.cwd, '/work/app');
  assert.equal(s.gitBranch, 'main');
  assert.equal(s.title, 'first real prompt', 'tag-only prompts are skipped, newlines collapse');
  assert.equal(s.msgCount, 3);
  assert.equal(s.end, Date.parse('2026-01-01T10:02:00Z'));

  const mode = D.RESUME_MODES.find((x) => x.name === 'plan');
  assert.equal(D.resumeCommandCd(s, mode), 'cd /work/app && claude --resume abc12345-0000 --permission-mode plan');
});

test('conversation turns are ordered and typed', async () => {
  const file = path.join(tmp, 'conv.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T10:05:00Z',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }),
    JSON.stringify({ type: 'user', timestamp: '2026-01-01T10:00:00Z',
      message: { role: 'user', content: 'do it' } }),
    JSON.stringify({ type: 'user', timestamp: '2026-01-01T10:06:00Z',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'boom', is_error: true }] } }),
  ].join('\n'));

  const turns = await D.loadConversation(file);
  assert.deepEqual(turns.map((t) => t.kind), ['text', 'thinking', 'tool_use', 'tool_result']);
  assert.equal(turns[2].text, '{"command":"ls"}');
  assert.equal(turns[3].isError, true);
});

test('delete refuses anything outside ~/.claude/projects', () => {
  const stray = path.join(tmp, 'stray.jsonl');
  fs.writeFileSync(stray, 'x');
  assert.throws(() => D.deleteSession(stray), /outside/);
  assert.throws(() => D.deleteSession(path.join(D.projectsRoot(), 'p', 'notes.txt')), /not a .jsonl/);
  assert.throws(() => D.deleteProject(path.join(D.projectsRoot(), 'p', 'nested')), /not a project folder/);
  assert.throws(() => D.deleteProject(tmp), /not a project folder/);
  assert.ok(fs.existsSync(stray), 'the stray file survived every refusal');
});

test('wrapping breaks long words and keeps blank lines', () => {
  assert.deepEqual(App.wrapLine('aaaa bbbb cc', 6), ['aaaa', 'bbbb', 'cc']);
  assert.deepEqual(App.wrapLine('xxxxxxxxxx', 4), ['xxxx', 'xxxx', 'xx']);
  assert.deepEqual(App.wrapLine('   ', 10), ['']);
});

test('tool results are capped', () => {
  const s = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
  const out = App.lineBudget(s, 5).split('\n');
  assert.equal(out.length, 6);
  assert.equal(out[5], '… (15 more lines)');
});

test('anchors point at the line each prompt starts on', () => {
  const { body, anchors } = App.renderConversation([
    { kind: 'text', role: 'assistant', text: 'one\ntwo' },
    { kind: 'text', role: 'user', text: 'my question' },
  ], 40);
  const lines = T.stripANSI(body).split('\n');
  assert.equal(anchors.length, 1);
  assert.ok(lines[anchors[0].line].includes('▶ You'), 'anchor lands on the prompt header');
  assert.equal(anchors[0].text, 'my question');
});

test('truncVis keeps escape sequences whole', () => {
  const styled = '\x1b[38;5;81mhello world\x1b[0m';
  const cut = T.truncVis(styled, 5);
  assert.equal(T.stripANSI(cut), 'hello');
  assert.ok(cut.endsWith('\x1b[0m'), 'colour is closed so it cannot bleed');
});

test('key decoding handles escape sequences and multi-key chunks', () => {
  assert.deepEqual(T.decode(Buffer.from('\x1b[A\x1b[Bq')), ['up', 'down', 'q']);
  assert.deepEqual(T.decode(Buffer.from('\x1b')), ['esc']);
  assert.deepEqual(T.decode(Buffer.from('\x1b[6~')), ['pgdn']);
  assert.deepEqual(T.decode(Buffer.from('\r\x7f')), ['enter', 'backspace']);
});

test('list filters, scrolls and reports its state', () => {
  const l = new T.List('t', require('./cccsss') && {
    dim: (s) => s, cursor: (s) => s, listTitle: (s) => s, selBar: (s) => s,
    selTitle: (s) => s, selDesc: (s) => s, normTitle: (s) => s, normDesc: (s) => s,
  });
  l.setSize(40, 20);
  l.setItems(['alpha', 'beta', 'gamma'].map((n) => ({ title: n, desc: '', filterValue: n })));
  l.key('down');
  assert.equal(l.selected().title, 'beta');
  l.key('/');
  for (const c of 'gma') l.key(c);
  assert.equal(l.filterState, 'filtering');
  assert.deepEqual(l.visible().map((i) => i.title), ['gamma'], 'subsequence match');
  l.key('enter');
  assert.equal(l.filterState, 'applied');
  assert.equal(l.selected().title, 'gamma');
  l.key('/');      // reopening the field and backing out clears the filter
  l.key('esc');
  assert.equal(l.filterState, 'off');
  assert.equal(l.visible().length, 3);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
