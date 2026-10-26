import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, AUTH_EXPIRED_EVENT, AuthUser } from '@api/client';
import { AuthContext, Permission } from './auth';
import './styles/global.css';

const DashboardPage = lazy(() => import('@pages/Dashboard'));
const ScanPage = lazy(() => import('@pages/Scan'));
const PublicSearchPage = lazy(() => import('@pages/PublicSearch'));
const PublicDashboardPage = lazy(() => import('@pages/PublicDashboard'));
const PublicScanPage = lazy(() => import('@pages/PublicScan'));
const ArtikelDetailPage = lazy(() => import('@pages/ArtikelDetail'));
const KinderPage = lazy(() => import('@pages/Kinder'));
const LoginPage = lazy(() => import('@pages/Login'));
const InventarPage = lazy(() => import('@pages/Inventar'));
const BenutzerPage = lazy(() => import('@pages/Benutzer'));
const ProtokollPage = lazy(() => import('@pages/Protokoll'));
const TodosPage = lazy(() => import('@pages/Todos'));
const AusgabePage = lazy(() => import('@pages/Ausgabe'));
const KontoPage = lazy(() => import('@pages/Konto'));

function AppShell({
  children,
  user,
  onLogout
}: {
  children: React.ReactNode;
  user: AuthUser;
  onLogout: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canTodos = user.permissions.includes('todos.manage');
  // Anzahl offener Todos für die Navigation; teilt sich den Cache mit der Todo-Seite
  const todosQuery = useQuery({
    queryKey: ['todos'],
    queryFn: async () => (await import('@pages/Todos')).fetchTodos(),
    enabled: canTodos,
    staleTime: 60_000
  });
  const openTodoCount = (todosQuery.data ?? []).filter((todo) => !todo.doneAt).length;

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand-lockup" onClick={() => setMenuOpen(false)}>
          <img src="/ui/logo.png" alt="Jugendfeuerwehr Logo" className="brand-mark" loading="lazy" />
        </Link>
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
          {user.permissions.includes('articles.assign') && (
            <Link to="/ausgabe" onClick={() => setMenuOpen(false)}>Ausgabe</Link>
          )}
          <Link to="/scan" onClick={() => setMenuOpen(false)}>Scannen</Link>
          <Link to="/inventar" onClick={() => setMenuOpen(false)}>Inventar</Link>

          {user.permissions.includes('children.view') && (
            <Link to="/kinder" onClick={() => setMenuOpen(false)}>Kinder</Link>
          )}
          {canTodos && (
            <Link to="/todos" onClick={() => setMenuOpen(false)}>
              Todos{openTodoCount > 0 && <span className="nav-count">{openTodoCount}</span>}
            </Link>
          )}
          {user.permissions.includes('users.manage') && (
            <Link to="/benutzer" onClick={() => setMenuOpen(false)}>Benutzer</Link>
          )}
          {user.permissions.includes('audit.view') && (
            <Link to="/protokoll" onClick={() => setMenuOpen(false)}>Protokoll</Link>
          )}
          <Link to="/konto" onClick={() => setMenuOpen(false)} title={user.email}>Konto</Link>
          <button type="button" className="ghost-button nav-logout" onClick={onLogout} title={user.email}>
            Abmelden
          </button>
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

function PublicShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/public" className="brand-lockup" onClick={() => setMenuOpen(false)}>
          <img src="/ui/logo.png" alt="Jugendfeuerwehr Logo" className="brand-mark" loading="lazy" />
        </Link>
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
          <Link to="/public" onClick={() => setMenuOpen(false)}>Dashboard</Link>
          <Link to="/public/search" onClick={() => setMenuOpen(false)}>Suche</Link>
          <Link to="/public/scan" onClick={() => setMenuOpen(false)}>Scannen</Link>
          <Link to="/login" onClick={() => setMenuOpen(false)}>Anmelden</Link>
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
  // undefined = wird noch geprüft, null = nicht angemeldet
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    api
      .get<{ data: AuthUser | null }>('/api/auth/me')
      .then((res) => setUser(res.data.data))
      .catch(() => setUser(null));
  }, []);

  // Session abgelaufen oder serverseitig beendet: zurück zum Login
  useEffect(() => {
    const handleExpired = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, []);

  const handleLogin = (loggedIn: AuthUser) => {
    setUser(loggedIn);
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from !== '/login' ? from : '/', { replace: true });
  };

  const handleLogout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
      queryClient.clear();
      navigate('/login', { replace: true });
    }
  }, [navigate, queryClient]);

  const renderProtectedRoute = (component: React.ReactNode, permission?: Permission) => {
    if (user === undefined) {
      return <div className="auth"><p className="muted">Anmeldung wird geprüft ...</p></div>;
    }
    if (user === null) {
      return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }
    if (permission && !user.permissions.includes(permission)) {
      return <Navigate to="/" replace />;
    }
    return (
      <AuthContext.Provider value={user}>
        <AppShell user={user} onLogout={handleLogout}>{component}</AppShell>
      </AuthContext.Provider>
    );
  };

  const renderPublicRoute = (component: React.ReactNode) => (
    <PublicShell>{component}</PublicShell>
  );

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? (
          <Navigate to="/" replace />
        ) : (
          <Suspense fallback={<div className="card"><p className="muted">Login wird geladen ...</p></div>}>
            <LoginPage onSuccess={handleLogin} />
          </Suspense>
        )}
      />
      <Route
        path="/public"
        element={renderPublicRoute(<PublicDashboardPage />)}
      />
      <Route
        path="/public/search"
        element={renderPublicRoute(<PublicSearchPage />)}
      />
      <Route
        path="/public/scan"
        element={renderPublicRoute(<PublicScanPage />)}
      />
      <Route
        path="/"
        element={renderProtectedRoute(<DashboardPage />)}
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
        element={renderProtectedRoute(<KinderPage />, 'children.view')}
      />
      <Route
        path="/benutzer"
        element={renderProtectedRoute(<BenutzerPage />, 'users.manage')}
      />
      <Route
        path="/konto"
        element={renderProtectedRoute(<KontoPage />)}
      />
      <Route
        path="/ausgabe"
        element={renderProtectedRoute(<AusgabePage />, 'articles.assign')}
      />
      <Route
        path="/todos"
        element={renderProtectedRoute(<TodosPage />, 'todos.manage')}
      />
      <Route
        path="/protokoll"
        element={renderProtectedRoute(<ProtokollPage />, 'audit.view')}
      />
      <Route
        path="/artikel/:id"
        element={renderProtectedRoute(<ArtikelDetailPage />)}
      />
    </Routes>
  );
}
