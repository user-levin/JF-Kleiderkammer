import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { Article } from 'types/domain';

type StatCard = {
  label: string;
  value: number;
  muted?: string;
};

export default function PublicDashboard() {
  const { data: articles = [], isLoading, error } = useQuery<Article[]>({
    queryKey: ['articles'],
    queryFn: async () => {
      const res = await api.get<{ data: Article[] }>('/api/articles');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const stats = useMemo(() => {
    const total = articles.length;
    const children = articles.filter((article) => article.location.type === 'kind').length;
    const storage = total - children;

    return {
      total,
      children,
      storage,
      childPercent: total ? Math.round((children / total) * 100) : 0,
      storagePercent: total ? Math.round((storage / total) * 100) : 0,
    };
  }, [articles]);

  const statCards = useMemo<StatCard[]>(() => [
    {
      label: 'Artikel insgesamt',
      value: stats.total,
    },
    {
      label: 'Bei Kindern',
      value: stats.children,
      muted: `${stats.childPercent}% ausgeliehen`,
    },
    {
      label: 'Im Lager',
      value: stats.storage,
      muted: `${stats.storagePercent}% Reserve`,
    },
  ], [stats]);

  return (
    <div className="public-dashboard-layout">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Dashboard</h2>
            <p className="muted">Live-Daten aus der Kleiderkammer</p>
          </div>
        </div>

        {error && <p className="error">Fehler beim Laden der Daten.</p>}

        {isLoading ? (
          <p className="muted">Bestandsdaten werden geladen ...</p>
        ) : (
          <>
            <div className="stat-grid">
              {statCards.map((card) => (
                <article key={card.label} className="stat-card">
                  <p className="stat-label">{card.label}</p>
                  <p className="stat-value">{card.value}</p>
                  {card.muted && <span className="muted">{card.muted}</span>}
                </article>
              ))}
            </div>

            <div className="public-distribution-section">
              <h3>Gesamtverteilung</h3>
              <p className="muted">Artikel im Lager vs. ausgegeben</p>

              <div className="public-distribution-chart">
                <div className="distribution-item">
                  <div className="distribution-bar-row">
                    <span className="distribution-label">Im Lager</span>
                    <div className="distribution-bar-track">
                      <div
                        className="distribution-bar"
                        style={{ width: `${stats.storagePercent}%` }}
                      />
                    </div>
                    <span className="distribution-count">{stats.storage}</span>
                  </div>
                </div>

                <div className="distribution-item">
                  <div className="distribution-bar-row">
                    <span className="distribution-label">Ausgegeben</span>
                    <div className="distribution-bar-track">
                      <div
                        className="distribution-bar distribution-bar-children"
                        style={{ width: `${stats.childPercent}%` }}
                      />
                    </div>
                    <span className="distribution-count">{stats.children}</span>
                  </div>
                </div>
              </div>

              <div className="public-distribution-legend">
                <span className="legend-item">
                  <span className="legend-dot" style={{ backgroundColor: '#60a5fa' }} />
                  Lager
                </span>
                <span className="legend-item">
                  <span className="legend-dot" style={{ backgroundColor: '#34d399' }} />
                  Ausgegeben
                </span>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
