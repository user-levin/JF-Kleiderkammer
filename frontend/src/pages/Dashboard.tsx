import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const { data } = useQuery({
    queryKey: ['overview'],
    queryFn: async () => {
      const res = await api.get('/health');
      return res.data;
    }
  });

  return (
    <section className="card">
      <div className="card-header">
        <h2>?bersicht</h2>
        <button onClick={onLogout}>Logout</button>
      </div>
      <p>Status Backend: {data ? 'online' : 'l?dt?'}</p>
      <p>API Ping: {data?.status ?? '-'}</p>
    </section>
  );
}
