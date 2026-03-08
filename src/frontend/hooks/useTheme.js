import { useCallback, useEffect, useState } from "react";

export function useTheme() {
  const [theme, setThemeState] = useState(
    () => localStorage.getItem("theme") || "light",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const setTheme = useCallback((t) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === "dark" ? "light" : "dark")),
    [],
  );
  const isDark = theme === "dark";

  return { theme, isDark, setTheme, toggleTheme };
}
