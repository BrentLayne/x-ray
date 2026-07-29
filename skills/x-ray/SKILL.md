---
name: x-ray
description: X-Ray a PR — load it into memory and let me ask questions about the diff while a background code review runs
disable-model-invocation: true
---

I will provide you with a link to a GitHub PR.

**Complete these setup steps in order before responding to anything else.** Even if my next message contains a question about the diff, finish all steps first, then answer. Steps 1–4 land the why + review order on the sidebar so I can start reading the PR immediately; step 5 kicks off the background review so its findings are ready by the time I'm done asking questions.

1. Load the provided PR into memory; read the whole PR and the PR description (use `gh` to fetch the PR).

2. Gather background context on the PR from every signal you can reach. The goal is to explain both *why* this PR exists (the motivation, the problem it solves, the decision that led to it) and the general background a reviewer needs (what system it touches, prior work it builds on, constraints in play). **Understanding the why and the background is what makes a PR easy to review** — without it, the reviewer is stuck reverse-engineering intent from the diff. Cast a wide net:
   - **PR description and title** — extract the stated motivation, linked issues, and any embedded links.
   - **JIRA** — if the PR title, branch name, or description references a ticket (e.g. `[FOO-1234]`, `foo-1234` branch prefix), fetch it and pull the ticket summary, description, and recent comments for context on the underlying problem.
   - **Slack** — devs usually post their PR URL in Slack when asking for review, and often share relevant context in surrounding messages. Search Slack for the full PR URL to find where it was posted, and also look at recent messages from the PR author's Slack handle for adjacent discussion (design decisions, blockers, context they shared with teammates). Also follow any explicit Slack thread/channel references from the PR description or JIRA ticket.
   - **Prior PRs / commit history** — if the PR is part of a series (mentioned in the description, or obvious from the branch/title), look at what came before.

   Don't fabricate context. If a signal isn't there or is unreachable, skip it silently — don't invent motivation. Prefer 2-3 rich, sourced sentences over a paragraph of speculation.

