import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteRun, listRuns } from "../emailValidator.js";

const REFRESH_INTERVAL_MS = 5000;
const API_TIMEOUT_MS = 4000;

export default function ReportsListPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const pageLimit = 20;
  const pollRef = useRef(null);

  const fetchRuns = useCallback(
    async (reset = false, silent = false) => {
      if (loading) return;
      setLoading(true);
      const targetPage = reset ? 1 : currentPage + 1;
      try {
        const data = await listRuns(targetPage, pageLimit, API_TIMEOUT_MS);
        const fetched = Array.isArray(data.runs) ? data.runs : [];
        setCurrentPage(targetPage);
        setRuns((prev) => (reset ? fetched : [...prev, ...fetched]));
        setHasMore(
          (reset ? fetched.length : runs.length + fetched.length) <
            Number(data.total || 0),
        );
      } catch (err) {
        if (!silent) console.error("Failed to load runs:", err);
      } finally {
        setLoading(false);
      }
    },
    [loading, currentPage, runs.length],
  );

  const refreshLoaded = useCallback(async () => {
    try {
      const limit = Math.min(100, currentPage * pageLimit);
      const data = await listRuns(1, limit, API_TIMEOUT_MS);
      const fetched = Array.isArray(data.runs) ? data.runs : [];
      setRuns(fetched);
      setHasMore(fetched.length < Number(data.total || 0));
    } catch {}
  }, [currentPage]);

  const handleDeleteRun = async (event, runId) => {
    event.stopPropagation();

    const shouldDelete = window.confirm(
      "Are you sure you want to delete this report? This action cannot be undone.",
    );
    if (!shouldDelete) return;

    try {
      await deleteRun(runId);
      await refreshLoaded();
    } catch (err) {
      alert(`Failed to delete report: ${err.message}`);
    }
  };

  // Initial load + polling
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const data = await listRuns(1, pageLimit, API_TIMEOUT_MS);
        if (!mounted) return;
        const fetched = Array.isArray(data.runs) ? data.runs : [];
        setCurrentPage(1);
        setRuns(fetched);
        setHasMore(fetched.length < Number(data.total || 0));
      } catch {
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    pollRef.current = setInterval(() => {
      if (mounted) refreshLoaded();
    }, REFRESH_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(pollRef.current);
    };
  }, []);

  return (
    <div>
      <div className="reports-header">
        <h2>Validation Reports</h2>
        <button className="secondary-btn" onClick={() => fetchRuns(true)}>
          Refresh
        </button>
      </div>

      {runs.length === 0 && !loading && (
        <div className="reports-empty" style={{ display: "block" }}>
          <p>
            No validation reports yet. Go to <strong>Validate emails</strong> to
            start a new run.
          </p>
        </div>
      )}

      {runs.length > 0 && (
        <div className="reports-list">
          {runs.map((run) => {
            const pct =
              run.totalCount > 0
                ? Math.round((run.processedCount / run.totalCount) * 100)
                : 0;
            const date = run.createdAt
              ? new Date(run.createdAt).toLocaleString()
              : "";
            const source =
              run.originalFilename || run.inputSource || "textarea";

            return (
              <div
                key={run.id}
                className="report-card"
                onClick={() => navigate(`/reports/${run.id}`)}
              >
                <div className="report-card-header">
                  <span className={`status-badge status-${run.status}`}>
                    {run.status}
                  </span>
                  <span className="report-card-date">{date}</span>
                </div>
                <div className="report-card-body">
                  <div className="report-card-source">{source}</div>
                  <div className="report-card-stats">
                    <span className="stat-valid">{run.validCount} valid</span>
                    <span className="stat-invalid">
                      {run.invalidCount} invalid
                    </span>
                    <span className="stat-total">{run.totalCount} total</span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="report-card-pct">{pct}% processed</div>
                  <div className="report-card-actions">
                    <button
                      className="secondary-btn danger-btn"
                      onClick={(event) => handleDeleteRun(event, run.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="reports-load-more-wrap">
          <button
            className="secondary-btn"
            disabled={loading}
            onClick={() => fetchRuns(false)}
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
