import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@api/client';
import { CATEGORY_PRESETS } from '@constants/articlePresets';
import { Article } from 'types/domain';

type SizeCount = {
  size: string;
  count: number;
};

export default function PublicSearch() {
  const { data: articles = [], isLoading, error } = useQuery<Article[]>({
    queryKey: ['articles'],
    queryFn: async () => {
      const res = await api.get<{ data: Article[] }>('/api/articles');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const [category, setCategory] = useState<string>(CATEGORY_PRESETS[0]?.label ?? '');
  const [size, setSize] = useState<string>('');
  const [customSize, setCustomSize] = useState<string>('');

  const preset = useMemo(
    () => CATEGORY_PRESETS.find((entry) => entry.label === category),
    [category]
  );

  const sizeOptions = useMemo(() => {
    if (preset?.sizeOptions?.length) {
      return preset.sizeOptions;
    }
    const unique = new Set<string>();
    articles
      .filter((article) => article.category === category && article.size)
      .forEach((article) => {
        if (article.size) {
          unique.add(article.size);
        }
      });
    return sortSizes(Array.from(unique));
  }, [articles, category, preset]);

  useEffect(() => {
    if (preset?.key === 'helm') {
      setSize(preset.defaultSize ?? 'Einheitsgröße');
      setCustomSize('');
      return;
    }

    if (sizeOptions.length > 0) {
      setSize((current) => (sizeOptions.includes(current) ? current : sizeOptions[0]));
      setCustomSize('');
      return;
    }

    setSize('');
  }, [preset, sizeOptions]);

  const resolvedSize = size || customSize.trim();

  const countsBySize = useMemo(() => {
    const map = new Map<string, number>();
    articles
      .filter((article) => article.category === category && article.location.type === 'lager')
      .forEach((article) => {
        const sizeKey = article.size || 'One Size';
        map.set(sizeKey, (map.get(sizeKey) ?? 0) + 1);
      });
    return map;
  }, [articles, category]);

  const chartSizes = useMemo<SizeCount[]>(() => {
    const allSizes = sizeOptions.length > 0 ? sizeOptions : sortSizes(Array.from(countsBySize.keys()));
    const range = getSizeRange(allSizes, resolvedSize);

    return range.map((entry) => ({
      size: entry,
      count: countsBySize.get(entry) ?? 0,
    }));
  }, [countsBySize, resolvedSize, sizeOptions]);

  const selectedCount = resolvedSize ? countsBySize.get(resolvedSize) ?? 0 : 0;
  const maxCount = Math.max(1, ...chartSizes.map((entry) => entry.count));

  return (
    <div className="public-search-layout">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>Suche</h2>
            <p className="muted">Bestand im Lager nach Kategorie und Groesse</p>
          </div>
        </div>

        <div className="public-search-form">
          <label>
            Kategorie
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORY_PRESETS.map((entry) => (
                <option key={entry.key} value={entry.label}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          {preset?.key === 'helm' ? (
            <label>
              Groesse
              <input type="text" value={preset.defaultSize ?? 'Einheitsgroesse'} disabled />
            </label>
          ) : sizeOptions.length > 0 ? (
            <label>
              Groesse
              <select value={size} onChange={(event) => setSize(event.target.value)}>
                {sizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Groesse
              <input
                type="text"
                value={customSize}
                onChange={(event) => setCustomSize(event.target.value)}
                placeholder="z.B. 128"
              />
            </label>
          )}
        </div>

        {error && <p className="error">Fehler beim Laden der Artikel.</p>}
        {isLoading ? (
          <p className="muted">Bestand wird geladen ...</p>
        ) : resolvedSize ? (
          <div className="public-search-results">
            <p className="public-search-total">
              Verfuegbar im Lager ({category}, Groesse {resolvedSize}):
              <span>{selectedCount}</span>
            </p>
            <div className="public-size-chart">
              {chartSizes.map((entry) => (
                <div
                  key={entry.size}
                  className={`public-size-row ${entry.size === resolvedSize ? 'is-selected' : ''}`}
                >
                  <span className="public-size-label">{entry.size}</span>
                  <div className="public-size-track">
                    <div
                      className="public-size-bar"
                      style={{ width: `${(entry.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="public-size-count">{entry.count}</span>
                </div>
              ))}
            </div>
            <p className="muted">Die Anzeige beruecksichtigt auch zwei Größen kleiner/groesser.</p>
          </div>
        ) : (
          <p className="muted">Bitte eine Groesse auswaehlen.</p>
        )}
      </section>
    </div>
  );
}

function sortSizes(values: string[]): string[] {
  const numeric = values.every((value) => !Number.isNaN(Number(value)));
  if (numeric) {
    return values
      .map((value) => Number(value))
      .sort((a, b) => a - b)
      .map((value) => String(value));
  }
  return values.sort((a, b) => a.localeCompare(b, 'de-DE'));
}

function getSizeRange(allSizes: string[], selected: string): string[] {
  if (!selected) {
    return allSizes.slice(0, 5);
  }

  const index = allSizes.findIndex((size) => size === selected);
  if (index >= 0) {
    const start = Math.max(0, index - 2);
    const end = Math.min(allSizes.length, index + 3);
    return allSizes.slice(start, end);
  }

  const parsed = Number(selected);
  if (!Number.isNaN(parsed)) {
    return Array.from({ length: 5 }, (_, offset) => String(parsed - 2 + offset));
  }

  return allSizes.slice(0, 5);
}
