# SMTP Email Validator

A privacy-first full-stack email validation app built with a Vite/React frontend and a Node.js/Express backend. The app supports authenticated validation runs, stores reports in SQLite, and can perform optional SMTP recipient checks on the server.

## 1. Setup

### Requirements

- Node.js 20+ recommended
- npm
- Network access for DNS lookups and, if enabled, SMTP handshakes on port `25`

### Install and configure

1. Install dependencies:
	- `npm install`
2. Create or review your environment file:
	- Copy `.env.example` to `.env` if you do not already have one.
3. Check the important environment variables:
	- `PORT` — backend HTTP port, default `8081`
	- `SMTP_TIMEOUT_SECONDS` — SMTP socket timeout, default `20`
	- `SMTP_HELO_HOST` — optional hostname used in `EHLO`/`HELO`
	- `SMTP_MAIL_FROM` — optional sender used in SMTP probing
	- `AUTH_SIGNUP_ENABLED` — set to `true` to allow self-signup
	- `JWT_SECRET` — required for production deployments
	- `JWT_EXPIRES_IN` — JWT lifetime, default `7d`
	- `SQLITE_DB_PATH` — SQLite database path, default `./data/app.sqlite3`
	- `KEEP_EMAIL_LOG` — when `true`, writes one text log per run to `data/logs`, default `false`
	- `MAX_CONCURRENT_RUNS` — concurrent run workers, default `5`
	- `RUN_WORKER_CONCURRENCY` — per-run validation concurrency, default `20`
	- `SCHEDULER_POLL_MS` — scheduler poll interval, default `2000`
	- `DNS_TIMEOUT_MS` — DNS lookup timeout, default `5000`
	- `MAX_INPUT_EMAILS` — max emails per run, default `100000`

### Start the app

- Frontend only: `npm run dev`
- Backend only: `npm run dev:server`
- Frontend + backend together: `npm run dev:full`
- Production build: `npm run build`
- Production server: `npm run start`

### First-run behavior

- The backend creates the parent directory for the SQLite database automatically.
- If `KEEP_EMAIL_LOG=true`, the backend also creates `data/logs` automatically.
- The database schema is initialized on startup.
- A demo account is seeded if it does not already exist:
  - username: `admin`
  - password: `admin`
- SQLite is opened in WAL mode.

## 2. Usage

### Sign in and access the validator

1. Start the application.
2. Open the app in your browser.
3. Sign in with the seeded demo account or create a user if sign-up is enabled.
4. Open the `Validate` page.

### Submit email input

You can start a validation run in two ways:

- Paste email addresses into the textarea, one per line.
- Import a CSV file that contains a column named `Email`.

The UI accepts plain addresses like `john@example.com` and formatted entries like `Jane Doe <jane@example.com>`.

### Choose processing options

The validator lets you decide whether to allow or reject:

- role-based addresses such as `info@company.com`
- disposable addresses
- unlikely-looking addresses
- addresses whose domain has no website (`A` record)
- optional SMTP recipient probing

You can also provide custom blocked words. If an email contains any of those words, it is excluded before DNS checks run.

Note: the UI currently includes an `allowDuplicates` toggle, but duplicate filtering is not implemented in the current backend validation pipeline.

### What happens after submission

- The frontend creates an authenticated validation run through `/api/runs`.
- The backend stores the run and queues per-email result rows in SQLite.
- A background scheduler picks up pending runs and processes them in batches.
- You can open the generated report, pause it, resume it, cancel it, rerun it, or delete it.
- Completed results can be exported as CSV:
  - all emails
  - valid emails only
  - invalid emails with reasons

### Single-email and API-driven usage

The backend also exposes direct validation endpoints for programmatic use:

- `GET /api/health`
- `POST /api/smtp/verify`
- `POST /api/email/validate`
- `POST /api/email/validate-batch`
- auth and report routes under `/api/auth` and `/api/runs`

## 3. How validation works

Validation is intentionally layered. The backend does not jump straight to SMTP; it applies cheaper and more reliable checks first, then uses SMTP only when requested.

### Step 1: Normalize the request and build a run

- For bulk runs, the frontend submits the email list and selected options to the backend.
- The backend stores the original input and creates placeholder result rows.
- The scheduler processes pending rows asynchronously.

### Step 2: Basic format check

Each email must match the app's format rule:

- `local-part@domain.tld`
- allowed characters in the local part are constrained by a regex
- domains must end in a `2+` character alphabetic TLD

If the format check fails, the address is marked invalid immediately.

### Step 3: Unlikely-pattern detection

If `allowUnlikely` is disabled, the validator rejects suspicious addresses early. It checks for things like:

- suspicious tokens such as `fake`, `test`, `dummy`, `spam`, `noreply`
- pattern rules from `src/frontend/data/unlikelyPatterns.json`
- repeated punctuation or consecutive non-alphanumeric characters in the local part
- excessive repeated characters in the local part
- local-part/domain combinations that strongly suggest fake input
- local-part and domain length bounds
- local parts that do not start and end with an alphanumeric, underscore, or hyphen

If such a pattern is found, the result is flagged as `isUnlikely`; whether it is rejected depends on the selected option.

### Step 4: Role-based email detection

The validator marks addresses like `info@`, `sales@`, `noreply@`, and other known role mailboxes as role-based.

- Source list: `src/frontend/data/roleBasedEmails.json`
- Additional built-in patterns: `no-reply`, `noreply`, `sales@`

If `allowRoleBased` is disabled, those addresses are rejected.

### Step 5: Disposable email detection

