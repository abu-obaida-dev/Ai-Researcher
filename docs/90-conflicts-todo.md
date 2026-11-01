# Conflict Report: Documentation vs. the Current Project (To-Do List)

> **Purpose:** Identify every place where the documentation (`docs/`) promises something the current code does not implement, or describes the code inaccurately.
> **Rule:** Documentation is the variable (correct it to describe reality); code is fixed. No new features without an explicit decision.
> **Highest authority:** Documentation Realignment Specification.
> **Status:** ✅ All 18 items have been closed (last update: partial profile gate P0-2 + accompanying documentation).

---

## 🔴 P0 — Promises the code actually contradicts (highest priority)

- [x] **P0-1 ✅ · Documentation promises 5 citation styles, but code supports only 2**
  - Documentation (`01 §6`, `06`): “follows the citation style” is phrased generally, implying that it supports any style the user chooses.
  - Reality (`supervisor-context.js:145`): `mla9 ? MLA 9 : APA 7` — any other value (Chicago 17 / IEEE / Harvard) silently falls back to APA 7, even though the form presents them as options and saves them (`routes/auth.js`).
  - **✅ Done:** `CITATION_STYLE_INSTRUCTIONS` map with all five values in `supervisor-context.js` — unknown values clearly fall back to APA 7.

