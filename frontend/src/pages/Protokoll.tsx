import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { AppUser } from 'types/domain';

type AuditEntry = {
  id: number;
  createdAt: string;
  userId: number | null;
  userEmail: string | null;
  action: string;
  entityId: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  ip: string | null;
};

type AuditPage = {
  entries: AuditEntry[];
  hasMore: boolean;
  categories: Record<string, string>;
};

const PAGE_SIZE = 50;
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'medium' });

export default function Protokoll() {
  const [category, setCategory] = useState('');
  const [userId, setUserId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Suche erst nach kurzer Tipp-Pause abschicken
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const usersQuery = useQuery<AppUser[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get<{ data: AppUser[] }>('/api/users')).data.data,
    staleTime: 60_000
  });

  const auditQuery = useInfiniteQuery({
    queryKey: ['audit', category, userId, search],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await api.get<{ data: AuditPage }>('/api/audit', {
        params: { category, userId, q: search, limit: PAGE_SIZE, offset: pageParam }
      });
      return res.data.data;
    },
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length * PAGE_SIZE : undefined)
  });

  const entries = auditQuery.data?.pages.flatMap((page) => page.entries) ?? [];
  const categories = auditQuery.data?.pages[0]?.categories ?? {};

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>Protokoll</h2>
          <p className="muted">Wer hat wann was gemacht – Anmeldungen und alle Änderungen</p>
        </div>
        <div className="card-actions">
          <button className="ghost-button" type="button" onClick={() => auditQuery.refetch()} disabled={auditQuery.isFetching}>
            {auditQuery.isFetching ? 'Aktualisiere…' : 'Aktualisieren'}
          </button>
        </div>
      </div>

      <div className="audit-filters">
        <input
          type="search"
          placeholder="Suchen (Name, Inventarnummer, E-Mail) …"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Bereich">
          <option value="">Alle Bereiche</option>
          {Object.entries(categories).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select value={userId} onChange={(event) => setUserId(event.target.value)} aria-label="Benutzer">
          <option value="">Alle Benutzer</option>
          {(usersQuery.data ?? []).map((user) => (
            <option key={user.id} value={user.id}>{user.email}</option>
          ))}
        </select>
      </div>

      {auditQuery.isError && <p className="error-text">Protokoll konnte nicht geladen werden.</p>}
      {auditQuery.isLoading ? (
        <p className="muted">Protokoll wird geladen …</p>
      ) : entries.length === 0 ? (
        <p className="muted">Keine Einträge gefunden.</p>
      ) : (
        <div className="user-table-wrapper">
          <table className="user-table audit-table">
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Benutzer</th>
                <th>Bereich</th>
                <th>Was</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const categoryKey = entry.action.split('.')[0];
                const hasDetails = entry.details !== null && Object.keys(entry.details).length > 0;
                const isFailedLogin = entry.action === 'auth.login_failed';
                return (
                  <tr key={entry.id} className={isFailedLogin ? 'audit-row-warning' : undefined}>
                    <td className="audit-time">{DATE_TIME_FORMAT.format(new Date(entry.createdAt))}</td>
                    <td>{entry.userEmail ?? '–'}</td>
                    <td>
                      <span className={`audit-category audit-category-${categoryKey}`}>
                        {categories[categoryKey] ?? categoryKey}
                      </span>
                    </td>
                    <td>
                      {entry.summary}
                      {hasDetails && (
                        <button
                          type="button"
                          className="audit-details-toggle"
                          onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                        >
                          {expandedId === entry.id ? 'weniger' : 'Details'}
                        </button>
                      )}
                      {expandedId === entry.id && entry.details && <AuditDetails details={entry.details} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {auditQuery.hasNextPage && (
        <div className="audit-more">
          <button
            type="button"
            className="ghost-button"
            onClick={() => auditQuery.fetchNextPage()}
            disabled={auditQuery.isFetchingNextPage}
          >
            {auditQuery.isFetchingNextPage ? 'Lade …' : 'Ältere Einträge laden'}
          </button>
        </div>
      )}
    </section>
  );
}

function AuditDetails({ details }: { details: Record<string, unknown> }) {
  return (
    <dl className="audit-details">
      {Object.entries(details).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{formatDetailValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '–';
  }
  if (typeof value === 'object' && 'von' in value && 'nach' in value) {
    const change = value as { von: unknown; nach: unknown };
    return `${formatDetailValue(change.von)} → ${formatDetailValue(change.nach)}`;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '–' : value.map(formatDetailValue).join('; ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${formatDetailValue(entry)}`)
      .join(', ');
  }
  return String(value);
}
