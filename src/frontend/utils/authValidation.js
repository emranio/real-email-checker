const usernamePattern = /^[a-zA-Z0-9_]{3,32}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUsername(username) {
  const v = String(username || "").trim();
  if (!v) return "Username is required.";
  if (!usernamePattern.test(v))
    return "Username must be 3-32 chars and only include letters, numbers, or underscore.";
  return null;
}

export function validateEmail(email) {
  const v = String(email || "")
    .trim()
    .toLowerCase();
  if (!v) return "Email is required.";
  if (!emailPattern.test(v)) return "Please enter a valid email address.";
  if (v.length > 120) return "Email is too long.";
  return null;
}

export function validatePassword(password, { allowEmpty = false } = {}) {
  const v = String(password || "");
  if (!v && allowEmpty) return null;
  if (!v) return "Password is required.";
  if (v.length < 5) return "Password must be at least 5 characters.";
  if (v.length > 128) return "Password is too long.";
  return null;
}
