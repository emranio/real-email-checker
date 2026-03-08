import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { hashPassword } from "./authSecurity.js";

let authDb = null;

function ensureParentDirectory(filePath) {
  const parentDir = path.dirname(filePath);
  fs.mkdirSync(parentDir, { recursive: true });
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS validation_runs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      total_count INTEGER NOT NULL,
      processed_count INTEGER NOT NULL DEFAULT 0,
      valid_count INTEGER NOT NULL DEFAULT 0,
      invalid_count INTEGER NOT NULL DEFAULT 0,
      input_source TEXT NOT NULL,
      input_emails TEXT NOT NULL,
      options_json TEXT NOT NULL,
      original_filename TEXT,
      pause_requested INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS validation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
      sequence_no INTEGER NOT NULL,
      original_value TEXT NOT NULL,
      email TEXT NOT NULL,
      is_valid INTEGER,
      reason TEXT,
      is_role_based INTEGER DEFAULT 0,
      is_disposable INTEGER DEFAULT 0,
      is_unlikely INTEGER DEFAULT 0,
      has_mx INTEGER,
      has_a_record INTEGER,
      has_smtp INTEGER,
      smtp_checked INTEGER DEFAULT 0,
      checked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_user_status ON validation_runs(user_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_scheduler ON validation_runs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_results_run_seq ON validation_results(run_id, sequence_no);
  `);
}

function ensureDemoUser(db) {
  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get("admin");

  if (existingAdmin) {
    return;
  }

  const passwordHash = hashPassword("admin");
  db.prepare(
    `
      INSERT INTO users (username, email, password_hash)
      VALUES (?, ?, ?)
    `,
  ).run("admin", "admin@example.local", passwordHash);
}

export function getAuthDb(config) {
  if (authDb) {
    return authDb;
  }

  ensureParentDirectory(config.sqliteDbPath);
  authDb = new Database(config.sqliteDbPath);
  authDb.pragma("journal_mode = WAL");

  initializeSchema(authDb);
  ensureDemoUser(authDb);

  return authDb;
}

export function mapUserRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
