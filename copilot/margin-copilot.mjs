#!/usr/bin/env node
// Margin Autopilot — Claude-API copilot prototype (Pharmacy Call Tracking)
//
// Natural language in  →  Claude (claude-opus-4-8) parses intent  →  calls a
// DETERMINISTIC tool that runs the real billing math  →  Claude formats a
// recommend-only proposal. The LLM never invents margins or scrub values; the
// numbers always come from the tool. A human approves in the UI; nothing here
// moves money or touches a locked week.
//
// Usage:
//   export ANTHROPIC_API_KEY=sk-ant-...
//   npm install            # installs @anthropic-ai/sdk
//   node margin-copilot.mjs "what scrub holds 35% margin on RedPeak?"
//   node margin-copilot.mjs                 # default: triage all vendors vs 30%

import Anthropic from "@anthropic-ai/sdk";

// ───────────────────────── deterministic engine (mirrors the mockup) ─────────
const AR_RATE_CENTS = 30000;                       // client pays per connected (>=120s) call
const adj = (n, sc) => Math.round(n * (1 - sc));   // scrub haircut → fewer billable
const MAX_SCRUB = 0.35;

// rate $/call, current scrub, conn = connected (>=120s) calls = AR basis, subs = per-sub billable (>=630s, FIFO)
const VENDORS = {
  LIVMED:  { name: "LivMed",            rate: 250, scrub: 0.08, conn: 396, subs: [210, 162] },
  REDPEAK: { name: "RedPeak Media",     rate: 265, scrub: 0.05, conn: 392, subs: [120, 118, 80] },
  COASTAL: { name: "Coastal Connect",   rate: 240, scrub: 0.12, conn: 182, subs: [219] },
  GOHEALTH:{ name: "Go Health 360, Inc",rate: 235, scrub: 0.00, conn: 163, subs: [131] },
};

const apCost   = (v, scrub) => v.subs.reduce((a, f) => a + adj(f, scrub) * v.rate, 0);
const arRev    = (v) => v.conn * (AR_RATE_CENTS / 100);

function getVendorMargin(key) {
  const v = VENDORS[key]; if (!v) throw new Error(`unknown vendor ${key}`);
  const ar = arRev(v), ap = apCost(v, v.scrub);
  return { vendor: v.name, vendorKey: key, currentScrubPct: v.scrub,
           arRevenue: ar, apCost: ap, marginPct: +( (ar - ap) / ar ).toFixed(4) };
}

function proposeScrub(key, targetMarginPct) {
  const v = VENDORS[key]; if (!v) throw new Error(`unknown vendor ${key}`);
  const ar = arRev(v);
  const current = getVendorMargin(key).marginPct;
  // controller step: proportional nudge, clamped to bounds (open week only)
  const proposed = Math.max(0, Math.min(MAX_SCRUB, v.scrub + (targetMarginPct - current)));
  const projected = +( (ar - apCost(v, proposed)) / ar ).toFixed(4);
  return {
    vendor: v.name, vendorKey: key,
    currentScrubPct: v.scrub, currentMarginPct: current,
    targetMarginPct, proposedScrubPct: +proposed.toFixed(3), projectedMarginPct: projected,
    appliesTo: "open week only", mode: "recommend — human approves", maxScrubPct: MAX_SCRUB,
  };
}

// ───────────────────────── tools exposed to Claude ───────────────────────────
const VKEYS = Object.keys(VENDORS);
const tools = [
  {
    name: "get_vendor_margin",
    description: "Get the current margin %, AR revenue (client pays us), AP cost (we pay the vendor), and current scrub for one vendor. Call this before reasoning about a vendor's profitability — never estimate these yourself.",
    input_schema: { type: "object", properties: { vendorKey: { type: "string", enum: VKEYS } }, required: ["vendorKey"] },
  },
  {
    name: "propose_scrub",
    description: "Run the deterministic billing engine to find the scrub rate that brings a vendor to a target margin. Returns current scrub, current margin, proposed scrub, and projected margin. Use this whenever the admin asks 'what scrub hits X% on <vendor>' or to recommend a fix. Scrub is admin-only, applies to the OPEN WEEK only, and is recommend-only (a human approves).",
    input_schema: {
      type: "object",
      properties: {
        vendorKey: { type: "string", enum: VKEYS },
        targetMarginPct: { type: "number", description: "target margin as a fraction, e.g. 0.35 for 35%" },
      },
      required: ["vendorKey", "targetMarginPct"],
    },
  },
];

const runTool = (name, input) =>
  name === "get_vendor_margin" ? getVendorMargin(input.vendorKey)
  : name === "propose_scrub"   ? proposeScrub(input.vendorKey, input.targetMarginPct)
  : { error: `unknown tool ${name}` };

const SYSTEM = `You are the Margin Autopilot copilot for "Pharmacy Call Tracking".
The operator pays vendors (AP) and is paid by the client, Exact Care Pharmacy (AR). Margin = AR − AP.
Scrub is an admin-only fraud-control duration haircut that lowers AP (and so raises margin).

Rules:
- ALWAYS get numbers from the tools. Never invent a margin, scrub, or projected value.
- Scrub changes are RECOMMEND-ONLY: you propose, a human approves in the UI, and they apply to the OPEN WEEK only — never a locked invoice. Say so.
- Vendor keys: ${VKEYS.join(", ")}.
- Be concise. When proposing, give one line per vendor: "Vendor — scrub A% → B% → ~C% margin". End with a one-line caveat that this is a recommendation a human must approve.`;

// ───────────────────────── manual tool-use loop ──────────────────────────────
const client = new Anthropic(); // reads ANTHROPIC_API_KEY
const question = process.argv.slice(2).join(" ")
  || "Which vendors are below a 30% margin target, and what scrub would bring each to 30%?";

let messages = [{ role: "user", content: question }];

while (true) {
  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    tools,
    messages,
  });

  if (res.stop_reason !== "tool_use") {
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    console.log("\n" + text + "\n");
    break;
  }

  messages.push({ role: "assistant", content: res.content });
  const toolResults = [];
  for (const block of res.content) {
    if (block.type === "tool_use") {
      const out = runTool(block.name, block.input);
      console.error(`  · ${block.name}(${JSON.stringify(block.input)}) → ${JSON.stringify(out)}`);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
    }
  }
  messages.push({ role: "user", content: toolResults });
}
