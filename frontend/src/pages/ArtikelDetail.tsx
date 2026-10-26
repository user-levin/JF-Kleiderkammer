import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { api } from '@api/client';
import ArticleModal from '@components/ArticleModal';
import { Article, Child } from 'types/domain';
import { useAuth } from '../auth';

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

export default function ArtikelDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const canOpenModal = can('articles.edit') || can('articles.assign');
  const { data, isLoading, error } = useQuery<Article>({
    queryKey: ['article-detail', id],
    queryFn: async () => {
      const res = await api.get<{ data: Article }>(`/api/articles/${id}`);
      return res.data.data;
    },
    enabled: Boolean(id),
    retry: false
  });

  const childrenQuery = useQuery({
    queryKey: ['children'],
    queryFn: async () => (await api.get<{ data: Child[] }>('/api/children')).data.data,
    enabled: modalOpen && can('children.view'),
    staleTime: 60_000
  });

  if (isLoading) {
    return <p className="muted">Lädt ...</p>;
  }
  if (error) {
    const notFound = axios.isAxiosError(error) && error.response?.status === 404;
    return (
      <section className="card">
        <h2>Artikel {id}</h2>
        <p className={notFound ? 'muted' : 'error'}>
          {notFound
            ? 'Diesen Artikel gibt es nicht mehr – er wurde ausgesondert oder gelöscht.'
            : 'Artikel konnte nicht geladen werden.'}
        </p>
        <Link to="/inventar">Zum Inventar</Link>
      </section>
    );
  }
  if (!data) {
    return <p className="muted">Artikel wurde nicht gefunden.</p>;
  }

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>Artikel {data.id}</h2>
          <p className="muted">{data.category} · {data.size ?? 'One Size'}</p>
        </div>
        {canOpenModal && (
          <div className="card-actions">
            <button type="button" onClick={() => setModalOpen(true)}>
              {can('articles.edit') ? 'Bearbeiten' : 'Zuordnen'}
            </button>
          </div>
        )}
      </div>
      <div className="article-info-grid">
        <div>
          <p className="label">Bezeichnung</p>
          <p>{data.label}</p>
        </div>
        <div>
          <p className="label">Status</p>
          <p>{statusLabel(data)}</p>
        </div>
        <div>
          <p className="label">Ort</p>
          <p>{data.location.type === 'kind' ? `Bei ${data.location.name}` : 'Lager'}</p>
        </div>
        <div>
          <p className="label">Zuletzt bewegt</p>
          <p>{TIMESTAMP_FORMAT.format(new Date(data.assignedAt))}</p>
        </div>
        <div>
          <p className="label">Nächste Helmprüfung</p>
          <p>{data.helmetNextCheck ? DATE_FORMAT.format(new Date(data.helmetNextCheck)) : '-'}</p>
        </div>
        <div>
          <p className="label">Ablaufdatum</p>
          <p>{data.expiryDate ? DATE_FORMAT.format(new Date(data.expiryDate)) : '-'}</p>
        </div>
      </div>
      {data.warning && (
        <p className="badge badge-warning">
          Warnung: {data.warning.type === 'pruefung' ? 'Prüfung' : 'Ablauf'} bis {DATE_FORMAT.format(new Date(data.warning.date))}
        </p>
      )}
      {data.notes && <p className="muted">Notizen: {data.notes}</p>}
      {modalOpen && (
        <ArticleModal
          article={data}
          childrenOptions={childrenQuery.data ?? []}
          onClose={() => setModalOpen(false)}
          onUpdated={(updated) => {
            queryClient.setQueryData(['article-detail', id], updated);
            queryClient.invalidateQueries({ queryKey: ['articles'] });
          }}
        />
      )}
    </section>
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
