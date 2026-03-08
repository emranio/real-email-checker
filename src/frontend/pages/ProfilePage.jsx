import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import {
  validateUsername,
  validateEmail,
  validatePassword,
} from "../utils/authValidation.js";

export default function ProfilePage() {
  const { user, updateProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (user) {
      setUsername(user.username || "");
      setEmail(user.email || "");
    }
  }, [user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);

    const err =
      validateUsername(username) ||
      validateEmail(email) ||
      validatePassword(password, { allowEmpty: true });
    if (err) {
      setMessage({ text: err, type: "error" });
      return;
    }

    try {
      await updateProfile(
        username.trim(),
        email.trim().toLowerCase(),
        password,
      );
      setPassword("");
      setMessage({ text: "Profile updated successfully.", type: "ok" });
    } catch (err) {
      setMessage({
        text: err.message || "Unable to update profile.",
        type: "error",
      });
    }
  };

  const handleSignOut = () => {
    signOut();
    navigate("/signin");
  };

  return (
    <section className="auth-section">
      <h2>Account Access</h2>
      <p className="auth-status">Signed in as {user?.username || "user"}</p>

      <form className="auth-form" autoComplete="on" onSubmit={handleSubmit}>
        <label htmlFor="profileUsername">Username</label>
        <input
          id="profileUsername"
          name="username"
          type="text"
          required
          pattern="[a-zA-Z0-9_]{3,32}"
          maxLength={32}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <label htmlFor="profileEmail">Email</label>
        <input
          id="profileEmail"
          name="email"
          type="email"
          required
          maxLength={120}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="profilePassword">New password (optional)</label>
        <input
          id="profilePassword"
          name="new-password"
          type="password"
          minLength={5}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className="auth-profile-actions">
          <button type="submit" className="process-btn auth-submit-btn">
            Save profile
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={handleSignOut}
          >
            Sign out
          </button>
        </div>
        {message && (
          <p className={`auth-message ${message.type}`}>{message.text}</p>
        )}
      </form>
    </section>
  );
}
