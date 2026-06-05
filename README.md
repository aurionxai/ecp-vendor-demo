# ECP — Vendor Reporting Console (interactive mockup)

A clickable, **front-end-only prototype** of the ECP vendor reporting dashboard.
No backend, no database, no real authentication — all data is hardcoded sample data
that ties to the plan's funnel (10,210 calls → 951 qualified ≥630s → 909 billable).

> **Prototype only.** This is a design/flow mockup for review. The "login" is cosmetic
> and the numbers are illustrative. The real app is described in `ARCHITECTURE.md` / `PLAN.md`
> (Next.js + Prisma + Postgres, CallShaper → S3 ingest) and is **not** built here yet.

## What it demonstrates

- **Aurion portal** — one admin sign-in → choose **SSDI** or **ECP** (the standalone-portal concept).
- **TRUE ↔ Vendor-facing lens** (admin) — flips every number between gross and net-of-scrub.
- **Role-scoped views** — Admin / Vendor (manager) / Sub-vendor, each scoped to its own data.
- **Vendor experience** — total calls, % qualified, calls paid, earnings; sub-vendor drill-down.
- **Invoices** — admin draft + FIFO/LIFO × scrub review + lock; vendor paid/unpaid history.
- **Team** — vendors invite their sub-vendors to their own scoped logins.
- **Admin** — billing config, variable rates, Unknown-DID assign flow, master-ledger upload.
- **Data health** — ingest runs, S3 buckets, quarantine counts.

## Run locally

It's a single self-contained file — just open `index.html` in any browser (works offline;
only Google Fonts need a connection, and it degrades gracefully without).

## Hosted

Served via GitHub Pages from this repo's `main` branch.
