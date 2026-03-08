import crypto from "node:crypto";
import pLimit from "p-limit";
import { getAuthDb } from "./authDb.js";
import { validateEmail, setDnsTimeout } from "./emailValidator.js";

const activeWorkers = new Map();
let intervalId = null;
let config = null;

export function startScheduler(cfg) {
  config = cfg;
  setDnsTimeout(config.dnsTimeoutMs || 5000);

  const db = getAuthDb(config);
  db.prepare(
    "UPDATE validation_runs SET status = 'pending', updated_at = datetime('now') WHERE status = 'running'",
  ).run();

  intervalId = setInterval(() => tick(), config.schedulerPollMs || 2000);
  tick();

  return stopScheduler;
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function tick() {
  const db = getAuthDb(config);
  const maxRuns = config.maxConcurrentRuns || 5;
  const slotsAvailable = maxRuns - activeWorkers.size;

  if (slotsAvailable <= 0) return;

  const pendingRuns = db
    .prepare(
      "SELECT id FROM validation_runs WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?",
    )
    .all(slotsAvailable);

  for (const row of pendingRuns) {
    const claimed = db
      .prepare(
        "UPDATE validation_runs SET status = 'running', started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
      )
      .run(row.id);

    if (claimed.changes > 0) {
      const worker = runWorker(row.id);
      activeWorkers.set(row.id, worker);
      worker.finally(() => activeWorkers.delete(row.id));
    }
  }
}

async function runWorker(runId) {
  const db = getAuthDb(config);
  const concurrency = config.runWorkerConcurrency || 20;
  const limit = pLimit(concurrency);
  const batchSize = Math.max(1, concurrency);

  try {
    const optionsRow = db
      .prepare("SELECT options_json FROM validation_runs WHERE id = ?")
      .get(runId);
    if (!optionsRow) return;

    const options = JSON.parse(optionsRow.options_json);

    const updateResult = db.prepare(
      `UPDATE validation_results
       SET is_valid = ?, reason = ?, is_role_based = ?, is_disposable = ?,
           is_unlikely = ?, has_mx = ?, has_a_record = ?, has_smtp = ?,
           smtp_checked = ?, checked_at = datetime('now')
       WHERE id = ?`,
    );

    const updateRunCounts = db.prepare(
      `UPDATE validation_runs
       SET processed_count = (SELECT COUNT(*) FROM validation_results WHERE run_id = ? AND is_valid IS NOT NULL),
           valid_count = (SELECT COUNT(*) FROM validation_results WHERE run_id = ? AND is_valid = 1),
           invalid_count = (SELECT COUNT(*) FROM validation_results WHERE run_id = ? AND is_valid = 0),
           updated_at = datetime('now')
       WHERE id = ?`,
    );

    const batchUpdate = db.transaction((results) => {
      for (const r of results) {
        updateResult.run(
          r.is_valid,
          r.reason,
          r.is_role_based,
          r.is_disposable,
          r.is_unlikely,
          r.has_mx,
          r.has_a_record,
          r.has_smtp,
          r.smtp_checked,
          r.id,
        );
      }
      updateRunCounts.run(runId, runId, runId, runId);
    });

    const checkForPauseOrCancel = () => {
      const pauseCheck = db
        .prepare(
          "SELECT pause_requested, status FROM validation_runs WHERE id = ?",
        )
        .get(runId);

      if (!pauseCheck || pauseCheck.status === "canceled") {
        return "stop";
      }

      if (pauseCheck.pause_requested) {
        db.prepare(
          "UPDATE validation_runs SET status = 'paused', pause_requested = 0, updated_at = datetime('now') WHERE id = ?",
        ).run(runId);
        return "paused";
      }

      return null;
    };

    while (true) {
      const pauseState = checkForPauseOrCancel();
      if (pauseState) return;

      const unchecked = db
        .prepare(
          "SELECT id, email FROM validation_results WHERE run_id = ? AND is_valid IS NULL ORDER BY sequence_no LIMIT ?",
        )
        .all(runId, batchSize);

      if (unchecked.length === 0) break;

      const batchResults = await Promise.all(
        unchecked.map((row) =>
          limit(async () => {
            const result = await validateEmail(row.email, options, config);
            return {
              id: row.id,
              is_valid: result.valid ? 1 : 0,
              reason: result.reason,
              is_role_based: result.isRoleBased ? 1 : 0,
              is_disposable: result.isDisposable ? 1 : 0,
              is_unlikely: result.isUnlikely ? 1 : 0,
              has_mx:
                result.hasMx === true ? 1 : result.hasMx === false ? 0 : null,
              has_a_record:
                result.hasARecord === true
                  ? 1
                  : result.hasARecord === false
                    ? 0
                    : null,
              has_smtp:
                result.hasSmtp === true
                  ? 1
                  : result.hasSmtp === false
                    ? 0
                    : null,
              smtp_checked: result.smtpChecked ? 1 : 0,
            };
          }),
        ),
      );

      batchUpdate(batchResults);

      const postBatchPauseState = checkForPauseOrCancel();
      if (postBatchPauseState) return;
    }

    db.prepare(
      "UPDATE validation_runs SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'running'",
    ).run(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    db.prepare(
      "UPDATE validation_runs SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(message, runId);
  }
}

export function createRun(
  db,
  userId,
  inputSource,
  emails,
  optionsJson,
  originalFilename,
) {
  const runId = crypto.randomUUID();
  const totalCount = emails.length;

  const insertRun = db.prepare(
    `INSERT INTO validation_runs (id, user_id, status, total_count, input_source, input_emails, options_json, original_filename)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
  );

  const insertResult = db.prepare(
    `INSERT INTO validation_results (run_id, sequence_no, original_value, email)
     VALUES (?, ?, ?, ?)`,
  );

  const createTransaction = db.transaction(() => {
    insertRun.run(
      runId,
      userId,
      totalCount,
      inputSource,
      JSON.stringify(emails),
      optionsJson,
      originalFilename || null,
    );

    for (let i = 0; i < emails.length; i++) {
      const entry = emails[i];
      const emailStr = typeof entry === "string" ? entry : entry.email || "";
      const originalValue =
        typeof entry === "string" ? entry : entry.original || emailStr;
      insertResult.run(runId, i, originalValue, emailStr);
    }
  });

  createTransaction();
  return runId;
}
