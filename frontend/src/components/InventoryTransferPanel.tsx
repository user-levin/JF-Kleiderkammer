import { ChangeEvent, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '@api/client';
import { Article } from 'types/domain';
import { exportInventoryCsv, exportInventoryPdf } from '../utils/inventoryExport';

type Scope = 'alle' | 'filter';

type ImportResult = {
  created: number;
  skipped: number;
  errors: { line: number; message: string }[];
};

type Props = {
  allArticles: Article[];
  filteredArticles: Article[];
  /** Lesbare Beschreibung der aktiven Filter, leer wenn keine gesetzt sind */
  filterDescription: string;
  onClose: () => void;
};

/**
 * Import/Export des Bestands (nur Admin): CSV und PDF, wahlweise alles oder nur die gefilterte Liste.
 */
export default function InventoryTransferPanel({ allArticles, filteredArticles, filterDescription, onClose }: Props) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasFilter = filterDescription !== '';
  const [scope, setScope] = useState<Scope>(hasFilter ? 'filter' : 'alle');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = scope === 'filter' ? filteredArticles : allArticles;
  const scopeLabel = scope === 'filter' ? filterDescription : 'Alle Artikel';
  const filenameSuffix = scope === 'filter' ? '_gefiltert' : '';

  const importMutation = useMutation({
    mutationFn: async (csv: string) =>
      (await api.post<{ data: ImportResult }>('/api/articles/import', { csv })).data.data,
    onSuccess: (result) => {
      setMessage(`${result.created} Artikel angelegt, ${result.skipped} schon vorhanden (übersprungen).`);
      setError(
        result.errors.length
          ? `Nicht übernommen – ${result.errors.map((entry) => `Zeile ${entry.line}: ${entry.message}`).join(' · ')}`
          : null
      );
      queryClient.invalidateQueries({ queryKey: ['articles'] });
    },
    onError: (mutationError) => {
      setMessage(null);
      const apiMessage = axios.isAxiosError(mutationError) ? mutationError.response?.data?.error : null;
      setError(typeof apiMessage === 'string' ? apiMessage : 'Import fehlgeschlagen.');
    }
  });

  const handlePdf = async () => {
    setError(null);
    setPdfBusy(true);
    try {
      await exportInventoryPdf(selected, { title: 'Kleiderkammer – Bestand', scope: scopeLabel, filenameSuffix });
    } catch (pdfError) {
      setError(pdfError instanceof Error ? pdfError.message : 'PDF konnte nicht erstellt werden.');
    } finally {
      setPdfBusy(false);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setMessage(null);
    setError(null);
    importMutation.mutate(await file.text());
  };

  return (
    <div className="transfer-panel">
      <div className="transfer-panel-header">
        <h3>Import / Export</h3>
        <button type="button" className="ghost-button" onClick={onClose}>Schließen</button>
      </div>

      <div className="transfer-grid">
        <section>
          <h4>Export</h4>
          <div className="transfer-scope">
            <label className="checkbox-label">
              <input type="radio" name="export-scope" checked={scope === 'alle'} onChange={() => setScope('alle')} />
              <span>Alle Artikel <span className="muted">({allArticles.length})</span></span>
            </label>
            <label className={`checkbox-label ${hasFilter ? '' : 'is-disabled'}`}>
              <input
                type="radio"
                name="export-scope"
                checked={scope === 'filter'}
                onChange={() => setScope('filter')}
                disabled={!hasFilter}
              />
              <span>
                Aktuelle Filter <span className="muted">({filteredArticles.length})</span>
                <br />
                <span className="muted transfer-filter-text">{hasFilter ? filterDescription : 'Keine Filter gesetzt'}</span>
              </span>
            </label>
          </div>
          <div className="transfer-actions">
            <button type="button" onClick={() => exportInventoryCsv(selected, filenameSuffix)} disabled={selected.length === 0}>
              CSV herunterladen
            </button>
            <button type="button" onClick={handlePdf} disabled={selected.length === 0 || pdfBusy}>
              {pdfBusy ? 'PDF wird erstellt …' : 'PDF herunterladen'}
            </button>
          </div>
        </section>

        <section>
          <h4>Import</h4>
          <p className="muted transfer-hint">
            CSV im selben Format wie der Export. Pflicht sind <strong>Inventarnummer</strong> und{' '}
            <strong>Kategorie</strong>, bei Helmen das Herstellungsdatum. Mit Ort „Kind“ und dem Namen in
            „Kind / Lagerort“ wird der Artikel direkt ausgegeben. Vorhandene Nummern werden übersprungen.
          </p>
          <div className="transfer-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importMutation.isPending}
            >
              {importMutation.isPending ? 'Importiere …' : 'CSV-Datei auswählen'}
            </button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleImportFile} />
          </div>
        </section>
      </div>

      {message && <p className="info-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
