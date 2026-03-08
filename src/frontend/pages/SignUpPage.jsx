import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import {
  validateUsername,
  validateEmail,
  validatePassword,
} from "../utils/authValidation.js";

export default function SignUpPage() {
  const { signUp, signupEnabled } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(null);

  if (!signupEnabled) {
    return <Navigate to="/signin" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);

    const err =
      validateUsername(username) ||
      validateEmail(email) ||
      validatePassword(password);
    if (err) {
      setMessage({ text: err, type: "error" });
      return;
    }

    try {
      await signUp(username.trim(), email.trim().toLowerCase(), password);
      navigate("/validate", { replace: true });
    } catch (err) {
      setMessage({ text: err.message || "Unable to sign up.", type: "error" });
    }
  };

  return (
    <section className="auth-section">
      <h2>Create Account</h2>
      <form className="auth-form" autoComplete="on" onSubmit={handleSubmit}>
        <label htmlFor="signUpUsername">Username</label>
        <input
          id="signUpUsername"
          name="username"
          type="text"
          required
          pattern="[a-zA-Z0-9_]{3,32}"
          maxLength={32}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <label htmlFor="signUpEmail">Email</label>
        <input
          id="signUpEmail"
          name="email"
          type="email"
          required
          maxLength={120}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="signUpPassword">Password</label>
        <input
          id="signUpPassword"
          name="new-password"
          type="password"
          required
          minLength={5}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button type="submit" className="process-btn auth-submit-btn">
          Create account
        </button>
        {message && (
          <p className={`auth-message ${message.type}`}>{message.text}</p>
        )}
      </form>
    </section>
  );
}
