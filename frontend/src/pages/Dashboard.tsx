import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { api } from '@api/client';

type Article = {
  id: string;
  category: string;
  label: string;
  size: string | null;
  notes: string | null;
  status: 'frei' | 'ausgegeben' | 'warnung';
  location: {
    type: 'kind' | 'lager';
    name: string;
    kindId: number | null;
  };
  assignedAt: string;
  expiryDate: string | null;
  helmetNextCheck: string | null;
  helmetLastCheck: string | null;
  helmetManufacturedAt: string | null;
  warning: null | { type: 'pruefung' | 'ablauf'; date: string; windowDays: number };
};

type TypeSizeRow = {
  key: string;
  category: string;
  sizeLabel: string;
  total: number;
  children: number;
  storage: number;
  childRatio: number;
  storageRatio: number;
};

type HelmetAlert = {
  article: Article;
  reason: string;
  severity: 'warning' | 'critical';
};

type SystemHealth = {
  app: string;
  status: 'ok' | 'error';
  db: 'ok' | 'down';
  message?: string;
  detail?: string;
  timestamp: string;
};

const WARNING_DAYS = 30;
const dateFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const timestampFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const HEALTH_CHECK_INTERVAL = 60_000;

type DashboardProps = {
  onLogout?: () => void;
};

