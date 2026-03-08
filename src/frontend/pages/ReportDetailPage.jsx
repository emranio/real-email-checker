import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Chart from "chart.js/auto";
import {
  getRun,
  getRunResults,
  pauseRun,
  resumeRun,
  cancelRun,
  rerunRun,
  deleteRun,
  downloadRunExport,
} from "../emailValidator.js";
import { useTheme } from "../hooks/useTheme.js";

const LARGE_REPORT_THRESHOLD = 1000;
const REFRESH_INTERVAL_MS = 5000;
const PAUSE_PENDING_POLL_INTERVAL_MS = 1000;
const API_TIMEOUT_MS = 4000;

function isRunActive(status) {
  return status === "pending" || status === "running";
}

export default function ReportDetailPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();

  const [runData, setRunData] = useState(null);
  const [results, setResults] = useState([]);
  const [filter, setFilter] = useState("all");
  const [isPausePending, setIsPausePending] = useState(false);
  const pollRef = useRef(null);
  const chartRefs = useRef([null, null, null]);
  const canvasRefs = useRef([null, null, null]);

  const isLargeRun = Number(runData?.totalCount || 0) > LARGE_REPORT_THRESHOLD;

  const loadRun = useCallback(
    async (silent = false) => {
      try {
        const data = await getRun(runId, API_TIMEOUT_MS);
        setRunData(data.run);
        return data.run;
      } catch (err) {
        if (!silent) console.error("Failed to load run:", err);
        return null;
      }
    },
    [runId],
  );

  const loadResults = useCallback(
    async (silent = false) => {
      if (!runData) return;
      if (Number(runData.totalCount || 0) > LARGE_REPORT_THRESHOLD) {
        setResults([]);
        return;
      }
      try {
        const data = await getRunResults(runId, {
          page: 1,
          limit: 10000,
          timeoutMs: API_TIMEOUT_MS,
        });
        setResults(data.results || []);
      } catch (err) {
        if (!silent) console.error("Failed to load results:", err);
      }
    },
    [runId, runData],
  );

  // Initial load
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getRun(runId, API_TIMEOUT_MS);
        if (!mounted) return;
        setRunData(data.run);
      } catch {}
    })();

    return () => {
      mounted = false;
      clearInterval(pollRef.current);
    };
  }, [runId]);

  useEffect(() => {
    if (!runData) {
      return;
    }

    if (runData.status === "paused" || runData.status === "completed") {
      setIsPausePending(false);
      return;
    }

    if (runData.status === "failed" || runData.status === "canceled") {
      setIsPausePending(false);
    }
  }, [runData]);

  // Poll while running or while a pause request is waiting to be honored
  useEffect(() => {
    clearInterval(pollRef.current);

    if (!isRunActive(runData?.status) && !isPausePending) {
      return undefined;
    }

    let mounted = true;
    const pollIntervalMs = isPausePending
      ? PAUSE_PENDING_POLL_INTERVAL_MS
      : REFRESH_INTERVAL_MS;
    pollRef.current = setInterval(async () => {
      if (!mounted) return;
      try {
        const data = await getRun(runId, API_TIMEOUT_MS);
        if (mounted) setRunData(data.run);
      } catch {}
    }, pollIntervalMs);

    return () => {
      mounted = false;
      clearInterval(pollRef.current);
    };
  }, [runId, runData?.status, isPausePending]);

  // Load results when runData changes
  useEffect(() => {
    if (!runData) return;
    if (Number(runData.totalCount || 0) > LARGE_REPORT_THRESHOLD) {
      setResults([]);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const data = await getRunResults(runId, {
          page: 1,
          limit: 10000,
          timeoutMs: API_TIMEOUT_MS,
        });
        if (mounted) setResults(data.results || []);
      } catch {}
    })();
    return () => {
      mounted = false;
    };
  }, [runId, runData?.processedCount, runData?.status]);

  // Charts
  useEffect(() => {
    const destroyChart = (i) => {
      if (chartRefs.current[i]) {
        chartRefs.current[i].destroy();
        chartRefs.current[i] = null;
      }
    };
    if (isLargeRun || results.length < 5) {
      destroyChart(0);
      destroyChart(1);
      destroyChart(2);
      return;
    }

    const chartColor = isDark ? "#ffffff" : "#000000";
    const makeChart = (idx, cfg) => {
      destroyChart(idx);
      const canvas = canvasRefs.current[idx];
      if (!canvas) return;
      chartRefs.current[idx] = new Chart(canvas.getContext("2d"), cfg);
    };

    const valid = results.filter((r) => r.is_valid === 1);
    const invalid = results.filter((r) => r.is_valid === 0);
    let invalidSyntax = 0,
      invalidMX = 0;
    for (const r of invalid) {
      if (r.reason === "invalid syntax") invalidSyntax++;
      else if (r.reason === "no valid MX record") invalidMX++;
    }

    makeChart(0, {
      type: "pie",
      data: {
        labels: [
          "Valid",
          "Invalid Syntax",
          "Invalid DNS Record",
          "Other Invalid",
        ],
        datasets: [
          {
            data: [
              valid.length,
              invalidSyntax,
              invalidMX,
              invalid.length - invalidSyntax - invalidMX,
            ],
            backgroundColor: ["#caffbf", "#ffadad", "#ffc6ff", "#ffd6a5"],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { color: chartColor } },
          title: { display: false, color: chartColor },
        },
      },
    });

    let rb = 0,
      disp = 0,
      unl = 0;
    for (const r of results) {
      if (r.is_role_based) rb++;
      if (r.is_disposable) disp++;
      if (r.is_unlikely) unl++;
    }
    makeChart(1, {
      type: "pie",
      data: {
        labels: ["Role-based", "Disposable", "Unlikely valid"],
        datasets: [
          {
            data: [rb, disp, unl],
            backgroundColor: ["#9bf6ff", "#a0c4ff", "#bdb2ff"],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { color: chartColor } },
          title: { display: false, color: chartColor },
        },
      },
    });

    const dc = {};
    for (const r of results) {
      const at = (r.email || "").lastIndexOf("@");
      if (at > 0) {
        const d = r.email.slice(at + 1).toLowerCase();
        if (d) dc[d] = (dc[d] || 0) + 1;
      }
    }
    const top = Object.entries(dc)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    makeChart(2, {
      type: "pie",
      data: {
        labels: top.map(([d]) => d),
        datasets: [
          {
            data: top.map(([, c]) => c),
            backgroundColor: [
              "#809bce",
              "#95b8d1",
              "#b8e0d4",
              "#d6eadf",
              "#404e67",
            ],
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { color: chartColor } },
          title: { display: false, color: chartColor },
        },
      },
    });

    return () => {
      destroyChart(0);
      destroyChart(1);
      destroyChart(2);
    };
  }, [results, isLargeRun, isDark]);

  const handlePause = async () => {
    try {
      setIsPausePending(true);
      await pauseRun(runId);
      const updatedRun = await loadRun(true);
      if (updatedRun?.status === "paused") {
        setIsPausePending(false);
      }
    } catch (err) {
      setIsPausePending(false);
      alert(`Action failed: ${err.message}`);
    }
  };

  const handleResume = async () => {
    try {
      await resumeRun(runId);
      setIsPausePending(false);
      await loadRun();
    } catch (err) {
      alert(`Action failed: ${err.message}`);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelRun(runId);
      setIsPausePending(false);
      await loadRun();
    } catch (err) {
      alert(`Action failed: ${err.message}`);
    }
  };

  const handleRerun = async () => {
    try {
      const data = await rerunRun(runId);
      const newId = data?.runId || data?.run?.id;
      if (newId) navigate(`/reports/${newId}`);
    } catch (err) {
      alert(`Rerun failed: ${err.message}`);
    }
  };

  const handleDownloadCsv = (type) => {
    downloadRunExport(runId, type, API_TIMEOUT_MS)
      .then(({ blob, filename }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch((err) => alert(`Failed to download CSV: ${err.message}`));
  };

  const handleDeleteRun = async () => {
    const shouldDelete = window.confirm(
      "Are you sure you want to delete this report? This action cannot be undone.",
    );
    if (!shouldDelete) return;

    try {
      await deleteRun(runId);
      navigate("/reports");
    } catch (err) {
      alert(`Failed to delete report: ${err.message}`);
    }
  };

  if (!runData) return null;

  const run = runData;
  const pct =
    run.totalCount > 0
      ? Math.round((run.processedCount / run.totalCount) * 100)
      : 0;
  const isActive = isRunActive(run.status);
  const isPaused = run.status === "paused";
  const isDone = ["completed", "failed", "canceled"].includes(run.status);
  const showPauseWaitingState = isActive && isPausePending;

  const validResults = results.filter((r) => r.is_valid === 1);
  const invalidResults = results.filter((r) => r.is_valid === 0);

  return (
    <div>
      <div className="report-detail-header">
        <button className="secondary-btn" onClick={() => navigate("/reports")}>
          &larr; Back to Reports
        </button>
        <span className={`status-badge status-${run.status}`}>
          {run.status}
        </span>
      </div>

      <div className="report-summary-card">
        <h2 style={{ marginTop: 0 }}>
          Report: {run.originalFilename || run.inputSource || "Report"}
        </h2>
        <p className="report-meta">
          Created{" "}
          {run.createdAt ? new Date(run.createdAt).toLocaleString() : ""} ·{" "}
          {run.totalCount} emails · {run.validCount} valid · {run.invalidCount}{" "}
          invalid
        </p>
        <div className="report-progress-section">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-text">
            {run.processedCount} / {run.totalCount} processed ({pct}%)
          </div>
        </div>
        <div className="report-actions">
          {isActive && (
            <button
              className="secondary-btn"
              onClick={handlePause}
              disabled={showPauseWaitingState}
            >
              {showPauseWaitingState ? "Pausing, please wait" : "Pause"}
            </button>
          )}
          {isPaused && (
            <button className="secondary-btn" onClick={handleResume}>
              Resume
            </button>
          )}
          {(isActive || isPaused) && (
            <button
              className="secondary-btn"
              onClick={handleCancel}
              disabled={showPauseWaitingState}
            >
              Cancel
            </button>
          )}
          {isDone && (
            <button className="secondary-btn" onClick={handleRerun}>
              Rerun
            </button>
          )}
          <button
            className="secondary-btn danger-btn"
            onClick={handleDeleteRun}
          >
            Delete
          </button>
        </div>
      </div>

      {!isLargeRun && results.length >= 5 && (
        <div id="reportChartsContainer">
          <div className="result-group result-chart">
            <h3>Results Chart</h3>
            <canvas
              ref={(el) => (canvasRefs.current[0] = el)}
              width={250}
              height={150}
              style={{ borderRadius: 8 }}
            />
          </div>
          <div className="result-group result-chart">
            <h3>Special Email Types</h3>
            <canvas
              ref={(el) => (canvasRefs.current[1] = el)}
              width={250}
              height={150}
              style={{ borderRadius: 8 }}
            />
          </div>
          <div className="result-group result-chart">
            <h3>Top 5 Input Email Domains</h3>
            <canvas
              ref={(el) => (canvasRefs.current[2] = el)}
              width={250}
              height={150}
              style={{ borderRadius: 8 }}
            />
          </div>
        </div>
      )}

      {(results.length > 0 || isLargeRun) && (
        <div>
          <div className="result-group export-actions">
            <h3>Download Results</h3>
            <div className="export-buttons">
              <button
                className="secondary-btn"
                onClick={() => handleDownloadCsv("valid")}
              >
                Download valid CSV
              </button>
              <button
                className="secondary-btn"
                onClick={() => handleDownloadCsv("invalid")}
              >
                Download excluded CSV
              </button>
            </div>
          </div>

          {isLargeRun && (
            <p className="report-large-run-notice">
              This report contains {Number(run.totalCount).toLocaleString()}{" "}
              emails. Inline output is disabled for runs larger than{" "}
              {LARGE_REPORT_THRESHOLD.toLocaleString()} to keep the page fast.
              Download the CSV files instead.
            </p>
          )}

          {!isLargeRun && (
            <>
              <div className="report-results-filter">
                <label htmlFor="reportResultsFilter">Filter:</label>
                <select
                  id="reportResultsFilter"
                  className="report-filter-select"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="valid">Valid only</option>
                  <option value="invalid">Invalid only</option>
                </select>
              </div>

              <div className="result-group-container">
                <div className="result-group">
                  <h3>Valid looking email addresses</h3>
                  <textarea
                    readOnly
                    value={
                      filter === "invalid"
                        ? ""
                        : validResults.map((r) => r.email).join("\n")
                    }
                  />
                </div>
                <div className="result-group">
                  <h3>Invalid looking email addresses</h3>
                  <textarea
                    readOnly
                    value={
                      filter === "valid"
                        ? ""
                        : invalidResults
                            .map((r) => `${r.email} — ${r.reason || "invalid"}`)
                            .join("\n")
                    }
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
