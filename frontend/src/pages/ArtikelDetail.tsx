import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';

export default function ArtikelDetail() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['artikel', id],
    queryFn: async () => {
      const res = await api.get(`/artikel/${id}`);
      return res.data;
    },
    enabled: Boolean(id)
  });

  if (isLoading) return <p>L?dt?</p>;
  if (error) return <p className="error">Fehler beim Laden</p>;
  if (!data) return <p>Nicht gefunden</p>;

  return (
    <section className="card">
      <div className="card-header">
        <h2>Artikel {data.id}</h2>
      </div>
      <ul className="meta">
        <li>Kategorie: {data.kategorie}</li>
        <li>Bezeichnung: {data.bezeichnung}</li>
        <li>Gr??e: {data.groesse ?? '-'}</li>
        <li>Zustand: {data.zustand ?? '-'}</li>
        <li>Aktiv: {data.aktiv ? 'ja' : 'nein'}</li>
      </ul>
      <div className="card">
        <strong>Aktueller Ort</strong>
        <p>{data.aktueller_ort?.label ?? 'unbekannt'}</p>
      </div>
    </section>
  );
}
