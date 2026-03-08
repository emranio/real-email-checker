const AUTH_API_BASE = "/api/auth";
const AUTH_STORAGE_KEY = "SMTPEmailValidatorAuthTokenV1";

export function getToken() {
  return localStorage.getItem(AUTH_STORAGE_KEY);
}

export function setToken(token) {
  localStorage.setItem(AUTH_STORAGE_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export async function authConfigRequest() {
  const response = await fetch(`${AUTH_API_BASE}/config`);
  return response.json();
}

export async function authRequest(path, options = {}, requireAuth = false) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (requireAuth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${AUTH_API_BASE}${path}`, {
    ...options,
    headers,
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}
