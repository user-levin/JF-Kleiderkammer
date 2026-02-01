import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@api/client';
import { Article, Child } from 'types/domain';
import { CATEGORY_PRESETS, CUSTOM_CATEGORY_KEY, findPresetByKey, matchPresetByCategory } from '@constants/articlePresets';

export type ArticleModalProps = {
  article: Article;
  childrenOptions: Child[];
  onClose: () => void;
  onUpdated: (article: Article) => void;
};

type ArticleFormState = {
  category: string;
  size: string;
  expiryDate: string;
  helmetManufacturedAt: string;
  helmetLastCheck: string;
  helmetNextCheck: string;
};

const initialFormState = (article: Article): ArticleFormState => ({
  category: article.category,
  size: article.size ?? '',
  expiryDate: article.expiryDate ?? '',
  helmetManufacturedAt: article.helmetManufacturedAt ?? '',
  helmetLastCheck: article.helmetLastCheck ?? '',
  helmetNextCheck: article.helmetNextCheck ?? '',
});

export default function ArticleModal({ article, childrenOptions, onClose, onUpdated }: ArticleModalProps) {
  const [formState, setFormState] = useState<ArticleFormState>(() => initialFormState(article));
  const [selectedChild, setSelectedChild] = useState<string>(article.location.kindId ? String(article.location.kindId) : '');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');

  useEffect(() => {
    setFormState(initialFormState(article));
    setSelectedChild(article.location.kindId ? String(article.location.kindId) : '');
    setStatusMessage(null);
    setErrorMessage(null);
    setNewNote('');
  }, [article]);

  const isHelmet = formState.category.trim().toLowerCase() === 'helm';

  useEffect(() => {
    if (!isHelmet) {
      return;
    }
    const computedExpiry = computeHelmetExpiry(formState.helmetManufacturedAt);
    setFormState((prev) => {
      if (computedExpiry && computedExpiry !== prev.expiryDate) {
        return { ...prev, expiryDate: computedExpiry };
      }
      if (!computedExpiry && prev.expiryDate !== '') {
        return { ...prev, expiryDate: '' };
      }
      return prev;
    });
  }, [isHelmet, formState.helmetManufacturedAt]);

  const sortedChildren = useMemo(() => {
    return [...childrenOptions].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'aktiv' ? -1 : 1;
      }
      return a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de');
    });
  }, [childrenOptions]);

  const updateMutation = useMutation({
    mutationFn: async (payload: Record<string, string | null>) => {
      const res = await api.patch<{ data: Article }>(`/api/articles/${article.id}`, payload);
      return res.data.data;
    },
    onSuccess: (updatedArticle) => {
      setStatusMessage('Artikel wurde gespeichert.');
      setErrorMessage(null);
      onUpdated(updatedArticle);
    },
    onError: (mutationError: unknown) => {
      setErrorMessage(mutationError instanceof Error ? mutationError.message : 'Artikel konnte nicht gespeichert werden.');
    }
  });

  const assignmentMutation = useMutation({
    mutationFn: async (target: { targetType: 'lager' | 'kind'; kindId?: number }) => {
      const res = await api.patch<{ data: Article }>(`/api/articles/${article.id}/assignment`, target);
      return res.data.data;
    },
    onSuccess: (updatedArticle) => {
      setStatusMessage('Zuweisung aktualisiert.');
      setErrorMessage(null);
      onUpdated(updatedArticle);
    },
    onError: (mutationError: unknown) => {
      setErrorMessage(mutationError instanceof Error ? mutationError.message : 'Zuweisung konnte nicht angepasst werden.');
    }
  });

  const categoryPreset = matchPresetByCategory(formState.category);
  const categorySelectValue = categoryPreset?.key ?? CUSTOM_CATEGORY_KEY;

  const handleCategorySelect = (value: string) => {
    if (value === CUSTOM_CATEGORY_KEY) {
      setFormState((prev) => ({ ...prev, category: '' }));
      return;
    }
    const preset = findPresetByKey(value);
    setFormState((prev) => ({ ...prev, category: preset?.label ?? prev.category }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const payload = buildArticlePayload(article, formState);

    if (newNote.trim()) {
      payload.notes = newNote.trim();
    }

    if (Object.keys(payload).length === 0) {
      setStatusMessage('Keine Änderungen erkannt.');
      return;
    }

    setStatusMessage(null);
    setErrorMessage(null);
    updateMutation.mutate(payload, {
      onSuccess: () => setNewNote('')
    });
  };

  const handleAssignToChild = () => {
    if (!selectedChild) {
      return;
    }
    setStatusMessage(null);
    setErrorMessage(null);
    assignmentMutation.mutate({ targetType: 'kind', kindId: Number(selectedChild) });
  };

  const handleReturnToWarehouse = () => {
    setStatusMessage(null);
    setErrorMessage(null);
    assignmentMutation.mutate({ targetType: 'lager' });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <header className="modal-header">
          <div>
            <p className="muted">Artikel</p>
            <h3>{article.id}</h3>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>Schließen</button>
        </header>
        <div className="modal-body">
          <form className="modal-form" onSubmit={handleSubmit}>
            <label>
              Artikel-ID
              <input value={article.id} disabled />
            </label>
            <label>
              Bezeichnung (automatisch)
              <input value={article.label} disabled />
            </label>
            <label>
              Kategorie*
              <select value={categorySelectValue} onChange={(event) => handleCategorySelect(event.target.value)} required>
                {CATEGORY_PRESETS.map((preset) => (
                  <option key={preset.key} value={preset.key}>{preset.label}</option>
                ))}
                <option value={CUSTOM_CATEGORY_KEY}>Eigene Kategorie</option>
              </select>
            </label>
            {categorySelectValue === CUSTOM_CATEGORY_KEY && (
              <label>
                Eigene Kategorie
                <input
                  value={formState.category}
                  onChange={(event) => setFormState((prev) => ({ ...prev, category: event.target.value }))}
                  required
                />
              </label>
            )}
            <div className="modal-row">
              <label>
                Größe
                <input
                  value={formState.size}
                  onChange={(event) => setFormState((prev) => ({ ...prev, size: event.target.value }))}
                />
              </label>
              <label>
                Ablaufdatum {isHelmet && <span className="muted">(berechnet +10 Jahre)</span>}
                <input
                  type="date"
                  value={formState.expiryDate}
                  onChange={(event) => setFormState((prev) => ({ ...prev, expiryDate: event.target.value }))}
                  disabled={isHelmet}
                />
              </label>
            </div>
            {isHelmet && (
              <div className="modal-row">
                <label>
                  Herstellungsdatum*
                  <input
                    type="date"
                    value={formState.helmetManufacturedAt}
                    onChange={(event) => setFormState((prev) => ({ ...prev, helmetManufacturedAt: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Letzte Prüfung
                  <input
                    type="date"
                    value={formState.helmetLastCheck}
                    onChange={(event) => setFormState((prev) => ({ ...prev, helmetLastCheck: event.target.value }))}
                  />
                </label>
                <label>
                  Nächste Prüfung
                  <input
                    type="date"
                    value={formState.helmetNextCheck}
                    onChange={(event) => setFormState((prev) => ({ ...prev, helmetNextCheck: event.target.value }))}
                  />
                </label>
              </div>
            )}
            <label>
              Notizen (Chronik)
              <textarea
                rows={5}
                value={article.notes ?? ''}
                readOnly
                className="note-log"
              />
            </label>
            <label>
              Neue Notiz
              <textarea
                rows={3}
                value={newNote}
                onChange={(event) => setNewNote(event.target.value)}
                placeholder="Wird beim Speichern mit Zeitstempel ergänzt"
              />
            </label>
            <div className="modal-actions">
              <button type="submit" disabled={updateMutation.isPending}>Änderungen speichern</button>
            </div>
          </form>
          <aside className="modal-sidebar">
            <div className="sidebar-card">
              <p className="label">Status</p>
              <p>{articleStatusLabel(article)}</p>
              <p className="label">Aktueller Ort</p>
              <p>{article.location.type === 'kind' ? `Bei ${article.location.name}` : 'Lager'}</p>
            </div>
            <div className="sidebar-card">
              <h4>Zuweisung</h4>
              <label>
                Kind auswählen
                <select value={selectedChild} onChange={(event) => setSelectedChild(event.target.value)}>
                  <option value="">Bitte auswählen</option>
                  {sortedChildren.map((child) => (
                    <option key={child.id} value={child.id}>
                      {composeChildName(child)}{child.status === 'inaktiv' ? ' (inaktiv)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <div className="sidebar-actions">
                <button type="button" onClick={handleAssignToChild} disabled={!selectedChild || assignmentMutation.isPending}>
                  Zu Kind zuordnen
                </button>
                <button type="button" className="ghost-button" onClick={handleReturnToWarehouse} disabled={assignmentMutation.isPending}>
                  Zurück ins Lager
                </button>
              </div>
            </div>
            {(statusMessage || errorMessage) && (
              <p className={errorMessage ? 'error-text' : 'info-text'}>
                {errorMessage ?? statusMessage}
              </p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function computeHelmetExpiry(manufacturedAt?: string | null): string | null {
  if (!manufacturedAt) {
    return null;
  }
  const date = new Date(manufacturedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setFullYear(date.getFullYear() + 10);
  return date.toISOString().slice(0, 10);
}

function buildArticlePayload(article: Article, form: ArticleFormState): Record<string, string | null> {
  const payload: Record<string, string | null> = {};
  const normalize = (value: string | null | undefined) => (value ?? '').trim();
  const normalizeDate = (value: string | null | undefined) => (value && value.trim() !== '' ? value : null);
  const isHelmet = form.category.trim().toLowerCase() === 'helm';

  if (normalize(form.category) !== article.category) {
    payload.category = form.category.trim();
  }

  if (normalize(form.size) !== normalize(article.size)) {
    payload.size = form.size.trim();
  }

  if (!isHelmet && normalizeDate(form.expiryDate) !== normalizeDate(article.expiryDate)) {
    payload.expiryDate = form.expiryDate || null;
  }

  if (normalizeDate(form.helmetManufacturedAt) !== normalizeDate(article.helmetManufacturedAt)) {
    payload.helmetManufacturedAt = form.helmetManufacturedAt || null;
  }

  if (normalizeDate(form.helmetLastCheck) !== normalizeDate(article.helmetLastCheck)) {
    payload.helmetLastCheck = form.helmetLastCheck || null;
  }

  if (normalizeDate(form.helmetNextCheck) !== normalizeDate(article.helmetNextCheck)) {
    payload.helmetNextCheck = form.helmetNextCheck || null;
  }

  return payload;
}

function articleStatusLabel(article: Article): string {
  switch (article.status) {
    case 'frei':
      return 'Im Lager';
    case 'ausgegeben':
      return article.location.kindId ? `Bei ${article.location.name}` : 'Ausgegeben';
    case 'warnung':
      return 'Warnung aktiv';
    default:
      return 'Unbekannt';
  }
}

function composeChildName(child: Child): string {
  return `${child.firstName} ${child.lastName}`.trim();
}
