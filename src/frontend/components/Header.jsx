import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { useTheme } from "../hooks/useTheme.js";

export default function Header() {
  const { user, signOut, signupEnabled } = useAuth();
  const { isDark, setTheme } = useTheme();
  const navigate = useNavigate();

  const handleSignOut = (e) => {
    e.preventDefault();
    signOut();
    navigate("/signin");
  };

  return (
    <header>
      <div className="header-content">
        <div className="header-left">
          <h1 className="logo">SMTP Email Validator</h1>
          <nav className="header-nav" aria-label="Primary navigation">
            {user ? (
              <>
                <NavLink
                  to="/validate"
                  className={({ isActive }) =>
                    `secondary-btn header-nav-btn${isActive ? " active" : ""}`
                  }
                >
                  Validate emails
                </NavLink>
                <NavLink
                  to="/reports"
                  className={({ isActive }) =>
                    `secondary-btn header-nav-btn${isActive ? " active" : ""}`
                  }
                >
                  Reports
                </NavLink>
                <NavLink
                  to="/profile"
                  className={({ isActive }) =>
                    `secondary-btn header-nav-btn${isActive ? " active" : ""}`
                  }
                >
                  Profile
                </NavLink>
              </>
            ) : (
              <div className="header-nav">
                <NavLink
                  to="/signin"
                  className={({ isActive }) =>
                    `secondary-btn header-nav-btn${isActive ? " active" : ""}`
                  }
                >
                  Sign in
                </NavLink>
                {signupEnabled && (
                  <NavLink
                    to="/signup"
                    className={({ isActive }) =>
                      `secondary-btn header-nav-btn${isActive ? " active" : ""}`
                    }
                  >
                    Sign up
                  </NavLink>
                )}
              </div>
            )}
          </nav>
        </div>
        <div className="right-side">
          <NavLink className="header-nav-link" to="/how-it-works">
            How it works
          </NavLink>
          {user && (
            <a className="header-nav-link" href="#" onClick={handleSignOut}>
              Sign Out
            </a>
          )}
          <div className="theme-toggle">
            <img
              src="images/toggle_sun.png"
              alt="Switch to Light Mode"
              className="theme-icon sun-icon"
              onClick={() => setTheme("light")}
            />
            <img
              src="images/toggle_moon.png"
              alt="Switch to Dark Mode"
              className="theme-icon moon-icon"
              onClick={() => setTheme("dark")}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