Disposable-domain detection uses the `mailchecker` library.

- If the email belongs to a disposable provider, the result is flagged as `isDisposable`.
- If `allowDisposable` is disabled, the address is rejected.

### Step 6: Custom blocked words

If you entered blocked words in the UI, the backend compares them against the normalized email string.

- Any match causes an immediate rejection.
- This happens before DNS lookups, which keeps the process cheaper and faster.

### Step 7: DNS checks

The validator can check two DNS-related signals:

1. **MX record check**
	- Looks up MX records for the domain.
	- If no MX record is found, the result is rejected with `no valid MX record`.
2. **A record / website presence check**
	- Looks up IPv4 `A` records for the domain.
	- If no `A` record is found and `allowNoWebsiteDomain` is disabled, the result is rejected with `domain has no website`.

Important nuance: DNS lookup failures and timeouts are treated conservatively. The code falls back to `true` on resolver errors instead of turning temporary DNS issues into false negatives.

### Step 8: Optional SMTP verification

SMTP verification is **optional** and disabled by default.

When enabled, the backend performs a live SMTP handshake against up to the first three MX hosts for the email domain:

1. Resolve MX records and sort by priority.
2. Open a TCP connection to port `25`.
3. Read the SMTP banner and require a `220` response.
4. Send `EHLO`, then fall back to `HELO` if needed.
5. Send `MAIL FROM:<...>` using `SMTP_MAIL_FROM` or a generated fallback sender.
6. Send `RCPT TO:<recipient@example.com>`.
7. Interpret the response carefully.

#### How SMTP results are interpreted

- `250` or `251`: recipient accepted → SMTP check passes.
- Definitive mailbox failures such as `5.1.1`, `5.1.6`, `5.1.10`, `user unknown`, `no such mailbox`, or similar indicators → the email is rejected with reason `smtp rejected recipient`.
- Policy or reputation failures such as `5.7.x`, Spamhaus blocks, rate limits, greylisting, or server-side anti-abuse responses are treated as **inconclusive**, not proof that the mailbox does not exist.
- Connection errors, banner problems, timeouts, and many server-side refusals also remain inconclusive.

That distinction matters: many mail servers intentionally block recipient probing, so an SMTP failure does **not** always mean the address is invalid.

### Step 9: Result storage and reporting

Each processed row stores:

- the submitted email value
- validity result
- rejection reason if invalid
- role-based / disposable / unlikely flags
- MX, A-record, and SMTP outcomes
- whether SMTP was actually checked
- timestamp of the completed check

The run counters are updated continuously so report pages can show progress while a job is still running.

### Caching and performance notes

- DNS and SMTP results use in-memory LRU-style caches.
- Cache size: `10000` entries
- Cache TTL: `1 hour`
- Validation concurrency for batch jobs is controlled by `RUN_WORKER_CONCURRENCY`.

## 4. Data privacy, data store, licenses and used libraries

### Data privacy

This app is privacy-aware, but it is not a zero-retention service once you create a saved validation run.

What stays local to the browser or process:

- UI preferences and last-used form state are stored in browser `localStorage`.
- DNS answers and SMTP results are cached only in server memory.

What is sent over the network:

- DNS queries for domain lookups
- Optional SMTP traffic to recipient mail servers when SMTP checking is enabled
- Normal app traffic between the browser and your Node backend

What is stored by the app server for authenticated runs:

- account data: username, email, password hash
- run metadata: source type, selected options, filename, counters, timestamps, status
- input emails for the run
- per-email validation results and reasons

Optional additional storage when `KEEP_EMAIL_LOG=true`:

- one text file per run in `data/logs`
- a run header with metadata such as run id, user, timestamps, and options
- one processed-email line per checked address
- a final run summary when the run finishes

If you need strict no-retention behavior, use the direct validation endpoints in a way that does not create stored runs, or delete runs after export.

### Data store

Persistent data is stored in SQLite, typically at `data/app.sqlite3`.

Main tables:

- `users`
- `validation_runs`
- `validation_results`

Storage characteristics:

- SQLite is initialized automatically on startup.
- WAL mode is enabled.
- deleting a run removes its results through foreign-key cascade behavior.
- the scheduler resumes safely by converting any previously `running` jobs back to `pending` on startup.

### License

The project itself is licensed under the MIT License. See `LICENSE`.

### Used libraries

Direct runtime dependencies currently used by the app include:

| Library | Purpose | License |
| --- | --- | --- |
| `better-sqlite3` | SQLite access for users, runs, and validation results | MIT |
| `chart.js` | Charts in the frontend reports/visualizations | MIT |
| `dotenv` | Loads environment variables from `.env` | BSD-2-Clause |
| `express` | Backend HTTP API and static app serving | MIT |
| `jsonwebtoken` | JWT-based authentication | MIT |
| `mailchecker` | Disposable email detection | MIT |
| `p-limit` | Concurrency control for batch validation workers | MIT |
| `react` and `react-dom` | Frontend UI | MIT |
| `react-router-dom` | Client-side routing | MIT |

Direct development dependencies include:

| Library | Purpose | License |
| --- | --- | --- |
| `@vitejs/plugin-react` | React integration for Vite | MIT |
| `concurrently` | Runs frontend and backend dev processes together | MIT |
| `html-minifier-terser` | HTML optimization tooling | MIT |
| `sass-embedded` | SCSS compilation | MIT |
| `vite` | Frontend build and dev server | MIT |

If you redistribute or deploy this project, review transitive dependency licenses as part of your normal release process.