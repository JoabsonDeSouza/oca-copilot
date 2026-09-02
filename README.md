# OCA Copilot

A tiny macOS menu bar widget that shows, side by side, how much of each AI
coding assistant's rate limit you have burned: **Claude Code**, **Codex** and
**Gemini**. Three rings, live percentages, and today's cost.

It sits as a discreet tab on the right edge of your screen and expands on hover.

> Built with [Tauri](https://tauri.app) (lightweight shell) + a small Node
> collector that reads each tool's local usage data. No servers, no accounts,
> no data leaves your machine.

## Features

- **Three live rings** with the used percentage of each tool's limit window.
- **Peek + hover**: tucks into a thin tab on the screen edge, expands when you
  move the cursor over it. A button keeps it always on top.
- **Official logos**, colored per service.
- **Today's usage** line showing estimated cost and real work tokens
  (`hoje $71 / 328k`) instead of the raw, cache-inflated total.
- **Click a ring** to open a terminal with that assistant loaded
  (`claude`, `codex`, `gemini`).
- **Duo mode**: a button that opens a terminal where Claude and Codex discuss a
  topic with each other, taking turns (`duo.mjs`).
- **Exhausted state**: when an assistant hits its limit, its ring turns red and
  the icon dims.

## How it works

```
  ui/                front-end (HTML + CSS + inline SVG, no framework)
  src-collector/     collector.mjs: reads local usage and emits unified JSON
  src-tauri/         Tauri shell: menu bar tray, popover window, commands
  duo.mjs            Claude x Codex discussion runner
  config.json        settings (refresh interval, budgets)
```

The front-end calls the Tauri command `get_usage`, which runs `collector.mjs`
and gets back one JSON object with the three agents plus `dayTokens`.

## What the percentage means

| Agent | Data source | % = |
|-------|-------------|-----|
| **Claude** | `ccusage` (reads transcripts in `~/.claude/projects`) | tokens of the current 5h block vs a ceiling (budget from `config.json`, or your heaviest historical block) |
| **Codex** | session rollout in `~/.codex/sessions/.../rollout-*.jsonl` | `rate_limits.primary.used_percent`, Codex's **native** 5h-window number |
| **Gemini** | gemini-cli session JSON (after login) | day usage vs `gemini.dailyRequestBudget` (wired after login) |

Codex reports the number natively. Claude does not expose a local rate-limit
percentage, so we use a configurable proxy. The three are independent windows,
so they do not add up to 100%.

### About the "today" number

The raw daily token total is dominated by **cache reads** (Claude Code re-reads
the whole cached context every turn). Those count toward the total but cost a
fraction of a normal token. So the widget shows **estimated cost** plus **real
work tokens** (new input + generated output), not the inflated total.

## Requirements

- macOS
- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) (to build the app)
- The CLIs you want to monitor: `claude`, `codex`, and/or `@google/gemini-cli`

## Build & install

```bash
npm install
npm run tauri build
cp -R "src-tauri/target/release/bundle/macos/OCA Copilot.app" /Applications/
```

Launch it from Spotlight or Launchpad ("OCA Copilot"). It has no Dock icon; it
lives in the menu bar. Left-click the tray icon to show/hide, right-click for
the menu (Show/Hide, Quit).

For development: `npm run tauri dev`.

## Configuration (`config.json`)

```json
{
  "refreshSeconds": 45,
  "claude": { "blockTokenBudget": null },
  "gemini": { "dailyRequestBudget": 1000 }
}
```

- `refreshSeconds`: how often it refreshes (minimum 15s).
- `claude.blockTokenBudget`: token ceiling per 5h block for the %. `null`
  auto-calibrates from your heaviest block; set a number for a truer %.
- `gemini.dailyRequestBudget`: daily quota reference for Gemini's %.

## Gemini (pending)

The CLI installs via `@google/gemini-cli`, but the usage adapter is not wired
yet. Run `gemini` once to log in; until the adapter reads its session schema,
the third ring shows a dimmed `setup` state.

## Notes on logos

The Claude, OpenAI and Google Gemini marks are trademarks of their respective
owners and are used here only to identify each service. The SVGs come from
[Simple Icons](https://simpleicons.org).

## License

MIT. See [LICENSE](LICENSE).
