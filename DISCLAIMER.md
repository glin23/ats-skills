# Disclaimer

Read this **completely** before installing or using `mrweirdo-jobs`. The tool can automate real job applications to your name, so the risks below are real risks to you, not theoretical risks to the project.

## Purpose

`mrweirdo-jobs` is a personal tool that automates the mechanical parts of US job applications — discovering openings, filling out application forms, and submitting them. It exists because the author was applying to many roles by hand and wanted to spend less time on repetitive fields. It is shared publicly so others can do the same for themselves.

It is **not** a commercial product. It is **not** a hosted service. There is **no business model** behind it.

## What this tool does — be precise about this

When you install `mrweirdo-jobs` and run `/mrweirdo-onboard`, the tool will:

1. Read your resume PDF.
2. Use AI to infer your job-search preferences (role, industry, location, etc.).
3. Ask you a short ABCD questionnaire to disambiguate.
4. Discover job listings from public job-board APIs (currently: RemoteOK; future versions add Wellfound, YC, and ATS bulk crawl).
5. Filter and score them with AI.
6. For listings on **Greenhouse / Ashby / Lever** that pass scoring + safety gates:
   - Fill out the application form using your resume + answered questions.
   - **Click Submit automatically** without asking you again.

The user's only required actions are: (a) uploading the resume, (b) optionally answering the 5–8 questionnaire questions, and (c) later checking their email for confirmation messages from companies.

This is **fundamentally different** from v1 of the same project, which always paused before Submit and required you to click "submit" yourself. v2 (which is this) removes that gate.

## What you are accepting by using v2 — read this

By running `mrweirdo-jobs` v2, **you are accepting the following risks**, all of which are real:

1. **ATS Terms of Service violations.** Greenhouse, Ashby, Lever (and most other ATS platforms) have Terms of Service that prohibit automated submission of applications. Auto-submitting applications via this tool violates those Terms. The fact that the tool runs on your own machine using your own browser does not change that.

2. **Possible account bans or blacklisting.** If an ATS platform detects automation, the consequences for you can include: applications invalidated; future applications to companies on that platform rejected before review; your name and email flagged on the platform; in some cases your LinkedIn profile (commonly used by ATS for de-duplication) flagged as well.

3. **AI mistakes propagate without a human gate.** v1 had you review each filled form before submitting; v2 does not. If the AI mis-classifies a role, picks the wrong location, fills the wrong field, or answers a yes/no question incorrectly, those mistakes go directly into the application as submitted. There is no last-line-of-defense human review on a per-application basis.

4. **Resume typos propagate to every application.** If your resume PDF has a typo (wrong phone, mis-spelled email, outdated school year), every application sent by the tool will have that typo. The 5-second "informed display" window after resume parsing is your only chance to catch this before the run starts.

5. **The tool may apply to roles you wouldn't choose.** AI scoring is imperfect. A role can pass the fit-score threshold and still be wrong for you. Once submitted, the application is on your record at that company.

If you are not willing to accept these risks for any reason — including being a student whose first application impressions matter, an early-career professional with limited applications to spend, or an international applicant whose ATS records may affect future immigration filings — **use v1 (`/mrweirdo-greenhouse`, `/mrweirdo-ashby`, `/mrweirdo-lever`) instead**. v1 keeps the per-application Submit gate. The single-URL skills remain in this repository for exactly that reason.

## Mitigations that are built in (not removals of the risk above)

The v2 tool includes several safety nets, none of which eliminates the risks above; they reduce blast radius:

- **Resume-verbatim filling.** The tool fills fields directly from your resume without inventing answers. If a field isn't on your resume, the tool leaves it blank or skips the application.
- **Hard fit-score threshold.** Only listings with `fit_score >= 7` (configurable) are auto-applied.
- **Daily cap.** Maximum 50 auto-submissions per calendar day (configurable down, not up by default).
- **Large-company quota guard.** ~25 large companies (Google, Meta, Microsoft, Stripe, Anthropic, OpenAI, FAANG, top banks, etc.) are deliberately skipped from auto-apply because each has a hard submission cap per cycle. To apply to one of these, you run `/mrweirdo-cherry-pick` manually; that skill **preserves** the v1 Submit gate for large companies.
- **CAPTCHA detection.** If a form shows a CAPTCHA / "verify you are human" widget, the tool skips that application rather than attempting to bypass.
- **Per-application screenshots.** Pre-submit and post-submit screenshots are saved to `~/.mrweirdo-jobs/log/screenshots/` for forensic audit. You can review what was submitted on your behalf after the fact.
- **Audit log.** Every submission is logged to `~/.mrweirdo-jobs/feedback.jsonl` and to the local SQLite database at `~/.mrweirdo-jobs/jobs.db`. Use `datasette serve ~/.mrweirdo-jobs/jobs.db --open` to inspect.

