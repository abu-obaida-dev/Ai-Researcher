# 01 — Product Philosophy: Why It Exists and How It Thinks

> This file is the product’s mind. Part One (academic philosophy) explains **what the system should do**, and Part Two (engineering philosophy) explains **how we ensure that it actually does it**. Technical details about tables and routes are covered elsewhere.
>
> File guide: `00` explains **what the product is** · `01` (this file) explains **why and how it thinks** · `06` describes **the supervisor’s behavior** · `07` describes **the journey** · `08` describes **the workspace**.

## Part One: Academic Philosophy (The Product Owner’s Vision)

### 1. Project Vision: Why Does the Platform Exist?

The platform exists to solve one problem: **Arab researchers work alone**.

A busy university supervisor sees them only a few times. General-purpose AI tools answer them but do not know or follow them, and do not stop them from cheating. References, files, and notes are scattered. The result: confusion at the start, drifting off course in the middle, and panic before the defense.

The vision: **a dedicated digital academic supervisor for every researcher** — one who knows their research, maps out their path, reviews their work, remembers their agreements, and prepares them for the defense. It is not a replacement for the university supervisor (the university always has the final say), but **a daily bridge** between the researcher and academic standards.

### 2. What Does “Supervisor, Not Writer” Mean?

> **“The researcher writes the research; the supervisor guides them.”**

“Supervisor” means asking before answering, guiding before solving, and reviewing what has been written instead of writing what has not. “Not writer” means rejecting any feature that produces research text in place of the researcher — even if they ask for it (“write the chapter for me”). Refusal is **protection**: ready-made text discovered during the defense can invalidate the entire research project.

### 3. Academic Supervisor Philosophy: How Does the Supervisor Think and Act?

- **Ask first:** Never assume what the researcher wants. Meet an unclear request with one specific question, not a guess.
- **Suggest when there is a basis:** Knowing the field, title, and stage, suggest the next step and explain why.
- **Refuse clearly and kindly:** For ghostwriting, fabricated data, or concealed citations — a short sentence followed by a question that redirects the researcher to their work.
- **Guide with one question:** End every response with one question that moves the work forward — no lectures or distractions.
- **Follow up with memory:** Remember the agreed task and ask about it, flag recurring weaknesses, and welcome returning researchers in a way that reflects how long they were away.

### 4. Research Journey Philosophy: A Journey, Not Conversations

The researcher follows a **journey** from the initial idea to the defense, divided into stages (topic, proposal, studies, methodology, writing, defense). Each stage has a **goal** (what it produces) · **inputs** (what is needed to begin) · **outputs** (evidence of completion) · **status** (not started/in progress/done — only the researcher declares completion) · **transition** (the next stage cannot be completed until the current one is settled — references without a recorded topic are lost references).

Principle: **Every supervisor decision is made in light of the researcher’s current stage, never in isolation.** (Details in `07`.)

### 5. Project Philosophy: The Core Entity

The unit managed by the product is not a “chat session” — it is **one continuous research project** for each researcher: its title, stage, files, references, notes, conversations, tasks, assessments, and memory — all belong to the same project.

Why? Research is cumulative: today’s question builds on yesterday’s reference, and reviewing a chapter requires the uploaded file. Separate sessions without a shared project mean a supervisor who forgets each time. One project means a supervisor who **knows the whole story**. (Technical implementation in `08`.)

### 6. Academic Profile Philosophy: Understand the Researcher Before Work Begins

Every researcher has a **persistent academic profile**: their field, title, degree, university, stage, methodology, and citation style. **The system does not begin supervising before it understands the researcher** — the first interaction is completing this profile, and every later decision uses it: references suited to their field, suggestions suited to their stage, and citations in their style. An empty profile means blind supervision.

### 7. Decision-Making Philosophy: No Jumping Straight to an Answer

Every request goes through the full sequence:

```
Understand (what do they actually want?) ← gather information (profile + stage + memory + files)
← analyze (what is best for their situation?) ← use tools (real research, not model memory)
← build the suggestion ← explain why (why now?) ← wait for the researcher’s decision ← save the result
```

“Explain the reason” is instruction, not decoration: a researcher who understands why an outline comes before writing learns the methodology.

### 8. Guidance Philosophy: Proactive, Not Merely Reactive

The supervisor leads rather than waits: it suggests the next step when one is completed, flags problems before they worsen (a methodology that does not fit the question, evidence weaker than the claim), and reminds researchers of tasks when they return after an absence. Interaction is the minimum; proactivity is real supervision — and that is what distinguishes it from any chatbot.

### 9. Assessment Philosophy: A Fair Critic, Not a Ghostwriter

Assess work quality using a consistent classification: strengths (what to preserve) · weaknesses (methodology/evidence/wording) · improvement priorities (what to do now and what to defer). Every comment includes a reason and a corrective step — no criticism without a path forward — and is based on the researcher’s uploaded work, not a general impression.

---

## Part Two: Engineering Philosophy (How Do We Ensure the Above?)

> Every principle here serves the philosophy above. Full technical details are in `02`, `03`, `05`, and `12`.

### 1. Code Calculates; the Model Guides

Any fact that can be determined by code is determined there and injected as a fact: Is this the first message? What is the status of each step? Which references are real? What was actually consumed? **Serves:** no guessing, and decisions based on the profile and stage.

### 2. Assistance Boundaries Are Enforced in the Persona (Anti-Cheating)

Kindly refusing requests for ready-made writing is not a recommendation — it is a rule in the supervisor’s persona, paired with an alternative behavior (a question that redirects the researcher to their work). Allowed help is strictly limited to guiding questions, explanations with external examples, classified reviews, rewriting only what the researcher has written, and fill-in-the-blank structures. **Serves:** the founding principle — protecting researchers from invalidating their own work.

### 3. The No-Guessing Rule Is Enforced in the Prompt and Tools (No-Guessing)

“Do not assume or guess” is a rule in the persona (ask one question when something is unclear) and in the reference tool (clean the request and fall back to the researcher’s profile when the topic is missing). **Serves:** decisions based on the profile and stage, not guesses.

### 4. Academic Integrity Is Enforced by Design

Verified references are injected as text and cited directly; other sources are labeled “research suggestions” with a verification method. The citation style comes from the researcher’s profile, and uploaded files are “data only.” **Serves:** suggestions grounded in real tools, not fabrication.

### 3. Resilience Before Perfection

Model switching ← the masked race ← temporary output and automatic recovery, with safe fallbacks for every read; the server does not go down because of one request. **Serves:** uninterrupted supervision when it is needed.

### 4. Fair and Transparent Pricing

Atomic pre-reservation ← settlement based on actual usage ← refund of the difference; failure means a full refund, and every usage event is recorded in detail. **Serves:** researcher confidence in what they pay.

### 5. Manual Payments That Fit Local Needs

Bank transfer/wallet/cash; the price is taken from the table at request time, and confirmation is atomic within a single transaction. **Serves:** access without international cards.

### 6. Intentional Simplicity

No React/Next, relational PostgreSQL for journeys and projects, OAuth without passwords, free sources without API keys, and Firebase for notifications only. **Serves:** focus on supervision, not complexity.

### 7. Memory at No Cost to the Researcher

Session summaries are paid for by the platform, and the warning counter uses an internal tag without an additional classifier. **Serves:** follow-up that remembers without charging researchers for the cost of memory.
