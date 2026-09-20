# Jev.UI

[TypeSafe's](https://typesafe.ai) Jev model doesn't generate text. Send it a **state** (a
message, a support ticket, any text or JSON) plus a set of named, typed **questions**, and it
returns typed answers with probabilities: **noul** (yes/no, as P(yes)), **choice** (one of up to
255 options, with a probability per option and a confidence), and **score** (2–10 ordered levels,
with a probability-weighted score, a per-level distribution, and a confidence). Jev.UI is a local
workbench for composing those requests and reading the results — not a chat client.

## What you can do with it

- Compose a state and a set of questions, and see the probabilities and confidence behind every
  answer, not just a single guess.
- Save question sets to disk as plain, versionable JSON files.
- Export any request as a ready-to-run cURL command, Python script, or TypeScript snippet.
- Pipe text straight through `jev ask` from the command line, scripts, or other tools.
- Work in a browser, a terminal UI, or a one-shot CLI command — same request format everywhere.

## Requirements

- Node.js 24 or later
- [pnpm](https://pnpm.io)
- A TypeSafe API key, set as `TYPESAFE_API_KEY`. Get one from the
  [TypeSafe console](https://console.typesafe.ai/keys).

## Install and build from source

```sh
git clone <this repository>
cd Jev.UI
pnpm install
pnpm build
```

Run the CLI straight from the checkout:

```sh
node apps/cli/dist/bin.js --help
```

Or link it onto your `PATH` as `jev`:

```sh
pnpm --filter jev-ui link --global
```

## Quick start

### `jev serve` — the web workbench

```sh
jev serve
```

Starts the local server and opens a browser to it (`--no-open` to skip that, `--port <n>` to pick
a port).

### `jev` — the terminal UI

```sh
jev
```

Launches the interactive TUI in your terminal.

### `jev ask` — one-shot from the command line

```sh
echo "Hi, I've been trying to connect my Stripe account…" | jev ask support-triage
```

Loads the `support-triage` question set from the sets directory, sends the piped text as state,
and prints a readable result. Useful flags:

- `--state <file>` — read state from a file instead of stdin (`-` also means stdin)
- `--model <id>` — override the question set's model
- `--json` — print the raw JSON result instead of the formatted view

| Exit code | Meaning                                                                              |
| --------- | ------------------------------------------------------------------------------------ |
| `0`       | Success                                                                              |
| `1`       | The request reached the API but failed (auth, validation, rate limit, timeout, etc.) |
| `2`       | Usage error — bad arguments, missing state, no API key, or an invalid question set   |

## The web workbench

The main view has three modes, toggled at the top: **Form** (guided question editors), **JSON**
(a raw request editor), and **Split** (both side by side; on narrow screens this collapses to
Build/JSON tabs). Editing the JSON pane applies to the form the moment it parses as a valid
request; while it's invalid, the form keeps showing the last valid document, the JSON pane shows
the error and its line number, and Run is disabled. Typing in the form's own text fields is never
rewritten out from under you.

Results are shown per question, with the full probability distribution and confidence, not just
the winning answer. If you edit the request after a run, the results are marked stale rather than
cleared, so you can compare the old answer against your change. Run with the button or
⌘/Ctrl+Enter. Export turns the current request into a cURL command, a Python script, or a
TypeScript snippet. A theme toggle switches between light and dark.

## The terminal UI

At 120 columns or wider the TUI shows three panes side by side — state, questions, results — with
tabs to switch between them below that width.

| Key         | Action                                       |
| ----------- | -------------------------------------------- |
| Tab         | cycle panes                                  |
| 1 / 2 / 3   | jump to a pane                               |
| ↑ / ↓ (k/j) | move selection                               |
| r           | run                                          |
| a           | add question                                 |
| d           | delete question                              |
| D           | duplicate question                           |
| J / K       | move question down / up                      |
| Enter       | edit selected question                       |
| n           | rename selected question                     |
| i           | edit state (single line)                     |
| m           | set model                                    |
| o           | open a question set                          |
| s           | save                                         |
| e           | export (cURL / Python / TypeScript)          |
| E           | edit state in `$EDITOR`                      |
| ?           | toggle this help                             |
| Esc         | close help / cancel a prompt                 |
| q           | quit (confirms if there are unsaved changes) |

Set `NO_COLOR` to disable colored output in both the TUI and `jev ask`'s formatted results.

## Question sets

Sets are plain JSON files. Jev.UI looks for them in, in order: `--sets-dir`, then
`JEV_SETS_DIR`, then `./jev` relative to the current directory. A set's file name must match
`^[a-z0-9][a-z0-9_-]*$` (e.g. `support-triage.json`).

```json
{
  "name": "support-triage",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this",
      "criteria": {
        "billing": "Payment or subscription issues",
        "technical": "Bugs or integration problems",
        "sales": "Pricing or account questions"
      }
    },
    "frustration": {
      "type": "score",
      "instructions": "How frustrated the customer appears",
      "criteria": [
        "Calm, just stating facts",
        "Frustrated but civil",
        "Very angry, strong language"
      ]
    },
    "is_urgent": {
      "type": "noul",
      "instructions": "The message conveys urgency or time-sensitivity"
    }
  }
}
```

Every question has an `instructions` field and a `type`-specific `criteria`:

| Type     | `criteria`                                     | Limits        |
| -------- | ---------------------------------------------- | ------------- |
| `noul`   | optional `{ true, false }` descriptions        | —             |
| `choice` | a map of option name → description (or `null`) | 1–255 options |
| `score`  | an ordered array of level descriptions         | 2–10 levels   |

`instructions` and `criteria` values can be plain strings, or structured text (an array or an
object) when a single string doesn't say enough. When the state is structured JSON, the web
workbench lets you reference a piece of it from an instructions or criteria field by typing a
backtick — for example `` `state.customer.plan` `` — which triggers autocomplete over the state's
own paths. Because JavaScript orders object keys with integer-like keys first in numeric order,
`choice` options named `"0"`, `"1"`, `"2"` are always listed in that numeric order regardless of
how they were typed, ahead of any non-numeric option names.

## Cost and limits

Jev.UI estimates cost using a fixed price-per-input-token constant baked into the app; it's a
constant maintained here, not a live lookup, so it can lag TypeSafe's published pricing. The state
editor shows a live token estimate against a 32,000-token soft budget, and the full request has a
64,000-token budget. Any token or cost figure shown before you run is only an estimate of the
state plus the largest question — the API's own count, returned after the call, is higher.

## Security model

The server binds to `127.0.0.1` only. Every request is checked against a Host/Origin allow-list
that accepts only `127.0.0.1` or `localhost` on the bound port; this blocks DNS-rebinding attacks
and stray cross-site requests from other pages in your browser. It never sends any
`Access-Control-*` header, so no other origin can call it even if it discovers the port.

Your API key is read from the environment by the Node process that runs the server; it is never
sent to the browser, never logged, and never written into an export or a history record. Run
history is written to `~/.local/share/jev-ui/history.jsonl` (or under `$XDG_DATA_HOME` if set),
with the containing directory created `0700` and the file `0600`. It records full requests and
results (or errors), so treat it as sensitive. Do not expose this server to a network — it has no
authentication.

## Development

| Package               | Role                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@jev-ui/core`        | Request/answer schemas, the TypeSafe client, question-set and history storage. `@jev-ui/core/browser` re-exports the subset that's safe to bundle into the browser (no Node built-ins, no API key handling). |
| `@jev-ui/server`      | The localhost Hono API: host/origin guard, `/api/*` routes, static hosting of the built web app.                                                                                                             |
| `@jev-ui/web`         | The React web workbench, built as static files served by `@jev-ui/server`.                                                                                                                                   |
| `jev-ui` (`apps/cli`) | The `jev` binary: `ask`, `serve`, and the default terminal UI.                                                                                                                                               |

Common scripts, run from the repo root:

```sh
pnpm build       # build every package
pnpm test        # build, then run every package's test suite
pnpm typecheck   # type-check every package
pnpm lint        # eslint + prettier --check
```

For the web app's own dev server with hot reload, run the built server on its default port
alongside Vite's dev server:

```sh
jev serve --no-open --port 4173
pnpm --filter @jev-ui/web dev
```

Vite's dev server proxies `/api` requests to `127.0.0.1:4173` and rewrites the proxied request's
`Origin` header to match, since the dev server itself runs on a different port and would otherwise
be rejected by the host/origin guard described above.

The live API test is opt-in and skipped by default; it makes one real request and costs a
fraction of a cent:

```sh
JEV_LIVE=1 pnpm --filter @jev-ui/core test live
```

## Roadmap

- Batch runs over CSV/JSONL input, with threshold tuning for choice and score questions
- A question linter that flags known model weak spots
- Diffing results across model versions
- A browser for past run history

## Licence

Apache License 2.0. See [LICENSE](LICENSE). Jev.UI is an independent, community-built workbench
and is not affiliated with or endorsed by TypeSafe.
