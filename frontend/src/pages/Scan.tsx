import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { NotFoundException } from '@zxing/library';
import { api } from '@api/client';
import ArticleModal from '@components/ArticleModal';
import { Article, Child } from 'types/domain';
import { CATEGORY_PRESETS, CUSTOM_CATEGORY_KEY, findPresetByKey } from '@constants/articlePresets';

type CreateArticlePayload = {
  id: string;
  category: string;
  label: string;
  size?: string;
  notes?: string;
  locationType: 'lager' | 'kind';
  kindId?: number;
  helmetManufacturedAt?: string;
};

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });
const SCANNER_RESET_MS = 60;
const DEFAULT_CREATION_STATE = {
  category: '',
  size: '',
  notes: '',
  locationType: 'lager' as const,
  kindId: '',
  helmetManufacturedAt: '',
  categoryKey: '',
  sizeSelection: ''
};

type CreationFormState = typeof DEFAULT_CREATION_STATE;

export default function Scan() {
  const queryClient = useQueryClient();
  const [manualInput, setManualInput] = useState('');
  const [keyboardScannerMode, setKeyboardScannerMode] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastScanValue, setLastScanValue] = useState<string | null>(null);
  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [missingId, setMissingId] = useState<string | null>(null);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [creationForm, setCreationForm] = useState<CreationFormState>(() => ({ ...DEFAULT_CREATION_STATE }));
  const cameraLastResultRef = useRef<{ value: string; timestamp: number }>({ value: '', timestamp: 0 });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);

  const normalizedInput = useMemo(() => normalizeArticleId(manualInput), [manualInput]);
  const normalizedCategory = creationForm.category.trim().toLowerCase();
  const requireHelmetDate = normalizedCategory === 'helm';

  const childrenQuery = useQuery({
    queryKey: ['children'],
    queryFn: async () => {
      const res = await api.get<{ data: Child[] }>('/api/children');
      return res.data.data;
    },
    staleTime: 60_000
  });

  const lookupMutation = useMutation({
    mutationFn: async (articleId: string) => {
      const res = await api.get<{ data: Article }>(`/api/articles/${articleId}`);
      return res.data.data;
    },
    onSuccess: (article) => {
      setActiveArticle(article);
      setIsModalOpen(true);
      setManualInput(article.id);
      setMissingId(null);
      setLookupMessage(null);
    },
    onError: (error, articleId) => {
      setActiveArticle(null);
      setIsModalOpen(false);
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        setMissingId(articleId);
        setLookupMessage('Kein Artikel gefunden. Du kannst ihn jetzt anlegen.');
      } else {
        setMissingId(null);
        setLookupMessage(error instanceof Error ? error.message : 'Unbekannter Fehler.');
      }
    }
  });

  const createMutation = useMutation({
    mutationFn: async (payload: CreateArticlePayload) => {
      const res = await api.post<{ data: Article }>('/api/articles', payload);
      return res.data.data;
    },
    onSuccess: (article) => {
      setActiveArticle(article);
      setIsModalOpen(true);
      setMissingId(null);
      setLookupMessage('Artikel wurde angelegt.');
      setManualInput(article.id);
      queryClient.invalidateQueries({ queryKey: ['articles'] });
    },
    onError: (error) => {
      setLookupMessage(error instanceof Error ? error.message : 'Artikel konnte nicht erstellt werden.');
    }
  });

  const triggerLookup = useCallback(
    (rawValue?: string) => {
      const normalized = normalizeArticleId(rawValue ?? manualInput);
      if (!normalized) {
        setLookupMessage('Bitte eine gültige Artikelnummer eingeben oder scannen.');
        return;
      }
      setActiveArticle(null);
      setMissingId(null);
      setLookupMessage(null);
      lookupMutation.mutate(normalized);
    },
    [lookupMutation, manualInput]
  );

  const handleCameraDecode = useCallback((value: string) => {
    if (!value) {
      return;
    }
    const normalized = normalizeArticleId(value);
    if (!normalized) {
      setLookupMessage('Der Code enthält keine Artikelnummer.');
      return;
    }

    const now = Date.now();
    if (cameraLastResultRef.current.value === normalized && now - cameraLastResultRef.current.timestamp < 1500) {
      return;
    }

    cameraLastResultRef.current = { value: normalized, timestamp: now };
    setManualInput(normalized);
    setLastScanValue(normalized);
    triggerLookup(normalized);
  }, [triggerLookup]);

  const handleArticleUpdated = useCallback((article: Article) => {
    setActiveArticle(article);
    setLookupMessage('Artikel aktualisiert.');
    queryClient.invalidateQueries({ queryKey: ['articles'] });
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    const startScanner = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Dieses Gerät stellt keine Kamera zur Verfügung.');
        return;
      }

      const videoElement = videoRef.current;
      if (!videoElement) {
        requestAnimationFrame(() => {
          if (!cancelled) {
            startScanner();
          }
        });
        return;
      }

      try {
        const controls = await reader.decodeFromVideoDevice(undefined, videoElement, (result, error) => {
          if (result) {
            handleCameraDecode(result.getText());
            setCameraError(null);
          } else if (error && !(error instanceof NotFoundException)) {
            setCameraError(error.message ?? 'Kamera konnte nicht verwendet werden.');
          }
        });
        scannerControlsRef.current = controls;
      } catch (error) {
        setCameraError(error instanceof Error ? error.message : 'Kamera konnte nicht verwendet werden.');
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      scannerControlsRef.current?.stop();
    };
  }, [handleCameraDecode]);

  useEffect(() => {
    if (!keyboardScannerMode) {
      return;
    }

    let buffer = '';
    let lastEvent = 0;

    const handler = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true')) {
        return;
      }

      const now = Date.now();
      if (now - lastEvent > SCANNER_RESET_MS) {
        buffer = '';
      }

      if (event.key === 'Enter') {
        const normalized = normalizeArticleId(buffer);
        if (normalized) {
          setManualInput(buffer);
          setLastScanValue(normalized);
          triggerLookup(buffer);
        }
        buffer = '';
        return;
      }

      if (/^[0-9]$/.test(event.key)) {
        buffer = `${buffer}${event.key}`;
        lastEvent = now;
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [keyboardScannerMode, triggerLookup]);

  useEffect(() => {
    if (!missingId) {
      setCreationForm({ ...DEFAULT_CREATION_STATE });
    }
  }, [missingId]);

  const handleManualSubmit = (event: FormEvent) => {
    event.preventDefault();
    triggerLookup();
  };

  const handleCreateSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!missingId) {
      return;
    }
    const category = creationForm.category.trim();
    if (!category) {
      setLookupMessage('Kategorie wird benötigt.');
      return;
    }

    const payload: CreateArticlePayload = {
      id: missingId,
      category,
      label: category,
      locationType: creationForm.locationType,
    };

    if (creationForm.size.trim()) {
      payload.size = creationForm.size.trim();
    }
    if (creationForm.notes.trim()) {
      payload.notes = creationForm.notes.trim();
    }
    if (creationForm.locationType === 'kind' && creationForm.kindId) {
      payload.kindId = Number(creationForm.kindId);
    }
    if (requireHelmetDate && creationForm.helmetManufacturedAt) {
      payload.helmetManufacturedAt = creationForm.helmetManufacturedAt;
    }

    createMutation.mutate(payload);
  };

  const handleCategorySelect = (value: string) => {
    setCreationForm((prev) => {
      if (value === CUSTOM_CATEGORY_KEY) {
        return {
          ...prev,
          categoryKey: CUSTOM_CATEGORY_KEY,
          category: '',
          sizeSelection: '',
        };
      }

      const preset = findPresetByKey(value);
      const hasSizeOptions = Boolean(preset?.sizeOptions?.length);
      const nextSize = hasSizeOptions
        ? preset?.defaultSize ?? preset?.sizeOptions?.[0] ?? ''
        : prev.size;

      return {
        ...prev,
        categoryKey: value,
        category: preset?.label ?? prev.category,
        size: nextSize,
        sizeSelection: hasSizeOptions ? nextSize : '',
      };
    });
  };

  return (
    <div className="scanner-grid">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Artikel finden</h2>
            <p className="muted">Manuelle Eingabe (links aufgefüllt) oder Barcode-Scanner</p>
          </div>
        </div>

        <div className="scanner-toggle-group">
          <button
            type="button"
            className={`ghost-button ${keyboardScannerMode ? 'is-active' : ''}`}
            onClick={() => setKeyboardScannerMode((state) => !state)}
          >
            {keyboardScannerMode ? 'Hardware-Scanner aktiv' : 'Hardware-Scanner einschalten'}
          </button>
          <p className="scanner-hint">Kamera-Scanner läuft automatisch im Hintergrund.</p>
        </div>

        <div className="camera-scanner">
          <video ref={videoRef} className="scanner-video" playsInline muted autoPlay />
        </div>
        {cameraError ? (
          <p className="error-text">{cameraError}</p>
        ) : (
          <p className="muted">Barcode kurz vor die Kamera halten – Treffer werden automatisch gesucht.</p>
        )}

        <form onSubmit={handleManualSubmit} className="scan-form">
          <div className="input-inline-wrapper">
            <input
              placeholder="Artikelnummer eingeben"
              value={manualInput}
              onChange={(event) => setManualInput(event.target.value)}
              inputMode="numeric"
              maxLength={30}
            />
            <span className="input-inline-value" aria-hidden="true">{normalizedInput || '---'}</span>
          </div>
          <button type="submit" disabled={lookupMutation.isPending}>Suchen</button>
        </form>
        {lastScanValue && <p className="muted">Letzter Scan: {lastScanValue}</p>}
        {lookupMutation.isPending && <p className="muted">Artikel wird geladen ...</p>}
        {lookupMessage && <p className="info-text">{lookupMessage}</p>}
      </section>

      {activeArticle && (
        <ArticlePreview
          article={activeArticle}
          onEdit={() => setIsModalOpen(true)}
        />
      )}

      {missingId && (
        <section className="card">
          <div className="card-header">
            <div>
              <h3>Neuen Artikel anlegen</h3>
              <p className="muted">ID {missingId}</p>
            </div>
          </div>
          <form className="creation-form" onSubmit={handleCreateSubmit}>
            <label>
              Kategorie*
              <select
                value={creationForm.categoryKey}
                onChange={(event) => handleCategorySelect(event.target.value)}
                required
              >
                <option value="">Bitte auswählen</option>
                {CATEGORY_PRESETS.map((preset) => (
                  <option key={preset.key} value={preset.key}>{preset.label}</option>
                ))}
                <option value={CUSTOM_CATEGORY_KEY}>Eigene Kategorie</option>
              </select>
            </label>
            {creationForm.categoryKey === CUSTOM_CATEGORY_KEY && (
              <label>
                Eigene Bezeichnung
                <input
                  value={creationForm.category}
                  onChange={(event) => setCreationForm((prev) => ({ ...prev, category: event.target.value }))}
                  placeholder="z. B. Schuhe"
                  required
                />
              </label>
            )}
            <div className="creation-row">
              <label>
                Größe
                {renderSizeField(creationForm, setCreationForm)}
              </label>
              <label>
                Ort
                <select
                  value={creationForm.locationType}
                  onChange={(event) => setCreationForm((prev) => ({ ...prev, locationType: event.target.value as 'lager' | 'kind', kindId: '' }))}
                >
                  <option value="lager">Lager</option>
                  <option value="kind">Kind</option>
                </select>
              </label>
            </div>
            {creationForm.locationType === 'kind' && (
              <label>
                Kind auswählen
                <select
                  value={creationForm.kindId}
                  onChange={(event) => setCreationForm((prev) => ({ ...prev, kindId: event.target.value }))}
                >
                  <option value="">Bitte auswählen</option>
                  {childrenQuery.data?.map((child) => (
                    <option key={child.id} value={child.id}>
                      {composeChildName(child)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Notizen
              <textarea
                rows={3}
                value={creationForm.notes}
                onChange={(event) => setCreationForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </label>
            {requireHelmetDate && (
              <label>
                Herstellungsdatum (Helm)*
                <input
                  type="date"
                  value={creationForm.helmetManufacturedAt}
                  onChange={(event) => setCreationForm((prev) => ({ ...prev, helmetManufacturedAt: event.target.value }))}
                />
              </label>
            )}
            <div className="creation-actions">
              <button type="submit" disabled={createMutation.isPending}>
                Artikel speichern
              </button>
            </div>
          </form>
        </section>
      )}

      {activeArticle && isModalOpen && (
        <ArticleModal
          article={activeArticle}
          childrenOptions={childrenQuery.data ?? []}
          onClose={() => setIsModalOpen(false)}
          onUpdated={handleArticleUpdated}
        />
      )}
    </div>
  );
}

function ArticlePreview({ article, onEdit }: { article: Article; onEdit: () => void }) {
  return (
    <section className="card article-preview">
      <div className="card-header">
        <div>
          <h3>Artikel {article.id}</h3>
          <p className="muted">{article.category} · {article.size ?? 'One Size'}</p>
        </div>
        <div className="preview-actions">
          <button type="button" onClick={onEdit}>Popup öffnen</button>
        </div>
      </div>
      <div className="article-info-grid">
        <div>
          <p className="label">Status</p>
          <p>{statusLabel(article)}</p>
        </div>
        <div>
          <p className="label">Ort</p>
          <p>{article.location.type === 'kind' ? `Bei ${article.location.name}` : 'Lager'}</p>
        </div>
        <div>
          <p className="label">Zuletzt bewegt</p>
          <p>{TIMESTAMP_FORMAT.format(new Date(article.assignedAt))}</p>
        </div>
        <div>
          <p className="label">Nächste Helmprüfung</p>
          <p>{article.helmetNextCheck ? DATE_FORMAT.format(new Date(article.helmetNextCheck)) : '-'}</p>
        </div>
        <div>
          <p className="label">Ablaufdatum</p>
          <p>{article.expiryDate ? DATE_FORMAT.format(new Date(article.expiryDate)) : '-'}</p>
        </div>
      </div>
      {article.notes && (
        <p className="muted">Notizen: {article.notes}</p>
      )}
      {article.warning && (
        <p className="badge badge-warning">
          Warnung: {article.warning.type === 'pruefung' ? 'Prüfung' : 'Ablauf'} bis {DATE_FORMAT.format(new Date(article.warning.date))}
        </p>
      )}
    </section>
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

function composeChildName(child: Child): string {
  return `${child.firstName} ${child.lastName}`.trim();
}

function statusLabel(article: Article): string {
  if (article.warning) {
    return 'Warnung';
  }
  return article.status === 'ausgegeben' ? 'Bei Kind' : article.status === 'frei' ? 'Im Lager' : 'Unbekannt';
}

function renderSizeField(
  form: CreationFormState,
  setForm: React.Dispatch<React.SetStateAction<CreationFormState>>
) {
  const preset = findPresetByKey(form.categoryKey);

  if (preset?.sizeOptions?.length) {
    const hasCustom = Boolean(preset.allowCustomSize);
    const selectValue = form.sizeSelection || '';
    const showCustom = hasCustom && selectValue === '__custom';

    return (
      <div className="size-field">
        <select
          value={showCustom ? '__custom' : selectValue}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '__custom') {
              setForm((prev) => ({ ...prev, sizeSelection: '__custom', size: '' }));
            } else {
              setForm((prev) => ({ ...prev, sizeSelection: value, size: value }));
            }
          }}
        >
          <option value="">Bitte auswählen</option>
          {preset.sizeOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
          {hasCustom && <option value="__custom">Eigene Größe</option>}
        </select>
        {hasCustom && showCustom && (
          <input
            placeholder="Eigene Größe"
            value={form.size}
            onChange={(event) => setForm((prev) => ({ ...prev, size: event.target.value }))}
          />
        )}
      </div>
    );
  }

  return (
    <input
      value={form.size}
      onChange={(event) => setForm((prev) => ({ ...prev, size: event.target.value }))}
    />
  );
}