3. Produce a structured JSON payload for the sidebar with this shape:
   ```json
   {
     "pr_url": "<the exact PR URL I gave you>",
     "why": "a comprehensive background explanation of the PR — both *why* it's being made (motivation, problem, decision) and the general context a reviewer needs (what it touches, what it builds on, relevant constraints); synthesized from the signals gathered in step 2",
     "review_order": [
       {"file": "path/to/file", "rationale": "why review this file at this position, how it builds on the previous file, and what it sets up for the next file"}
     ]
   }
   ```
   Order the files in `review_order` from most-foundational to most-derivative (schema/types before consumers, config before code that reads it, etc.).

   **Voice: substantive but disciplined.** I want real context and explanation — enough that I understand *why now, why this*, and can hold the design in my head before opening a file. But I don't want AI slop: no throat-clearing, no restating what I already know, no hedged filler. Every sentence should carry information a reviewer couldn't get from the diff alone. Soft targets:
   - **`why`: roughly 100-180 words.** Go longer if the PR genuinely needs it (multi-week initiative, subtle constraint, unusual rollout plan), shorter if the change is small. Don't pad to hit a number.
   - **`rationale`: roughly 50-90 words per file.** Enough for the "builds on / sets up for" link to land with substance, not enough to become a mini-essay.

   Rules that stay strict regardless of length:
   - **No preamble or throat-clearing.** Never open with "This PR…", "The purpose of this change is…", "In summary…", "Essentially…", "It's worth noting that…", "As mentioned in the JIRA ticket…". Lead with the concrete noun or fact.
   - **Don't restate the field/section label.** In `why`, don't say "The motivation for this PR is…" — I already know the section is called PR background.
   - **Cut hedging filler.** Drop "notably", "importantly", "interestingly", "arguably", "generally speaking", "in order to" (say "to"), "for the purposes of", "the fact that", "at this time", "going forward", "due to the fact that" (say "because").
   - **No summarizing what you're about to say or just said.** Skip "First, I'll cover X. Then Y." and "In short, …" at the end.
   - **Avoid sentence starters like "This PR", "This change", "This commit", "This introduces", "This adds"** — they read as filler. Lead with the concrete noun (`sm3-am-settled-options-enabled` gates AM contracts at the GraphQL boundary — not "This PR introduces `sm3-am-settled-options-enabled`…").
   - **Whenever you're enumerating discrete items, use a bulleted list — always.** If you catch yourself writing "three tests were added:", "affects four files:", "the flag guards two paths:", "checks include A, B, and C", stop and convert the enumeration to a `- ` bulleted list. Never inline enumerated items in prose ("A, B, and C") when the sidebar can render them as bullets. This is the single biggest lever for skimmability — a 6-line paragraph with an inline list becomes a 1-line lead + 3-bullet list that I can read in a glance.

   **Formatting: the `why` and `rationale` fields render as full GitHub-Flavored Markdown in the sidebar (via `marked` + `DOMPurify`).** Everything CommonMark + GFM supports works: paragraphs, bulleted/numbered lists (with nesting), headings (`###` used sparingly — the section already has a title, so prefer h4/h5 or bold labels over h1/h2), inline `` `code` `` and fenced code blocks (```` ```lang ````), `**bold**` and `*italic*`, `[label](https://…)` links, autolinked bare URLs, blockquotes (`>`), tables (`| a | b |`), horizontal rules (`---`), and hard line breaks (a single newline becomes a `<br>`; a blank line starts a new paragraph). HTML tags, `javascript:` URLs, `<script>`, event handlers, and inline styles are stripped by DOMPurify — don't rely on them. Since JSON strings can't contain literal newlines, use `\n` escapes in your JSON payload.

   Style guidance for the narrow sidebar:
   - **Avoid a single 4+ sentence paragraph.** Split into two shorter paragraphs, or pull enumerated items out into a bulleted list.
   - **Any enumeration → bullets.** Restating: if you find yourself writing "N things:", "the following:", "consists of:", "includes A, B, and C", make it a `- ` list. No exceptions.
   - Wrap ticket IDs, flag names, class names, file paths, and symbol names in backticks so they visually stand out.
   - Link to the JIRA ticket, related PRs, and Slack threads inline with `[label](url)` when you have concrete URLs — don't paste raw URLs unless there's no meaningful label.
   - Use `> ` blockquotes only to quote a decisive line from JIRA/Slack/PR verbatim; don't blockquote your own paraphrase.
   - Fenced code blocks only for actual multi-line code/config, not narrative.

   The `why` field renders in the sidebar's "PR background" section — I read it first, before opening any file. Typical shape: **a short paragraph of motivation (2-4 sentences), then a bulleted list of the concrete facts, constraints, and links** (JIRA, related PRs, Slack threads). Lead with the "*why now, why this*"; the bullets carry the specifics — flag names, class names, rollout plan, out-of-scope callouts.

   **The `rationale` is the most important field — I read it as I navigate.** Cover:
   - **Why this file at this position** — what concept does the reader need before opening it?
   - **How it builds on the previous file** — name the previous file; name the concrete type/contract/idea this one consumes.
   - **What it sets up for the next file** — name what's next and the specific idea this file plants.
   For the very first file, skip "builds on"; for the last, skip "sets up for". Reading rationales top-to-bottom should feel like a guided tour — thorough enough that I trust the guide, not so verbose that I start scrolling past. If a file has multiple noteworthy pieces (a class + a helper + a test), lead with a sentence naming what the file does, then use a bulleted list for the pieces.

4. POST that payload to the local broker via the helper — do this *before* kicking off the background review, so the sidebar populates as soon as possible and I can start reading:
   ```
   ~/.claude/pr-sidebar/post-to-broker.sh --kind summary --pr-url '<PR URL>' <<'JSON'
   { ...payload from step 3... }
   JSON
   ```
   The helper handles URL encoding and exits 0 even when the broker is offline. If it prints a broker-offline message, mention it to me once and keep going — the terminal experience still works.

5. Kick off a backgrounded subagent that uses `/code-review medium` to review the PR in the background. Do this *before* answering any questions about the diff, no matter what my follow-up message says.

   Append these instructions to the background agent's prompt verbatim:
   > **DO NOT publish this review to GitHub under any circumstance.** The `/code-review` command's final step tells you to run `gh pr comment` (or otherwise post the review to the PR). **Skip that step entirely.** Do not call `gh pr comment`, `gh pr review`, `gh api ... /comments`, or any other GitHub write API. The review output is for local consumption only, via the sidebar broker below. If you find yourself about to post to GitHub, stop — that is the failure mode this instruction exists to prevent.
   >
   > When you finish the review, POST your findings JSON to the sidebar broker via the helper:
   > ```
   > ~/.claude/pr-sidebar/post-to-broker.sh --kind findings --pr-url '<PR URL>' <<'JSON'
   > {"findings": [{"file": "...", "line": 123, "severity": "critical", "short_summary": "...", "summary": "...", "failure_scenario": "..."}]}
   > JSON
   > ```
   > Each finding must include a `severity` field with one of these exact values:
   > - `"critical"` — a blocking issue: a real bug, correctness problem, security issue, or CLAUDE.md violation that must be fixed before merge.
   > - `"other"` — a non-blocking suggestion, nit, or minor improvement worth mentioning but not merge-blocking.
   > - `"general"` — a general observation or comment that doesn't require action (e.g., context, a "consider this later" note, or a heads-up).
   >
   > **Voice: substantive but disciplined — I want real explanation, not AI slop.** Soft targets: `short_summary` ≤ 15 words, single line, no markdown blocks. `summary` roughly 40-100 words — enough to explain the defect and its impact, not so much that it becomes a mini-essay. `failure_scenario` roughly 30-70 words. No preamble ("This code…", "The issue is that…"), no restating the file/line (the sidebar already shows it), no hedging ("it seems", "arguably", "potentially could"). State the defect, name the consequence, then any needed context.
   >
   > **Any enumeration must be a bulleted list.** If a finding has multiple affected call sites, multiple failing inputs, or multiple sub-issues, use `- ` bullets — never inline as "A, B, and C" prose. This is non-negotiable; enumerations are why findings turn into walls of text.
   >
   > The `short_summary`, `summary`, and `failure_scenario` fields render as full GitHub-Flavored Markdown in the sidebar (paragraphs, lists, headings, tables, fenced code blocks, blockquotes, inline `` `code` ``, `**bold**`, `[label](https://…)` links). Use it to make findings skimmable: wrap symbol names, file paths, flag names, and ticket IDs in backticks; use `[label](https://…)` for external references; use `**bold**` sparingly to call out the specific bug/impact; use fenced code blocks (```` ```lang ````) for a short snippet of the offending or corrected code when it clarifies faster than prose. `failure_scenario` works best as two bullets: trigger, then resulting bad state. In JSON strings, use `\n` for newlines.
   >
   > The helper handles URL encoding and exits 0 even when the broker is offline — the terminal review is still useful.

Once those steps are done, I will ask you a series of questions about the PR as I read over the diff and review it; your job is to help answer my questions about the diff, so that I can build up my own mental models and understanding of the code changes and how they fit into the project.

When answering my questions, give clear explanations and examples and analogies.

When I have no more questions and the background agent is done, let's review the code review agent's findings together.
