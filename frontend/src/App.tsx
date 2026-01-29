import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { QueryClient } from '@tanstack/react-query';
import Dashboard from '@pages/Dashboard';
import Scan from '@pages/Scan';
import ArtikelDetail from '@pages/ArtikelDetail';
import Login from '@pages/Login';
import './styles/app.css';

const client = new QueryClient();

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Digitale Kleiderkammer</h1>
        <nav>
          <Link to="/">Dashboard</Link>
          <Link to="/scan">Scannen</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const navigate = useNavigate();

  const handleLogin = (t: string) => {
    localStorage.setItem('token', t);
    setToken(t);
    navigate('/');
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    navigate('/login');
  };

  return (
    <Routes>
      <Route
        path="/login"
        element={<Login onSuccess={handleLogin} />}
      />
      <Route
        path="/"
        element={
          token ? (
            <AppShell>
              <Dashboard onLogout={handleLogout} />
            </AppShell>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/scan"
        element={
          token ? (
            <AppShell>
              <Scan />
            </AppShell>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/artikel/:id"
        element={
          token ? (
            <AppShell>
              <ArtikelDetail />
            </AppShell>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
}
