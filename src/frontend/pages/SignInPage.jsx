import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";

export default function SignInPage() {
  const { signIn, signupEnabled, demoCredentials } = useAuth();
  const navigate = useNavigate();
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (!usernameOrEmail.trim() || !password) {
      setMessage({
        text: "Username/email and password are required.",
        type: "error",
      });
      return;
    }

    try {
      await signIn(usernameOrEmail.trim(), password);
      navigate("/validate", { replace: true });
    } catch (err) {
      setMessage({ text: err.message || "Unable to sign in.", type: "error" });
    }
  };

  return (
    <section className="auth-section">
      <h2>Account Access</h2>
      <p className="auth-subtitle">
        Sign in to use the email checker. Profile updates are protected by JWT.
      </p>
      {demoCredentials && (
        <p className="demo-credentials">
          Demo user: {demoCredentials.username} / {demoCredentials.password}
        </p>
      )}
      <p className="auth-status">Not signed in</p>

      <form className="auth-form" autoComplete="on" onSubmit={handleSubmit}>
        <label htmlFor="signInUsernameOrEmail">Username or email</label>
        <input
          id="signInUsernameOrEmail"
          name="username"
          type="text"
          required
          maxLength={120}
          value={usernameOrEmail}
          onChange={(e) => setUsernameOrEmail(e.target.value)}
        />

        <label htmlFor="signInPassword">Password</label>
        <input
          id="signInPassword"
          name="current-password"
          type="password"
          required
          minLength={5}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button type="submit" className="process-btn auth-submit-btn">
          Sign in
        </button>
        {message && (
          <p className={`auth-message ${message.type}`}>{message.text}</p>
        )}
        {!signupEnabled && (
          <p className="auth-hint">
            Sign up is disabled by server configuration. Please sign in.
          </p>
        )}
      </form>
    </section>
  );
}
