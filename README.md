# cccsss

Browse your Claude Code sessions and get the exact command to resume any of them.

Pure Node.js, **zero dependencies**: no third-party packages, so there is no supply chain to attack. The whole TUI — lists, filtering, the scrolling transcript, search — is built directly on ANSI escapes and raw-mode stdin.

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
| Sessions | `↑/↓` move · `/` filter · `s` sort · `enter` read · `r` run · `c` copy · `m` mode · `d` delete · `esc` back · `q` quit |
| Transcript | `↑/↓ pgup/pgdn` scroll · `g`/`G` ends · `[`/`]` prev/next prompt · `/` search · `n`/`N` matches · `r` run · `c` copy · `m` mode · `d` delete · `esc` back · `q` quit |

Every screen lists its keys in the footer.

## Resume modes

`m` cycles the command through Claude Code's permission modes: normal, plan, accept edits, auto, don't ask, bypass permissions. `c` copies the command instead of running anything. `r` runs it directly — cccsss hands the terminal to `claude --resume` and exits once it does. Your mode and sort choices are remembered between runs.

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

MIT License. See [LICENSE](LICENSE) for the full text.

## Contributing

Contributions are very welcome, thank you! Before you start on a pull request, please open an issue and tell me what you would like to add or change. That way we can agree on it first, and your time is not wasted on something that might not fit. Thanks for helping make cccsss better.

## You might also like

<p><a href="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/0"><picture><source media="(prefers-color-scheme: dark)" srcset="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/0-dark.svg"><img src="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/0-light.svg" width="50%" align="top" alt="More apps by p32929 on OpenStore (1)"></picture></a><a href="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/1"><picture><source media="(prefers-color-scheme: dark)" srcset="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/1-dark.svg"><img src="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/1-light.svg" width="50%" align="top" alt="More apps by p32929 on OpenStore (2)"></picture></a><br><a href="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/2"><picture><source media="(prefers-color-scheme: dark)" srcset="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/2-dark.svg"><img src="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/2-light.svg" width="50%" align="top" alt="More apps by p32929 on OpenStore (3)"></picture></a><a href="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/3"><picture><source media="(prefers-color-scheme: dark)" srcset="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/3-dark.svg"><img src="https://openstore.pfay.workers.dev/more/p32929/cccsss/personal/3-light.svg" width="50%" align="top" alt="More apps by p32929 on OpenStore (4)"></picture></a></p>

<p><a href="https://p32929.github.io/share/?repo=cccsss"><picture><source media="(prefers-color-scheme: dark)" srcset="https://p32929.github.io/readme/footer-share-dark.svg"><img src="https://p32929.github.io/readme/footer-share-light.svg" width="50%" align="top" alt="Share this project with your friends in one click"></picture></a><a href="https://p32929.github.io/support/"><picture><source media="(prefers-color-scheme: dark)" srcset="https://p32929.github.io/readme/footer-support-dark.svg"><img src="https://p32929.github.io/readme/footer-support-light.svg" width="50%" align="top" alt="If you like my work and want to support me, feel free to support"></picture></a><br><a href="https://openstore.pfay.workers.dev/add"><picture><source media="(prefers-color-scheme: dark)" srcset="https://p32929.github.io/readme/footer-join-dark.svg"><img src="https://p32929.github.io/readme/footer-join-light.svg" width="100%" align="top" alt="Put your own apps on OpenStore: free, your listing lives in your own repo"></picture></a></p>
