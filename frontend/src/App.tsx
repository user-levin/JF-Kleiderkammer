import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Suspense, lazy, useState } from 'react';
import './styles/global.css';

const DashboardPage = lazy(() => import('@pages/Dashboard'));
const ScanPage = lazy(() => import('@pages/Scan'));
const ArtikelDetailPage = lazy(() => import('@pages/ArtikelDetail'));
const KinderPage = lazy(() => import('@pages/Kinder'));
const LoginPage = lazy(() => import('@pages/Login'));
const InventarPage = lazy(() => import('@pages/Inventar'));
const BenutzerPage = lazy(() => import('@pages/Benutzer'));

function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <img src="/logo.png" alt="Jugendfeuerwehr Logo" className="brand-mark" loading="lazy" />
        </div>
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
      <main>
        <Suspense fallback={<div className="card"><p className="muted">Ansicht wird geladen ...</p></div>}>
          {children}
        </Suspense>
      </main>
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
        element={authDisabled ? (
          <Navigate to="/" replace />
        ) : (
          <Suspense fallback={<div className="card"><p className="muted">Login wird geladen ...</p></div>}>
            <LoginPage onSuccess={handleLogin} />
          </Suspense>
        )}
      />
      <Route
        path="/"
        element={renderProtectedRoute(<DashboardPage onLogout={authDisabled ? undefined : handleLogout} />)}
      />
      <Route
        path="/inventar"
        element={renderProtectedRoute(<InventarPage />)}
      />
      <Route
        path="/scan"
        element={renderProtectedRoute(<ScanPage />)}
      />
      <Route
        path="/kinder"
        element={renderProtectedRoute(<KinderPage />)}
      />
      <Route
        path="/benutzer"
        element={renderProtectedRoute(<BenutzerPage />)}
      />
      <Route
        path="/artikel/:id"
        element={renderProtectedRoute(<ArtikelDetailPage />)}
      />
    </Routes>
  );
}