- [x] **P0-2 ✅ · Documentation says “the profile is required and gates are closed,” but code blocks nothing**
  - Documentation (`07 §2`): “Without a complete profile, gates remain closed.”
  - Reality: `needsOnboarding()` is defined but no router calls it; the only protection is a `/dashboard` redirect, while `/chat`, `/references`, `/journey`, `/files`, and `/defense` work with an empty profile (and the context fills in “unspecified”).
  - **✅ Done (product owner's decision: gradual partial gate):** `requireCoreOnboarding` middleware in `middleware/auth.js` is applied to `POST /chat` + `GET/POST /journey` + `POST /defense/*`, with a complete `?next=` return flow; reads remain open; `GET /chat` and `/references` show a helpful notice explaining what is missing and linking to the profile; `docs/07 §2` was rewritten to describe a “starting point, not a barrier.”

- [x] **P0-3 ✅ · Explicit conflict within the documentation about the references rule**
  - `07` (transition requirements): “There is no lock” + the only restriction is to ask for a title before references.
  - `06` (navigation): “Do not ask for references before recording the title” — temporal wording (before/after) implies a completed stage, whereas the restriction is immediate (state a title now, even if it is your first step).
  - **✅ Done:** Unified wording in `07 §5` (“No reference recommendations unless the researcher names a specific title now — an immediate constraint”) and in `06` (study navigation).

---

## 🟠 P1 — Inaccurate descriptions of actual behavior

- [x] **P1-1 ✅ · Defense questions: documentation says 11, code comment says 8–12**
  - `07 §6`: “11 questions (2+3+3+2+1)” — correct (`defense.js: TOTAL_QUESTIONS = 11`).
  - However, `chat.js:437` has an old comment (“8–12 questions”) that suggests flexibility where none exists.
  - **✅ Done:** The comment now says “11 questions total through the final evaluation.”

- [x] **P1-2 ✅ · Reading statuses: documentation lists 3, code has 4**
  - `03-database.md`: only `to_read/reading/done`.
  - Reality (`constants.js:264`): `to_read/reading/read/cited` — four statuses.
  - **✅ Done:** `03` now lists all four (the only occurrence mentioned there).

- [x] **P1-3 ✅ · “One question per response” is stated absolutely, but code breaks it in 3 places**
  - Defense start message (greeting + question); final evaluation (3 items + recommendations, no question); `needsTopic` response (question + mention of field).
  - **✅ Done:** All three are documented as exceptions under the rule in `06 §How she speaks`.

- [x] **P1-4 ✅ · “First-time greeting” covers the account's entire history, not a session**
  - Reality (`supervisor-context.js:45`): `isFirstMessageEver` spans all conversations; if all conversations are deleted, the user is greeted as new (an undocumented edge case).
  - **✅ Done:** A line in `06 §How memory is used` specifies the scope (“the first time in the user's history on the platform, across all conversations”).

- [x] **P1-5 ✅ · References are “free” — accurate but incomplete**
  - External search has no direct charge, but injecting its results increases the message input and is therefore priced indirectly.
  - **✅ Done:** A line in `05 §4` describes the indirect cost.

---

## 🟡 P2 — Documentation gaps (correct behavior not documented)

- [x] **P2-1 ✅ · Topic registration works only during the `topic` stage — undocumented**
  - `07 §4`: “When the researcher states their topic, it is registered” is phrased generally.
  - Reality (`chat.js:312`): it works only when the current stage is `topic` — if the researcher states a topic during “methodology,” nothing is registered, silently.
  - **✅ Done:** The condition is explicitly documented in `07 §4`.

- [x] **P2-2 ✅ · “Review it on the journey page before we approve it” — no verification mechanism**
  - The code uses `registeredTopic()` immediately in the next message without waiting for any actual review.
  - **✅ Done:** This is documented as guidance, not a guarantee, in `07 §4`.

- [x] **P2-3 ✅ · Response limit silently expands (900 → 1400) with references/attachments**
  - Reality (`chat.js:331`): any response with references or attachments gets the defense-stage limit, even in normal mode (higher cost without notice).
  - **✅ Done:** The rule is documented in `05 §4` because it affects the bill.

- [x] **P2-4 ✅ · Summarization happens when “starting a new session,” not “after every session”**
  - Reality (`chat.js:196,427`): the previous conversation is summarized only when a new one is created; sessions are not summarized for users who keep one conversation forever.
  - **✅ Done:** Wording in `06 §How memory is used` is now accurate.

- [x] **P2-5 ✅ · `resetStrikes` exists but nobody calls it**
  - The only actual reset happens automatically after an idle period; the manual function has zero call sites in `src/`.
  - **✅ Done:** It is documented as an unused fallback in its comment (`supervisor-memory.js`) and in `06`.

- [x] **P2-6 ✅ · `requireService` comment lists 4 routes and omits `/journey`**
  - `/journey` is actually protected (`journey.js:32`) but is not mentioned; `/chat` is intentionally outside the gate (available to everyone), but that intention is undocumented.
  - **✅ Done:** The comment lists all five routes, explains why `/chat` is excluded, and notes the partial profile gate; `04 §5` was also updated.

---

## 🔵 P3 — Terminology consistency

- [x] **P3-1 ✅ · The interface says “points,” while the database uses `tokens_*` — no note explains this**
  - **✅ Done:** Terminology note added to `03` and `10`.

- [x] **P3-2 ✅ · “Supervisor” refers to 3 things (AI/academic/administrative) without a glossary**
  - **✅ Done:** Three-line glossary added under the product definition in `00`.

- [x] **P3-3 ✅ · Stage names are inconsistent (6 philosophical / 9 programmatic / 7 journey stages)**
  - **✅ Done:** A single new mapping table in `07 §Stage mapping` links the three lists.

- [x] **P3-4 ✅ · “Conversation opens on a step” implies a grouped view that does not exist**
  - `step_key` is stored as context only; no query fetches conversations by step and no page displays them.
  - **✅ Done:** Wording was softened in `08` (“tagged with its step as context only”).

---

## 📊 Summary

| Priority | Count | Status |
|---|---:|---|
| Critical P0 | 3 | ✅ All (P0-1 citation-style map · P0-2 partial gate + documentation · P0-3 unified wording) |
| Accuracy P1 | 5 | ✅ All (comments and wording) |
| Gaps P2 | 6 | ✅ All (documented actual behavior + comments) |
| Terminology P3 | 4 | ✅ All (glossary + tables + wording) |
| **Total** | **18** | **✅ Closed** |

> **Implemented in code (not documentation only):** P0-1 (map of five citation styles) · P0-2 (`requireCoreOnboarding` middleware + `?next=` flow + helpful notices in `/chat` and `/references`) · P1-1, P2-5, and P2-6 (code comments). The remaining items are documentation-only.
> **Closure checks:** No new features without agreement; after P0, `00`, `01`, and `07` were reread; `npm run test:unit` = **19/19** (two profile-gate tests were added in this closure).
