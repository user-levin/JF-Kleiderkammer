import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/client';
import { AppUser, UserRole } from 'types/domain';

const ROLE_OPTIONS: { label: string; value: UserRole }[] = [
  { label: 'Leser', value: 'leser' },
  { label: 'Verwalter', value: 'verwalter' },
  { label: 'Admin', value: 'admin' },
];

const DATE_FORMATTER = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

type CreateUserPayload = {
  email: string;
  password: string;
  role: UserRole;
  active: boolean;
};

const INITIAL_FORM: CreateUserPayload = {
  email: '',
  password: '',
  role: 'leser',
  active: true,
};

export default function Benutzer() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<CreateUserPayload>(INITIAL_FORM);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const usersQuery = useQuery<AppUser[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await api.get<{ data: AppUser[] }>('/api/users');
      return response.data.data;
    },
    staleTime: 60_000,
  });

  const createMutation = useMutation<AppUser, unknown, CreateUserPayload>({
    mutationFn: async (payload) => {
      const response = await api.post<{ data: AppUser }>('/api/users', payload);
      return response.data.data;
    },
    onSuccess: () => {
      setFormState(INITIAL_FORM);
      setStatusMessage('Benutzer wurde angelegt.');
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (mutationError) => {
      const fallback = mutationError instanceof Error ? mutationError.message : 'Benutzer konnte nicht angelegt werden.';
      setErrorMessage(fallback);
      setStatusMessage(null);
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setStatusMessage(null);
    setErrorMessage(null);

    const payload: CreateUserPayload = {
      email: formState.email.trim().toLowerCase(),
      password: formState.password.trim(),
      role: formState.role,
      active: formState.active,
    };

    if (!payload.email || !payload.password) {
      setErrorMessage('E-Mail und Passwort werden benötigt.');
      return;
    }

    createMutation.mutate(payload);
  };

  return (
    <div className="users-layout">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Benutzer verwalten</h2>
            <p className="muted">Neue Benutzer hinzufügen und Rollen vergeben</p>
          </div>
        </div>
        <form className="user-form" onSubmit={handleSubmit}>
          <div className="user-form-grid">
            <label>
              E-Mail*
              <input
                type="email"
                value={formState.email}
                onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
            </label>
            <label>
              Passwort*
              <input
                type="password"
                value={formState.password}
                onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
                minLength={8}
                required
              />
            </label>
            <label>
              Rolle*
              <select
                value={formState.role}
                onChange={(event) => setFormState((prev) => ({ ...prev, role: event.target.value as UserRole }))}
                required
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
            </label>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={formState.active}
                onChange={(event) => setFormState((prev) => ({ ...prev, active: event.target.checked }))}
              />
              <span>Aktiv</span>
            </label>
          </div>
          <div className="user-form-actions">
            <button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Speichere…' : 'Benutzer anlegen'}
            </button>
          </div>
        </form>
        {(statusMessage || errorMessage) && (
          <p className={errorMessage ? 'error-text' : 'info-text'}>
            {errorMessage ?? statusMessage}
          </p>
        )}
      </section>

      <section className="card user-list-card">
        <div className="card-header">
          <div>
            <h3>Vorhandene Benutzer</h3>
            <p className="muted">{usersQuery.data?.length ?? 0} Nutzer registriert</p>
          </div>
        </div>
        {usersQuery.isLoading ? (
          <p className="muted">Benutzer werden geladen …</p>
        ) : usersQuery.isError ? (
          <p className="error-text">Benutzer konnten nicht geladen werden.</p>
        ) : usersQuery.data && usersQuery.data.length > 0 ? (
          <div className="user-table-wrapper">
            <table className="user-table">
              <thead>
                <tr>
                  <th>E-Mail</th>
                  <th>Rolle</th>
                  <th>Status</th>
                  <th>Erstellt</th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.data.map((user) => {
                  const roleLabel = ROLE_OPTIONS.find((role) => role.value === user.role)?.label ?? user.role;
                  return (
                    <tr key={user.id}>
                      <td>{user.email}</td>
                      <td><span className="user-role-pill">{roleLabel}</span></td>
                    <td>
                      <span className={user.active ? 'user-status active' : 'user-status inactive'}>
                        {user.active ? 'Aktiv' : 'Deaktiviert'}
                      </span>
                    </td>
                      <td>{DATE_FORMATTER.format(new Date(user.createdAt))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Noch keine Benutzer vorhanden.</p>
        )}
      </section>
    </div>
  );
}
