import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Scan() {
  const [artikelId, setArtikelId] = useState('');
  const navigate = useNavigate();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (artikelId.trim().length === 0) return;
    navigate(`/artikel/${encodeURIComponent(artikelId.trim())}`);
  };

  return (
    <section className="card">
      <h2>Artikel scannen/suchen</h2>
      <form onSubmit={submit} className="scan-form">
        <input
          placeholder="Artikel-ID eingeben oder scannen"
          value={artikelId}
          onChange={(e) => setArtikelId(e.target.value)}
        />
        <button type="submit">?ffnen</button>
      </form>
      <p className="muted">Barcode-Scanner kann sp?ter ?ber Kamerazugriff erg?nzt werden.</p>
    </section>
  );
}
