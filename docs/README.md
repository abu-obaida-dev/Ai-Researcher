# Zena AI Documentation Index — Intelligent Research Supervisor

> This folder is the complete reference for anyone who wants to understand the project: what it does, why it was built this way, and how each part works.

## How to read the documentation

| Order | File | What you will learn |
|---|---|---|
| 0 | [00-overview](./00-overview.md) | What is the product? The user, the problem, and the value — no technical details |
| 1 | [01-philosophy](./01-philosophy.md) | **Product philosophy**: supervision, the journey, the project, and decisions — then engineering |
| 2 | [02-architecture](./02-architecture.md) | Overall architecture: layers, request lifecycle, folder map |
| 3 | [03-database](./03-database.md) | Database: all tables, relationships, and safe-fallback philosophy |
| 4 | [04-auth-and-access](./04-auth-and-access.md) | Google sign-in + sessions + roles, permissions, and services |
| 5 | [05-ai-engine](./05-ai-engine.md) | AI engine: hedged race, multiple keys, actual pricing |
| 6 | [06-supervisor](./06-supervisor.md) | Zena's behavior: how she speaks, decides, refuses, and follows up |
| 7 | [07-research-journey](./07-research-journey.md) | Researcher's journey: stages, outputs, and identifying the current stage |
| 8 | [08-workspace](./08-workspace.md) | Workspace: the product's core — conversation is one of its tools |
| 9 | [09-literature](./09-literature.md) | Real reference tool: free sources, cleanup, filtering, DOI resolution |
| 10 | [10-payments-and-plans](./10-payments-and-plans.md) | Plans + quotas + manual payment and atomic confirmation |
| 11 | [11-admin](./11-admin.md) | Admin dashboard: sections, protection, researcher/library/notification management |
| 12 | [12-security](./12-security.md) | Security: sessions, CSRF, rate limits, binary signature checks, crash protection |
| 13 | [13-views-ux](./13-views-ux.md) | Interfaces: SSR without React, visual identity, layout, and sidebar |
| 14 | [14-ops](./14-ops.md) | Operations and deployment: environment, scripts, Vercel, troubleshooting |

## Golden rule

> **Code calculates; the model guides.**
> Anything that can be determined by the database or code is determined by code, not left to AI guesswork.

## New developers: start here

1. Read `00-overview` then `01-philosophy` to understand “why.”
2. Read `02-architecture` then `03-database` to understand “where everything is.”
3. Run the project according to `14-ops`, then try a complete researcher journey: sign in → onboarding → journey → chat → references → payment.
