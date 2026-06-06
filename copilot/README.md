# Fraud Autopilot — copilot prototype

A runnable prototype of the **Claude-API copilot** layer for the Fraud Autopilot
(see the mockup's Admin tab and `ECP-SCOPE.md` §11).

**The design point:** the LLM is the *interface*, not the calculator. Fraud and
scrub are **per sub-vendor** (pubID) — Claude (`claude-opus-4-8`) parses a
natural-language question and calls a **deterministic tool** (`recommend_scrub` /
`list_subvendors`) that sets scrub **one-to-one** to each sub-vendor's fraud
signal. Every number comes from the tool — the model never invents one. It only
**recommends**; a human approves, open week only, never a locked invoice. (Scrub
is fraud control, **not** a margin lever — margin is held by rate.)

## Run — swappable backend

**Claude API** (quality):
```sh
export ANTHROPIC_API_KEY=sk-ant-...
npm install
node margin-copilot.mjs "is anyone padding call durations on RedPeak?"
```

**Local Ollama** (no token / no API cost — runs on your machine):
```sh
ollama run qwen3.5            # pre-warm once (first cold load is slow — see note)
node margin-copilot.mjs --ollama "which sub-vendors are we over-scrubbing?"
# or: COPILOT_BACKEND=ollama OLLAMA_MODEL=qwen3.5 node margin-copilot.mjs "..."
```

Same deterministic tools and prompt for both; only the model backend changes
(`--ollama` / `--claude`, or `COPILOT_BACKEND`). `OLLAMA_MODEL` (default `qwen3.5`)
and `OLLAMA_URL` (default `http://localhost:11434/v1`) are overridable.

> **Local cold-start:** the first call after `ollama serve` loads several GB into
> RAM and (with non-streaming) returns nothing until the full answer is ready —
> Node's `fetch` can time out. **Pre-warm the model once** (`ollama run qwen3.5`)
> before running, or switch the request to streaming. This only affects the local
> path; the Claude API path streams headers immediately.

Tool calls are printed to stderr (so you can see the deterministic engine being
driven); Claude's final recommendation prints to stdout.

## How it maps to the real build

- `get_vendor_margin` / `propose_scrub` → the controller in `packages/engine`
  (the same math the worker's scrub-controller job would run on a cadence).
- The model's output is a **proposal** → in production this becomes a
  `ScrubProposal` row that the admin approves (recommend mode), exactly like the
  mockup's "Approve →" button.
- Swap the in-file `VENDORS` data for live DB reads and this is the real copilot.

> Prototype only — no DB, no auth, and it really calls the Claude API (costs
> tokens). Keep it in `recommend` framing; never let it auto-apply.
