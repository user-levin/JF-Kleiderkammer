import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { api } from '@api/client';
import ArticleModal from '@components/ArticleModal';
import { AppUser, Article, Child } from 'types/domain';

type Place = { type: 'kind' | 'lager'; name: string } | null;

type MovementEntry = {
  id: number;
  articleId: string;
  category: string;
  size: string | null;
  articleActive: boolean;
  performedAt: string;
  eventType: 'create' | 'transfer' | 'delete' | 'undo';
  userEmail: string | null;
  from: Place;
  to: Place;
  undoneAt: string | null;
  undoneBy: string | null;
  canUndo: boolean;
  undoBlockedReason: string | null;
};

type MovementPage = { entries: MovementEntry[]; hasMore: boolean; days: number };

const FIRST_PAGE = 5;
const PAGE_STEP = 10;
const TIME_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

function describe(entry: MovementEntry): string {
  const to = entry.to?.type === 'kind' ? entry.to.name : 'Lager';
  const from = entry.from?.type === 'kind' ? entry.from.name : 'Lager';
  switch (entry.eventType) {
    case 'create':
      return `neu angelegt → ${to}`;
    case 'delete':
      return 'ausgesondert';
    case 'undo':
      return `rückgängig: zurück → ${to}`;
    default:
      return entry.to?.type === 'kind' && entry.from?.type === 'kind'
        ? `umgebucht ${from} → ${to}`
        : entry.to?.type === 'kind'
          ? `ausgegeben → ${to}`
          : `zurück ins Lager (von ${from})`;
  }
}

/**
 * Verlauf der letzten Ausgaben/Rückgaben/Neuanlagen für Admins, mit Rückgängig und Bearbeiten.
 * Zeigt zuerst nur wenige Schritte der gewählten Person; "Mehr anzeigen" lädt weitere.
 */
export default function MovementHistory() {
  const queryClient = useQueryClient();
  const [userFilter, setUserFilter] = useState('me');
  const [limit, setLimit] = useState(FIRST_PAGE);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editArticle, setEditArticle] = useState<Article | null>(null);

  const historyQuery = useQuery({
    queryKey: ['movements', userFilter, limit],
    queryFn: async () =>
      (await api.get<{ data: MovementPage }>('/api/movements', { params: { userId: userFilter === 'all' ? '' : userFilter, limit } })).data.data,
    placeholderData: (previous) => previous
  });

  const usersQuery = useQuery<AppUser[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get<{ data: AppUser[] }>('/api/users')).data.data,
    staleTime: 60_000
  });

  const childrenQuery = useQuery({
    queryKey: ['children'],
    queryFn: async () => (await api.get<{ data: Child[] }>('/api/children')).data.data,
    enabled: editArticle !== null,
    staleTime: 60_000
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['movements'] });
    queryClient.invalidateQueries({ queryKey: ['articles'] });
    queryClient.invalidateQueries({ queryKey: ['child-articles'] });
  };

  const handleUndo = async (entry: MovementEntry) => {
    const question =
      entry.eventType === 'create'
        ? `Neuanlage von ${entry.category} ${entry.articleId} rückgängig machen? Der Artikel wird ausgesondert.`
        : `„${entry.category} ${entry.articleId}: ${describe(entry)}“ rückgängig machen?`;
    if (!window.confirm(question)) return;
    setBusyId(entry.id);
    setError(null);
    try {
      await api.post(`/api/movements/${entry.id}/undo`);
      setMessage(`${entry.category} ${entry.articleId}: rückgängig gemacht.`);
      refresh();
    } catch (undoError) {
      setMessage(null);
      setError(axios.isAxiosError(undoError) && undoError.response?.data?.error ? undoError.response.data.error : 'Rückgängig fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  };

  const handleEdit = async (entry: MovementEntry) => {
    setError(null);
    try {
      setEditArticle((await api.get<{ data: Article }>(`/api/articles/${entry.articleId}`)).data.data);
    } catch {
      setError('Artikel konnte nicht geladen werden.');
    }
  };

  const entries = historyQuery.data?.entries ?? [];
  const showUser = userFilter !== 'me';

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h3>Letzte Ausgaben &amp; Rückgaben</h3>
          <p className="muted">Rückgängig oder bearbeiten bis {(historyQuery.data?.days ?? 28) / 7} Wochen zurück</p>
        </div>
        <select
          value={userFilter}
          onChange={(event) => {
            setUserFilter(event.target.value);
            setLimit(FIRST_PAGE);
          }}
          aria-label="Person"
        >
          <option value="me">Meine Schritte</option>
          <option value="all">Alle Personen</option>
          {(usersQuery.data ?? []).map((user) => (
            <option key={user.id} value={String(user.id)}>{user.email}</option>
          ))}
        </select>
      </div>

      {message && <p className="info-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}

      {historyQuery.isLoading ? (
        <p className="muted">Lädt …</p>
      ) : entries.length === 0 ? (
        <p className="muted">Keine Schritte in den letzten {(historyQuery.data?.days ?? 28) / 7} Wochen.</p>
      ) : (
        <ul className="history-list">
          {entries.map((entry) => {
            const isUndone = entry.undoneAt !== null;
            return (
              <li key={entry.id} className={`history-item ${isUndone ? 'is-undone' : ''} is-${entry.eventType}`}>
                <div className="history-main">
                  <p className="history-title">
                    <Link to={`/artikel/${entry.articleId}`} className="audit-link">
                      {entry.category}{entry.size ? ` ${entry.size}` : ''} · {entry.articleId}
                    </Link>
                  </p>
                  <p className="history-desc">{describe(entry)}</p>
                  <p className="history-meta">
                    {TIME_FORMAT.format(new Date(entry.performedAt))}
                    {showUser && ` · ${entry.userEmail ?? 'unbekannt'}`}
                    {isUndone && ` · rückgängig gemacht von ${entry.undoneBy ?? 'unbekannt'}`}
                  </p>
                </div>
                {entry.eventType !== 'undo' && entry.eventType !== 'delete' && !isUndone && (
                  <div className="history-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => handleUndo(entry)}
                      disabled={!entry.canUndo || busyId === entry.id}
                      title={entry.undoBlockedReason ?? 'Diesen Schritt rückgängig machen'}
                    >
                      Rückgängig
                    </button>
                    <button type="button" className="ghost-button" onClick={() => handleEdit(entry)} disabled={!entry.articleActive}>
                      Bearbeiten
                    </button>
                  </div>
                )}
                {!entry.canUndo && entry.undoBlockedReason && !isUndone && entry.eventType !== 'undo' && (
                  <p className="history-blocked">{entry.undoBlockedReason}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {historyQuery.data?.hasMore && (
        <div className="audit-more">
          <button type="button" className="ghost-button" onClick={() => setLimit((value) => value + PAGE_STEP)} disabled={historyQuery.isFetching}>
            {historyQuery.isFetching ? 'Lädt …' : 'Mehr anzeigen'}
          </button>
        </div>
      )}

      {editArticle && (
        <ArticleModal
          article={editArticle}
          childrenOptions={childrenQuery.data ?? []}
          onClose={() => {
            setEditArticle(null);
            refresh();
          }}
          onUpdated={(updated) => setEditArticle(updated)}
        />
      )}
    </section>
  );
}
