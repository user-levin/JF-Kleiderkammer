import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '@api/client';

export type Todo = {
  id: number;
  text: string;
  createdAt: string;
  createdBy: string | null;
  doneAt: string | null;
  doneBy: string | null;
  deleteAt: string | null;
};

type UpdateTodoPayload = { id: number; text?: string; done?: boolean };

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export const TODOS_QUERY_KEY = ['todos'];

export async function fetchTodos(): Promise<Todo[]> {
  const res = await api.get<{ data: Todo[] }>('/api/todos');
  return res.data.data;
}

export default function Todos() {
  const queryClient = useQueryClient();
  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [showDone, setShowDone] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const todosQuery = useQuery({ queryKey: TODOS_QUERY_KEY, queryFn: fetchTodos });

  const onError = (mutationError: unknown) => {
    const apiMessage = axios.isAxiosError(mutationError) ? mutationError.response?.data?.error : null;
    setError(typeof apiMessage === 'string' ? apiMessage : 'Aktion fehlgeschlagen.');
  };
  const onSuccess = () => {
    setError(null);
    queryClient.invalidateQueries({ queryKey: TODOS_QUERY_KEY });
  };

  const createMutation = useMutation({
    mutationFn: async (text: string) => (await api.post<{ data: Todo }>('/api/todos', { text })).data.data,
    onSuccess: () => {
      setNewText('');
      onSuccess();
    },
    onError
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...payload }: UpdateTodoPayload) =>
      (await api.patch<{ data: Todo }>(`/api/todos/${id}`, payload)).data.data,
    onSuccess: () => {
      setEditingId(null);
      onSuccess();
    },
    onError
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/todos/${id}`);
    },
    onSuccess,
    onError
  });

  const todos = todosQuery.data ?? [];
  const openTodos = todos.filter((todo) => !todo.doneAt);
  const doneTodos = todos.filter((todo) => todo.doneAt);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (newText.trim()) {
      createMutation.mutate(newText.trim());
    }
  };

  const handleEditSubmit = (event: FormEvent, todo: Todo) => {
    event.preventDefault();
    if (editText.trim() && editText.trim() !== todo.text) {
      updateMutation.mutate({ id: todo.id, text: editText.trim() });
    } else {
      setEditingId(null);
    }
  };

  const handleDelete = (todo: Todo) => {
    if (todo.doneAt || window.confirm(`Todo „${todo.text}“ wirklich löschen?`)) {
      deleteMutation.mutate(todo.id);
    }
  };

  const renderTodo = (todo: Todo) => {
    const isDone = Boolean(todo.doneAt);
    return (
      <li key={todo.id} className={`todo-item ${isDone ? 'is-done' : ''}`}>
        <input
          type="checkbox"
          className="todo-check"
          checked={isDone}
          onChange={() => updateMutation.mutate({ id: todo.id, done: !isDone })}
          aria-label={isDone ? 'Wieder als offen markieren' : 'Als erledigt markieren'}
        />
        <div className="todo-body">
          {editingId === todo.id ? (
            <form className="todo-edit-form" onSubmit={(event) => handleEditSubmit(event, todo)}>
              <input
                value={editText}
                onChange={(event) => setEditText(event.target.value)}
                maxLength={500}
                autoFocus
                onKeyDown={(event) => event.key === 'Escape' && setEditingId(null)}
              />
              <button type="submit" disabled={updateMutation.isPending}>Speichern</button>
              <button type="button" className="ghost-button" onClick={() => setEditingId(null)}>Abbrechen</button>
            </form>
          ) : (
            <p className="todo-text">{todo.text}</p>
          )}
          <p className="todo-meta">
            {todo.createdBy ?? 'Unbekannt'} · {DATE_TIME_FORMAT.format(new Date(todo.createdAt))}
            {isDone && todo.doneAt && (
              <>
                {' '}· erledigt von {todo.doneBy ?? 'Unbekannt'} am {DATE_FORMAT.format(new Date(todo.doneAt))}
                {todo.deleteAt && <> · wird am {DATE_FORMAT.format(new Date(todo.deleteAt))} gelöscht</>}
              </>
            )}
          </p>
        </div>
        {editingId !== todo.id && (
          <div className="todo-actions">
            {!isDone && (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setEditText(todo.text);
                  setEditingId(todo.id);
                }}
              >
                Bearbeiten
              </button>
            )}
            <button
              type="button"
              className="ghost-button danger"
              onClick={() => handleDelete(todo)}
              disabled={deleteMutation.isPending}
            >
              Löschen
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <section className="card todo-card">
      <div className="card-header">
        <div>
          <h2>Todos</h2>
          <p className="muted">Gemeinsame Aufgaben – erledigte werden nach einem Monat automatisch gelöscht</p>
        </div>
      </div>

      <form className="todo-add-form" onSubmit={handleCreate}>
        <input
          placeholder="Neues Todo, z. B. Helme Größe M nachbestellen"
          value={newText}
          onChange={(event) => setNewText(event.target.value)}
          maxLength={500}
        />
        <button type="submit" disabled={createMutation.isPending || !newText.trim()}>
          Hinzufügen
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}

      {todosQuery.isLoading ? (
        <p className="muted">Todos werden geladen …</p>
      ) : (
        <>
          <h3 className="todo-section-title">Offen ({openTodos.length})</h3>
          {openTodos.length === 0 ? (
            <p className="muted">Nichts zu tun.</p>
          ) : (
            <ul className="todo-list">{openTodos.map(renderTodo)}</ul>
          )}

          {doneTodos.length > 0 && (
            <>
              <button type="button" className="todo-section-toggle" onClick={() => setShowDone((state) => !state)}>
                {showDone ? '▾' : '▸'} Erledigt ({doneTodos.length})
              </button>
              {showDone && <ul className="todo-list">{doneTodos.map(renderTodo)}</ul>}
            </>
          )}
        </>
      )}
    </section>
  );
}
