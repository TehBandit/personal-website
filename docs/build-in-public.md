# build-in-public automation

The automation reviews qualifying commits each Sunday at 12:00 PM in
`America/New_York`. Its weekly window starts at the previous Sunday at noon
(inclusive) and ends at the current Sunday at noon (exclusive). GitHub's
timezone-aware schedule and Luxon-based window calculation preserve local noon
through daylight-saving transitions.

If the collector finds no qualifying activity, the run succeeds without
generating a post, opening a pull request, or sending a heartbeat. A repository
variable named `BUILD_IN_PUBLIC_ENABLED` gates scheduled publishing; leave it
unset until the dry run and branch rule checks below are complete.

## required repository configuration

GitHub Actions secrets:

- `COLLECTOR_GH_APP_ID`
- `COLLECTOR_GH_APP_PRIVATE_KEY`
- `PUBLISHER_GH_APP_ID`
- `PUBLISHER_GH_APP_PRIVATE_KEY`
- `OPENAI_API_KEY`
- `RESEND_API_KEY`

GitHub Actions variables:

- `BUILD_IN_PUBLIC_ALERT_TO`: the email address that receives errors
- `BUILD_IN_PUBLIC_ALERT_FROM`: a verified Resend sender, including its display
  name if desired, such as `site automation <automation@example.com>`
- `BUILD_IN_PUBLIC_ENABLED`: set to `true` only after testing

The Collector App must be installed for all repositories owned by `TehBandit`,
with read access to repository contents and pull requests. The Publisher App
must be installed only for `TehBandit/personal-website`, with read access to
checks and read/write access to contents and pull requests.

## first test and activation

1. Merge these workflow files to the default branch. GitHub only runs scheduled
   workflows and `deployment_status` workflows from the default branch.
2. Open **Actions → weekly build in public → Run workflow**. Keep **publish**
   disabled and optionally enter a known Sunday as `window_end`.
3. If qualifying activity exists, download the seven-day preview artifact and
   inspect its privacy, voice, metadata, and production/development wording. No
   branch or pull request is created in preview mode.
4. For the initial model evaluation, run the same `window_end` once with low
   reasoning and once with medium reasoning. Prefer low when both outputs pass
   and sound equally grounded; change `reasoningEffort` in
   `build-in-public.config.json` to medium only if the quality difference is
   repeatable and worth the added usage.
   The July 26, 2026 evaluation selected medium because it covered materially
   more grounded activity while retaining the same privacy boundaries.
5. Run the workflow again with **publish** enabled. It creates a bot branch,
   opens a pull request, waits for the exact `build-in-public-ci` check, squash
   merges it, and deletes the bot branch.
6. In the `main` ruleset, add the observed `build-in-public-ci` check as a
   required status check. Keep required approvals at zero and confirm the
   Publisher App can merge a passing pull request normally.
7. Set `BUILD_IN_PUBLIC_ENABLED` to `true` to activate the Sunday schedule.

Re-running a window whose post is already on the default branch is a successful
no-op. Re-running after a failed publishing attempt safely updates the automation-owned
branch and reuses its open pull request.

To re-check model/schema compatibility without repository data, run
`npm run smoke:build-in-public-schema` with `OPENAI_API_KEY` in the environment.
This makes one small billable request and is intentionally not part of CI.

## content and privacy boundary

The collector includes commits authored by one of the configured GitHub logins
or email addresses. A commit reachable from a repository's configured default
branch is production; commits found only on other branches are development.
Merge commits and known automation actors are ignored, and commits found on
multiple branches are deduplicated.

Private repository names are replaced with generic project labels before model
input. Sensitive paths, binary files, lockfiles, credentials, URLs, emails,
identifiers, high-entropy tokens, and diff coordinates are removed or excluded.
Path-like strings, filenames, internal hostnames, and common database-object
references inside otherwise eligible patches are generalized before model input.
Per-commit, per-repository, and total prompt ceilings compact oversized evidence
before submission, prioritizing production and recent activity while preserving
the broad activity records that fit safely inside the configured budgets.
The model receives only the resulting sanitized evidence and must return strict
JSON using approved presentation blocks. Generated prose is then checked for
schema validity, evidence references, production/development claims, secrets,
code details, paths, hashes, capitalization, source-text copying, and word count.
Spelling is intentionally not normalized or used as a publishing gate so unusual
product language and deliberate phrasing can remain faithful to the evidence.
The agent's complete, reviewable behavior prompt lives in
`scripts/build-in-public/system-prompt.md`; `generate.mjs` appends only the
current window's metadata, project list, and word limits before each request.

The JSON renderer—not the model—owns the actual React and Tailwind classes. This
prevents generated executable markup and guarantees a consistent devlog layout.
Each post title is derived from the coverage window as
`Devlog: [start date] - [end date]`, while the subtitle is a single-line summary
of the full period. Every active repository is represented once using its public
project name, with one to three executive-facing bullets followed by a one- to
three-sentence recap in the owner's more casual voice. Public project names that
differ from repository names are configured in `publicRepositoryLabels`.
Each project also displays GitHub's additions and deletions for all qualifying
commits in the weekly window. The collector aggregates these totals before
evidence compaction, validation requires the model to reproduce them exactly,
and the renderer presents additions in green and deletions in red.
When a repository has a valid website in its GitHub About metadata, the
collector normalizes it to a safe HTTP(S) URL and the renderer links the project
heading to it. Missing or invalid About URLs produce an ordinary plaintext
heading, and validation prevents the model from inventing or changing links.
If a qualifying commit added one or more PNG, JPEG, GIF, WebP, or AVIF images,
the collector randomly chooses one image per project, verifies its raster
signature and size, and copies it into the site's public devlog assets. The
renderer places it beside the project copy on normal screens and stacks it only
on narrow mobile screens. Intrinsic sizing, `max-width: 100%`, a bounded maximum
height, and `object-contain` ensure the image scales down within the existing
section instead of expanding its width. Preview artifacts include the selected
media, and publishing commits both the JSON post and its generated media
directory.

The renderer adds the AI-generation disclosure and a link to
`TehBandit/personal-website` at the bottom of every generated post, keeping the
disclaimer identical even when model output changes.

## operational limits

- GitHub's commit endpoint filters on commit timestamps, not the moment a commit
  was pushed. An old commit pushed during the week may therefore be outside the
  window, while a recently timestamped commit is included.
- The scan covers branches that still exist and commits still reachable when
  the Sunday run starts. Deleted branches cannot be reconstructed by this job.
- GitHub Actions schedules can start late during service congestion; the content
  window remains anchored to Sunday noon regardless of actual start time.
- Secret scanning and deterministic validators reduce disclosure risk but cannot
  mathematically guarantee that every sensitive business fact is recognized.
- Deployment failure email depends on the Vercel GitHub integration publishing
  `deployment_status` events. If it does not, Vercel API credentials and a
  separate polling step will be needed.
- No automation can send an error email if GitHub Actions itself is unavailable
  or cannot start the workflow. OpenAI, GitHub, Resend, and Vercel outages can
  also delay or prevent parts of a run.
