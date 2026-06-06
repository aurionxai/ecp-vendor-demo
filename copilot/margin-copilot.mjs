#!/usr/bin/env node
// Fraud Autopilot — copilot prototype with a SWAPPABLE LLM backend.
//
// Same deterministic per-sub-vendor engine + tools for both backends. The LLM is
// only the natural-language interface; the money math is in the tools, so a small
// LOCAL model is plenty here. Recommend-only — a human approves, open week only.
//
//   Claude API (quality):   export ANTHROPIC_API_KEY=sk-ant-...
//                           node margin-copilot.mjs "is anyone padding RedPeak?"
//   Local Ollama (no cost): node margin-copilot.mjs --ollama "is anyone padding RedPeak?"
//                           (or COPILOT_BACKEND=ollama ; OLLAMA_MODEL=qwen3.5 ; OLLAMA_URL=...)
//
// No tokens/API billing on the --ollama path — it hits your local Ollama server.

// ── deterministic per-sub-vendor engine (mirrors the mockup) ──────────────────
const SUBS = {
  "livmed-day":  { vendor: "LivMed",            rate: 250, scrub: 0.08, fraud: 0.04, billable: 210 },
  "livmed-night":{ vendor: "LivMed",            rate: 250, scrub: 0.08, fraud: 0.12, billable: 162 },
  "redpeak-a":   { vendor: "RedPeak Media",     rate: 265, scrub: 0.05, fraud: 0.03, billable: 120 },
  "redpeak-b":   { vendor: "RedPeak Media",     rate: 265, scrub: 0.05, fraud: 0.18, billable: 118 },
  "redpeak-c":   { vendor: "RedPeak Media",     rate: 265, scrub: 0.05, fraud: 0.06, billable: 80 },
  "coastal-a":   { vendor: "Coastal Connect",   rate: 240, scrub: 0.12, fraud: 0.22, billable: 219 },
  "gh360-out":   { vendor: "Go Health 360, Inc",rate: 235, scrub: 0.00, fraud: 0.03, billable: 131 },
};
const PUBS = Object.keys(SUBS);

function recommend(pub) {
  const s = SUBS[pub]; if (!s) throw new Error(`unknown sub-vendor ${pub}`);
  const dir = s.fraud > s.scrub + 0.005 ? "raise (under-scrubbed — padding suspected)"
            : s.fraud < s.scrub - 0.005 ? "lower (honest — currently over-scrubbed)"
            : "matched";
  return { pub, vendor: s.vendor, fraudPct: s.fraud, currentScrubPct: s.scrub,
           recommendedScrubPct: s.fraud, direction: dir,
           note: "1:1 to this sub-vendor's fraud signal · recommend-only · open week · human approves" };
}
const listSubvendors = () =>
  PUBS.map((p) => ({ pub: p, vendor: SUBS[p].vendor, fraudPct: SUBS[p].fraud, currentScrubPct: SUBS[p].scrub }));

const runTool = (name, input) =>
  name === "list_subvendors" ? listSubvendors()
  : name === "recommend_scrub" ? recommend(input.pub)
  : { error: `unknown tool ${name}` };
const logTool = (name, input, out) =>
  console.error(`  · ${name}(${JSON.stringify(input)}) → ${JSON.stringify(out)}`);

// ── neutral tool spec (converted per backend) ─────────────────────────────────
const TOOLSPEC = [
  { name: "list_subvendors",
    description: "List every sub-vendor with its fraud signal and current scrub. Call first to triage — fraud and scrub are PER SUB-VENDOR, never per vendor.",
    parameters: { type: "object", properties: {}, required: [] } },
  { name: "recommend_scrub",
    description: "For one sub-vendor (by pubID), return the scrub recommended ONE-TO-ONE to its fraud signal. Honest sub-vendors get scrub LOWERED; padded ones RAISED. Recommend-only; open week; human approves.",
    parameters: { type: "object", properties: { pub: { type: "string", enum: PUBS } }, required: ["pub"] } },
];

const SYSTEM = `You are the Fraud Autopilot copilot for "Pharmacy Call Tracking".
Vendors send traffic through sub-vendors (pubIDs). Some pad call durations to push calls over the 630s billable bar so we overpay. Scrub is an admin-only duration haircut that drops padded calls below the bar.

Rules:
- Fraud and scrub are PER SUB-VENDOR (pubID), never per vendor. Reason at the sub-vendor grain.
- Scrub adjusts ONE-TO-ONE to each sub-vendor's fraud signal. Honest sub-vendors (fraud < scrub) → LOWER scrub (stop underpaying); padded ones (fraud > scrub) → RAISE.
- ALWAYS get numbers from the tools. Never invent a fraud %, scrub %, or recommendation.
- RECOMMEND-ONLY: you propose, a human approves, changes apply to the OPEN WEEK only. Scrub is fraud control, NOT a margin lever.
- Be concise. One line per affected sub-vendor: "pubID (Vendor) — scrub A% → B% [raise/lower]". End with a one-line "a human must approve" caveat.`;

const DEFAULT_Q = "Triage every sub-vendor: who is padding durations, who is over-scrubbed, and what scrub do you recommend for each?";

// ── backend: Claude API (official SDK) ────────────────────────────────────────
async function runAnthropic(question) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const tools = TOOLSPEC.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  let messages = [{ role: "user", content: question }];
  while (true) {
    const res = await client.messages.create({
      model: "claude-opus-4-8", max_tokens: 16000, thinking: { type: "adaptive" },
      system: SYSTEM, tools, messages,
    });
    if (res.stop_reason !== "tool_use")
      return res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    messages.push({ role: "assistant", content: res.content });
    const results = [];
    for (const b of res.content) if (b.type === "tool_use") {
      const out = runTool(b.name, b.input); logTool(b.name, b.input, out);
      results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
}

// ── backend: local Ollama (OpenAI-compatible /v1, no API key, no token cost) ──
async function runOllama(question, model, url) {
  const tools = TOOLSPEC.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  let messages = [{ role: "system", content: SYSTEM }, { role: "user", content: question }];
  for (let round = 0; round < 8; round++) {
    const r = await fetch(`${url}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto", stream: false }),
    });
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
    const msg = (await r.json()).choices[0].message;
    messages.push(msg);
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let args = {}; try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        const out = runTool(tc.function.name, args); logTool(tc.function.name, args, out);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
      }
      continue;
    }
    return msg.content || "";
  }
  return "(stopped after max tool rounds)";
}

// ── main: pick backend ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let backend = process.env.COPILOT_BACKEND || "anthropic";
if (argv[0] === "--ollama" || argv[0] === "--local") { backend = "ollama"; argv.shift(); }
if (argv[0] === "--anthropic" || argv[0] === "--claude") { backend = "anthropic"; argv.shift(); }
const question = argv.join(" ") || DEFAULT_Q;
const model = process.env.OLLAMA_MODEL || "qwen3.5";
const url = (process.env.OLLAMA_URL || "http://localhost:11434/v1").replace(/\/$/, "");

console.error(`[backend: ${backend === "ollama" ? `ollama · ${model} @ ${url} · no token cost` : "claude-opus-4-8 · Claude API"}]`);
const out = backend === "ollama" ? await runOllama(question, model, url) : await runAnthropic(question);
console.log("\n" + out + "\n");
