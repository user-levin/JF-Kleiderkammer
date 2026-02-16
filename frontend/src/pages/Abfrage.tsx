import { FormEvent, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { api } from '@api/client';
import { Article } from 'types/domain';
import { TimelineEntry, buildArticleTimeline } from '../utils/articleHistory';

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

export default function Abfrage() {
  const [inputValue, setInputValue] = useState('');
  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [feedback, setFeedback] = useState<string>('Bitte Artikelnummer eingeben.');

  const lookupMutation = useMutation({
    mutationFn: async (articleId: string) => {
      const res = await api.get<{ data: Article }>(`/api/articles/${articleId}`);
      return res.data.data;
    },
    onSuccess: (article) => {
      setActiveArticle(article);
      setFeedback('Artikel wurde gefunden. Du kannst die Daten unten einsehen.');
    },
    onError: (error) => {
      setActiveArticle(null);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        setFeedback('Artikel wurde nicht gefunden.');
      } else {
        setFeedback(error instanceof Error ? error.message : 'Artikel konnte nicht geladen werden.');
      }
    }
  });

  const timelineEntries = useMemo<TimelineEntry[]>(() => {
    if (!activeArticle) {
      return [];
    }
    return buildArticleTimeline(activeArticle);
  }, [activeArticle]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeArticleId(inputValue);
    if (!normalized) {
      setFeedback('Bitte eine gültige Artikelnummer eingeben.');
      setActiveArticle(null);
      return;
    }
    setInputValue(normalized);
    lookupMutation.mutate(normalized);
  };

  return (
    <div className="query-layout">
      <section className="card query-card">
        <div className="card-header">
          <div>
            <h2>Abfrage</h2>
            <p className="muted">Nur lesen – ideal für Lesende ohne Admin- oder Verwalterrechte.</p>
          </div>
          <Link to="/scan" className="ghost-button">Zum Scanner</Link>
        </div>
        <form className="query-form" onSubmit={handleSubmit}>
          <label>
            Artikelnummer (9-stellig)
            <input
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder="z.B. 000123456"
              inputMode="numeric"
            />
          </label>
          <div className="query-form-actions">
            <button type="submit" disabled={lookupMutation.isPending}>Abfragen</button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setInputValue('');
                setActiveArticle(null);
                setFeedback('Bitte Artikelnummer eingeben.');
              }}
            >
              Zurücksetzen
            </button>
          </div>
        </form>
        <p className="muted">{lookupMutation.isPending ? 'Suche läuft...' : feedback}</p>
      </section>

      <section className="card query-result-card">
        {!activeArticle && !lookupMutation.isPending && (
          <div className="query-result-empty">
            <p className="muted">Noch kein Artikel geladen.</p>
            <p className="muted">Nutze das Formular, um Details angezeigt zu bekommen.</p>
          </div>
        )}

        {lookupMutation.isPending && (
          <p className="muted">Artikel wird geladen ...</p>
        )}

        {activeArticle && !lookupMutation.isPending && (
          <div className="query-result">
            <div className="card-header">
              <div>
                <h3>Artikel {activeArticle.id}</h3>
                <p className="muted">{activeArticle.category} · {activeArticle.size ?? 'One Size'}</p>
              </div>
              <span className={`query-status-pill ${statusClass(activeArticle)}`}>
                {statusLabel(activeArticle)}
              </span>
            </div>

            <div className="query-summary">
              <div>
                <p className="label">Bezeichnung</p>
                <p>{activeArticle.label}</p>
              </div>
              <div>
                <p className="label">Ort</p>
                <p>{activeArticle.location.type === 'kind' ? `Bei ${activeArticle.location.name}` : 'Lager'}</p>
              </div>
              <div>
                <p className="label">Zuletzt bewegt</p>
                <p>{formatTimestamp(activeArticle.assignedAt)}</p>
              </div>
              <div>
                <p className="label">Nächste Prüfung</p>
                <p>{formatDate(activeArticle.helmetNextCheck)}</p>
              </div>
              <div>
                <p className="label">Ablaufdatum</p>
                <p>{formatDate(activeArticle.expiryDate)}</p>
              </div>
              <div>
                <p className="label">Notizen</p>
                <p>{activeArticle.notes ?? 'Keine Notizen vorhanden.'}</p>
              </div>
            </div>

            {activeArticle.warning && (
              <p className="badge badge-warning">
                Warnung: {activeArticle.warning.type === 'pruefung' ? 'Prüfung' : 'Ablauf'} bis {formatDate(activeArticle.warning.date)}
              </p>
            )}

            {timelineEntries.length > 0 && (
              <div className="query-timeline">
                <h4>Verlauf</h4>
                <ol className="article-timeline">
                  {timelineEntries.map((entry, index) => (
                    <li key={`${entry.label}-${entry.date}-${index}`}>
                      <p className="timeline-label">{entry.label}</p>
                      <p className="timeline-date">{entry.date}</p>
                      {entry.meta && <p className="timeline-meta">{entry.meta}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function normalizeArticleId(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  const trimmed = digits.slice(-9);
  return trimmed.padStart(9, '0');
}

function formatDate(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : DATE_FORMAT.format(date);
}

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : TIMESTAMP_FORMAT.format(date);
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

function statusClass(article: Article): string {
  if (article.warning) {
    return 'is-warning';
  }
  if (article.status === 'ausgegeben') {
    return 'is-muted';
  }
  return 'is-success';
}
