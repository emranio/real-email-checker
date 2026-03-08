import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext.jsx";
import Layout from "./components/Layout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import SignUpPage from "./pages/SignUpPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import HowItWorksPage from "./pages/HowItWorksPage.jsx";
import ValidatePage from "./pages/ValidatePage.jsx";
import ReportsListPage from "./pages/ReportsListPage.jsx";
import ReportDetailPage from "./pages/ReportDetailPage.jsx";

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) return null;

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Public routes */}
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route
          path="/signin"
          element={user ? <Navigate to="/validate" replace /> : <SignInPage />}
        />
        <Route
          path="/signup"
          element={user ? <Navigate to="/validate" replace /> : <SignUpPage />}
        />

        {/* Protected routes */}
        <Route
          path="/validate"
          element={
            <ProtectedRoute>
              <ValidatePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <ReportsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/:runId"
          element={
            <ProtectedRoute>
              <ReportDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />

        {/* Default redirect */}
        <Route
          path="*"
          element={<Navigate to={user ? "/validate" : "/signin"} replace />}
        />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </HashRouter>
  );
}
