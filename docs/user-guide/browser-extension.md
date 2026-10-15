# Browser extension

The security questionnaire extension answers third-party questionnaires
from your OpenComp data, directly inside the requester's web page.

## Install and sign in

1. Install the extension from the Chrome Web Store.
2. Sign in to OpenComp in Chrome. Open the extension popup and select the
   intended organization; the extension uses the browser’s OpenComp session.
3. Keep detection on so the extension offers help on questionnaire pages.

## Answer a questionnaire

1. Open the questionnaire page. The extension detects it and offers to help.
2. Generate answers from your OpenComp knowledge base and policies.
3. Review each answer in the side panel — edit anything wrong.
4. Approve and insert answers into the page fields.

Guardrails: the first generate and the first insert on a new domain ask for
confirmation; batch inserts always confirm; switching organizations clears
drafts. Google Sheets uses a question column, answer column, and row range. Google
Docs uses clipboard export for manual pasting rather than reliable automatic
insertion. Review the target mapping before inserting into Sheets.

## Troubleshooting

- **Signed out:** sign in to OpenComp in the same Chrome profile, then reopen
  the side panel.
- **No questions detected:** verify the page contains editable questionnaire
  fields. Use the app’s file-upload workflow if the page is unsupported.
- **Needs review:** inspect the sources and supply a verified answer; do not
  approve a guess.
- **Wrong destination:** check the workspace and domain confirmation and, in
  Sheets, the question/answer columns and row range before insertion.

## Practical guidance

- The extension drafts; you attest. Review like you would any
  [questionnaire](questionnaires.md) response.
- Generated answers are not saved as questionnaire records unless you route
  them through the app flow.
- If answers look thin, the knowledge base needs feeding — tell your
  compliance lead, don't invent facts.
