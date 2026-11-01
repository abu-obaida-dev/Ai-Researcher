# 08 — Workspace: The Heart of the Product

> The rule this file establishes: **the workspace is the product, and conversation is one of its tools.** The philosophy is in `01`, the behavior in `06`, and the journey in `07`—here: where everything lives and how it is connected to the project.

## What is the workspace?

The single place where the researcher's entire project comes together: their academic profile, journey steps and statuses, uploaded files, references and reading records, notes and ideas, conversations with the supervisor, agreed tasks, work evaluations, the supervisor's memory of them, and their overall progress.

> “Research project” here is a functional concept: it brings together journey data (fully defined in `01 §5`) as one coherent whole—not a separate entity in itself. “Tasks” are what has been agreed for next time, and “evaluations” are the supervisor's reviews saved within conversations and memory.

When a researcher opens their workspace, they see **the complete story of their research**: where they began, where they are now, and what remains—not an empty chat screen waiting for a question.

## Workspace components (all belong to the project)

- **The project itself:** its title, current stage, and progress—the thread connecting everything beneath it.
- **Files:** uploaded and saved chapters, drafts, and tables—the materials the supervisor actually reviews (reading their content and quoting them by name).
- **References:** the researcher's own list (from the central library or manually entered data), with each reference's reading status and linked step—not a separate list of links.
- **Notes:** the researcher's ideas and notes, pinned and tagged, linked to the step or reference they concern—so a methodology idea does not get lost among writing notes.
- **Conversations:** the researcher's history of exchanges with the supervisor—**a communication tool** for the project, not the project itself (like meetings with an academic supervisor: important, but not the research itself).
- **Tasks:** what has been agreed for next time—shown when the researcher returns, so they are asked about it rather than it being forgotten.
- **Evaluations:** the supervisor's reviews of the researcher's work, categorized (methodology/evidence/writing), and the final defense evaluation—a cumulative quality record, not a passing opinion.
- **Memory:** a summary of the researcher's status, decisions, and weaknesses—what allows each session to build on the previous one.
- **Progress:** a numeric view (stages completed, references read, weekly activity)—showing actual progress rather than a feeling.

## Conversation as a tool, not a product

Conversation does one thing: **moves something from or into the workspace**. Before responding, it reads the profile, stage, memory, and attachments; after responding, it writes the two messages and any stated topic, agreed task, or completed evaluation. A conversation that neither reads from nor writes to the workspace is general chat, which the platform refuses to be.

## How is everything connected?

The shared link is the **research step**: a reference is linked to its step, a note to its step, a file to its step, and a conversation is **tagged with its step for context only** (`step_key` is saved with it to help the supervisor know where the researcher is—it is not a page that groups conversations by step). Progress is calculated from the steps. This lets the researcher see “everything related to the literature review” in one place: its references, notes, and files—not scattered across four pages.

## Brief technical reference (for developers only)

References and notes: `services/workspace.js` (`citationText` documentation without generation, and tolerant Arabic search via `normalizeArabic`) · files: `services/files.js` (plan and settings limits, binary fingerprint `upload-guard.js`) · supervisor reading: `documents.js` and preview: `spreadsheet.js` · central library: `services/library.js` and its sources: `09-literature`.
