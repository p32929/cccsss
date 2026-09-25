# cccsss

Browse your Claude Code sessions and get the exact command to resume any of them.

Pure Node.js, **zero dependencies**. The whole TUI — lists, filtering, the scrolling transcript, search — is built directly on ANSI escapes and raw-mode stdin.

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

## Contributing

Contributions are warmly welcomed and greatly appreciated! Whether it's a bug fix, new feature, or improvement, your input helps make this project better for everyone.

Before submitting a pull request, please:

1. Create an issue describing the feature or bug fix you'd like to work on
2. Wait for discussion and approval to ensure alignment with project goals
3. Fork the repository and create your feature branch
4. Submit your pull request with a clear description of changes

This approach helps avoid duplicate efforts and ensures smooth collaboration. Thank you for considering contributing!

## Share

Sharing this repository with your friends is just one click away from here

[![facebook](https://user-images.githubusercontent.com/6418354/179013321-ac1d1452-0689-493f-9066-940cf2302b6e.png)](https://www.facebook.com/sharer/sharer.php?u=https://github.com/p32929/cccsss/)
[![twitter](https://user-images.githubusercontent.com/6418354/179013351-7d8d6d1c-4ce2-46ab-bef8-4c4765a1b888.png)](https://twitter.com/intent/tweet?url=https://github.com/p32929/cccsss/)
[![tumblr](https://user-images.githubusercontent.com/6418354/179013343-3111f55a-3b90-40c7-8487-9777348672b0.png)](https://www.tumblr.com/share?v=3&u=https://github.com/p32929/cccsss/)
[![pocket](https://user-images.githubusercontent.com/6418354/179013334-b095c45f-becf-49f4-9ee1-5a731a9b1f85.png)](https://getpocket.com/save?url=https://github.com/p32929/cccsss/)
[![pinterest](https://user-images.githubusercontent.com/6418354/179013331-44cd9206-11b1-4b65-becb-5863b61c828f.png)](https://pinterest.com/pin/create/button/?url=https://github.com/p32929/cccsss/)
[![reddit](https://user-images.githubusercontent.com/6418354/179013338-7416ae3f-73ba-4522-86e1-1374d7082d22.png)](https://www.reddit.com/submit?url=https://github.com/p32929/cccsss/)
[![linkedin](https://user-images.githubusercontent.com/6418354/179013327-ca7b7102-1da8-4b1c-858f-1a6e5f21bd70.png)](https://www.linkedin.com/shareArticle?mini=true&url=https://github.com/p32929/cccsss/)
[![whatsapp](https://user-images.githubusercontent.com/6418354/179013353-f477fa0b-3e6f-4138-a357-c9991b23ff88.png)](https://api.whatsapp.com/send?text=https://github.com/p32929/cccsss/)

<!-- kit-block -->

---

## Using Claude Code CLI for real work?

I put together the **[Claude Code Starter Kit](https://p32929.github.io/claude-code-starter-kit/)** — tested `.claude/` subagents, slash commands and guard hooks (blocks `rm -rf` and `.env` reads) that install in 60 seconds. Free Lite version on GitHub, or the full kit plus a done-for-you Team ($999) / Enterprise ($1,499) rollout across your repos.
