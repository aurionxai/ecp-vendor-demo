#!/usr/bin/env node
// Fraud Autopilot — Claude-API copilot prototype (Pharmacy Call Tracking)
//
// Fraud lives at the SUB-VENDOR grain (each sub-vendor = its own DID + duration
// pattern). Scrub adjusts ONE-TO-ONE to each sub-vendor's fraud signal — never a
// vendor-wide average. Claude (claude-opus-4-8) parses the question and calls a
// DETERMINISTIC tool that runs the real per-sub math; the model never invents a
// number. It only RECOMMENDS — a human approves, open week only, never a locked
// invoice. (Margin is held by RATE, not scrub — scrub is fraud control only.)
//
// Usage:
//   export ANTHROPIC_API_KEY=sk-ant-...
//   npm install
//   node margin-copilot.mjs "is anyone padding call durations on RedPeak?"
//   node margin-copilot.mjs            # default: triage every sub-vendor

import Anthropic from "@anthropic-ai/sdk";

// ── deterministic per-sub-vendor engine (mirrors the mockup) ──────────────────
const round2 = (n) => +n.toFixed(2);
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

// ── tools exposed to Claude ───────────────────────────────────────────────────
const tools = [
  {
    name: "list_subvendors",
    description: "List every sub-vendor with its fraud signal and current scrub. Call this first to triage — fraud and scrub are PER SUB-VENDOR, never per vendor.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "recommend_scrub",
    description: "For one sub-vendor (by pubID), return the scrub the deterministic engine recommends — set ONE-TO-ONE to that sub-vendor's fraud signal. Honest sub-vendors get scrub LOWERED; padded ones get it RAISED. Recommend-only; a human approves; applies to the open week only.",
    input_schema: { type: "object", properties: { pub: { type: "string", enum: PUBS } }, required: ["pub"] },
  },
];
const runTool = (name, input) =>
  name === "list_subvendors" ? listSubvendors()
  : name === "recommend_scrub" ? recommend(input.pub)
  : { error: `unknown tool ${name}` };

const SYSTEM = `You are the Fraud Autopilot copilot for "Pharmacy Call Tracking".
Vendors send call traffic through sub-vendors (pubIDs). Some sub-vendors pad call durations to push calls over the 630s billable bar so we overpay. Scrub is an admin-only duration haircut that drops padded calls below the bar.

Rules:
- Fraud and scrub are PER SUB-VENDOR (pubID), never per vendor. Always reason at the sub-vendor grain.
- Scrub adjusts ONE-TO-ONE to each sub-vendor's fraud signal — never a vendor-wide average. Honest sub-vendors (fraud < scrub) should have scrub LOWERED so we stop underpaying them; padded ones (fraud > scrub) should have it RAISED.
- ALWAYS get numbers from the tools. Never invent a fraud %, scrub %, or recommendation.
- This is RECOMMEND-ONLY: you propose, a human approves, and changes apply to the OPEN WEEK only — never a locked invoice. Scrub is fraud control, NOT a margin lever.
- Be concise. One line per affected sub-vendor: "pubID (Vendor) — scrub A% → B% [raise/lower]". End with a one-line caveat that a human must approve.`;

// ── manual tool-use loop ──────────────────────────────────────────────────────
const client = new Anthropic();
const question = process.argv.slice(2).join(" ")
  || "Triage every sub-vendor: who is padding durations, who is over-scrubbed, and what scrub do you recommend for each?";

let messages = [{ role: "user", content: question }];
while (true) {
  const res = await client.messages.create({
    model: "claude-opus-4-8", max_tokens: 16000, thinking: { type: "adaptive" },
    system: SYSTEM, tools, messages,
  });
  if (res.stop_reason !== "tool_use") {
    console.log("\n" + res.content.filter((b) => b.type === "text").map((b) => b.text).join("") + "\n");
    break;
  }
  messages.push({ role: "assistant", content: res.content });
  const results = [];
  for (const b of res.content) {
    if (b.type === "tool_use") {
      const out = runTool(b.name, b.input);
      console.error(`  · ${b.name}(${JSON.stringify(b.input)}) → ${JSON.stringify(out)}`);
      results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) });
    }
  }
  messages.push({ role: "user", content: results });
}