## Hard red lines (will not change)

The v2 tool will **not** do these. This is non-negotiable and is enforced in the code:

- **No automation on LinkedIn.** LinkedIn Easy Apply, LinkedIn job search scraping, LinkedIn messaging — none of it. Use LinkedIn manually.
- **No automation on Indeed or Glassdoor.** Same reason as LinkedIn.
- **No CAPTCHA solving.** The tool detects CAPTCHAs and stops; it does not try to defeat them.
- **No mass-submission rate.** Default pacing is 30–90 seconds between submissions, even when the daily cap allows more in a shorter window. This is also enforced in code.
- **No financial actions on your behalf.** The tool only submits free job applications. It does not pay fees, accept terms involving money, or sign agreements outside the scope of a normal application form.

## Your responsibilities as the user

When you use `mrweirdo-jobs`, **you remain responsible for**:

- Reading and following the Terms of Service of every ATS platform you direct the tool at, including Greenhouse, Ashby, Lever, and any others added in future versions. The tool does not check Terms for you.
- Following any explicit "do not contact" or "do not apply" requests a company or recruiter has given you. The tool will not check your inbox or LinkedIn for such instructions.
- The accuracy of your own resume. The tool fills verbatim; it cannot detect typos.
- The decision to use v2 (auto-submit) versus v1 (with submit gate) versus not using the tool at all. v2 is the more aggressive choice — pick it knowingly.
- Reviewing the auto-applied roles after the fact via Datasette or the screenshots, especially during your first few runs, to verify the tool is doing what you expect.

If a platform's Terms change after you install the tool, the new Terms apply, even if this Disclaimer has not been updated.

## What this tool does not do

- It does not bypass anti-bot systems. It drives a real Chrome instance under your own browser profile. It does not spoof TLS fingerprints, rotate IPs, solve CAPTCHAs, or impersonate other users. Detection is fully possible and you accept that risk.
- It does not scrape closed platforms. Discovery is via each ATS's own public Job Board API or via aggregator APIs that are themselves public.
- It does not rewrite your resume per job description. Bring your own PDF.
- It does not retry failed submissions. One shot per row to avoid double-submissions.

## If a platform asks you to stop

If Greenhouse, Ashby, Lever, or any other ATS contacts you and asks you to stop using automation against their service, **stop**. Uninstall the tool. Open an issue on this repository so other users know.

The author will also stop development of automation against that platform if asked by an affected platform.

## No warranty

This software is provided "as is", without warranty of any kind. See [LICENSE](LICENSE) for the full text.

The author makes no guarantees that:

- The tool will correctly fill any given application.
- Submitted applications will be received by, or considered by, the employer.
- Use of the tool will not affect your standing with an ATS platform, a recruiter, an employer, your school's career services, or any third party.
- The AI-derived search intent or scoring is correct for your career goals.
- Future versions will be backward-compatible with your current data.

If something goes wrong with your application or your account on an ATS platform because of this tool, **that is on you, not on the author**.

## Misuse

Do not use this tool to:

- Apply to jobs on behalf of someone else without their authorization.
- Submit fraudulent information (resumes you didn't write, fake credentials, falsified work history).
- Apply for roles you have no genuine interest in or qualifications for, simply because the auto-apply makes it cheap.
- Test, probe, or attack an ATS platform's infrastructure.
- Run the tool at a rate that looks like a denial-of-service attack to the receiving platform.

If you are not sure whether something you want to do is misuse, the answer is probably yes.

## In short

Use this tool for your own job search, treating each submission as if you had clicked Submit yourself — because for legal and accountability purposes, you did. The tool's automation does not absolve you of any responsibility for the applications it sends.

If you want a tool that does not auto-submit, use the v1 single-URL skills (`/mrweirdo-greenhouse`, `/mrweirdo-ashby`, `/mrweirdo-lever`) or `/mrweirdo-cherry-pick` for large-company applications. They are explicitly preserved in this repository so you have that choice.
