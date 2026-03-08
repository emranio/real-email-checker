import os from "node:os";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { getAuthDb } from "./services/authDb.js";
import { startScheduler } from "./services/scheduler.js";

const app = createApp(env);

getAuthDb(env);
const stopScheduler = startScheduler(env);

app.listen(env.port, () => {
  const host = os.hostname();
  console.log(
    `SMTP Email Validator server running on http://localhost:${env.port} (${host})`,
  );
});

function shutdown() {
  console.log("Shutting down gracefully...");
  stopScheduler();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
