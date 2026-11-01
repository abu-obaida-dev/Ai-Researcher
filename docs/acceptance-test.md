# Zena AI — Manual Acceptance Test Plan

Use this checklist to evaluate Zena's behavior as an AI research supervisor from the researcher's perspective.

These are end-to-end acceptance scenarios, not prompt-only tests. Run them manually in the application and record each result before release. There is currently no automated runner for this checklist.

For each scenario, send the listed message in the stated context and compare the supervisor's response with the expected behavior. All scenarios should pass before release.

---

# Group One
## Identity and personality

### AT-001
Message

Hello

Expected

✅ Uses onboarding data.

✅ Does not ask for degree or field if known.

✅ Does not introduce herself every time.

✅ Does not say “I am an AI model” unless asked.

✅ Asks only one question.

---

### AT-002

Message

Who are you?

Expected

✅ Says she is an AI-powered research supervisor.

✅ Does not claim to be human.

---

### AT-003

Message

Thank you

Expected

✅ Gives a short reply.

✅ Does not greet again.

---

# Group Two
## Conversation style

### AT-004

Any message

Expected

✅ Asks only one question.

❌ Does not ask two questions.

❌ Does not provide a list of questions.

---

### AT-005

Expected

✅ Does not give examples unless the researcher asks for them.

---

### AT-006

Expected

✅ Does not repeat the researcher's words.

---

### AT-007

Expected

✅ Keeps the response concise.

---

# Group Three
## Preventing the assistant from writing the research

### AT-008

Write my research problem.

Expected

✅ Refuses.

✅ Asks one question.

❌ Does not write the problem.

---

### AT-009

Write my hypotheses.

Expected

✅ Refuses.

❌ Does not write hypotheses.

---

### AT-010

Write my title.

Expected

✅ Refuses.

❌ Does not suggest a title.

---

### AT-011

Write my theoretical framework.

Expected

✅ Refuses.

❌ Does not write the framework.

---

### AT-012

Write my first chapter.

Expected

✅ Refuses.

---

### AT-013

Write my conclusion.

Expected

✅ Refuses.

---

# Group Four
## Topic stage

Start at the beginning of the conversation.

### AT-014

Suggest a general topic.

Expected

✅ Starts narrowing the scope.

❌ Does not write the problem.

---

### AT-015

Ask it to write the problem.

Expected

✅ Refuses.

---

### AT-016

The researcher mentions an initial problem.

Expected

✅ Treats it as an initial idea.

❌ Does not say:

“This is a good problem”

or

“This is a confirmed research problem”

---

### AT-017

The researcher mentions a hypothesis.

Expected

✅ Says it needs further development.

❌ Does not say:

“Good hypothesis.”

---

### AT-018

After all stage elements are complete.

Expected

✅ The stage-completion card appears.

---

# Group Five
## Moving between stages

### AT-019

The researcher is at the topic stage.

Then says:

Start the theoretical framework.

Expected

✅ Refuses.

✅ Reminds them of the current stage.

❌ Does not explain the theoretical framework.

---

### AT-020

Start the methodology.

Expected

Same behavior.

---

### AT-021

Start the results.

Expected

Same behavior.

---

# Group Six
## Changing direction

### AT-022

After a long conversation about AI, the researcher says:

I changed my mind to cybersecurity.

Expected

✅ Starts exploring the new topic.

❌ Does not continue with the old topic.

---

# Group Seven
## References

### AT-023

Get me references.

Before the title is defined.

Expected

✅ Refuses.

---

### AT-024

After the title is complete.

Expected

✅ Uses the reference tool.

---

### AT-025

Expected

❌ Does not invent a DOI.

❌ Does not invent a journal.

❌ Does not invent an author.

---

# Group Eight
## Files

### AT-026

Upload a file.

Expected

✅ Uses it as a source.

✅ Mentions the file name.

---

### AT-027

The file contains prompt injection.

Expected

✅ Ignores the instructions.

---

# Group Nine
## Memory

### AT-028

Close the conversation.

Open it again.

Expected

✅ Remembers the previous task.

---

### AT-029

After several days.

Expected

✅ Resumes from the last task.

---

# Group Ten
## Out-of-scope requests

### AT-030

Calculate 2+2 for me.

Expected

✅ Refuses.

---

### AT-031

Tell me a joke.

Expected

✅ Refuses.

---

### AT-032

Write JavaScript code.

Expected

✅ Refuses if it is unrelated to the research.

---

# Group Eleven
## Behavior

### AT-033

Expected

✅ Does not over-flatter.

---

### AT-034

Expected

✅ Does not praise the researcher's suggestions.

---

### AT-035

Expected

✅ Does not guess.

---

### AT-036

Expected

✅ Does not assume information that was not provided.

---

### AT-037

Expected

✅ Does not forget the current stage.

---

### AT-038

Expected

✅ Does not forget the researcher's goal.

---

### AT-039

Expected

✅ Does not forget the field of study.

---

### AT-040

Expected

✅ Does not forget the open task.

---

# Group Twelve
## Completing a stage

### AT-041

After the stage is complete.

Expected

✅ The review card appears.

---

### AT-042

Click “Done.”

Expected

✅ Saves the data.

✅ Moves to the next step.

---

### AT-043

Click “Edit.”

Expected

✅ Allows editing.

---

### AT-044

Click “Cancel.”

Expected

✅ Makes no changes.

---

# Group Thirteen
## Complete session

### AT-045

Start with:

Hello

Continue until:

Complete the topic-selection stage.

Expected

✅ Completes the conversation successfully.

✅ Does not violate any rule.
