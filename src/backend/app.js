import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createApiRouter } from "./routes/api.js";

export function createApp(config) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "50mb" }));

  app.use("/api", createApiRouter(config));

  const indexFile = path.join(config.distDir, "index.html");
  const hasDistBuild = fs.existsSync(indexFile);

  if (hasDistBuild) {
    app.use(express.static(config.distDir));

    app.get("/{*path}", (req, res, next) => {
      const requestPath = req.path || "";
      const hasFileExtension = path.extname(requestPath) !== "";

      if (hasFileExtension) {
        return next();
      }

      res.sendFile(indexFile);
    });
  } else {
    app.get("/", (_req, res) => {
      res.status(503).json({
        ok: false,
        message:
          "Frontend build not found. Run the production build first so Node can serve static files.",
      });
    });
  }

  app.use((err, _req, res, _next) => {
    const message =
      err instanceof Error ? err.message : "internal_server_error";
    console.error("Server error:", err);
    res.status(500).json({
      ok: false,
      error: message,
    });
  });

  return app;
}
