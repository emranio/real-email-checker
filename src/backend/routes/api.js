import { Router } from "express";
import { createAuthRouter } from "./auth.js";
import { createRunsRouter } from "./runs.js";
import { verifyRecipientViaSmtp } from "../services/smtpVerifier.js";
import {
  validateEmail,
  validateEmailBatch,
} from "../services/emailValidator.js";

export function createApiRouter(config) {
  const router = Router();

  router.use("/auth", createAuthRouter(config));
  router.use("/runs", createRunsRouter(config));

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "real-email-checker-api",
      timestamp: new Date().toISOString(),
    });
  });

  router.post("/smtp/verify", async (req, res, next) => {
    try {
      const email = String(req.body?.email || "").trim();
      if (!email) {
        return res.status(400).json({
          valid: false,
          reason: "missing_email",
        });
      }

      const verification = await verifyRecipientViaSmtp(email, config);
      return res.status(200).json(verification);
    } catch (error) {
      return next(error);
    }
  });

  router.post("/email/validate", async (req, res, next) => {
    try {
      const email = String(req.body?.email || "").trim();
      if (!email) {
        return res.status(400).json({
          ok: false,
          error: "missing_email",
        });
      }

      const options =
        req.body?.options && typeof req.body.options === "object"
          ? req.body.options
          : {};

      const result = await validateEmail(email, options, config);
      return res.status(200).json({
        ok: true,
        result,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/email/validate-batch", async (req, res, next) => {
    try {
      const emails = req.body?.emails;
      if (!Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({
          ok: false,
          error: "missing_emails",
        });
      }

      const options =
        req.body?.options && typeof req.body.options === "object"
          ? req.body.options
          : {};

      const results = await validateEmailBatch(emails, options, config);
      return res.status(200).json({
        ok: true,
        results,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
