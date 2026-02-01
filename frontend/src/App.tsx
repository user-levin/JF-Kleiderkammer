import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import Dashboard from '@pages/Dashboard';
import Scan from '@pages/Scan';
import ArtikelDetail from '@pages/ArtikelDetail';
import Kinder from '@pages/Kinder';
import Login from '@pages/Login';
import Inventar from '@pages/Inventar';
import Benutzer from '@pages/Benutzer';
import './styles/global.css';

function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Digitale Kleiderkammer</h1>
        <button
          type="button"
          className="hamburger-button"
          onClick={() => setMenuOpen((state) => !state)}
          aria-label={menuOpen ? 'Menü schließen' : 'Menü öffnen'}
        >
          <span />
          <span />
          <span />
        </button>
        <nav className={menuOpen ? 'is-open' : ''}>
          <Link to="/" onClick={() => setMenuOpen(false)}>Dashboard</Link>
          <Link to="/scan" onClick={() => setMenuOpen(false)}>Scannen</Link>
          <Link to="/inventar" onClick={() => setMenuOpen(false)}>Inventar</Link>

          <Link to="/kinder" onClick={() => setMenuOpen(false)}>Kinder</Link>
          <Link to="/benutzer" onClick={() => setMenuOpen(false)}>Benutzer</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

export default function App() {
  const authDisabled = (import.meta.env.VITE_AUTH_DISABLED ?? 'true') === 'true';
  const [token, setToken] = useState<string | null>(authDisabled ? 'dev-token' : localStorage.getItem('token'));
  const navigate = useNavigate();
  const isAuthenticated = authDisabled || Boolean(token);

  const handleLogin = (t: string) => {
    if (authDisabled) {
      navigate('/');
      return;
    }
    localStorage.setItem('token', t);
    setToken(t);
    navigate('/');
  };

  const handleLogout = () => {
    if (authDisabled) {
      navigate('/');
      return;
    }
    localStorage.removeItem('token');
    setToken(null);
    navigate('/login');
  };

  const renderProtectedRoute = (component: React.ReactNode) => (
    isAuthenticated ? <AppShell>{component}</AppShell> : <Navigate to="/login" replace />
  );

  return (
    <Routes>
      <Route
        path="/login"
        element={authDisabled ? <Navigate to="/" replace /> : <Login onSuccess={handleLogin} />}
      />
      <Route
        path="/"
        element={renderProtectedRoute(<Dashboard onLogout={authDisabled ? undefined : handleLogout} />)}
      />
      <Route
        path="/inventar"
        element={renderProtectedRoute(<Inventar />)}
      />
      <Route
        path="/scan"
        element={renderProtectedRoute(<Scan />)}
      />
      <Route
        path="/kinder"
        element={renderProtectedRoute(<Kinder />)}
      />
      <Route
        path="/benutzer"
        element={renderProtectedRoute(<Benutzer />)}
      />
      <Route
        path="/artikel/:id"
        element={renderProtectedRoute(<ArtikelDetail />)}
      />
    </Routes>
  );
}
