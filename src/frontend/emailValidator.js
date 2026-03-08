const EMAIL_VALIDATE_ENDPOINT = "/api/email/validate";
const EMAIL_VALIDATE_BATCH_ENDPOINT = "/api/email/validate-batch";
const RUNS_API_BASE = "/api/runs";

function getAuthHeaders() {
  const token = localStorage.getItem("SMTPEmailValidatorAuthTokenV1");
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "validation_request_failed");
  }

  return data;
}

async function authFetch(url, options = {}) {
  const { timeoutMs = 0, ...restOptions } = options;
  const controller = timeoutMs > 0 ? new AbortController() : null;
  let timeoutId = null;

  if (controller) {
    timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  const headers = { ...getAuthHeaders(), ...(options.headers || {}) };
  let response;
  try {
    response = await fetch(url, {
      ...restOptions,
      headers,
      signal: controller?.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("request_timeout");
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `request_failed_${response.status}`);
  }
  return data;
}

async function validateEmail(email, options = {}) {
  const data = await postJson(EMAIL_VALIDATE_ENDPOINT, { email, options });

  if (!data?.result || typeof data.result !== "object") {
    throw new Error("invalid_validation_response");
  }

  return data.result;
}

async function validateEmailsBatch(emails, options = {}) {
  const normalizedEmails = Array.isArray(emails)
    ? emails.map((email) => String(email ?? ""))
    : [];

  const data = await postJson(EMAIL_VALIDATE_BATCH_ENDPOINT, {
    emails: normalizedEmails,
    options,
  });

  if (!Array.isArray(data?.results)) {
    throw new Error("invalid_batch_validation_response");
  }

  return data.results;
}

async function createRun(
  inputSource,
  emails,
  options = {},
  originalFilename = null,
) {
  return authFetch(RUNS_API_BASE, {
    method: "POST",
    body: JSON.stringify({ inputSource, emails, options, originalFilename }),
  });
}

async function listRuns(page = 1, limit = 50, timeoutMs = 0) {
  return authFetch(`${RUNS_API_BASE}?page=${page}&limit=${limit}`, {
    timeoutMs,
  });
}

async function getRun(runId, timeoutMs = 0) {
  return authFetch(`${RUNS_API_BASE}/${encodeURIComponent(runId)}`, {
    timeoutMs,
  });
}

async function getRunResults(
  runId,
  { page = 1, limit = 200, filter = "all", timeoutMs = 0 } = {},
) {
  return authFetch(
    `${RUNS_API_BASE}/${encodeURIComponent(runId)}/results?page=${page}&limit=${limit}&filter=${filter}`,
    { timeoutMs },
  );
}

function getRunExportUrl(runId, type = "all") {
  return `${RUNS_API_BASE}/${encodeURIComponent(runId)}/export?type=${encodeURIComponent(type)}`;
}

async function downloadRunExport(runId, type = "all", timeoutMs = 0) {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  let timeoutId = null;

  if (controller) {
    timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  try {
    const response = await fetch(getRunExportUrl(runId, type), {
      method: "GET",
      headers: getAuthHeaders(),
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new Error(`request_failed_${response.status}`);
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);

    return {
      blob,
      filename: filenameMatch?.[1] || `run-${type}.csv`,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("request_timeout");
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function pauseRun(runId) {
  return authFetch(`${RUNS_API_BASE}/${encodeURIComponent(runId)}/pause`, {
    method: "POST",
  });
}

async function resumeRun(runId) {
  return authFetch(`${RUNS_API_BASE}/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
  });
}

async function cancelRun(runId) {
  return authFetch(`${RUNS_API_BASE}/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });
}

async function rerunRun(runId) {
  return authFetch(`${RUNS_API_BASE}/${encodeURIComponent(runId)}/rerun`, {
    method: "POST",
  });
}

async function deleteRun(runId) {
  return authFetch(`${RUNS_API_BASE}/${encodeURIComponent(runId)}`, {
    method: "DELETE",
  });
}

export {
  validateEmail,
  validateEmailsBatch,
  createRun,
  listRuns,
  getRun,
  getRunResults,
  pauseRun,
  resumeRun,
  cancelRun,
  rerunRun,
  deleteRun,
  getRunExportUrl,
  downloadRunExport,
};
