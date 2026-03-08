import dns from "node:dns/promises";
import net from "node:net";

const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function parseEmail(email) {
  const normalized = String(email || "").trim();
  if (!normalized || !emailRegex.test(normalized)) {
    return null;
  }

  const [localPart, domain] = normalized.split("@");
  if (!localPart || !domain) {
    return null;
  }

  return { localPart, domain };
}

async function getMxHosts(domain) {
  try {
    const records = await dns.resolveMx(domain);
    if (!Array.isArray(records) || records.length === 0) {
      return [];
    }

    return records
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((record) => String(record.exchange || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readSmtpResponse(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let message = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      socket.off("end", onEnd);
    };

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    const processLine = (line) => {
      if (!line) {
        return;
      }

      message += `${line}\n`;
      const match = line.match(/^(\d{3})([\s-])(.*)$/);
      if (!match) {
        return;
      }

      const code = Number(match[1]);
      const separator = match[2];
      if (separator === " ") {
        finish(null, {
          code,
          message: message.trim(),
        });
      }
    };

    const onData = (chunk) => {
      buffer += chunk.toString("utf8");

      let lineBreakIndex = buffer.indexOf("\n");
      while (lineBreakIndex >= 0) {
        const line = buffer.slice(0, lineBreakIndex).replace(/\r$/, "");
        buffer = buffer.slice(lineBreakIndex + 1);
        processLine(line);
        if (settled) {
          return;
        }
        lineBreakIndex = buffer.indexOf("\n");
      }
    };

    const onError = (error) => finish(error);
    const onClose = () => finish(new Error("smtp_socket_closed"));
    const onEnd = () => finish(new Error("smtp_socket_ended"));

    const timeoutId = setTimeout(() => {
      finish(new Error("smtp_timeout"));
    }, timeoutMs);

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.on("end", onEnd);
  });
}

function extractEnhancedStatus(message) {
  const match = String(message || "").match(/\b([245]\.\d+\.\d+)\b/);
  return match?.[1] || null;
}

function isRecipientAddressFailure(code, message) {
  const normalizedMessage = String(message || "").toLowerCase();
  const enhancedStatus = extractEnhancedStatus(normalizedMessage);

  // --- Definitive address/mailbox failures (check FIRST) ---

  const definitiveStatuses = new Set(["5.1.1", "5.1.6", "5.1.10"]);
  if (enhancedStatus && definitiveStatuses.has(enhancedStatus)) {
    return true;
  }

  const definitiveIndicators = [
    "user unknown",
    "unknown user",
    "unknown recipient",
    "recipient not found",
    "invalid recipient",
    "mailbox unavailable",
    "mailbox not found",
    "no such user",
    "no such mailbox",
    "does not exist",
    "recipient address rejected: user unknown",
    "relay access denied",
    "relay not permitted",
    "relaying denied",
  ];

  if (
    definitiveIndicators.some((indicator) =>
      normalizedMessage.includes(indicator),
    )
  ) {
    return true;
  }

  if (code === 551) {
    return true;
  }

  // --- Sender/IP policy blocks (inconclusive about recipient) ---

  if (enhancedStatus?.startsWith("5.7.")) {
    return false;
  }

  const policyIndicators = [
    "spamhaus",
    "blocked",
    "blacklist",
    "block list",
    "service unavailable",
    "policy",
    "reputation",
    "greylist",
    "graylist",
    "rate limit",
    "not authorized",
    "client host rejected",
    "temporarily deferred",
    "try again later",
  ];

  if (
    policyIndicators.some((indicator) => normalizedMessage.includes(indicator))
  ) {
    return false;
  }

  return false;
}

async function sendCommand(socket, command, timeoutMs) {
  if (socket.destroyed || socket.writableEnded || !socket.writable) {
    throw new Error("smtp_socket_not_writable");
  }

  const responsePromise = readSmtpResponse(socket, timeoutMs);

  try {
    socket.write(`${command}\r\n`);
  } catch (error) {
    socket.destroy(error instanceof Error ? error : undefined);
    throw error;
  }

  return responsePromise;
}

async function verifyAgainstHost({
  mxHost,
  recipient,
  heloHost,
  mailFrom,
  timeoutMs,
}) {
  let socket;

  try {
    socket = net.createConnection({ host: mxHost, port: 25 });
    socket.on("error", () => {
      // Keep a baseline error handler attached for the entire socket lifetime
      // so transient SMTP close/write races do not crash the process.
    });

    await new Promise((resolve, reject) => {
      const onConnect = () => {
        socket.off("error", onError);
        resolve();
      };

      const onError = (error) => {
        socket.off("connect", onConnect);
        reject(error);
      };

      socket.once("connect", onConnect);
      socket.once("error", onError);
      socket.setTimeout(timeoutMs, () => {
        socket.destroy(new Error("smtp_connect_timeout"));
      });
    });

    const banner = await readSmtpResponse(socket, timeoutMs);
    if (banner.code !== 220) {
      return { valid: false, reason: "bad_banner", mxHost };
    }

    let ehlo = await sendCommand(socket, `EHLO ${heloHost}`, timeoutMs);
    if (ehlo.code !== 250) {
      ehlo = await sendCommand(socket, `HELO ${heloHost}`, timeoutMs);
      if (ehlo.code !== 250) {
        return { valid: false, reason: "helo_failed", mxHost };
      }
    }

    const mailFromResp = await sendCommand(
      socket,
      `MAIL FROM:<${mailFrom}>`,
      timeoutMs,
    );
    if (mailFromResp.code !== 250) {
      return { valid: true, reason: "mail_from_rejected", mxHost };
    }

    const rcptResp = await sendCommand(
      socket,
      `RCPT TO:<${recipient}>`,
      timeoutMs,
    );

    if ([250, 251].includes(rcptResp.code)) {
      return { valid: true, reason: "recipient_accepted", mxHost };
    }

    if (isRecipientAddressFailure(rcptResp.code, rcptResp.message)) {
      return { valid: false, reason: "recipient_rejected", mxHost };
    }

    return {
      valid: false,
      reason: `rcpt_inconclusive_${rcptResp.code}`,
      mxHost,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown_error";
    return { valid: false, reason: `connect_failed_${detail}`, mxHost };
  } finally {
    if (socket && !socket.destroyed) {
      socket.once("error", () => {
        // Ignore late socket teardown errors (e.g. EPIPE after peer FIN).
      });

      if (socket.writable && !socket.writableEnded) {
        socket.end("QUIT\r\n");
      } else {
        socket.destroy();
      }
    }
  }
}

export async function verifyRecipientViaSmtp(email, config) {
  const parsed = parseEmail(email);
  if (!parsed) {
    return {
      valid: false,
      reason: "invalid_email_format",
    };
  }

  const mxHosts = await getMxHosts(parsed.domain);
  if (mxHosts.length === 0) {
    return {
      valid: false,
      reason: "no_mx_record",
    };
  }

  const timeoutMs = Math.max(
    2000,
    Number(config.smtpTimeoutSeconds || 20) * 1000,
  );
  const heloHost = config.smtpHeloHost || "localhost";
  const mailFrom = config.smtpMailFrom || `verify@${parsed.domain}`;
  const recipient = `${parsed.localPart}@${parsed.domain}`;

  const hostsToTry = mxHosts.slice(0, 3);

  const results = await Promise.allSettled(
    hostsToTry.map((mxHost) =>
      verifyAgainstHost({ mxHost, recipient, heloHost, mailFrom, timeoutMs }),
    ),
  );

  let fallbackReason = "smtp_unreachable";
  for (const entry of results) {
    if (entry.status !== "fulfilled") continue;
    const result = entry.value;
    if (result.valid) return result;
    if (result.reason === "recipient_rejected") return result;
    fallbackReason = result.reason || fallbackReason;
  }

  return {
    valid: false,
    reason: fallbackReason,
  };
}
