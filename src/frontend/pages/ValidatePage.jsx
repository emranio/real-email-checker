import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Chart from "chart.js/auto";
import { validateEmailsBatch, createRun } from "../emailValidator.js";
import { useTheme } from "../hooks/useTheme.js";

const APP_STORAGE_KEY = "SMTPEmailValidatorStateV1";
const PERSISTED_OPTION_IDS = [
  "allowRoleBased",
  "allowDisposable",
  "allowDuplicates",
  "allowUnlikely",
  "allowNoWebsiteDomain",
  "checkSmtp",
];

function normalizeEmail(email) {
  if (!email) return "";
  let normalized = email.toLowerCase().trim();
  const atIndex = normalized.indexOf("@");
  if (atIndex > 0) {
    let localPart = normalized.substring(0, atIndex);
    const domain = normalized.substring(atIndex);
    const plusIndex = localPart.indexOf("+");
    if (plusIndex > 0) localPart = localPart.substring(0, plusIndex);
    if (["@gmail.com", "@protonmail.com", "@proton.me"].includes(domain)) {
      localPart = localPart.replace(/\./g, "");
    }
    normalized = localPart + domain;
  }
  return normalized;
}

function parseEmails(input) {
  return input
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const m = trimmed.match(/^(.+?)\s*<(.+?)>$/);
      if (m)
        return { original: trimmed, email: m[2].trim(), name: m[1].trim() };
      return { original: trimmed, email: trimmed, name: "" };
    })
    .filter(Boolean);
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let value = "";
  let insideQuotes = false;
  for (let i = 0; i < csvText.length; i++) {
    const c = csvText[i];
    const n = csvText[i + 1];
    if (c === '"') {
      if (insideQuotes && n === '"') {
        value += '"';
        i++;
      } else insideQuotes = !insideQuotes;
    } else if (c === "," && !insideQuotes) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !insideQuotes) {
      if (c === "\r" && n === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function escapeCsvValue(v) {
  const s = String(v ?? "");
  if (
    s.includes(",") ||
    s.includes('"') ||
    s.includes("\n") ||
    s.includes("\r")
  ) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsvFile(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ValidatePage() {
  const { isDark } = useTheme();

  const [emailInput, setEmailInput] = useState("");
  const [customExclude, setCustomExclude] = useState("");
  const [options, setOptions] = useState({
    allowRoleBased: false,
    allowDisposable: false,
    allowDuplicates: false,
    allowUnlikely: false,
    allowNoWebsiteDomain: false,
    checkSmtp: false,
  });
  const [processing, setProcessing] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [logEntries, setLogEntries] = useState([]);
  const [validEmails, setValidEmails] = useState([]);
  const [invalidEmails, setInvalidEmails] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [notice, setNotice] = useState(null);
  const [csvInputData, setCsvInputData] = useState(null);
  const [lastRunSource, setLastRunSource] = useState("textarea");
  const [lastRunCsvMeta, setLastRunCsvMeta] = useState(null);

  const csvInputRef = useRef(null);
  const chartRefs = useRef([null, null, null]);
  const canvasRefs = useRef([null, null, null]);

  // Restore persisted state on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(APP_STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (!state || typeof state !== "object") return;
      if (typeof state.emailInput === "string") setEmailInput(state.emailInput);
      if (typeof state.customExcludeWords === "string")
        setCustomExclude(state.customExcludeWords);
      if (state.options && typeof state.options === "object") {
        setOptions((prev) => {
          const next = { ...prev };
          for (const key of PERSISTED_OPTION_IDS) {
            if (key in state.options) next[key] = Boolean(state.options[key]);
          }
          return next;
        });
      }
      if (Array.isArray(state.logEntries))
        setLogEntries(state.logEntries.map(String));
      const lrs = state.lastRunSource === "csv" ? "csv" : "textarea";
      setLastRunSource(lrs);
      if (state.lastRunCsvMeta && typeof state.lastRunCsvMeta === "object")
        setLastRunCsvMeta(state.lastRunCsvMeta);
      if (state.csvInputData && typeof state.csvInputData === "object")
        setCsvInputData(state.csvInputData);
      if (
        Array.isArray(state.lastRunValidEmails) &&
        state.lastRunValidEmails.length
      ) {
        setValidEmails(state.lastRunValidEmails);
        setInvalidEmails(
          Array.isArray(state.lastRunInvalidEmails)
            ? state.lastRunInvalidEmails
            : [],
        );
        setShowResults(true);
      }
    } catch {}
  }, []);

  // Persist state on changes
  useEffect(() => {
    try {
      const state = {
        emailInput,
        customExcludeWords: customExclude,
        options,
        logEntries,
        lastRunSource,
        lastRunCsvMeta,
        csvInputData,
        lastRunValidEmails: validEmails,
        lastRunInvalidEmails: invalidEmails,
      };
      localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [
    emailInput,
    customExclude,
    options,
    logEntries,
    validEmails,
    invalidEmails,
    lastRunSource,
    lastRunCsvMeta,
    csvInputData,
  ]);

  // Charts
  useEffect(() => {
    if (!showResults) return;
    const allEmails = [...validEmails, ...invalidEmails];
    const total = allEmails.length;
    const chartColor = isDark ? "#ffffff" : "#000000";

    const destroyChart = (i) => {
      if (chartRefs.current[i]) {
        chartRefs.current[i].destroy();
        chartRefs.current[i] = null;
      }
    };
    const makeChart = (idx, cfg) => {
      destroyChart(idx);
      const canvas = canvasRefs.current[idx];
      if (!canvas) return;
      chartRefs.current[idx] = new Chart(canvas.getContext("2d"), cfg);
    };

    if (total < 5) {
      destroyChart(0);
      destroyChart(1);
      destroyChart(2);
      return;
    }

    // Chart 1
    let invalidSyntax = 0,
      invalidMX = 0;
    for (const e of invalidEmails) {
      if (e.reason === "invalid syntax") invalidSyntax++;
      else if (e.reason === "no valid MX record") invalidMX++;
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
              validEmails.length,
              invalidSyntax,
              invalidMX,
              invalidEmails.length - invalidSyntax - invalidMX,
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

    // Chart 2
    let rb = 0,
      disp = 0,
      unl = 0;
    for (const e of allEmails) {
      if (e.is_role_based) rb++;
      if (e.is_disposable) disp++;
      if (e.is_unlikely) unl++;
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

    // Chart 3 — top domains
    const dc = {};
    for (const e of allEmails) {
      const at = (e.email || "").lastIndexOf("@");
      if (at > 0) {
        const d = e.email.slice(at + 1).toLowerCase();
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
  }, [showResults, validEmails, invalidEmails, isDark]);

  const addLog = useCallback(
    (entry) => setLogEntries((prev) => [...prev, entry]),
    [],
  );

  const handleOptionChange = (key) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const readCsvFile = async (file) => {
    const csvText = await file.text();
    const parsed = parseCsv(csvText).filter((row) =>
      row.some((c) => String(c ?? "").trim() !== ""),
    );
    if (parsed.length === 0) throw new Error("The selected CSV file is empty.");
    const headers = parsed[0].map((h) => String(h ?? "").trim());
    const emailColIdx = headers.findIndex((h) => h.toLowerCase() === "email");
    if (emailColIdx === -1)
      throw new Error('CSV must include an "Email" column.');
    const dataRows = parsed.slice(1).map((row) => {
      const nr = [...row];
      while (nr.length < headers.length) nr.push("");
      nr.length = headers.length;
      return nr;
    });
    const emails = dataRows.map((row, i) => ({
      original: row[emailColIdx] ?? "",
      email: String(row[emailColIdx] ?? "").trim(),
      name: "",
      sourceRow: row,
      sourceRowIndex: i,
    }));
    return { headers, emailColumnIndex: emailColIdx, rows: dataRows, emails };
  };

  const handleCsvChange = async () => {
    if (!csvInputRef.current?.files?.length) {
      setCsvInputData(null);
      return;
    }
    try {
      const data = await readCsvFile(csvInputRef.current.files[0]);
      setCsvInputData(data);
      addLog(
        `CSV imported: ${csvInputRef.current.files[0].name} (${data.emails.length} rows found).`,
      );
    } catch (err) {
      setCsvInputData(null);
      if (csvInputRef.current) csvInputRef.current.value = "";
      alert(err.message);
    }
  };

  const handleSubmit = async () => {
    setLogEntries([]);
    setNotice(null);

    let emails;
    let source = "textarea";

    if (csvInputRef.current?.files?.length) {
      try {
        const data = await readCsvFile(csvInputRef.current.files[0]);
        setCsvInputData(data);
        emails = data.emails;
        source = "csv";
      } catch (err) {
        addLog(`Input error: ${err.message}`);
        alert(err.message);
        return;
      }
    } else if (csvInputData?.emails?.length) {
      emails = csvInputData.emails;
      source = "csv";
    } else {
      if (!emailInput.trim()) {
        alert(
          "Please enter email addresses in the textarea or import a CSV file.",
        );
        return;
      }
      emails = parseEmails(emailInput);
    }

    if (emails.length === 0) {
      alert("No valid email addresses found in the input.");
      return;
    }

    setProcessing(true);
    setProgressText("Submitting...");

    try {
      const emailStrings = emails.map((e) => e.email || e.original || "");
      const originalFilename =
        source === "csv" && csvInputRef.current?.files?.[0]
          ? csvInputRef.current.files[0].name
          : null;
      const customBlockedWords = customExclude
        ? [
            ...new Set(
              customExclude
                .split("\n")
                .map((w) => w.trim().toLowerCase())
                .filter(Boolean),
            ),
          ]
        : [];

      const result = await createRun(
        source,
        emailStrings,
        { ...options, customBlockedWords },
        originalFilename,
      );
      const runId = result?.runId || result?.run?.id || null;
      if (runId) {
        setEmailInput("");
        setCsvInputData(null);
        if (csvInputRef.current) csvInputRef.current.value = "";
        setLastRunSource("textarea");
        setLastRunCsvMeta(null);
        setValidEmails([]);
        setInvalidEmails([]);
        setShowResults(false);
        setNotice(runId);
      } else {
        throw new Error("missing_run_id_in_response");
      }
    } catch (err) {
      addLog(`Error: ${err.message}`);
      alert(`Failed to start validation: ${err.message}`);
    } finally {
      setProcessing(false);
      setProgressText("");
    }
  };

  const handleReset = () => {
    localStorage.removeItem(APP_STORAGE_KEY);
    setEmailInput("");
    setCustomExclude("");
    setOptions({
      allowRoleBased: false,
      allowDisposable: false,
      allowDuplicates: false,
      allowUnlikely: false,
      allowNoWebsiteDomain: false,
      checkSmtp: false,
    });
    setLogEntries([]);
    setValidEmails([]);
    setInvalidEmails([]);
    setShowResults(false);
    setCsvInputData(null);
    if (csvInputRef.current) csvInputRef.current.value = "";
    alert("All saved app data has been reset.");
  };

  const downloadResultsCsv = (type) => {
    const isValid = type === "valid";
    const rows = isValid ? validEmails : invalidEmails;
    if (!rows.length) {
      alert(`No ${isValid ? "filtered" : "excluded"} rows to download.`);
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = isValid
      ? `filtered-emails-${timestamp}.csv`
      : `excluded-emails-${timestamp}.csv`;
    let content;
    if (lastRunSource === "csv" && lastRunCsvMeta?.headers?.length) {
      const h = lastRunCsvMeta.headers;
      const csvRows = rows.map((r) =>
        Array.isArray(r.sourceRow) ? r.sourceRow : new Array(h.length).fill(""),
      );
      content = [
        h.map(escapeCsvValue).join(","),
        ...csvRows.map((r) => r.map(escapeCsvValue).join(",")),
      ].join("\n");
    } else {
      content = [
        "Email",
        ...rows.map((r) => escapeCsvValue(r.email || "")),
      ].join("\n");
    }
    downloadCsvFile(filename, content);
  };

  const totalEmails = validEmails.length + invalidEmails.length;

  return (
    <div>
      <p>
        It is a privacy-first, free and open source smtp email validator tool.
      </p>
      <p>
        It validates a list of email addresses for free and in a way that no
        one, including us, has access to them.
      </p>

      <h2>How To Clean Email Address List</h2>
      <p>
        Enter your email addresses below, one per line. You can use either email
        only format or name &lt;email@domain.com&gt; format.
      </p>
      <p>
        The system will validate each email address and separate valid from
        invalid ones based on your chosen criteria.
      </p>

      <div className="input-section">
        <div className="input-header-row">
          <label htmlFor="emailInput">Email addresses to validate:</label>
          <button
            className="secondary-btn reset-storage-btn"
            type="button"
            onClick={handleReset}
          >
            Reset saved data
          </button>
        </div>
        <textarea
          id="emailInput"
          placeholder={
            "Enter email addresses here, one per line\nExample:\njohn@example.com\nJane Doe <jane@example.com>\ninfo@company.com"
          }
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
        />

        <div className="csv-import-controls">
          <label htmlFor="csvInputFile" className="csv-file-label">
            Or import a CSV file:
          </label>
          <input
            type="file"
            id="csvInputFile"
            accept=".csv,text/csv"
            ref={csvInputRef}
            onChange={handleCsvChange}
          />
          <p className="csv-help-text">
            CSV files must include a column named &quot;Email&quot;.
          </p>
        </div>
      </div>

      <div className="options-section">
        <h3 style={{ marginTop: 0, paddingTop: 0 }}>Processing Options</h3>
        <div className="options-grid">
          {[
            {
              key: "allowRoleBased",
              title: "Allow role-based email addresses",
              desc: "Role-based email addresses are emails such as info@example.com and sales@example.com, that is, email inbox that is relating to a role within an organization, not a person.",
            },
            {
              key: "allowDisposable",
              title: "Allow disposable email addresses",
              desc: "Disposable email addresses, also known as throw-away emails and one-time-use emails, are email addresses provided by special websites that are intended to be used only for a short time.",
            },
            {
              key: "allowDuplicates",
              title: "Allow duplicate email addresses",
              desc: "Allow the output list to contain the same email address more than one time. This feature supports email providers that ignore dots in the email address local part.",
            },
            {
              key: "allowUnlikely",
              title: "Allow unlikely valid email addresses",
              desc: 'Unlikely valid email addresses are email addresses such as "nothanks@example.com" and "nospam@example.com" which could be valid, but probably are not.',
            },
            {
              key: "allowNoWebsiteDomain",
              title: "Allow email addresses from domains without a website",
              desc: "Typically valid email addresses will have a domain name that has some kind of website, but technically that is not a requirement.",
            },
            {
              key: "checkSmtp",
              title: "Enable optional SMTP handshake check",
              desc: "Performs an optional server-side SMTP recipient verification after DNS/MX checks. Explicit SMTP rejections are treated as invalid, but many mail servers time out or refuse recipient probing, so inconclusive SMTP responses do not automatically invalidate an address.",
            },
          ].map((opt) => (
            <div className="option-item" key={opt.key}>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={options[opt.key]}
                  onChange={() => handleOptionChange(opt.key)}
                />
                <span className="toggle-slider"></span>
              </label>
              <div className="option-text">
                <span className="option-title">{opt.title}</span>
                <span className="option-description">{opt.desc}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="custom-filter-section">
          <label htmlFor="customExcludeWords" className="custom-filter-label">
            Exclude emails containing these words (one per line)
          </label>
          <textarea
            id="customExcludeWords"
            className="custom-filter-textarea"
            placeholder={"Example:\ntest\nnoreply\nsupport"}
            value={customExclude}
            onChange={(e) => setCustomExclude(e.target.value)}
          />
          <p className="custom-filter-help">
            If an email contains any listed word, it will be excluded before MX
            checking.
          </p>
        </div>

        <div className="action-section">
          <button
            className="process-btn"
            disabled={processing}
            onClick={handleSubmit}
          >
            {processing ? "Submitting..." : "Start To Validate Emails"}
          </button>
          {notice && (
            <p className="run-created-notice">
              Run started successfully.{" "}
              <Link to={`/reports/${encodeURIComponent(notice)}`}>
                Open report #{notice}
              </Link>
            </p>
          )}
          {processing && (
            <div className="progress-container">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${progressPct}%` }}
                ></div>
              </div>
              <div className="progress-text">{progressText}</div>
            </div>
          )}
        </div>
      </div>

      {showResults && (
        <div className="results-section">
          {totalEmails >= 5 && (
            <div id="chartsContainer">
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

          {(validEmails.length > 0 || invalidEmails.length > 0) && (
            <div className="result-group export-actions">
              <h3>Download Results</h3>
              <div className="export-buttons">
                <button
                  className="secondary-btn"
                  disabled={!validEmails.length}
                  onClick={() => downloadResultsCsv("valid")}
                >
                  Download filtered (valid) CSV
                </button>
                <button
                  className="secondary-btn"
                  disabled={!invalidEmails.length}
                  onClick={() => downloadResultsCsv("invalid")}
                >
                  Download excluded CSV
                </button>
              </div>
            </div>
          )}

          {logEntries.length > 0 && (
            <div className="result-group">
              <h3>Analysis Log</h3>
              <textarea
                readOnly
                style={{ minHeight: 120, marginBottom: 20 }}
                value={logEntries.join("\n")}
              />
            </div>
          )}

          <div className="result-group-container">
            <div className="result-group">
              <h3>Valid looking email addresses</h3>
              <textarea
                readOnly
                value={validEmails.map((e) => e.original).join("\n")}
              />
            </div>
            <div className="result-group">
              <h3>Invalid looking email addresses</h3>
              <textarea
                readOnly
                value={invalidEmails.map((e) => e.original).join("\n")}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
