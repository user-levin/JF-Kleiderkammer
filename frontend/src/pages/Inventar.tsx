import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import ArticleModal from '@components/ArticleModal';
import { Article, Child } from 'types/domain';
import { CATEGORY_PRESETS, CUSTOM_CATEGORY_KEY, matchPresetByCategory } from '@constants/articlePresets';
import { useNavigate } from 'react-router-dom';

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

type StatusFilter = 'alle' | 'frei' | 'ausgegeben' | 'warnung';
type LocationFilter = 'alle' | 'lager' | 'kind';

type CategoryFilter = 'alle' | typeof CUSTOM_CATEGORY_KEY | (typeof CATEGORY_PRESETS)[number]['key'];

export default function Inventar() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle');
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('alle');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('alle');
  const [warningOnly, setWarningOnly] = useState(false);
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    data: articles = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<Article[]>({
    queryKey: ['articles'],
    queryFn: async () => {
      const res = await api.get<{ data: Article[] }>('/api/articles');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const childrenQuery = useQuery({
    queryKey: ['children'],
    queryFn: async () => {
      const res = await api.get<{ data: Child[] }>('/api/children');
      return res.data.data;
    },
    staleTime: 60_000,
  });

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredArticles = useMemo(() => {
    return articles
      .filter((article) => {
        if (statusFilter !== 'alle' && article.status !== statusFilter) {
          return false;
        }
        if (locationFilter !== 'alle' && article.location.type !== locationFilter) {
          return false;
        }
        if (warningOnly && !article.warning) {
          return false;
        }
        if (categoryFilter !== 'alle') {
          const presetMatch = matchPresetByCategory(article.category);
          if (categoryFilter === CUSTOM_CATEGORY_KEY) {
            if (presetMatch) {
              return false;
            }
          } else if (!presetMatch || presetMatch.key !== categoryFilter) {
            return false;
          }
        }
        if (!normalizedSearch) {
          return true;
        }
        const locationName = article.location.name ?? '';
        const locationTypeLabel = article.location.type === 'kind' ? 'kind' : 'lager';
        const haystack = `${article.id} ${article.label} ${article.category} ${locationName} ${locationTypeLabel}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((a, b) => a.id.localeCompare(b.id, 'de-DE'));
  }, [articles, statusFilter, locationFilter, categoryFilter, warningOnly, normalizedSearch]);

  const activeArticle = useMemo(() => {
    return activeArticleId ? articles.find((candidate) => candidate.id === activeArticleId) ?? null : null;
  }, [articles, activeArticleId]);

  const handleArticleUpdated = (_updatedArticle: Article) => {
    queryClient.invalidateQueries({ queryKey: ['articles'] });
    setActiveArticleId(null);
  };

  const deleteMutation = useMutation({
    mutationFn: async (articleId: string) => {
      await api.delete(`/api/articles/${articleId}`);
      return articleId;
    },
    onSuccess: (deletedId) => {
      setActiveArticleId((current) => (current === deletedId ? null : current));
      queryClient.invalidateQueries({ queryKey: ['articles'] });
    },
  });

  const handleDeleteArticle = (articleId: string) => {
    const confirmed = window.confirm('Diesen Artikel wirklich löschen? Dies kann nicht rückgängig gemacht werden.');
    if (!confirmed) {
      return;
    }
    deleteMutation.mutate(articleId);
  };

  return (
    <div className="inventory-layout">
      <section className="card inventory-controls">
        <div className="card-header">
          <div>
            <h2>Inventar</h2>
            <p className="muted">Artikel nach Kind, Kategorie oder Ort finden</p>
          </div>
          <div className="inventory-header-actions">
            <button type="button" onClick={() => navigate('/scan')}>
              Artikel hinzufügen
            </button>
            <button className="ghost-button" type="button" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Aktualisiere…' : 'Aktualisieren'}
            </button>
          </div>
        </div>
        <div className="inventory-filters">
          <input
            type="search"
            placeholder="Suche nach Kind, Kategorie oder Ort"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="alle">Status: Alle</option>
            <option value="frei">Im Lager</option>
            <option value="ausgegeben">Bei Kindern</option>
            <option value="warnung">Warnung aktiv</option>
          </select>
          <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value as LocationFilter)}>
            <option value="alle">Ort: Alle</option>
            <option value="lager">Nur Lager</option>
            <option value="kind">Nur Kinder</option>
          </select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}>
            <option value="alle">Alle Kategorien</option>
            {CATEGORY_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>{preset.label}</option>
            ))}
            <option value={CUSTOM_CATEGORY_KEY}>Weitere Kategorien</option>
          </select>
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={warningOnly}
              onChange={(event) => setWarningOnly(event.target.checked)}
            />
            <span>Nur Warnungen</span>
          </label>
        </div>
      </section>

      <section className="card inventory-list-card">
        {error && <p className="error-text">Inventar konnte nicht geladen werden.</p>}
        {isLoading ? (
          <p className="muted">Artikel werden geladen ...</p>
        ) : filteredArticles.length === 0 ? (
          <p className="muted">Keine Artikel mit den aktuellen Filtern gefunden.</p>
        ) : (
          <>
            <p className="muted">{filteredArticles.length} Artikel angezeigt</p>
            <div className="inventory-table-wrapper">
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Artikel</th>
                    <th>Kategorie</th>
                    <th>Größe</th>
                    <th>Status</th>
                    <th>Ort</th>
                    <th>Zuletzt bewegt</th>
                    <th>Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArticles.map((article) => (
                    <tr key={article.id} className={article.warning ? 'has-warning' : ''}>
                      <td>
                        <div className="inventory-article-id">#{article.id}</div>
                        <p className="inventory-article-label">{article.label}</p>
                      </td>
                      <td>{article.category}</td>
                      <td>{article.size ?? 'One Size'}</td>
                      <td>
                        <span className={`inventory-status inventory-status-${article.status}`}>
                          {statusLabel(article)}
                        </span>
                        {article.warning && (
                          <span className="inventory-warning-pill">
                            {article.warning.type === 'pruefung' ? 'Prüfung' : 'Ablauf'}
                          </span>
                        )}
                      </td>
                      <td>{article.location.type === 'kind' ? article.location.name : 'Lager'}</td>
                      <td>{DATE_TIME_FORMAT.format(new Date(article.assignedAt))}</td>
                      <td>
                        <div className="inventory-action-group">
                          <button type="button" className="ghost-button" onClick={() => setActiveArticleId(article.id)}>
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            className="ghost-button danger"
                            onClick={() => handleDeleteArticle(article.id)}
                            disabled={deleteMutation.isPending}
                          >
                            Löschen
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {activeArticle && (
        <ArticleModal
          article={activeArticle}
          childrenOptions={childrenQuery.data ?? []}
          onClose={() => setActiveArticleId(null)}
          onUpdated={handleArticleUpdated}
        />
      )}
    </div>
  );
}

function statusLabel(article: Article): string {
  if (article.warning) {
    return 'Warnung aktiv';
  }
  if (article.status === 'ausgegeben') {
    return 'Bei Kind';
  }
  if (article.status === 'frei') {
    return 'Im Lager';
  }
  return 'Unbekannt';
}
