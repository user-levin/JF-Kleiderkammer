import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '@api/client';
import ArticleModal from '@components/ArticleModal';
import { Article, Child } from 'types/domain';

type ChildFormState = {
  firstName: string;
  lastName: string;
};

const EMPTY_FORM: ChildFormState = { firstName: '', lastName: '' };

type StatusFilter = 'alle' | 'aktiv' | 'inaktiv';

export default function Kinder() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle');
  const [newChild, setNewChild] = useState<ChildFormState>({ ...EMPTY_FORM });
  const [editingChild, setEditingChild] = useState<Child | null>(null);
  const [editForm, setEditForm] = useState<ChildFormState>({ ...EMPTY_FORM });
  const [editStatus, setEditStatus] = useState<'aktiv' | 'inaktiv'>('aktiv');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<Child | null>(null);
  const [activeArticle, setActiveArticle] = useState<Article | null>(null);

  const childrenQuery = useQuery({
    queryKey: ['children'],
    queryFn: async () => {
      const res = await api.get<{ data: Child[] }>('/api/children');
      return res.data.data;
    }
  });

  useEffect(() => {
    if (!editingChild) {
      setEditForm({ ...EMPTY_FORM });
      setEditStatus('aktiv');
      return;
    }
    setEditForm({ firstName: editingChild.firstName, lastName: editingChild.lastName });
    setEditStatus(editingChild.status);
  }, [editingChild]);

  useEffect(() => {
    if (!selectedChild || !childrenQuery.data) {
      return;
    }
    const latest = childrenQuery.data.find((child) => child.id === selectedChild.id);
    if (!latest) {
      setSelectedChild(null);
      setActiveArticle(null);
    } else if (latest !== selectedChild) {
      setSelectedChild(latest);
    }
  }, [childrenQuery.data, selectedChild]);

  useEffect(() => {
    if (!selectedChild) {
      setActiveArticle(null);
    }
  }, [selectedChild]);

  const filteredChildren = useMemo(() => {
    const list = childrenQuery.data ?? [];
    const term = searchTerm.trim().toLowerCase();
    return list
      .filter((child) => (statusFilter === 'alle' || child.status === statusFilter))
      .filter((child) => {
        if (!term) {
          return true;
        }
        const haystack = `${child.firstName} ${child.lastName}`.toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de'));
  }, [childrenQuery.data, searchTerm, statusFilter]);

  const invalidateChildren = () => queryClient.invalidateQueries({ queryKey: ['children'] });

  const selectedChildId = selectedChild?.id;

  const childArticlesQuery = useQuery({
    queryKey: ['child-articles', selectedChildId],
    queryFn: async () => {
      if (!selectedChildId) {
        return [];
      }
      const res = await api.get<{ data: Article[] }>(`/api/children/${selectedChildId}/articles`);
      return res.data.data;
    },
    enabled: Boolean(selectedChildId),
  });

  const handleArticleUpdated = (updatedArticle: Article) => {
    setActiveArticle(updatedArticle);
    if (selectedChildId) {
      queryClient.invalidateQueries({ queryKey: ['child-articles', selectedChildId] });
    }
    invalidateChildren();
  };

  const createMutation = useMutation({
    mutationFn: async (payload: ChildFormState) => {
      const res = await api.post<{ data: Child }>('/api/children', payload);
      return res.data.data;
    },
    onSuccess: () => {
      setNewChild({ ...EMPTY_FORM });
      setFeedback('Kind wurde angelegt.');
      setError(null);
      invalidateChildren();
    },
    onError: (mutationError: unknown) => {
      setError(resolveErrorMessage(mutationError));
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Partial<{ firstName: string; lastName: string; status: 'aktiv' | 'inaktiv' }> }) => {
      const res = await api.patch<{ data: Child }>(`/api/children/${id}`, payload);
      return res.data.data;
    },
    onSuccess: (_, variables) => {
      setFeedback('Kind wurde aktualisiert.');
      setError(null);
      if (editingChild && variables.id === editingChild.id) {
        setEditingChild(null);
      }
      invalidateChildren();
    },
    onError: (mutationError: unknown) => {
      setError(resolveErrorMessage(mutationError));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/children/${id}`);
    },
    onSuccess: () => {
      setFeedback('Kind wurde gelöscht.');
      setError(null);
      invalidateChildren();
    },
    onError: (mutationError: unknown) => {
      setError(resolveErrorMessage(mutationError));
    }
  });

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!newChild.firstName.trim() || !newChild.lastName.trim()) {
      setError('Vor- und Nachname werden benötigt.');
      return;
    }
    createMutation.mutate({ firstName: newChild.firstName.trim(), lastName: newChild.lastName.trim() });
  };

  const handleEditSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editingChild) {
      return;
    }
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) {
      setError('Vor- und Nachname werden benötigt.');
      return;
    }
    updateMutation.mutate({
      id: editingChild.id,
      payload: {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        status: editStatus
      }
    });
  };

  const handleToggleStatus = (child: Child) => {
    const newStatus = child.status === 'aktiv' ? 'inaktiv' : 'aktiv';
    updateMutation.mutate({ id: child.id, payload: { status: newStatus } });
  };

  const handleDelete = (child: Child) => {
    if (typeof window !== 'undefined' && !window.confirm(`Soll ${child.firstName} ${child.lastName} wirklich gelöscht werden?`)) {
      return;
    }
    deleteMutation.mutate(child.id);
  };

  const handleSelectChild = (child: Child) => {
    setSelectedChild((current) => (current?.id === child.id ? current : child));
  };

  const handleCloseChildPanel = () => {
    setSelectedChild(null);
    setActiveArticle(null);
  };

  return (
    <div className="children-layout">
      <div className="children-columns">
        <section className="card child-card">
          <div className="card-header">
            <div>
              <h2>Kind hinzufügen</h2>
              <p className="muted">Neue Zuordnung vorbereiten</p>
            </div>
          </div>
          <form className="child-form" onSubmit={handleCreate}>
            <label>
              Vorname*
              <input value={newChild.firstName} onChange={(event) => setNewChild((prev) => ({ ...prev, firstName: event.target.value }))} />
            </label>
            <label>
              Nachname*
              <input value={newChild.lastName} onChange={(event) => setNewChild((prev) => ({ ...prev, lastName: event.target.value }))} />
            </label>
            <button type="submit" disabled={createMutation.isPending}>Kind speichern</button>
          </form>
        </section>

        {editingChild && (
          <section className="card child-card">
            <div className="card-header">
              <div>
                <h3>Kind bearbeiten</h3>
                <p className="muted">ID {editingChild.id}</p>
              </div>
              <button type="button" className="ghost-button" onClick={() => setEditingChild(null)}>Schließen</button>
            </div>
            <form className="child-form" onSubmit={handleEditSubmit}>
              <label>
                Vorname*
                <input value={editForm.firstName} onChange={(event) => setEditForm((prev) => ({ ...prev, firstName: event.target.value }))} />
              </label>
              <label>
                Nachname*
                <input value={editForm.lastName} onChange={(event) => setEditForm((prev) => ({ ...prev, lastName: event.target.value }))} />
              </label>
              <label>
                Status
                <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as 'aktiv' | 'inaktiv')}>
                  <option value="aktiv">Aktiv</option>
                  <option value="inaktiv">Inaktiv</option>
                </select>
              </label>
              <button type="submit" disabled={updateMutation.isPending}>Änderungen speichern</button>
            </form>
          </section>
        )}
      </div>

      <section className="card child-list-card">
        <div className="card-header child-list-header">
          <div>
            <h2>Alle Kinder</h2>
            <p className="muted">Suche und Filter anwenden</p>
          </div>
          <div className="child-filter-bar">
            <input
              type="search"
              placeholder="Suchen..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="alle">Alle</option>
              <option value="aktiv">Aktiv</option>
              <option value="inaktiv">Inaktiv</option>
            </select>
          </div>
        </div>
        {childrenQuery.isLoading && <p className="muted">Lade Kinder ...</p>}
        {!childrenQuery.isLoading && filteredChildren.length === 0 && (
          <p className="muted">Keine Kinder mit den aktuellen Filtern gefunden.</p>
        )}
        <div className="child-list">
          {filteredChildren.map((child) => (
            <article
              key={child.id}
              className={`child-row ${selectedChildId === child.id ? 'is-selected' : ''}`}
            >
              <button type="button" className="child-info-button" onClick={() => handleSelectChild(child)}>
                <p className="child-name">{child.firstName} {child.lastName}</p>
                <p className="muted">ID {child.id} · {(child.articleCount ?? 0)} Teile</p>
              </button>
              <span className={`status-badge ${child.status === 'aktiv' ? 'is-success' : 'is-muted'}`}>
                {child.status === 'aktiv' ? 'Aktiv' : 'Inaktiv'}
              </span>
              <div className="child-actions">
                <button type="button" onClick={() => setEditingChild(child)}>Bearbeiten</button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => handleToggleStatus(child)}
                  disabled={updateMutation.isPending}
                >
                  {child.status === 'aktiv' ? 'Inaktiv setzen' : 'Aktivieren'}
                </button>
                <button
                  type="button"
                  className="ghost-button danger"
                  onClick={() => handleDelete(child)}
                  disabled={deleteMutation.isPending}
                >
                  Löschen
                </button>
              </div>
            </article>
          ))}
        </div>
        {(feedback || error) && (
          <p className={error ? 'error-text' : 'info-text'}>{error ?? feedback}</p>
        )}
      </section>

      {selectedChild && (
        <section className="card child-inventory-card">
          <div className="card-header">
            <div>
              <h3>{composeChildName(selectedChild)}</h3>
              <p className="muted">
                {childArticlesQuery.isLoading && 'Artikel werden geladen ...'}
                {!childArticlesQuery.isLoading && `${childArticlesQuery.data?.length ?? 0} Artikel zugeordnet`}
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={handleCloseChildPanel}>Schließen</button>
          </div>
          {childArticlesQuery.isError && <p className="error-text">Artikel konnten nicht geladen werden.</p>}
          {childArticlesQuery.isSuccess && (childArticlesQuery.data?.length ?? 0) === 0 && (
            <p className="muted">Dem Kind sind aktuell keine Artikel zugeordnet.</p>
          )}
          {childArticlesQuery.isSuccess && childArticlesQuery.data && childArticlesQuery.data.length > 0 && (
            <div className="child-article-list">
              {childArticlesQuery.data.map((article) => (
                <article key={article.id} className="child-article-row">
                  <div>
                    <p className="child-article-title">{article.label}</p>
                    <p className="child-article-meta">
                      ID {article.id} · {article.category}
                      {article.size ? ` · Größe ${article.size}` : ''}
                    </p>
                  </div>
                  <div className="child-article-actions">
                    <button type="button" onClick={() => setActiveArticle(article)}>Bearbeiten</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeArticle && (
        <ArticleModal
          article={activeArticle}
          childrenOptions={childrenQuery.data ?? []}
          onClose={() => setActiveArticle(null)}
          onUpdated={handleArticleUpdated}
        />
      )}
    </div>
  );
}

function resolveErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const apiMessage = error.response?.data?.error;
    if (typeof apiMessage === 'string') {
      return apiMessage;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Aktion konnte nicht abgeschlossen werden.';
}

function composeChildName(child: Child): string {
  return `${child.firstName} ${child.lastName}`.trim();
}
