import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  getToken,
  setToken as saveToken,
  clearToken,
  authRequest,
  authConfigRequest,
} from "./authApi.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signupEnabled, setSignupEnabled] = useState(true);
  const [demoCredentials, setDemoCredentials] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await authConfigRequest();
        setSignupEnabled(Boolean(data?.signupEnabled));
        if (data?.demoUser?.username && data?.demoUser?.password) {
          setDemoCredentials(data.demoUser);
        }
      } catch {
        setSignupEnabled(false);
      }

      const token = getToken();
      if (token) {
        try {
          const { response, payload } = await authRequest(
            "/profile",
            { method: "GET" },
            true,
          );
          if (response.ok && payload?.user) {
            setUser(payload.user);
          } else {
            clearToken();
          }
        } catch {
          clearToken();
        }
      }

      setLoading(false);
    })();
  }, []);

  const signIn = useCallback(async (usernameOrEmail, password) => {
    const { response, payload } = await authRequest("/signin", {
      method: "POST",
      body: JSON.stringify({ usernameOrEmail, password }),
    });

    if (!response.ok || !payload?.token || !payload?.user) {
      throw new Error("Invalid credentials.");
    }

    saveToken(payload.token);
    setUser(payload.user);
    return payload.user;
  }, []);

  const signUp = useCallback(async (username, email, password) => {
    const { response, payload } = await authRequest("/signup", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    });

    if (!response.ok || !payload?.token || !payload?.user) {
      const message =
        payload?.error === "username_or_email_already_exists"
          ? "Username or email already exists."
          : "Unable to sign up. Please review your input.";
      throw new Error(message);
    }

    saveToken(payload.token);
    setUser(payload.user);
    return payload.user;
  }, []);

  const updateProfile = useCallback(async (username, email, password) => {
    const { response, payload } = await authRequest(
      "/profile",
      {
        method: "PUT",
        body: JSON.stringify({ username, email, password }),
      },
      true,
    );

    if (!response.ok || !payload?.token || !payload?.user) {
      const message =
        payload?.error === "username_or_email_already_exists"
          ? "Username or email already exists."
          : "Unable to update profile.";
      throw new Error(message);
    }

    saveToken(payload.token);
    setUser(payload.user);
    return payload.user;
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const value = {
    user,
    loading,
    signupEnabled,
    demoCredentials,
    signIn,
    signUp,
    updateProfile,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
