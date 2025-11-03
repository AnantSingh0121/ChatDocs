import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import "@/App.css";
import { isTokenExpired } from "./lib/auth";
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`.replace(/\/+$/, "");
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const checkAuth = async () => {
    const token = localStorage.getItem("token");
    if (!token || isTokenExpired(token)) {
      localStorage.removeItem("token");
      setIsAuthenticated(false);
      setLoading(false);
      return;
    }

    try {
      await axios.get(`${API}/auth/me`);
      setIsAuthenticated(true);
    } catch (error) {
      localStorage.removeItem("token");
      setIsAuthenticated(false);
    }
    setLoading(false);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token && !isTokenExpired(token)) {
      const [, payloadBase64] = token.split(".");
      const { exp } = JSON.parse(atob(payloadBase64));
      const timeout = exp * 1000 - Date.now();

      const logoutTimer = setTimeout(() => {
        localStorage.removeItem("token");
        setIsAuthenticated(false);
        window.location.href = "/login";
      }, timeout);

      return () => clearTimeout(logoutTimer);
    }
  }, [isAuthenticated]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          {/* Login Page */}
          <Route
            path="/login"
            element={
              isAuthenticated ? (
                <Navigate to="/" />
              ) : (
                <LoginPage onLogin={() => setIsAuthenticated(true)} />
              )
            }
          />

          {/* Dashboard (protected) */}
          <Route
            path="/"
            element={
              isAuthenticated ? (
                <Dashboard onLogout={() => {
                  localStorage.removeItem("token");
                  setIsAuthenticated(false);
                }} />
              ) : (
                <Navigate to="/login" />
              )
            }
          />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
