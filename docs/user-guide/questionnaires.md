# Security questionnaires

Requires `questionnaire:read`. Answer quality depends on published policies —
see [Policies](policies.md).

## Answer a questionnaire

1. Open **Questionnaire**.
2. Click **New Questionnaire** and select one PDF, XLSX, or CSV file
   up to 100 MB. Word documents are not accepted by this upload form.
3. OpenComp parses the questions and proposes answers drawn from your
   published policies, knowledge base, and prior answers.
4. Review every answer. Edit anything the AI gets wrong — you sign the
   response, not the AI.
5. Export the completed questionnaire and send it to the requester.

## Availability and completion

Questionnaires must be enabled for your organization and deployment as well
as permitted by your role. If the section is absent or its URL returns a
page-not-found error, ask your administrator to check feature availability.

After parsing, check that every expected question is present. Before
exporting, review unsupported claims, dates, product scope, and answers
without sources. Open the export and verify the question-to-answer mapping
before sharing it with a customer.

## Knowledge base

Open the **Knowledge Base** tab inside **Questionnaire**. Its sources include:

- **Published policies** — used automatically; only published, non-archived
  policies count.
- **Context Q&A** — short curated questions and answers with tags.
- **Manual answers** — approved answers reused across questionnaires.
- **Documents** — uploaded reference files.

Maintain it the way you maintain policies: review manual answers
periodically, and add a context entry every time you answer the same
one-off question twice.

## Statement of applicability

The statement of applicability, available from **Documents**, shows which controls apply to your organization and which
are excluded (with reasons). Keep exclusions current — they appear in audit
conversations.

## Tips for good answers

- Publish policies first. Unpublished drafts are invisible to the AI.
- Use reviewed answers for recurring facts, and revisit them when addresses,
  subprocessors, or certifications change.
- Always review auto-answers for scope errors ("we do X" when only one team
  does X).
