import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { api } from '@api/client';
import CameraScanner from '@components/CameraScanner';
import { Article, Child } from 'types/domain';
import { CATEGORY_PRESETS, CUSTOM_CATEGORY_KEY, findPresetByKey } from '@constants/articlePresets';
import { useAuth } from '../auth';

type Mode = 'ausgabe' | 'rueckgabe';

type EntryStatus = 'ok' | 'info' | 'error' | 'undone';

type SessionEntry = {
  key: number;
  articleId: string;
  text: string;
  status: EntryStatus;
  movementId?: number;
};

type Pending =
  | { type: 'transfer'; article: Article }
  | { type: 'create'; articleId: string };

type CreateForm = {
  categoryKey: string;
  category: string;
  size: string;
  helmetManufacturedAt: string;
};

const EMPTY_CREATE: CreateForm = { categoryKey: '', category: '', size: '', helmetManufacturedAt: '' };

/** Gleiche Normalisierung wie im Backend: nur Ziffern, 9 Stellen mit führenden Nullen */
function normalizeArticleId(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits ? digits.slice(-9).padStart(9, '0') : '';
}

function childName(child: Pick<Child, 'firstName' | 'lastName'>): string {
  return `${child.firstName} ${child.lastName}`;
}

function articleText(article: Pick<Article, 'id' | 'category' | 'size'>): string {
  return `${article.category}${article.size ? ` ${article.size}` : ''} (${article.id})`;
}

function errorText(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error;
  }
  return fallback;
}

/**
 * Ausgabe an ein Kind: erst das Kind wählen, dann beliebig viele Artikel scannen oder eintippen.
 * Jeder Artikel wird sofort gebucht; falsche Scans lassen sich in der Liste mit ✕ zurücknehmen.
 */
