import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getAuthDb, mapUserRow } from "../services/authDb.js";
import {
  hashPassword,
  signAuthToken,
  verifyPassword,
} from "../services/authSecurity.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-zA-Z0-9_]{3,32}$/;

function validateUsername(username) {
  const value = String(username || "").trim();
  if (!value) {
    return "username_required";
  }

  if (!usernamePattern.test(value)) {
    return "username_must_be_3_to_32_chars_with_letters_numbers_underscore";
  }

  return null;
}

function validateEmail(email) {
  const value = String(email || "")
    .trim()
    .toLowerCase();
  if (!value) {
    return "email_required";
  }

  if (!emailPattern.test(value)) {
    return "email_invalid";
  }

  if (value.length > 120) {
    return "email_too_long";
  }

  return null;
}

function validatePassword(password) {
  const value = String(password || "");
  if (!value) {
    return "password_required";
  }

  if (value.length < 5) {
    return "password_must_be_at_least_5_chars";
  }

  if (value.length > 128) {
    return "password_too_long";
  }

  return null;
}

function sanitizeUserPayload(payload) {
  return {
    username: String(payload?.username || "").trim(),
    email: String(payload?.email || "")
      .trim()
      .toLowerCase(),
    password: String(payload?.password || ""),
  };
}

export function createAuthRouter(config) {
  const router = Router();

  router.get("/config", (_req, res) => {
    res.json({
      ok: true,
      signupEnabled: Boolean(config.authSignupEnabled),
      demoUser: {
        username: "admin",
        password: "admin",
      },
    });
  });

  router.post("/signup", (req, res) => {
    if (!config.authSignupEnabled) {
      return res.status(403).json({
        ok: false,
        error: "signup_disabled",
      });
    }

    const payload = sanitizeUserPayload(req.body);
    const usernameError = validateUsername(payload.username);
    const emailError = validateEmail(payload.email);
    const passwordError = validatePassword(payload.password);

    if (usernameError || emailError || passwordError) {
      return res.status(400).json({
        ok: false,
        error: "validation_failed",
        fields: {
          username: usernameError,
          email: emailError,
          password: passwordError,
        },
      });
    }

    const db = getAuthDb(config);
    const existingUser = db
      .prepare("SELECT id FROM users WHERE username = ? OR email = ?")
      .get(payload.username, payload.email);

    if (existingUser) {
      return res.status(409).json({
        ok: false,
        error: "username_or_email_already_exists",
      });
    }

    const passwordHash = hashPassword(payload.password);
    const result = db
      .prepare(
        `
          INSERT INTO users (username, email, password_hash, created_at, updated_at)
          VALUES (?, ?, ?, datetime('now'), datetime('now'))
        `,
      )
      .run(payload.username, payload.email, passwordHash);

    const insertedUser = db
      .prepare(
        `
          SELECT id, username, email, created_at, updated_at
          FROM users
          WHERE id = ?
        `,
      )
      .get(result.lastInsertRowid);

    const user = mapUserRow(insertedUser);
    const token = signAuthToken(user, config);

    return res.status(201).json({
      ok: true,
      token,
      user,
    });
  });

  router.post("/signin", (req, res) => {
    const usernameOrEmail = String(req.body?.usernameOrEmail || "").trim();
    const password = String(req.body?.password || "");

    if (!usernameOrEmail || !password) {
      return res.status(400).json({
        ok: false,
        error: "username_or_email_and_password_required",
      });
    }

    const db = getAuthDb(config);
    const userRow = db
      .prepare(
        `
          SELECT id, username, email, password_hash, created_at, updated_at
          FROM users
          WHERE username = ? OR email = ?
        `,
      )
      .get(usernameOrEmail, usernameOrEmail.toLowerCase());

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      return res.status(401).json({
        ok: false,
        error: "invalid_credentials",
      });
    }

    const user = mapUserRow(userRow);
    const token = signAuthToken(user, config);

    return res.json({
      ok: true,
      token,
      user,
    });
  });

  router.get("/profile", requireAuth(config), (req, res) => {
    const db = getAuthDb(config);
    const userRow = db
      .prepare(
        `
          SELECT id, username, email, created_at, updated_at
          FROM users
          WHERE id = ?
        `,
      )
      .get(req.auth.userId);

    if (!userRow) {
      return res.status(404).json({
        ok: false,
        error: "user_not_found",
      });
    }

    return res.json({
      ok: true,
      user: mapUserRow(userRow),
    });
  });

  router.put("/profile", requireAuth(config), (req, res) => {
    const payload = sanitizeUserPayload(req.body);

    const usernameError = validateUsername(payload.username);
    const emailError = validateEmail(payload.email);
    const passwordError =
      payload.password.length > 0 ? validatePassword(payload.password) : null;

    if (usernameError || emailError || passwordError) {
      return res.status(400).json({
        ok: false,
        error: "validation_failed",
        fields: {
          username: usernameError,
          email: emailError,
          password: passwordError,
        },
      });
    }

    const db = getAuthDb(config);
    const conflictingUser = db
      .prepare(
        `
          SELECT id
          FROM users
          WHERE id != ? AND (username = ? OR email = ?)
        `,
      )
      .get(req.auth.userId, payload.username, payload.email);

    if (conflictingUser) {
      return res.status(409).json({
        ok: false,
        error: "username_or_email_already_exists",
      });
    }

    if (payload.password.length > 0) {
      const passwordHash = hashPassword(payload.password);
      db.prepare(
        `
          UPDATE users
          SET username = ?, email = ?, password_hash = ?, updated_at = datetime('now')
          WHERE id = ?
        `,
      ).run(payload.username, payload.email, passwordHash, req.auth.userId);
    } else {
      db.prepare(
        `
          UPDATE users
          SET username = ?, email = ?, updated_at = datetime('now')
          WHERE id = ?
        `,
      ).run(payload.username, payload.email, req.auth.userId);
    }

    const updatedUser = db
      .prepare(
        `
          SELECT id, username, email, created_at, updated_at
          FROM users
          WHERE id = ?
        `,
      )
      .get(req.auth.userId);

    const user = mapUserRow(updatedUser);
    const token = signAuthToken(user, config);

    return res.json({
      ok: true,
      token,
      user,
    });
  });

  return router;
}
