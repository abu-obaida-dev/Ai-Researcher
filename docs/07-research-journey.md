# 07 — The Researcher's Journey: From First Visit to Project Completion

> This file describes the **journey (Workflow)** managed by the product—the stages, transition conditions, outputs, current-stage awareness, and progress saving. The philosophy (“why a journey instead of conversations”) is in `01`, the supervisor's behavior within each stage is in `06`, and the place where everything comes together is in `08`.

## The journey at a glance

```
Sign-in → Academic profile → Registered topic → Proposal → Literature → Methodology → Writing → Defense → Completed project
```

It is not a list of pages the researcher visits, but an **academic production line**: each stage produces an output that feeds into the next, and the next stage cannot be completed before the current one is settled.

## Journey milestones

### 1. Sign-in: from visitor to known researcher

The researcher signs in with a Google account, and an account is created. The rule: **no supervision for an unknown user**—the system needs to know whom it is supervising before giving its first piece of advice.

### 2. Academic profile: the starting point for personalized supervision

The first required interaction is to complete the profile's three basics (academic level, field, current goal)—because every later decision (references, suggestions, citations) is based on them. But the profile is **a starting point for personalized supervision, not a barrier to the system**, and access is gated gradually and partially:

- **Available even when the profile is incomplete:** account and payment pages, and reading chat, references, files, and notes (help is never blocked)—the researcher dashboard directs the researcher to the profile only the first time, then opens normally.
- **Unlocked by completing the basics:** sending messages to the supervisor, the full research workflow, and starting and answering defense sessions.
- **Requests context through a smart prompt, not a block:** reference recommendations on the references page show a notice explaining what is missing, with a direct link to complete the profile.
- **Return flow:** a researcher redirected while in the workflow automatically returns to it after saving (`?next=`)—they only have to do this once.

Administrators and users with dashboard permissions are not asked to complete a profile. The philosophy is detailed in `01 §6`, the fields in `03-database`, and the middleware in `04 §5`.

### 3. Degree pathway: the right plan for the degree

The researcher's degree determines the pathway: bachelor's (6 steps) · master's (7+) · doctorate (8+) · diploma · independent. Each step has a goal, description, and guidance (what to ask the supervisor)—so the researcher can see **where they are in the entire journey**, not just the current step.

### 4. Registering the topic: the first real output

When the researcher states their topic in the conversation, it is recorded verbatim as in progress in the “topic” step (not completed—**only the researcher declares completion**) and copied to the profile title if that field is empty. The supervisor tells the researcher that the topic is saved and should be reviewed on the pathway page—**a guidance recommendation, not an actual approval**: the code accepts the registration in the next message without waiting for any review. Conditional rule: automatic registration occurs **only while the researcher is at the “topic selection” stage**—if they state a topic at a later stage, nothing is silently registered (they can register it themselves on the pathway page). From this point, the journey has a **name**: every later reference and suggestion is assessed against this topic.

### 5. Middle stages: proposal → literature → methodology → writing

- **Proposal:** problem, objectives, significance, and preliminary methodology—its output is an approved proposal document.
- **Literature:** gather real references (provided a title is stated and they are within the researcher's field) and organize them—its output is a documented reference list and a reading status for each reference.
- **Methodology:** determine the methodology, sample, and instrument, and discuss their suitability for the research question—its output is a justified methodological decision.
- **Writing:** one chapter at a time; the researcher uploads it for categorized review (methodology/evidence/writing)—its output is a complete draft written by the researcher.

At every stage, the supervisor knows where the researcher is (from their saved status) and responds at the appropriate level: no reference recommendations unless the researcher states a specific title **now** (this is an immediate condition; no previously completed stage is required), and no methodology discussion before the research question is settled.

### 6. Defense: simulate the committee before the real committee

Mock sessions (11 questions: opening 2 · methodology 3 · results 3 · literature 2 · evaluation 1) ask one question at a time and save the counter, ending with a **final evaluation**: strengths, weaknesses, and recommendations. The output is a researcher who enters the real committee having already faced its toughest questions.

### 7. Completion: a completed project, not ended conversations

The journey is complete when the required steps are done and the researcher has a registered title, documented references, a reviewed draft, and a defense evaluation. All of this is saved in the researcher's project (see `08`)—they can return to it whenever they like and continue where they left off without starting over.

## Transition conditions: guidance or enforcement?

Transitions between stages are **guided**: the supervisor suggests the next step when a step is completed, and only the researcher declares a step complete—there is no lock preventing work on any stage.

The restrictions actually enforced are:

1. **No reference recommendations before the title is known**—if the researcher asks for references without a specific title, they are asked, “For which specific title?” This is an **immediate** condition, not a time-based one: state a title now, even if this is the first step.
2. **Partial profile gate** (`requireCoreOnboarding`)—messaging the supervisor, the research workflow, and defense require all three basics to be complete (see §2); reading remains available (with the researcher dashboard's first-time redirect to the profile).
3. **Step-completion review card**—a deterministic check in chat (`services/step-review.js`) reads the conversation using a specification for each step (fields + Arabic patterns). If the indicators are complete, a card is placed in `conversations.pending_review` showing the extracted data with “Edit/Cancel” buttons and a “Save and complete step” button. **Nothing is written to the workflow before the researcher presses Save**: saving alone calls `setStepStatus(done)` with a note about the outputs, advances the next step to “in progress,” updates the supervisor's next task (`open_task`), resets the warnings, logs `usage_logs(step_completed)` (without a charge), then clears the card and displays a congratulations message. Cancel only clears the card. The pathway page retains its manually managed state.

Everything else is guidance, not a restriction.

## How does the system know the current and next steps?

- **Current:** the first incomplete step in the researcher's degree pathway (calculated from saved status, not from their words).
- **Next:** the step after the current one—the supervisor proactively suggests it when the current step is completed instead of waiting to be asked.
- **Return:** all progress is saved (status, note, completion date)—a researcher who is away for months returns to find their plan, memory, and task as they left them.

## Stage mapping: journey → code → philosophy

Three lists of stage names appear in three different contexts. This table maps them:

| Journey milestone (this file) | Code value `RESEARCH_STAGES` (9) | Philosophical stage `01 §4` (6) |
|---|---|---|
| Sign-in · academic profile · degree pathway | — (prepared before topic selection) | — |
| Topic registration | `topic` | Topic |
| Proposal | `proposal` | Proposal |
| Middle stages: literature | `literature` | Literature |
| Middle stages: methodology | `methodology` | Methodology |
| Data collection/analysis | `data` · `analysis` | Details within methodology (not a philosophically independent milestone) |
| Middle stages: writing | `writing` | Writing |
| Defense | `discussion` · `defense` | Defense |
| Completion | — (all required steps) | — |

Two notes: the profile form displays two different lists built on shared values (`GOAL_OPTIONS` goal = 8 and `PROGRESS_LEVELS` progress = 5), and the stage is stored in `profiles.research_stage`. The difference among the three lists is **depth**, not contradiction: the philosophical list explains “why,” the code list describes “what the screen reads,” and the journey list describes “the milestones the researcher sees.”

## Brief technical reference (for developers only)

Definitions: `data/research-paths.js` · progress: `services/journey.js (getJourney/setStepStatus)` · topic: `recordTopic/registeredTopic` · **step completion**: `services/step-review.js` (`specForStep/evaluateStepCompletion` pattern-based + `detectStepCompletion`, which places a card in `pending_review` after every response + `saveStepReview`, the only function that writes to the workflow via `POST /chat/:id/step-review`) · semantic links: `step_key` in steps, references, notes, and files · defense: `services/defense.js (defenseProgress)`.