export default function Ausgabe() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canCreate = can('articles.edit');
  const [searchParams, setSearchParams] = useSearchParams();
  const [childSearch, setChildSearch] = useState('');
  const [mode, setMode] = useState<Mode>('ausgabe');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const inputRef = useRef<HTMLInputElement>(null);
  const entryKey = useRef(0);

  const childId = Number(searchParams.get('kind')) || null;

  const childrenQuery = useQuery({
    queryKey: ['children'],
    queryFn: async () => (await api.get<{ data: Child[] }>('/api/children')).data.data,
    staleTime: 60_000
  });
  const child = childrenQuery.data?.find((entry) => entry.id === childId) ?? null;

  const childArticlesQuery = useQuery({
    queryKey: ['child-articles', childId],
    queryFn: async () => (await api.get<{ data: Article[] }>(`/api/children/${childId}/articles`)).data.data,
    enabled: childId !== null
  });

  const articlesQuery = useQuery({
    queryKey: ['articles'],
    queryFn: async () => (await api.get<{ data: Article[] }>('/api/articles')).data.data,
    enabled: canCreate,
    staleTime: 30_000
  });

  useEffect(() => {
    if (child && !pending) {
      inputRef.current?.focus();
    }
  }, [child, pending, mode]);

  const matchingChildren = useMemo(() => {
    const term = childSearch.trim().toLowerCase();
    return (childrenQuery.data ?? [])
      .filter((entry) => !term || childName(entry).toLowerCase().includes(term))
      .sort((a, b) => (a.status === b.status ? childName(a).localeCompare(childName(b), 'de-DE') : a.status === 'aktiv' ? -1 : 1));
  }, [childrenQuery.data, childSearch]);

  // Bekannte Größen der gewählten Kategorie als Vorschläge beim Neuanlegen
  const knownSizes = useMemo(() => {
    const category = (findPresetByKey(createForm.categoryKey)?.label ?? createForm.category).toLowerCase();
    const sizes = new Set<string>();
    for (const article of articlesQuery.data ?? []) {
      if (article.category.toLowerCase() === category && article.size) {
        sizes.add(article.size);
      }
    }
    return Array.from(sizes).sort((a, b) => a.localeCompare(b, 'de-DE', { numeric: true }));
  }, [articlesQuery.data, createForm.categoryKey, createForm.category]);

  const selectChild = (id: number | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) {
      next.set('kind', String(id));
    } else {
      next.delete('kind');
    }
    setSearchParams(next, { replace: true });
    setEntries([]);
    setPending(null);
    setChildSearch('');
  };

  const addEntry = (entry: Omit<SessionEntry, 'key'>) => {
    entryKey.current += 1;
    setEntries((prev) => [{ ...entry, key: entryKey.current }, ...prev]);
  };

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['articles'] });
    queryClient.invalidateQueries({ queryKey: ['child-articles'] });
    queryClient.invalidateQueries({ queryKey: ['children'] });
  };

  const assign = async (article: Article, targetType: 'kind' | 'lager') => {
    if (!child) return;
    try {
      const res = await api.patch<{ data: Article }>(`/api/articles/${article.id}/assignment`, {
        targetType,
        kindId: targetType === 'kind' ? child.id : undefined
      });
      const movementId = res.data.data.movementHistory?.[0]?.id;
      const wasElsewhere = article.location.type === 'kind' && article.location.kindId !== child.id;
      addEntry({
        articleId: article.id,
        movementId,
        status: 'ok',
        text:
          targetType === 'lager'
            ? `${articleText(article)} zurück ins Lager`
            : wasElsewhere
              ? `${articleText(article)} von ${article.location.name} umgebucht`
              : `${articleText(article)} ausgegeben`
      });
      refreshData();
    } catch (error) {
      addEntry({ articleId: article.id, status: 'error', text: `${article.id}: ${errorText(error, 'Buchung fehlgeschlagen.')}` });
    }
  };

  const handleNumber = async (raw: string) => {
    const articleId = normalizeArticleId(raw);
    if (!articleId || !child || busy) {
      return;
    }
    setInput('');
    setPending(null);
    setBusy(true);
    try {
      const res = await api.get<{ data: Article }>(`/api/articles/${articleId}`);
      const article = res.data.data;
      const isHere = article.location.type === 'kind' && article.location.kindId === child.id;

      if (mode === 'rueckgabe') {
        if (isHere) {
          await assign(article, 'lager');
        } else {
          addEntry({
            articleId,
            status: 'error',
            text: `${articleText(article)} ist nicht bei ${childName(child)} (${article.location.type === 'kind' ? article.location.name : 'im Lager'}).`
          });
        }
      } else if (isHere) {
        addEntry({ articleId, status: 'info', text: `${articleText(article)} hat ${childName(child)} schon.` });
      } else if (article.location.type === 'kind') {
        setPending({ type: 'transfer', article });
      } else {
        await assign(article, 'kind');
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404 && mode === 'ausgabe') {
        if (canCreate) {
          setPending({ type: 'create', articleId });
        } else {
          addEntry({ articleId, status: 'error', text: `${articleId} ist unbekannt – bitte vom Admin anlegen lassen.` });
        }
      } else {
        addEntry({ articleId, status: 'error', text: `${articleId}: ${errorText(error, 'Artikel nicht gefunden.')}` });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    handleNumber(input);
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!child || pending?.type !== 'create') return;
    const preset = findPresetByKey(createForm.categoryKey);
    const category = preset?.label ?? createForm.category.trim();
    setBusy(true);
    try {
      const res = await api.post<{ data: Article }>('/api/articles', {
        id: pending.articleId,
        category,
        size: createForm.size.trim(),
        helmetManufacturedAt: createForm.helmetManufacturedAt || undefined,
        locationType: 'kind',
        kindId: child.id
      });
      const article = res.data.data;
      addEntry({
        articleId: article.id,
        movementId: article.movementHistory?.[0]?.id,
        status: 'ok',
        text: `${articleText(article)} neu angelegt und ausgegeben`
      });
      // Kategorie und Größe bleiben für den nächsten Artikel stehen
      setCreateForm((prev) => ({ ...prev, helmetManufacturedAt: '' }));
      setPending(null);
      refreshData();
    } catch (error) {
      addEntry({ articleId: pending.articleId, status: 'error', text: `${pending.articleId}: ${errorText(error, 'Anlegen fehlgeschlagen.')}` });
    } finally {
      setBusy(false);
    }
  };

  const handleUndo = async (entry: SessionEntry) => {
    if (!entry.movementId) return;
    try {
      await api.post(`/api/movements/${entry.movementId}/undo`);
      setEntries((prev) => prev.map((item) => (item.key === entry.key ? { ...item, status: 'undone' } : item)));
      refreshData();
    } catch (error) {
      addEntry({ articleId: entry.articleId, status: 'error', text: `Rückgängig nicht möglich: ${errorText(error, 'Fehler.')}` });
    }
  };

  const childArticles = childArticlesQuery.data ?? [];
  const bookedCount = entries.filter((entry) => entry.status === 'ok').length;
  const createPreset = findPresetByKey(createForm.categoryKey);
  const isHelmet = (createPreset?.label ?? createForm.category).toLowerCase() === 'helm';

  if (!child) {
    return (
      <section className="card ausgabe-card">
        <div className="card-header">
          <div>
            <h2>Ausgabe &amp; Rückgabe</h2>
            <p className="muted">Zuerst das Kind auswählen, dann Artikel scannen oder eintippen</p>
          </div>
        </div>
        <input
          type="search"
          className="ausgabe-child-search"
          placeholder="Name des Kindes …"
          value={childSearch}
          onChange={(event) => setChildSearch(event.target.value)}
          autoFocus
        />
        {childrenQuery.isLoading ? (
          <p className="muted">Kinder werden geladen …</p>
        ) : (
          <div className="ausgabe-child-grid">
            {matchingChildren.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`ausgabe-child ${entry.status === 'inaktiv' ? 'is-inactive' : ''}`}
                onClick={() => selectChild(entry.id)}
              >
                <strong>{childName(entry)}</strong>
                <span className="muted">
                  {entry.articleCount ?? 0} Artikel{entry.status === 'inaktiv' ? ' · inaktiv' : ''}
                </span>
              </button>
            ))}
            {matchingChildren.length === 0 && <p className="muted">Kein Kind gefunden.</p>}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="ausgabe-layout">
      <section className="card ausgabe-card">
        <div className="card-header">
          <div>
            <p className="muted">{mode === 'ausgabe' ? 'Ausgabe an' : 'Rückgabe von'}</p>
            <h2>{childName(child)}</h2>
          </div>
          <div className="card-actions">
            <button type="button" className="ghost-button" onClick={() => selectChild(null)}>Anderes Kind</button>
          </div>
        </div>

        <div className="segmented ausgabe-mode" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'ausgabe'} className={mode === 'ausgabe' ? 'is-active' : ''} onClick={() => { setMode('ausgabe'); setPending(null); }}>
            Ausgabe
          </button>
          <button type="button" role="tab" aria-selected={mode === 'rueckgabe'} className={mode === 'rueckgabe' ? 'is-active' : ''} onClick={() => { setMode('rueckgabe'); setPending(null); }}>
            Rückgabe
          </button>
        </div>

        <form className="ausgabe-scan-form" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Inventarnummer scannen oder eintippen + Enter"
            inputMode="numeric"
            disabled={busy || pending !== null}
            aria-label="Inventarnummer"
          />
          <button type="submit" disabled={busy || pending !== null || !input.trim()}>
            {mode === 'ausgabe' ? 'Ausgeben' : 'Zurücknehmen'}
          </button>
          <button type="button" className={`ghost-button ${cameraOn ? 'is-active' : ''}`} onClick={() => setCameraOn((state) => !state)}>
            {cameraOn ? 'Kamera aus' : 'Kamera'}
          </button>
        </form>
        {cameraOn && !pending && <CameraScanner onScan={handleNumber} />}

        {pending?.type === 'transfer' && (
          <div className="ausgabe-pending">
            <p>
              <strong>{articleText(pending.article)}</strong> ist gerade bei <strong>{pending.article.location.name}</strong>.
              Zu {childName(child)} umbuchen?
            </p>
            <div className="transfer-actions">
              <button type="button" onClick={() => { const article = pending.article; setPending(null); assign(article, 'kind'); }}>
                Umbuchen
              </button>
              <button type="button" className="ghost-button" onClick={() => setPending(null)}>Abbrechen</button>
            </div>
          </div>
        )}

        {pending?.type === 'create' && (
          <form className="ausgabe-pending" onSubmit={handleCreate}>
            <p>
              <strong>{pending.articleId}</strong> gibt es noch nicht. Neu anlegen und direkt an {childName(child)} ausgeben:
            </p>
            <div className="ausgabe-create-grid">
              <label>
                Kategorie*
                <select
                  value={createForm.categoryKey}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, categoryKey: event.target.value, size: '' }))}
                  required
                  autoFocus
                >
                  <option value="">Bitte wählen</option>
                  {CATEGORY_PRESETS.map((preset) => (
                    <option key={preset.key} value={preset.key}>{preset.label}</option>
                  ))}
                  <option value={CUSTOM_CATEGORY_KEY}>Eigene Kategorie</option>
                </select>
              </label>
              {createForm.categoryKey === CUSTOM_CATEGORY_KEY && (
                <label>
                  Eigene Kategorie*
                  <input value={createForm.category} onChange={(event) => setCreateForm((prev) => ({ ...prev, category: event.target.value }))} required />
                </label>
              )}
              <label>
                Größe
                {createPreset?.sizeOptions?.length ? (
                  <select value={createForm.size} onChange={(event) => setCreateForm((prev) => ({ ...prev, size: event.target.value }))}>
                    <option value="">–</option>
                    {createPreset.sizeOptions.map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      value={createForm.size}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, size: event.target.value }))}
                      list="ausgabe-known-sizes"
                      placeholder="z. B. 152 oder L"
                    />
                    <datalist id="ausgabe-known-sizes">
                      {knownSizes.map((size) => <option key={size} value={size} />)}
                    </datalist>
                  </>
                )}
              </label>
              {isHelmet && (
                <label>
                  Herstellungsdatum*
                  <input
                    type="date"
                    value={createForm.helmetManufacturedAt}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, helmetManufacturedAt: event.target.value }))}
                    required
                  />
                </label>
              )}
            </div>
            <div className="transfer-actions">
              <button type="submit" disabled={busy}>Anlegen &amp; ausgeben</button>
              <button type="button" className="ghost-button" onClick={() => setPending(null)}>Abbrechen</button>
            </div>
          </form>
        )}

        <div className="ausgabe-session">
          <h3>
            Diese Sitzung
            {bookedCount > 0 && <span className="nav-count">{bookedCount}</span>}
          </h3>
          {entries.length === 0 ? (
            <p className="muted">Noch nichts gebucht. Jeder Scan wird sofort gespeichert.</p>
          ) : (
            <ul className="ausgabe-entries">
              {entries.map((entry) => (
                <li key={entry.key} className={`ausgabe-entry is-${entry.status}`}>
                  <span className="ausgabe-entry-icon" aria-hidden="true">
                    {entry.status === 'ok' ? '✓' : entry.status === 'info' ? 'i' : entry.status === 'undone' ? '↺' : '!'}
                  </span>
                  <span className="ausgabe-entry-text">
                    {entry.text}
                    {entry.status === 'undone' && <span className="muted"> – rückgängig gemacht</span>}
                  </span>
                  {entry.status === 'ok' && entry.movementId && (
                    <button type="button" className="ausgabe-undo" onClick={() => handleUndo(entry)} title="Rückgängig machen" aria-label={`${entry.text} rückgängig machen`}>
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card ausgabe-card">
        <div className="card-header">
          <div>
            <h3>Hat aktuell ({childArticles.length})</h3>
            <p className="muted">{mode === 'rueckgabe' ? 'Antippen, um ins Lager zurückzubuchen' : 'Bereits ausgegebene Teile'}</p>
          </div>
        </div>
        {childArticlesQuery.isLoading ? (
          <p className="muted">Lädt …</p>
        ) : childArticles.length === 0 ? (
          <p className="muted">{childName(child)} hat gerade keine Artikel.</p>
        ) : (
          <ul className="ausgabe-has-list">
            {childArticles.map((article) => (
              <li key={article.id}>
                <Link to={`/artikel/${article.id}`} className="audit-link">{article.id}</Link>
                <span>{article.category}</span>
                <span className="muted">{article.size ?? '–'}</span>
                {mode === 'rueckgabe' && (
                  <button type="button" className="ghost-button" onClick={() => assign(article, 'lager')}>
                    Zurück ins Lager
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
