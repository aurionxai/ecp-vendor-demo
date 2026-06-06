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

## Run

```sh
export ANTHROPIC_API_KEY=sk-ant-...
npm install
node margin-copilot.mjs "is anyone padding call durations on RedPeak?"
node margin-copilot.mjs "which sub-vendors are we over-scrubbing (underpaying)?"
node margin-copilot.mjs            # default: triage every sub-vendor
```

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
