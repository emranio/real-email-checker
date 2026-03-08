export default function HowItWorksPage() {
  return (
    <section className="how-it-works-page">
      <h2>How it Works</h2>

      <p>
        SMTP Email Validator uses a layered validation pipeline. It starts with
        inexpensive checks such as format and pattern rules, then moves to DNS,
        and only performs SMTP recipient probing when that option is enabled.
      </p>

      <p>
        If the app marks an address as invalid, there is usually a concrete
        reason recorded for it. If the app says an address looks valid, that
        means it passed the enabled checks; it does not guarantee perfect
        deliverability. Email systems are famously dramatic and sometimes refuse
        to reveal the full truth.
      </p>

      <h3>Usage</h3>

      <p>
        After signing in, open the validator page and submit email input in one
        of two ways:
      </p>

      <ul>
        <li>paste email addresses into the textarea, one per line</li>
        <li>import a CSV file that includes a column named `Email`</li>
      </ul>

      <p>The validator accepts entries such as:</p>

      <ul>
        <li>`john@example.com`</li>
        <li>`Jane Doe &lt;jane@example.com&gt;`</li>
      </ul>

      <p>You can configure the run to allow or reject:</p>

      <ul>
        <li>role-based addresses</li>
        <li>disposable addresses</li>
        <li>unlikely-looking addresses</li>
        <li>domains without a website</li>
        <li>optional SMTP recipient verification</li>
      </ul>

      <p>
        You can also supply custom blocked words. Matching addresses are
        rejected before DNS lookups begin.
      </p>

      <p>
        The UI also contains an `allowDuplicates` toggle, but duplicate
        filtering is not currently enforced by the backend validation pipeline.
      </p>

      <p>
        When you submit a job, the app creates a validation run, processes it in
        the background, and stores report results so you can open, pause,
        resume, cancel, rerun, delete, and export the run later.
      </p>

      <h3>How validation works</h3>

      <p>The backend evaluates each email in ordered stages:</p>

      <ol>
        <li>
          <strong>Format check:</strong> the address must match the app&apos;s
          email pattern.
        </li>
        <li>
          <strong>Unlikely-pattern checks:</strong> suspicious tokens, excessive
          repetition, strange punctuation, and fake-looking patterns can be
          flagged or rejected.
        </li>
        <li>
          <strong>Role-based detection:</strong> addresses such as `info@`,
          `sales@`, and `noreply@` can be rejected unless explicitly allowed.
        </li>
        <li>
          <strong>Disposable detection:</strong> disposable providers are
          identified using `mailchecker`.
        </li>
        <li>
          <strong>Custom blocked words:</strong> user-supplied blocked terms are
          checked before DNS work happens.
        </li>
        <li>
          <strong>DNS checks:</strong> the app looks for MX records and, unless
          allowed otherwise, an A record for the domain.
        </li>
        <li>
          <strong>Optional SMTP verification:</strong> the server performs a
          live SMTP handshake only when this option is enabled.
        </li>
      </ol>

      <p>
        SMTP verification works by resolving MX hosts, connecting to port `25`,
        reading the banner, sending `EHLO` or `HELO`, sending `MAIL FROM`, and
        then probing with `RCPT TO` for the recipient address.
      </p>

      <p>The app interprets SMTP responses conservatively:</p>

      <ul>
        <li>`250` or `251` means the recipient was accepted.</li>
        <li>
          explicit mailbox failures like `5.1.1`, `user unknown`, or `no such
          mailbox` are treated as a real rejection
        </li>
        <li>
          policy and reputation failures such as `5.7.x`, Spamhaus blocks,
          greylisting, rate limits, or other anti-abuse responses are treated as
          inconclusive rather than proof that the mailbox does not exist
        </li>
      </ul>

      <p>
        That SMTP distinction is important because many mail servers block
        recipient probing on purpose. A failed SMTP probe is not automatically a
        dead mailbox.
      </p>

      <h3>Data privacy, data store, licenses and used libraries</h3>

      <p>
        The app is privacy-aware, but authenticated validation runs are stored
        so that reports can be revisited and exported later.
      </p>

      <p>What is stored locally or persistently:</p>

      <ul>
        <li>
          browser `localStorage` keeps UI preferences and recent form state
        </li>
        <li>
          SQLite stores users, validation runs, original email input for those
          runs, and per-email results
        </li>
        <li>DNS and SMTP caches stay in server memory only</li>
      </ul>

      <p>What leaves the app environment:</p>

      <ul>
        <li>DNS lookups for the domain part of email addresses</li>
        <li>
          optional SMTP traffic to recipient mail servers when SMTP checking is
          enabled
        </li>
      </ul>

      <p>
        Persistent data is stored in SQLite, usually at `data/app.sqlite3`, and
        the database is opened in WAL mode.
      </p>

      <p>
        This project is licensed under the MIT License. Key libraries used by
        the app include `React`, `Express`, `better-sqlite3`, `jsonwebtoken`,
        `mailchecker`, `p-limit`, `Chart.js`, `dotenv`, `react-router-dom`, and
        Vite-based build tooling. Most direct dependencies are MIT licensed, and
        `dotenv` is BSD-2-Clause licensed.
      </p>
    </section>
  );
}
