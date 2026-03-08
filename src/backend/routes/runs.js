import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getAuthDb } from "../services/authDb.js";
import { createRun } from "../services/scheduler.js";

const ALLOWED_OPTIONS = [
  "allowRoleBased",
  "allowDisposable",
  "allowDuplicates",
  "allowUnlikely",
  "allowNoWebsiteDomain",
  "checkSmtp",
  "customBlockedWords",
];

function sanitizeOptions(raw) {
  if (!raw || typeof raw !== "object") return {};
  const clean = {};
  for (const key of ALLOWED_OPTIONS) {
    if (key in raw) {
      clean[key] =
        key === "customBlockedWords"
          ? Array.isArray(raw[key])
            ? raw[key].map(String)
            : []
          : Boolean(raw[key]);
    }
  }
  return clean;
}

export function createRunsRouter(config) {
  const router = Router();

  router.use(requireAuth(config));

  router.post("/", (req, res) => {
    const db = getAuthDb(config);
    const userId = req.auth.userId;

    const inputSource = String(req.body?.inputSource || "").trim();
    if (inputSource !== "textarea" && inputSource !== "csv") {
      return res.status(400).json({ ok: false, error: "invalid_input_source" });
    }

    const emails = req.body?.emails;
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ ok: false, error: "missing_emails" });
    }

    const maxInput = config.maxInputEmails || 100000;
    if (emails.length > maxInput) {
      return res
        .status(400)
        .json({ ok: false, error: "too_many_emails", max: maxInput });
    }

    const activeCount = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM validation_runs WHERE user_id = ? AND status IN ('pending', 'running')",
      )
      .get(userId).cnt;

    const maxConcurrent = config.maxConcurrentRuns || 5;
    if (activeCount >= maxConcurrent * 2) {
      return res.status(429).json({ ok: false, error: "too_many_active_runs" });
    }

    const options = sanitizeOptions(req.body?.options);
    const optionsJson = JSON.stringify(options);
    const originalFilename = req.body?.originalFilename
      ? String(req.body.originalFilename).slice(0, 255)
      : null;

    try {
      const runId = createRun(
        db,
        userId,
        inputSource,
        emails,
        optionsJson,
        originalFilename,
      );
      return res.status(201).json({ ok: true, runId });
    } catch (error) {
      console.error("Failed to create run:", error);
      return res.status(500).json({ ok: false, error: "run_creation_failed" });
    }
  });

  router.get("/", (req, res) => {
    const db = getAuthDb(config);
    const userId = req.auth.userId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const total = db
      .prepare("SELECT COUNT(*) as cnt FROM validation_runs WHERE user_id = ?")
      .get(userId).cnt;

    const runs = db
      .prepare(
        `SELECT id, status, total_count, processed_count, valid_count, invalid_count,
                input_source, original_filename, error_message,
                created_at, started_at, updated_at, completed_at
         FROM validation_runs
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset);

    return res.json({
      ok: true,
      runs: runs.map(mapRunRow),
      page,
      limit,
      total,
    });
  });

  router.get("/:id", (req, res) => {
    const db = getAuthDb(config);
    const run = db
      .prepare(
        `SELECT id, user_id, status, total_count, processed_count, valid_count, invalid_count,
                input_source, original_filename, options_json, error_message,
                created_at, started_at, updated_at, completed_at
         FROM validation_runs WHERE id = ?`,
      )
      .get(req.params.id);

    if (!run || run.user_id !== req.auth.userId) {
      return res.status(404).json({ ok: false, error: "run_not_found" });
    }

    return res.json({ ok: true, run: mapRunRow(run) });
  });

  router.get("/:id/results", (req, res) => {
    const db = getAuthDb(config);
    const run = db
      .prepare("SELECT id, user_id FROM validation_runs WHERE id = ?")
      .get(req.params.id);

    if (!run || run.user_id !== req.auth.userId) {
      return res.status(404).json({ ok: false, error: "run_not_found" });
    }

    const filter = String(req.query.filter || "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    let whereClause = "WHERE run_id = ?";
    const params = [run.id];

    if (filter === "valid") {
      whereClause += " AND is_valid = 1";
    } else if (filter === "invalid") {
      whereClause += " AND is_valid = 0";
    } else if (filter === "pending") {
      whereClause += " AND is_valid IS NULL";
    }

    const total = db
      .prepare(`SELECT COUNT(*) as cnt FROM validation_results ${whereClause}`)
      .get(...params).cnt;

    const results = db
      .prepare(
        `SELECT id, sequence_no, original_value, email, is_valid, reason,
                is_role_based, is_disposable, is_unlikely,
                has_mx, has_a_record, has_smtp, smtp_checked, checked_at
         FROM validation_results
         ${whereClause}
         ORDER BY sequence_no
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    return res.json({ ok: true, results, page, limit, total });
  });

  router.get("/:id/export", (req, res) => {
    const db = getAuthDb(config);
    const run = db
      .prepare("SELECT id, user_id FROM validation_runs WHERE id = ?")
      .get(req.params.id);

    if (!run || run.user_id !== req.auth.userId) {
      return res.status(404).json({ ok: false, error: "run_not_found" });
    }

    const type = String(req.query.type || "all")
      .trim()
      .toLowerCase();
    let whereClause = "WHERE run_id = ?";
    let filenameSuffix = "all";

    if (type === "valid") {
      whereClause += " AND is_valid = 1";
      filenameSuffix = "valid";
    } else if (type === "invalid") {
      whereClause += " AND is_valid = 0";
      filenameSuffix = "invalid";
    }

    const filename = `run-${run.id}-${filenameSuffix}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"${filename}\"`,
    );

    if (type === "invalid") {
      res.write("Email,Reason\n");
      const stmt = db.prepare(
        `SELECT email, reason
         FROM validation_results
         ${whereClause}
         ORDER BY sequence_no`,
      );

      for (const row of stmt.iterate(run.id)) {
        res.write(`${escapeCsv(row.email)},${escapeCsv(row.reason || "")}\n`);
      }
      return res.end();
    }

    res.write("Email\n");
    const stmt = db.prepare(
      `SELECT email
       FROM validation_results
       ${whereClause}
       ORDER BY sequence_no`,
    );

    for (const row of stmt.iterate(run.id)) {
      res.write(`${escapeCsv(row.email)}\n`);
    }

    return res.end();
  });

  router.post("/:id/pause", (req, res) => {
    const db = getAuthDb(config);
    const run = db
      .prepare("SELECT id, user_id, status FROM validation_runs WHERE id = ?")
      .get(req.params.id);

    if (!run || run.user_id !== req.auth.userId) {
      return res.status(404).json({ ok: false, error: "run_not_found" });
    }

    if (run.status !== "running" && run.status !== "pending") {
      return res
        .status(400)
        .json({ ok: false, error: "cannot_pause", currentStatus: run.status });
    }

    if (run.status === "pending") {
      db.prepare(
        "UPDATE validation_runs SET status = 'paused', updated_at = datetime('now') WHERE id = ?",
      ).run(run.id);
    } else {
      db.prepare(
        "UPDATE validation_runs SET pause_requested = 1, updated_at = datetime('now') WHERE id = ?",
      ).run(run.id);
    }

    return res.json({ ok: true });
  });

  router.post("/:id/resume", (req, res) => {
    const db = getAuthDb(config);
    const run = db
      .prepare("SELECT id, user_id, status FROM validation_runs WHERE id = ?")
      .get(req.params.id);

    if (!run || run.user_id !== req.auth.userId) {
      return res.status(404).json({ ok: false, error: "run_not_found" });
    }

    if (run.status !== "paused") {
      return res
        .status(400)
        .json({ ok: false, error: "cannot_resume", currentStatus: run.status });
    }

    db.prepare(
      "UPDATE validation_runs SET status = 'pending', pause_requested = 0, updated_at = datetime('now') WHERE id = ?",
    ).run(run.id);

    return res.json({ ok: true });
  });

  router.post("/:id/cancel", (req, res) => {
    const db = getAuthDb(config);
    const run = db
      .prepare("SELECT id, user_id, status FROM validation_runs WHERE id = ?")
      .get(req.params.id);

    if (!run || run.user_id !== req.auth.userId) {
      return res.status(404).json({ ok: false, error: "run_not_found" });
    }

    if (run.status === "completed" || run.status === "canceled") {
      return res
        .status(400)
        .json({ ok: false, error: "cannot_cancel", currentStatus: run.status });
    }

    db.prepare(
      "UPDATE validation_runs SET status = 'canceled', updated_at = datetime('now') WHERE id = ?",
    ).run(run.id);

    return res.json({ ok: true });
  });

  router.post("/:id/rerun", (req, res) => {
    const db = getAuthDb(config);
    const run = db
      .prepare(
        "SELECT id, user_id, input_source, input_emails, options_json, original_filename FROM validation_runs WHERE id = ?",
      )
      .get(req.params.id);

    if (!run || run.user_id !== req.auth.userId) {
      return res.status(404).json({ ok: false, error: "run_not_found" });
    }

    try {
      const emails = JSON.parse(run.input_emails);
      const runId = createRun(
        db,
        req.auth.userId,
        run.input_source,
        emails,
        run.options_json,
        run.original_filename,
      );
      return res.status(201).json({ ok: true, runId });
    } catch (error) {
      console.error("Failed to rerun:", error);
      return res.status(500).json({ ok: false, error: "rerun_failed" });
    }
  });

  router.delete("/:id", (req, res) => {
    const db = getAuthDb(config);
    const run = db
      .prepare("SELECT id, user_id FROM validation_runs WHERE id = ?")
      .get(req.params.id);

    if (!run || run.user_id !== req.auth.userId) {
      return res.status(404).json({ ok: false, error: "run_not_found" });
    }

    db.prepare("DELETE FROM validation_runs WHERE id = ?").run(run.id);
    return res.json({ ok: true });
  });

  return router;
}

function escapeCsv(value) {
  const normalized = String(value ?? "");
  if (
    normalized.includes(",") ||
    normalized.includes('"') ||
    normalized.includes("\n") ||
    normalized.includes("\r")
  ) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function mapRunRow(row) {
  return {
    id: row.id,
    status: row.status,
    totalCount: row.total_count,
    processedCount: row.processed_count,
    validCount: row.valid_count,
    invalidCount: row.invalid_count,
    inputSource: row.input_source,
    originalFilename: row.original_filename,
    options: row.options_json ? JSON.parse(row.options_json) : undefined,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}
