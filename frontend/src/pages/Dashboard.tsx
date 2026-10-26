import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { CATEGORY_PRESETS } from '../constants/articlePresets';
import { useAuth } from '../auth';
import { exportInventoryCsv } from '../utils/inventoryExport';

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

type CategoryStat = {
  category: string;
  total: number;
  children: number;
  storage: number;
  childArticles: Article[];
  storageArticles: Article[];
};

type HelmetAlert = {
  article: Article;
  reason: string;
  severity: 'warning' | 'critical';
};

const WARNING_DAYS = 30;
const dateFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
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

  // Aggregiere nach Kategorien (nicht nach Größe)
  const categoryStats = useMemo(() => {
    const map = new Map<string, CategoryStat>();
    const presetLabels = CATEGORY_PRESETS.map((preset) => preset.label);
    const emptyStat = (category: string): CategoryStat => ({
      category,
      total: 0,
      children: 0,
      storage: 0,
      childArticles: [],
      storageArticles: []
    });

    for (const label of presetLabels) {
      map.set(label, emptyStat(label));
    }

    for (const article of articles) {
      const category = article.category || 'Unbekannt';
      if (!map.has(category)) {
        map.set(category, emptyStat(category));
      }
      const current = map.get(category)!;
      current.total += 1;
      if (article.location.type === 'kind') {
        current.children += 1;
        current.childArticles.push(article);
      } else {
        current.storage += 1;
        current.storageArticles.push(article);
      }
    }

    for (const stat of map.values()) {
      stat.childArticles.sort(compareArticleIds);
      stat.storageArticles.sort(compareArticleIds);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.category.localeCompare(b.category, 'de-DE')
    );
  }, [articles]);

  const handleExportCsv = () => {
    exportInventoryCsv(articles);
  };

  const shortageItems = useMemo(() => {
    return categoryStats
      .map((cat) => ({
        ...cat,
        demandScore: cat.total ? cat.children / cat.total : 0,
        shortageLevel: cat.storage <= 1 ? 'kritisch' : cat.storage <= 3 ? 'niedrig' : 'stabil'
      }))
      .filter((cat) => cat.demandScore >= 0.6 && cat.storage <= 3)
      .sort((a, b) => b.demandScore - a.demandScore)
      .slice(0, 6);
  }, [categoryStats]);

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
          </div>
        </div>
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
            <p className="muted">Horizontaler Vergleich nach Kategorie (Lager vs. Kinder)</p>
          </div>
          {can('inventory.export') && (
            <div className="card-actions">
              <button className="ghost-button" onClick={handleExportCsv} disabled={articles.length === 0}>
                Export CSV
              </button>
            </div>
          )}
        </div>
        {categoryStats.length === 0 ? (
          <p className="muted">Noch keine Artikel vorhanden.</p>
        ) : (
          <div className="inventory-pie-grid">
            {categoryStats.map((cat) => {
              const total = cat.total || 0;
              const radius = 36;
              const circumference = 2 * Math.PI * radius;
              const childrenLength = total ? (cat.children / total) * circumference : 0;
              const storageLength = total ? (cat.storage / total) * circumference : 0;

              return (
                <article key={cat.category} className="inventory-pie-card">
                  <div className="inventory-pie-header">
                    <span>{cat.category}</span>
                    <span className="muted">{cat.total}</span>
                  </div>
                  <div
                    className="inventory-pie-wrapper"
                    title={`${cat.category}: ${cat.total} Artikel (${cat.children} bei Kindern, ${cat.storage} Lager)`}
                  >
                    <svg className="inventory-pie" viewBox="0 0 100 100" role="img">
                      <circle className="inventory-pie-ring" cx="50" cy="50" r={radius} />
                      {total > 0 && (
                        <>
                          <circle
                            className="inventory-pie-segment inventory-pie-children"
                            cx="50"
                            cy="50"
                            r={radius}
                            strokeDasharray={`${childrenLength} ${circumference - childrenLength}`}
                            strokeDashoffset="0"
                          />
                          <circle
                            className="inventory-pie-segment inventory-pie-storage"
                            cx="50"
                            cy="50"
                            r={radius}
                            strokeDasharray={`${storageLength} ${circumference - storageLength}`}
                            strokeDashoffset={-childrenLength}
                          />
                        </>
                      )}
                      <text className="inventory-pie-total" x="50" y="50">
                        {total}
                      </text>
                    </svg>
                  </div>
                  <div className="inventory-pie-legend">
                    <span className="legend-item legend-children">Kind: {cat.children}</span>
                    <span className="legend-item legend-storage">Lager: {cat.storage}</span>
                  </div>
                  {total > 0 && (
                    <details className="inventory-id-details">
                      <summary>Inventarnummern</summary>
                      <InventoryIdList title="Bei Kindern" articles={cat.childArticles} showChild />
                      <InventoryIdList title="Im Lager" articles={cat.storageArticles} />
                    </details>
                  )}
                </article>
              );
            })}
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
              <article key={item.category} className="demand-card">
                <header>
                  <strong>{item.category}</strong>
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
                {can('articles.edit') && <div className="helmet-actions">
                  <button onClick={() => handleHelmetCheck(alert.article.id)} disabled={helmetCheckMutation.isPending}>
                    Prüfung abschließen
                  </button>
                  <button
                    className="ghost-button danger"
                    onClick={() => handleRetireArticle(alert.article.id)}
                    disabled={retireArticleMutation.isPending}
                  >
                    Aussondern
                  </button>
                </div>}
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

function InventoryIdList({
  title,
  articles,
  showChild = false
}: {
  title: string;
  articles: Article[];
  showChild?: boolean;
}) {
  if (articles.length === 0) {
    return null;
  }

  return (
    <div className="inventory-id-group">
      <p className="inventory-id-title">
        {title} ({articles.length})
      </p>
      <ul className="inventory-id-list">
        {articles.map((article) => (
          <li key={article.id}>
            <span className="helmet-article-id">#{article.id}</span>
            <span
              className="muted"
              title={showChild && article.location.name ? article.location.name : undefined}
            >
              {article.size ?? 'One Size'}
              {showChild && article.location.name ? ` · ${article.location.name}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function compareArticleIds(a: Article, b: Article): number {
  return a.id.localeCompare(b.id, 'de-DE', { numeric: true });
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
