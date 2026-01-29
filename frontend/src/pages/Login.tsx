import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@api/client';

export default function Login({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post('/login', { email, password });
      onSuccess(res.data.token);
    } catch (err) {
      setError('Login fehlgeschlagen');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <h2>Anmelden</h2>
        <label>
          E-Mail
          <input value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Passwort
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? '?' : 'Login'}
        </button>
        <button type="button" onClick={() => navigate('/')}>Abbrechen</button>
      </form>
    </div>
  );
}