export default function Dashboard({ onLogout }: DashboardProps) {
  const queryClient = useQueryClient();
  const {
    data: systemHealth,
    isFetching: isCheckingHealth,
    refetch: refetchSystemHealth
  } = useQuery<SystemHealth>({
    queryKey: ['system-health'],
    queryFn: async () => {
      try {
        const response = await api.get<SystemHealth>('/health.php', { headers: { Accept: 'application/json' } });
        return response.data;
      } catch (err) {
        if (isAxiosError(err) && err.response?.data) {
          return err.response.data as SystemHealth;
        }
        throw err;
      }
    },
    refetchInterval: HEALTH_CHECK_INTERVAL,
    retry: 1
  });

  const { data, isLoading, isFetching, error, refetch } = useQuery<Article[]>({
    queryKey: ['articles'],
    queryFn: async () => {
      const res = await api.get<{ data: Article[] }>('/api/articles');
      return res.data.data;
    }
  });

  const articles = data ?? [];

  const helmetAlerts = useMemo<HelmetAlert[]>(() => {
    const today = new Date();
    const warningWindow = new Date(today.getTime() + WARNING_DAYS * 24 * 60 * 60 * 1000);

    return articles
      .filter((article) => article.category?.toLowerCase() === 'helm')
      .map<HelmetAlert | null>((article) => {
        const nextCheckDate = parseDate(article.helmetNextCheck);
        const expiryDate = parseDate(article.expiryDate);
        let severity: HelmetAlert['severity'] = 'warning';
        let reason: string | null = null;

        if (!nextCheckDate) {
          reason = 'Keine Prüfung dokumentiert';
        } else if (nextCheckDate <= today) {
          reason = `Prüfung überfällig (${formatDate(article.helmetNextCheck)})`;
          severity = 'critical';
        } else if (nextCheckDate <= warningWindow) {
          reason = `Prüfung fällig bis ${formatDate(article.helmetNextCheck)}`;
        }

        if (expiryDate) {
          if (expiryDate <= today) {
            reason = `Ablaufdatum überschritten (${formatDate(article.expiryDate)})`;
            severity = 'critical';
          } else if (expiryDate <= warningWindow) {
            reason = `Läuft ab bis ${formatDate(article.expiryDate)}`;
          }
        }

        if (!reason) {
          return null;
        }

        return { article, reason, severity };
      })
      .filter((alert): alert is HelmetAlert => Boolean(alert));
  }, [articles]);

  const typeSizeMatrix = useMemo<TypeSizeRow[]>(() => {
    const map = new Map<string, TypeSizeRow>();

    for (const article of articles) {
      const category = article.category || 'Unbekannt';
      const sizeLabel = article.size || 'One Size';
      const key = `${category.toLowerCase()}__${sizeLabel.toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          category,
          sizeLabel,
          total: 0,
          children: 0,
          storage: 0,
          childRatio: 0,
          storageRatio: 0
        });
      }

      const current = map.get(key)!;
      current.total += 1;
      if (article.location.type === 'kind') {
        current.children += 1;
      } else {
        current.storage += 1;
      }
      current.childRatio = current.total ? current.children / current.total : 0;
      current.storageRatio = current.total ? current.storage / current.total : 0;
    }

    return Array.from(map.values()).sort((a, b) => {
      return a.category.localeCompare(b.category, 'de-DE') || a.sizeLabel.localeCompare(b.sizeLabel, 'de-DE');
    });
  }, [articles]);

  const shortageItems = useMemo(() => {
    return typeSizeMatrix
      .map((row) => ({
        ...row,
        demandScore: row.childRatio,
        shortageLevel: row.storage <= 1 ? 'kritisch' : row.storage <= 3 ? 'niedrig' : 'stabil'
      }))
      .filter((row) => row.demandScore >= 0.6 && row.storage <= 3)
      .sort((a, b) => b.demandScore - a.demandScore)
      .slice(0, 6);
  }, [typeSizeMatrix]);

  const stats = useMemo(() => {
    const total = articles.length;
    const children = articles.filter((article) => article.location.type === 'kind').length;
    const storage = total - children;

    return {
      total,
      children,
      storage,
      helmetsDue: helmetAlerts.length
    };
  }, [articles, helmetAlerts.length]);

  const helmetCheckMutation = useMutation({
    mutationFn: async (articleId: string) => {
      await api.post(`/api/articles/${articleId}/helmet-check`, { date: new Date().toISOString().slice(0, 10) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['articles'] })
  });

  const retireArticleMutation = useMutation({
    mutationFn: async (articleId: string) => {
      await api.delete(`/api/articles/${articleId}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['articles'] })
  });

  const handleHelmetCheck = (articleId: string) => {
    helmetCheckMutation.mutate(articleId);
  };

  const handleRetireArticle = (articleId: string) => {
    if (!window.confirm('Artikel wirklich aussondern? Dies entfernt ihn dauerhaft.')) {
      return;
    }
    retireArticleMutation.mutate(articleId);
  };

  const dbUnavailable = systemHealth?.db === 'down';
  const lastHealthCheck = dbUnavailable && systemHealth?.timestamp ? formatDateTime(systemHealth.timestamp) : null;

  return (
    <div className="dashboard-grid">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Dashboard</h2>
            <p className="muted">Live-Daten aus der Kleiderkammer</p>
          </div>
          <div className="card-actions">
            <button className="ghost-button" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Aktualisiere...' : 'Aktualisieren'}
            </button>
            {onLogout && <button onClick={onLogout}>Logout</button>}
          </div>
        </div>
        {dbUnavailable && (
          <div className="debug-banner" role="status">
            <div>
              <strong>Datenbankverbindung fehlgeschlagen</strong>
              <p className="muted">{systemHealth?.message ?? 'Keine Verbindung zur Datenbank möglich.'}</p>
              {lastHealthCheck && <p className="muted">Letzter Prüfversuch: {lastHealthCheck}</p>}
            </div>
            <button className="ghost-button" onClick={() => refetchSystemHealth()} disabled={isCheckingHealth}>
              {isCheckingHealth ? 'Prüfe...' : 'Erneut prüfen'}
            </button>
          </div>
        )}
        {error && <p className="error">{error instanceof Error ? error.message : 'Fehler beim Laden.'}</p>}
        {isLoading ? (
          <p className="muted">Bestandsdaten werden geladen ...</p>
        ) : (
          <div className="stat-grid">
            <article className="stat-card">
              <p className="stat-label">Artikel insgesamt</p>
              <p className="stat-value">{stats.total}</p>
            </article>
            <article className="stat-card">
              <p className="stat-label">Bei Kindern</p>
              <p className="stat-value">{stats.children}</p>
              <span className="muted">{percentage(stats.children, stats.total)} ausgeliehen</span>
            </article>
            <article className="stat-card">
              <p className="stat-label">Im Lager</p>
              <p className="stat-value">{stats.storage}</p>
              <span className="muted">{percentage(stats.storage, stats.total)} Reserve</span>
            </article>
            <article className="stat-card">
              <p className="stat-label">Helme mit Aktion</p>
              <p className="stat-value warning">{stats.helmetsDue}</p>
              <span className="muted">Prüfung oder Ablauf innerhalb 30 Tage</span>
            </article>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>Bestandsverteilung</h3>
            <p className="muted">Artikeltyp x Größe · Kinder vs Lager</p>
          </div>
        </div>
        {typeSizeMatrix.length === 0 ? (
          <p className="muted">Noch keine Artikel vorhanden.</p>
        ) : (
          <div className="distribution-table-wrapper">
            <table className="distribution-table">
              <thead>
                <tr>
                  <th>Typ</th>
                  <th>Größe</th>
                  <th>Bei Kindern</th>
                  <th>Im Lager</th>
                  <th>Gesamt</th>
                </tr>
              </thead>
              <tbody>
                {typeSizeMatrix.map((row) => (
                  <tr key={row.key}>
                    <td>{row.category}</td>
                    <td>{row.sizeLabel}</td>
                    <td>
                      <span>{row.children}</span>
                      <div className="distribution-bar" aria-label={`Bei Kindern: ${row.children}`}>
                        <div className="bar bar-children" style={{ width: `${row.childRatio * 100}%` }} />
                      </div>
                    </td>
                    <td>
                      <span>{row.storage}</span>
                      <div className="distribution-bar" aria-label={`Im Lager: ${row.storage}`}>
                        <div className="bar bar-storage" style={{ width: `${row.storageRatio * 100}%` }} />
                      </div>
                    </td>
                    <td>{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>Engpass-Radar</h3>
            <p className="muted">Welche Größen sind stark gefragt und kaum verfügbar?</p>
          </div>
        </div>
        {shortageItems.length === 0 ? (
          <p className="muted">Aktuell keine Engpässe erkannt. Weiter so!</p>
        ) : (
          <div className="demand-grid">
            {shortageItems.map((item) => (
              <article key={item.key} className="demand-card">
                <header>
                  <strong>{item.category}</strong>
                  <span>Größe {item.sizeLabel}</span>
                </header>
                <p className="demand-score">{Math.round(item.demandScore * 100)}% ausgeliehen</p>
                <p className="muted">Nur {item.storage} im Lager · {item.children} bei Kindern</p>
                <span className={`badge ${item.shortageLevel === 'kritisch' ? 'badge-critical' : 'badge-warning'}`}>
                  {item.shortageLevel === 'kritisch' ? 'Kritisch' : 'Niedrige Reserve'}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h3>Helm-Prüfungen & Ablauf</h3>
            <p className="muted">Alerts für Prüfzyklen (+2 Jahre) oder Ablaufdatum</p>
          </div>
          <span className={`badge ${helmetAlerts.length ? 'badge-warning' : ''}`}>{helmetAlerts.length}</span>
        </div>
        {helmetAlerts.length === 0 ? (
          <p className="muted">Alle Helme sind aktuell innerhalb des Prüfzeitraums.</p>
        ) : (
          <div className="helmet-alert-grid">
            {helmetAlerts.map((alert) => (
              <article
                key={alert.article.id}
                className={`helmet-alert-card ${alert.severity === 'critical' ? 'critical' : 'warning'}`}
              >
                <div className="helmet-alert-header">
                  <span className="helmet-article-id">#{alert.article.id}</span>
                  <span className={`tag ${alert.article.location.type === 'kind' ? 'tag-kind' : 'tag-lager'}`}>
                    {alert.article.location.type === 'kind' ? alert.article.location.name : 'Lager'}
                  </span>
                </div>
                <p>{alert.reason}</p>
                <ul className="helmet-meta">
                  <li>Artikel: {alert.article.label}</li>
                  <li>Größe: {alert.article.size ?? 'One Size'}</li>
                  <li>Letzte Prüfung: {formatDate(alert.article.helmetLastCheck)}</li>
                  <li>Nächste Prüfung: {formatDate(alert.article.helmetNextCheck)}</li>
                  <li>Ablaufdatum: {formatDate(alert.article.expiryDate)}</li>
                </ul>
                <div className="helmet-actions">
                  <button onClick={() => handleHelmetCheck(alert.article.id)} disabled={helmetCheckMutation.isLoading}>
                    Prüfung abschließen
                  </button>
                  <button
                    className="ghost-button danger"
                    onClick={() => handleRetireArticle(alert.article.id)}
                    disabled={retireArticleMutation.isLoading}
                  >
                    Aussondern
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {(helmetCheckMutation.isError || retireArticleMutation.isError) && (
          <p className="error">
            Aktion fehlgeschlagen: {mutationErrorMessage(helmetCheckMutation.error ?? retireArticleMutation.error)}
          </p>
        )}
      </section>
    </div>
  );
}

function parseDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function formatDate(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = parseDate(value);
  if (!parsed) {
    return value;
  }
  return dateFormatter.format(parsed);
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = parseDate(value);
  if (!parsed) {
    return value;
  }
  return timestampFormatter.format(parsed);
}

function percentage(value: number, total: number): string {
  if (total === 0) {
    return '0%';
  }
  return `${Math.round((value / total) * 100)}%`;
}

function mutationErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Bitte erneut versuchen.';
}
