import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
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

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

export default function ArtikelDetail() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery<Article>({
    queryKey: ['article-detail', id],
    queryFn: async () => {
      const res = await api.get<{ data: Article }>(`/api/articles/${id}`);
      return res.data.data;
    },
    enabled: Boolean(id)
  });

  if (isLoading) {
    return <p className="muted">Lädt ...</p>;
  }
  if (error) {
    return <p className="error">Artikel konnte nicht geladen werden.</p>;
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
