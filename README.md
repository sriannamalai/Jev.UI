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
git clone https://github.com/sriannamalai/Jev.UI.git
cd Jev.UI
pnpm install --frozen-lockfile
pnpm build
```

Run the CLI straight from the checkout:

```sh
node apps/cli/dist/bin.js --help
```

Or set up a shell alias so you can type `jev` instead, run from the repository root:

```sh
alias jev="node $(pwd)/apps/cli/dist/bin.js"
```

The rest of this README uses `jev` in its examples — that always means this alias (or, if you
skipped it, the explicit `node apps/cli/dist/bin.js` form).

Version **0.2.0** adds the full-screen terminal workbench. See [CHANGELOG.md](CHANGELOG.md) for
release changes and [GitHub Releases](https://github.com/sriannamalai/Jev.UI/releases) for tagged
source archives. Releases currently use the source-build workflow above.

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
echo "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP." | jev ask support-triage
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

The Save button saves under the current set's name once one is loaded. Saving under a new name
from the web workbench only works before a set has been loaded (or been saved once); once a set
has a name, saving under a different name is currently only available in the terminal UI (`S`,
save as).

## The terminal UI

The TUI fills the terminal and restores your shell when you exit. The header shows the current
set, model, and unsaved changes; status and relevant shortcuts stay at the bottom. At 120 columns
or wider, State, Questions, and Results appear side by side; smaller terminals use tabs. Content
scrolls inside each pane and adapts when you resize the terminal.

Press **Ctrl+P** to open **Actions** and choose a command with the arrow keys and Enter. Disabled
actions explain what is missing. Esc returns to the workbench.

**Navigate**

| Key                 | Action                                                                      |
| ------------------- | --------------------------------------------------------------------------- |
| Tab / Shift+Tab     | next / previous pane                                                        |
| 1 / 2 / 3           | jump to State / Questions / Results                                         |
| ↑ / ↓ (k/j)         | select a question, or scroll State / Results                                |
| Page Up / Page Down | scroll a page; in Questions, page through details and questions             |
| Home / End          | jump to the beginning / end; in Questions, select the first / last question |

**Run**

| Key | Action |
| --- | ------ |
| r   | run    |

**Edit**

| Key   | Action                                                     |
| ----- | ---------------------------------------------------------- |
| a     | add and edit a question (Questions pane)                   |
| d     | confirm deletion of the selected question (Questions pane) |
| D     | duplicate the selected question (Questions pane)           |
| J / K | move question down / up (Questions pane)                   |
| Enter | edit State or the selected question in the focused pane    |
| n     | rename the selected question (Questions pane)              |
| i     | edit multiline state as Text or JSON                       |
| m     | set model                                                  |

**Sets & export**

| Key | Action                                                                    |
| --- | ------------------------------------------------------------------------- |
| o   | open a saved set                                                          |
| s   | save (prompts for a name only the first time; saves silently after)       |
| S   | save as (always prompts for a name)                                       |
| e   | export as cURL / Python / TypeScript                                      |
| E   | edit the full request as JSON in `$VISUAL`/`$EDITOR` (falls back to `vi`) |

**App**

| Key    | Action                                                                                 |
| ------ | -------------------------------------------------------------------------------------- |
| Ctrl+P | open the Actions menu                                                                  |
| ?      | show scrollable help (Esc closes)                                                      |
| Esc    | close help / cancel a prompt                                                           |
| q      | quit (confirms first if there are unsaved changes)                                     |
| Ctrl+C | quit from anywhere, including mid-prompt (confirms first if there are unsaved changes) |

State editing explicitly selects **Text** or **JSON**, defaulting to the current value type. Text
stays text even when it looks like JSON; JSON mode validates an object or array before saving.
Use Enter for a new line and Ctrl+S to save multiline fields.

Question editing shows step progress and keeps a draft until the final Save. Enter advances a
single-line field; Ctrl+S advances a multiline field. Esc discards the entire draft, including
an unfinished new question. Structured instructions and yes/no criteria open in a JSON editor.
Structured choice descriptions and score levels retain their identity through the
`<structured #N — edit in JSON>` placeholders; use `E` to edit those values in the full request.

**Question names and natural text:** `n` changes a question's identifier, such as
`customer_intent`. Identifiers start with a letter or `_` and contain letters, digits, `_`, or
`-`. To write the actual question — for example, “What does the customer need help with?” —
select it, press Enter, and edit **Instructions**. Spaces and punctuation belong there.
For a choice question, continue to **Options (key: description)** and edit one option per line:

```text
Billing help: Questions about payments or subscriptions
Technical support: Bugs, errors, or setup problems
```

Choice names may contain spaces. Quote a name as a JSON string if it contains a colon, such as
`"Billing: refunds": Refund requests`. Ctrl+S saves the options step. Existing unusual strings
may appear with an `=json ` prefix so their whitespace, newlines, and literal placeholder text
survive editing; keep that encoding when preserving the exact value.

Confirmations support arrows and Enter as well as the displayed letter keys. Delete and dirty
quit confirmations default to keeping your work. When a question has more details than fit in a
page, Page Up/Down scrolls through them; pressing Home/End again on the first/last question
reaches the start/end of its details.

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
backtick, which triggers autocomplete over the state's own paths. A backticked path is relative to
the state value itself, not prefixed with `state.` — for state `{"customer": {"plan": "pro"}}` the
path is `` `customer.plan` ``, and for `{"ticket": {"messages": [{"text": "…"}]}}` it's
`` `ticket.messages[0].text` ``. Because JavaScript orders object keys with integer-like keys
first in numeric order, `choice` options named `"0"`, `"1"`, `"2"` are always listed in that
numeric order regardless of how they were typed, ahead of any non-numeric option names.

## Cost and limits

Jev.UI estimates cost using a fixed price-per-input-token constant baked into the app; it's a
constant maintained here, not a live lookup, so it can lag TypeSafe's published pricing.

Two different pre-run figures are shown, and they measure different things:

- The **State pane's meter** counts the state plus the single largest question, against a
  32,000-token soft budget. That pairing is what the API applies its per-question limit to.
- The **status bar's `≈ N tok (request text only)`**, and the cost beside it, are just an estimate
  of the whole request's text — state and every question together. The app does not currently
  display or enforce a budget for this figure.

Both are estimates of the text you wrote. The API's own count, returned after the call, is higher
than either, because it also includes the prompt overhead upstream adds around your request.
Separately, the API applies its own 64,000-token limit to the whole request; Jev.UI does not
currently check or surface that limit before you run.

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
