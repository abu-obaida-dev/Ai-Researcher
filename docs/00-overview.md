# 00 — What Is This Product?

> This file answers one question only: **“What is this product?”** — without technical details about how it works or how it was built (those are covered in later files).

## The Product in One Sentence

> **Zena AI is an intelligent Academic Research Supervision Platform that supports university researchers from their first idea through completion of their research — with an academic supervisor who guides their journey, not a chatbot that answers their questions.**

> **A quick glossary for “supervisor”:** The term has three meanings in the project documentation: **AI supervisor** (Zena — the software automation within the platform) · **university supervisor** (the person who advises the researcher at their university) · **administrative supervisor** (a human role in the admin panel that manages users and content). Context distinguishes them throughout.

## Who Is the User?

The Arab university researcher: an undergraduate writing a graduation project, a master’s, doctoral, or diploma researcher, or an independent researcher without formal supervision. They share one thing: **they have research to complete to academic standards, but no dedicated supervisor to follow up with them every day.**

Supporting roles include a human university supervisor (who checks in when needed) and a platform administrator (who manages plans, the library, and payments) — but the product is designed around the researcher, first and foremost.

## What Problem Does It Address?

The researcher’s problem is not a lack of information — information is available everywhere. The real problem comes down to four things:

1. **Getting lost along the way:** They do not know where to start, what the next step is, when each stage ends, or how to tell whether they are on the right track.
2. **Lack of follow-up:** They write alone for months, with no one to ask, “How far have you gotten?” or warn them that they have strayed from their methodology or that their evidence is weak.
3. **Tool fragmentation:** References are in one place, notes in another, files somewhere else, and questions elsewhere — nothing brings them together into a single picture of progress.
4. **The temptation of an easy shortcut:** General-purpose AI tools offer to write the entire research paper in minutes. The researcher submits work that is not their own, the university supervisor discovers it, and they lose both their research and their reputation.

## Why Does the Researcher Need This Platform?

Because they need what every real university researcher needs: **a supervisor**.

A supervisor who knows their field, research title, university, and methodology. A supervisor who divides the path into clear stages. A supervisor who asks before answering. A supervisor who reviews what they have written and identifies the problem — in the methodology, the evidence, or the phrasing. A supervisor who remembers what they agreed on last time and follows up today. A supervisor who prepares them for the defense with real questions before they face the committee.

That is what the platform provides: **ongoing supervision**, not sporadic answers.

## Why Not a Chatbot?

Because a chatbot does three things this platform does not:

- A chatbot **waits for your question, answers, and forgets** — the platform **knows your journey and guides you to the next step**, even if you do not ask.
- A chatbot **treats every conversation as a new beginning** — the platform **manages one continuous research project** for the researcher (full definition in `01 §5`).
- A chatbot **writes whatever you ask for** — the supervisor here **refuses to write on your behalf**, because its goal is for you to complete your research yourself, not receive a ready-made text.

In short, conversation on this platform is **a means** of supervision — just as meeting with a supervisor is a means, not supervision itself. (Details in `08-workspace`.)

## How Is It Different from General-Purpose AI Tools?

| General AI tools | Zena AI |
|---|---|
| Answer anything: programming, entertainment, politics | Focus only on your research — anything else is redirected back to your research |
| Guess when they do not know | Do not guess: ask one question or refer to your academic profile |
| Invent convincing but false references and links | Use only real databases for references — anything unverified is labeled a suggestion with a verification method |
| Forget yesterday | Remember your decisions, tasks, and areas for improvement across sessions |
| Write an entire chapter for you | Review your chapter, classify issues, and ask you to fix them |
| Do not know where you are | Know your current stage, next step, and the status of each step |

## Core Value

**A researcher arrives with a vague idea and leaves with completed research defended before a committee — research they wrote themselves, reviewed stage by stage with their AI supervisor, supported by genuine references, and kept together in one organized project.**

That is the value. Everything else, from payment mechanisms to interfaces, exists only to support it.

## Where to Go After This File

- To understand **why** the product was built this way: read `01-philosophy` (the philosophy of supervision, the journey, the project, and decision-making).
- To understand **who the supervisor is** and how it behaves: read `06-supervisor`.
- To understand the **journey** managed by the product: read `07-research-journey`.
- To understand the **workspace** where everything comes together: read `08-workspace`.
- Technical details (architecture, database, engine, security, operations) are in files `02`–`05` and `09`–`14` — intentionally, none of them are covered in this file.
