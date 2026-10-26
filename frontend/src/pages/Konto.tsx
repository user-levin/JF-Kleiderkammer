import { FormEvent, useState } from 'react';
import axios from 'axios';
import { api } from '@api/client';
import { PASSWORD_MIN_LENGTH, ROLE_LABELS, useAuth } from '../auth';
import { downloadBlob } from '../utils/inventoryExport';

export default function Konto() {
  const { user, can } = useAuth();
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  const handleBackupDownload = async () => {
    setBackupBusy(true);
    setBackupError(null);
    try {
      const res = await api.get('/api/backup/download', { responseType: 'blob' });
      const disposition = String(res.headers['content-disposition'] ?? '');
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'kleiderkammer-backup.sql.gz';
      downloadBlob(filename, res.data as Blob);
    } catch {
      setBackupError('Backup konnte nicht erstellt werden.');
    } finally {
      setBackupBusy(false);
    }
  };
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (newPassword !== repeatPassword) {
      setError('Die neuen Passwörter stimmen nicht überein.');
      return;
    }

    setBusy(true);
    try {
      await api.post('/api/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      setMessage('Passwort geändert. Auf anderen Geräten musst du dich neu anmelden.');
    } catch (submitError) {
      const apiMessage = axios.isAxiosError(submitError) ? submitError.response?.data?.error : null;
      setError(typeof apiMessage === 'string' ? apiMessage : 'Passwort konnte nicht geändert werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card konto-card">
      <div className="card-header">
        <div>
          <h2>Mein Konto</h2>
          <p className="muted">
            {user?.email}
            {user && user.roles.length > 0 && ` · ${user.roles.map((role) => ROLE_LABELS[role] ?? role).join(', ')}`}
          </p>
        </div>
      </div>

      <h3>Passwort ändern</h3>
      <form className="konto-form" onSubmit={handleSubmit}>
        {/* Verstecktes Benutzerfeld, damit Passwortmanager (z. B. KeePassXC) das richtige Konto aktualisieren */}
        <input type="email" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
        <label>
          Aktuelles Passwort
          <input
            type="password"
            name="current-password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </label>
        <label>
          Neues Passwort <span className="muted">(mindestens {PASSWORD_MIN_LENGTH} Zeichen)</span>
          <input
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
        </label>
        <label>
          Neues Passwort wiederholen
          <input
            type="password"
            name="new-password-repeat"
            autoComplete="new-password"
            value={repeatPassword}
            onChange={(event) => setRepeatPassword(event.target.value)}
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
        </label>
        {message && <p className="info-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
        <div>
          <button type="submit" disabled={busy}>
            {busy ? 'Speichere …' : 'Passwort ändern'}
          </button>
        </div>
      </form>

      {can('data.backup') && (
        <div className="konto-backup">
          <h3>Datensicherung</h3>
          <p className="muted">
            Erstellt ein aktuelles Backup der kompletten Datenbank und lädt es herunter (.sql.gz). Die Datei
            enthält Namen der Kinder und Passwort-Hashes – sicher aufbewahren. Wiederherstellen siehe README.
          </p>
          {backupError && <p className="error-text">{backupError}</p>}
          <button type="button" onClick={handleBackupDownload} disabled={backupBusy}>
            {backupBusy ? 'Backup wird erstellt …' : 'Backup jetzt herunterladen'}
          </button>
        </div>
      )}
    </section>
  );
}
