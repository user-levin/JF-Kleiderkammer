import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '@api/client';
import { AppUser, UserRole } from 'types/domain';
import { PASSWORD_MIN_LENGTH, ROLE_LABELS, useAuth } from '../auth';

const ROLE_OPTIONS: { value: UserRole; description: string }[] = [
  { value: 'admin', description: 'Alles, inkl. Benutzer, Export und Artikel bearbeiten' },
  { value: 'betreuer', description: 'Alles ansehen und Bekleidung Kindern zuordnen' },
  { value: 'datenbank', description: 'Kinder anlegen, CSV-Import/-Export der Kinder' },
];

const DATE_FORMATTER = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

type CreateUserPayload = {
  email: string;
  password: string;
  roles: UserRole[];
  active: boolean;
};

type UpdateUserPayload = {
  id: number;
  roles?: UserRole[];
  active?: boolean;
  password?: string;
};

const INITIAL_FORM: CreateUserPayload = {
  email: '',
  password: '',
  roles: ['betreuer'],
  active: true,
};

export default function Benutzer() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [formState, setFormState] = useState<CreateUserPayload>(INITIAL_FORM);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [passwordUserId, setPasswordUserId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const usersQuery = useQuery<AppUser[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await api.get<{ data: AppUser[] }>('/api/users');
      return response.data.data;
    },
    staleTime: 60_000,
  });

  const showResult = (status: string | null, error: string | null) => {
    setStatusMessage(status);
    setErrorMessage(error);
  };

  const createMutation = useMutation<AppUser, unknown, CreateUserPayload>({
    mutationFn: async (payload) => {
      const response = await api.post<{ data: AppUser }>('/api/users', payload);
      return response.data.data;
    },
    onSuccess: () => {
      setFormState(INITIAL_FORM);
      showResult('Benutzer wurde angelegt.', null);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (mutationError) => showResult(null, errorText(mutationError, 'Benutzer konnte nicht angelegt werden.')),
  });

  const updateMutation = useMutation<AppUser, unknown, UpdateUserPayload>({
    mutationFn: async ({ id, ...payload }) => {
      const response = await api.patch<{ data: AppUser }>(`/api/users/${id}`, payload);
      return response.data.data;
    },
    onSuccess: (user, variables) => {
      if (variables.password) {
        setPasswordUserId(null);
        setNewPassword('');
        showResult(`Passwort für ${user.email} gesetzt.`, null);
      } else {
        showResult(`${user.email} wurde aktualisiert.`, null);
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (mutationError) => showResult(null, errorText(mutationError, 'Änderung fehlgeschlagen.')),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    showResult(null, null);

    const payload: CreateUserPayload = {
      email: formState.email.trim().toLowerCase(),
      password: formState.password,
      roles: formState.roles,
      active: formState.active,
    };

    if (!payload.email || !payload.password) {
      showResult(null, 'E-Mail und Passwort werden benötigt.');
      return;
    }
    if (payload.roles.length === 0) {
      showResult(null, 'Mindestens eine Rolle auswählen.');
      return;
    }

    createMutation.mutate(payload);
  };

  const toggleFormRole = (role: UserRole) => {
    setFormState((prev) => ({ ...prev, roles: toggleRole(prev.roles, role) }));
  };

  const handleToggleUserRole = (user: AppUser, role: UserRole) => {
    const roles = toggleRole(user.roles, role);
    if (roles.length === 0) {
      showResult(null, 'Mindestens eine Rolle muss bleiben.');
      return;
    }
    updateMutation.mutate({ id: user.id, roles });
  };

  const handlePasswordSubmit = (event: FormEvent, user: AppUser) => {
    event.preventDefault();
    updateMutation.mutate({ id: user.id, password: newPassword });
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
                autoComplete="off"
                value={formState.email}
                onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
            </label>
            <label>
              Passwort*
              <input
                type="password"
                autoComplete="new-password"
                value={formState.password}
                onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
                minLength={PASSWORD_MIN_LENGTH}
                required
              />
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
          <fieldset className="role-fieldset">
            <legend>Rollen* (mehrere möglich)</legend>
            {ROLE_OPTIONS.map((option) => (
              <label key={option.value} className="checkbox-label role-option">
                <input
                  type="checkbox"
                  checked={formState.roles.includes(option.value)}
                  onChange={() => toggleFormRole(option.value)}
                />
                <span>
                  <strong>{ROLE_LABELS[option.value]}</strong>
                  <span className="muted"> – {option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="user-form-actions">
            <button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Speichere…' : 'Benutzer anlegen'}
            </button>
          </div>
        </form>
      </section>

      <section className="card user-list-card">
        <div className="card-header">
          <div>
            <h3>Vorhandene Benutzer</h3>
            <p className="muted">{usersQuery.data?.length ?? 0} Nutzer registriert</p>
          </div>
        </div>
        {(statusMessage || errorMessage) && (
          <p className={errorMessage ? 'error-text' : 'info-text'}>
            {errorMessage ?? statusMessage}
          </p>
        )}
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
                  <th>Rollen</th>
                  <th>Status</th>
                  <th>Letzter Login</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.data.map((user) => {
                  const isSelf = user.id === currentUser?.id;
                  return (
                    <tr key={user.id}>
                      <td>
                        {user.email}
                        {isSelf && <span className="muted"> (du)</span>}
                      </td>
                      <td>
                        <div className="user-role-toggles">
                          {ROLE_OPTIONS.map((option) => {
                            const active = user.roles.includes(option.value);
                            const locked = isSelf && option.value === 'admin';
                            return (
                              <button
                                key={option.value}
                                type="button"
                                className={`user-role-pill ${active ? 'is-active' : 'is-off'}`}
                                onClick={() => handleToggleUserRole(user, option.value)}
                                disabled={locked || updateMutation.isPending}
                                title={locked ? 'Die eigene Admin-Rolle kann nicht entfernt werden' : `${ROLE_LABELS[option.value]} ${active ? 'entziehen' : 'vergeben'}`}
                                aria-pressed={active}
                              >
                                {ROLE_LABELS[option.value]}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <span className={user.active ? 'user-status active' : 'user-status inactive'}>
                          {user.active ? 'Aktiv' : 'Deaktiviert'}
                        </span>
                      </td>
                      <td>{user.lastLoginAt ? DATE_FORMATTER.format(new Date(user.lastLoginAt)) : '–'}</td>
                      <td>
                        {passwordUserId === user.id ? (
                          <form className="user-password-form" onSubmit={(event) => handlePasswordSubmit(event, user)}>
                            <input
                              type="password"
                              autoComplete="new-password"
                              placeholder="Neues Passwort"
                              minLength={PASSWORD_MIN_LENGTH}
                              value={newPassword}
                              onChange={(event) => setNewPassword(event.target.value)}
                              required
                              autoFocus
                            />
                            <button type="submit" disabled={updateMutation.isPending}>Setzen</button>
                            <button type="button" className="ghost-button" onClick={() => setPasswordUserId(null)}>
                              Abbrechen
                            </button>
                          </form>
                        ) : (
                          <div className="inventory-action-group">
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => {
                                setNewPassword('');
                                setPasswordUserId(user.id);
                              }}
                            >
                              Passwort setzen
                            </button>
                            {!isSelf && (
                              <button
                                type="button"
                                className={`ghost-button ${user.active ? 'danger' : ''}`}
                                onClick={() => updateMutation.mutate({ id: user.id, active: !user.active })}
                                disabled={updateMutation.isPending}
                              >
                                {user.active ? 'Deaktivieren' : 'Aktivieren'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
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

function toggleRole(roles: UserRole[], role: UserRole): UserRole[] {
  return roles.includes(role) ? roles.filter((entry) => entry !== role) : [...roles, role];
}

function errorText(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error;
  }
  return fallback;
}
