# Risk and vendors

## Risk register

**Risk** lists organizational risks with title, description, category,
department, status, likelihood, impact, residual likelihood/impact, treatment
strategy, and assignee.

1. Open **Compliance → Risks**. Search by title or filter by severity, status,
   and owner.
2. Choose **Create Risk**. Enter a title and description, then select category,
   department, and assignee. Create the record, then open its details to
   assess likelihood, impact, and treatment.
3. Open the risk's **Treatment Plan** to review its strategy and linked
   compliance work. Complete the work and review its evidence before
   changing the saved residual assessment.
4. Revisit accepted risks on your review schedule and after significant
   changes. A change to residual likelihood or impact makes an earlier
   acceptance stale and requires a fresh review and acceptance.

Editing risk details, treatment, and ratings requires `risk:update`.

![Create New Risk form with title, description, category, department, and assignee](images/risk-create.png)

*Describe the risk and assign responsibility before assessing its treatment.*

## Walkthrough: source code exposure through AI tools

The example risk is **Source Code and Intellectual Property Exposure in AI
Tooling**: staff sharing proprietary code, secrets, or customer information
with unapproved AI services. The development record used for this walkthrough
has 15 linked compliance tasks and 46 associated controls, with 0% task
completion. Your organization's records and progress will differ.

### Establish responsibility in Overview

Open **Compliance → Risks** and select the risk. In **Overview**, check the
description, **Assignee**, **Status**, **Category**, and **Department**. Name
an accountable owner and select **Save** after changing these fields. The
example is Pending, categorized as Technology, and assigned to IT.

### Choose treatment and inspect linked work

Open **Treatment Plan**. **Mitigate** applies controls to reduce likelihood
and impact. **Accept** documents a decision to live with the risk; its
treatment model assumes no reduction. **Transfer** shifts part of the
impact through an arrangement such as insurance or contractual indemnity.
Selecting a strategy saves it, so change it after the decision is agreed.

For the example, mitigation combines acceptable-use rules, data
classification, prompt retention limits, secret scanning, and separation
of development from production. Identify who implements each measure,
what evidence demonstrates it, and how it will be reviewed.

**Linked work** lists compliance tasks and their associated controls. Open
a task to complete its evidence and review workflow; open a control to
inspect coverage. Use pagination to review the full set. The number of
links alone does not demonstrate effective mitigation.

### Use AI for plans and link suggestions

- For a new plan without linked work, choose **Draft plan & suggest links**.
  If a plan already exists, choose **Suggest tasks & controls**. Review
  the proposed tasks and controls, remove irrelevant selections, and
  apply the selection. Applying links can then regenerate the plan.
- **Re-assess** reviews an existing set of links. Applying the reviewed
  selection replaces the existing task links; deselecting an existing
  task removes its link.
- **Regenerate with AI** rewrites the saved plan using the current context.
  **Edit** lets you refine it manually. Review generated wording for
  scope, feasibility, and supporting evidence.

AI suggestions do not complete tasks, prove control effectiveness, or
record the risk owner's acceptance.

### Distinguish forecasts from saved assessments

The example's treatment panel forecasts **5/10 → 3/10** at full execution:
Possible / Major becomes Unlikely / Moderate. With 0% of linked tasks
complete, that arrow is a forecast, not an achieved reduction. Open
**How is this calculated?** for the scoring explanation. The panel uses a
normalized score out of 10; **Risk Matrix** also shows raw 5 × 5 scores.

In **Risk Matrix**, **Inherent Risk** is the assessment before treatment.
**Residual Risk** shows the saved assessment. Its dashed cell is a computed
suggestion based on strategy and linked task completion. **Accept suggested
residual** saves that suggestion; alternatively select appropriate cells
and save a rating justified by your evidence.

The captured example has a saved residual of Very Unlikely / Insignificant
while its completion-based suggestion remains Possible / Major. Review
the evidence and rationale for that difference. Neither the saved rating
nor the projected target establishes that mitigation has succeeded.

### Manage actions, discussion, and history

- **Tasks** holds follow-up items directly attached to this risk, separate
  from the compliance tasks in **Linked work**. This example's Tasks tab
  is empty despite its 15 compliance links. Use **Create Task** for an
  additional action, assign an owner and due date, and filter by status
  or priority as work progresses.
- **Comments** records assumptions and review rationale. Mention colleagues
  with `@`, attach supporting material, and submit the comment. Comments
  do not change scores or record formal acceptance.
- **Activity** shows recorded changes to the risk and its follow-up items.
  An empty view means no events are displayed for that record.
- **Settings** shows “No settings yet” in this version. Edit ownership,
  status, category, and department in **Overview**.

### Ask the assistant for an evidence checklist

Open **Ask AI** in the application header. Name the risk by title or ID
and state whether you want analysis or changes. For example:

> Explain the mitigation plan for [risk title or ID]. Summarize linked work
> and evidence needed before reducing residual risk. Read-only: do not
> create, edit, link, regenerate, or accept anything.

For this risk, the assistant suggested policy acknowledgments, AI service
retention and training settings, secret-scanner reports, architecture and
access reviews, and disposal records. These are prompts to investigate,
not evidence already collected. Check every claimed score, completion
state, and approval against the record. In this run, the assistant called
the saved residual a target; verify that distinction in **Risk Matrix**.

### Record formal acceptance

After reviewing evidence and confirming the saved residual rating with
the accountable owner, return to **Treatment Plan → Residual risk
acceptance**. Choose **Record risk-owner acceptance**, select the accepting
member, add review notes if appropriate, and record the decision.

The record captures the member, date, and residual rating. It cannot be
edited or deleted. A later change to residual likelihood or impact marks
it stale; review the change and record a fresh acceptance. Choosing the
**Accept** treatment strategy does not create this formal record.

Before closing the review, confirm the approved strategy, evidence behind
the plan, owners for open actions, a defensible saved residual assessment,
and the owner's acceptance of the remaining risk. Arrange the next review
through your organization's review process.

## Vendor register

**Vendors** lists third-party vendors with risk context.

1. Open **Vendors** and review the register.
2. Choose **Add Vendor** to open **Create Vendor**. Enter the name, website,
   description, category, assessment status, and assignee for the third party.
3. Open a vendor to review its details, run an assessment review, and track
   follow-up tasks per vendor.
4. Record assessment outcomes on the vendor — they feed audit evidence and
   the Trust Center's vendor list.

![Create Vendor form with category, status, and assignee](images/vendor-create.png)

*Use Not Assessed until you have completed the review and recorded its outcome.*

## Confirm your review

Reopen the saved risk or vendor. Check the owner, status, scores, and review
notes. Record why treatment reduced the residual risk; completing a task
does not by itself demonstrate that the risk has fallen.

## Practical guidance

- Score honestly. A register full of low risks nobody believes is worse than
  a short register with three real ones.
- Tie every high risk to tasks with owners and dates.
- Review vendors when contracts renew, not only when onboarding.
- Use [Security questionnaires](questionnaires.md) to prepare answers about
  your own organization. Keep vendor assessment conclusions in the vendor record.
