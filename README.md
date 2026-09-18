# cccsss

Browse your Claude Code sessions and get the exact command to resume any of them.

A pure Node.js rewrite of [ccss](https://github.com/p32929/ccss) — same app, **zero dependencies**. The TUI (lists, filtering, scrolling transcript, search) is built directly on ANSI escapes and raw-mode stdin.

## Install

Needs Node 18+. No dependencies to pull in — the install is one file and a `lib/` folder.

### Option A — from npm

```bash
npm install -g cccsss
```

Or run it once without installing:

```bash
npx cccsss
```

### Option B — from source

```bash
git clone https://github.com/p32929/cccsss.git
cd cccsss
./run.sh
```

`run.sh` installs it globally and then starts it **in the folder you ran it from**, not in the clone — so you land on your own project's sessions.

### Uninstalling

```bash
npm uninstall -g cccsss
```

That leaves your settings behind. `./uninstall.sh` (in the clone) removes the package *and* `~/Library/Application Support/cccsss` (or `~/.config/cccsss`), and asks before it touches anything. Neither one goes near `~/.claude` — your sessions are yours.

## Use

Run `cccsss` in a project. It asks where to start:

```
 cccsss — where do you want to start?

 t  this folder   /Users/you/dev/my-app
                  5 sessions · 1.4MB

 a  all projects  149 projects · 4.0GB

 t this folder · a all projects · enter this folder · q quit
```

Pick a session, press `c`, and you get `cd /Users/you/dev/my-app && claude --resume 0f8e2a91-…` on your clipboard — the `cd` is included because `claude --resume` only finds a session from its own directory.

## Keys

| Screen | Keys |
|---|---|
| Projects | `↑/↓` move · `/` filter · `s` sort · `enter` open · `p` open a path · `d` delete project · `q` quit |
| Sessions | `↑/↓` move · `/` filter · `s` sort · `enter` read · `c` copy · `m` mode · `d` delete · `esc` back · `q` quit |
| Transcript | `↑/↓ pgup/pgdn` scroll · `g`/`G` ends · `[`/`]` prev/next prompt · `/` search · `n`/`N` matches · `c` copy · `m` mode · `d` delete · `esc` back · `q` quit |

Every screen lists its keys in the footer.

## Resume modes

`m` cycles the command through Claude Code's permission modes: normal, plan, accept edits, auto, don't ask, bypass permissions. The app never runs anything — it only shows you the command. Your mode and sort choices are remembered between runs.

## Deleting

`d` deletes the selected session, or on the projects list, every session in that project. Nothing happens until you confirm, and only `y` confirms. **There is no undo** — this removes `.jsonl` files from `~/.claude/projects`, and `claude --resume` can't bring back a session whose file is gone.

Deletes are guarded in `lib/data.js`: a path that isn't a `.jsonl` file directly inside `~/.claude/projects` is refused, and a project folder is only removed if deleting its transcripts left it empty.

## Where things live

| | |
|---|---|
| Sessions (read, and deleted by `d`) | `~/.claude/projects/<encoded-path>/<session-id>.jsonl` |
| Your settings | `~/Library/Application Support/cccsss/config.json` (macOS) or `~/.config/cccsss/config.json` |

## Layout

| File | |
|---|---|
| `cccsss.js` | the app: state, key handling, every screen |
| `lib/data.js` | reading session files, sorting, deleting, config |
| `lib/term.js` | ANSI styling, key decoding, list / input / viewport widgets |
| `test.js` | `npm test` |

## License

MIT
