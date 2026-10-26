import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Article } from 'types/domain';
import { matchPresetByCategory } from '@constants/articlePresets';

type Props = {
  category: string;
  articles: Article[];
  onClose: () => void;
};

type LocationTab = 'alle' | 'kind' | 'lager';

type SizeRow = {
  size: string;
  children: number;
  storage: number;
};

const NO_SIZE = 'Ohne Größe';
// Buchstabengrößen wie XXXS, 3XS, 3,5XS, M, XL, 2XL
const LETTER_SIZE_PATTERN = /^(\d+(?:[.,]\d+)?)?(x*)(s|m|l)$/i;

/**
 * Popup zur Bestandsverteilung einer Kategorie: Größen als Balkendiagramm (bei Kindern / im Lager)
 * und darunter alle Inventarnummern, filterbar nach Größe und Ort.
 */
export default function CategoryDetailModal({ category, articles, onClose }: Props) {
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [hoveredSize, setHoveredSize] = useState<string | null>(null);
  const [locationTab, setLocationTab] = useState<LocationTab>('alle');

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const sizeRows = useMemo<SizeRow[]>(() => {
    const map = new Map<string, SizeRow>();
    for (const article of articles) {
      const size = article.size?.trim() || NO_SIZE;
      const row = map.get(size) ?? { size, children: 0, storage: 0 };
      if (article.location.type === 'kind') {
        row.children += 1;
      } else {
        row.storage += 1;
      }
      map.set(size, row);
    }
    const presetOrder = matchPresetByCategory(category)?.sizeOptions ?? [];
    return Array.from(map.values()).sort((a, b) => compareSizes(a.size, b.size, presetOrder));
  }, [articles, category]);

  const maxTotal = Math.max(1, ...sizeRows.map((row) => row.children + row.storage));
  const totals = {
    all: articles.length,
    children: articles.filter((article) => article.location.type === 'kind').length,
    storage: articles.filter((article) => article.location.type !== 'kind').length
  };

  const listedArticles = useMemo(() => {
    return articles
      .filter((article) => !selectedSize || (article.size?.trim() || NO_SIZE) === selectedSize)
      .filter((article) => {
        if (locationTab === 'kind') return article.location.type === 'kind';
        if (locationTab === 'lager') return article.location.type !== 'kind';
        return true;
      })
      .sort((a, b) => a.id.localeCompare(b.id, 'de-DE', { numeric: true }));
  }, [articles, selectedSize, locationTab]);

  const readoutRow = sizeRows.find((row) => row.size === (hoveredSize ?? selectedSize));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Bestand ${category}`} onClick={onClose}>
      <div className="modal-card category-modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <p className="muted">Bestandsverteilung</p>
            <h3>{category}</h3>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>Schließen</button>
        </header>

        <div className="category-modal-body">
          <div className="category-stats">
            <div><span className="stat-label">Gesamt</span><strong>{totals.all}</strong></div>
            <div><span className="stat-label"><i className="swatch swatch-children" />Bei Kindern</span><strong>{totals.children}</strong></div>
            <div><span className="stat-label"><i className="swatch swatch-storage" />Im Lager</span><strong>{totals.storage}</strong></div>
          </div>

          <section aria-label="Größenverteilung">
            <div className="size-chart-header">
              <h4>Größen</h4>
              <div className="size-chart-legend" aria-hidden="true">
                <span><i className="swatch swatch-children" />Bei Kindern</span>
                <span><i className="swatch swatch-storage" />Im Lager</span>
              </div>
            </div>
            <p className="size-chart-readout" aria-live="polite">
              {readoutRow
                ? `Größe ${readoutRow.size}: ${readoutRow.children} bei Kindern · ${readoutRow.storage} im Lager`
                : 'Balken antippen, um die Inventarnummern dieser Größe zu sehen'}
            </p>
            {sizeRows.length === 0 ? (
              <p className="muted">Keine Artikel in dieser Kategorie.</p>
            ) : (
              <div className="size-chart">
                {sizeRows.map((row) => {
                  const total = row.children + row.storage;
                  const isSelected = selectedSize === row.size;
                  return (
                    <button
                      key={row.size}
                      type="button"
                      className={`size-row ${isSelected ? 'is-selected' : ''} ${selectedSize && !isSelected ? 'is-dimmed' : ''}`}
                      onClick={() => setSelectedSize(isSelected ? null : row.size)}
                      onMouseEnter={() => setHoveredSize(row.size)}
                      onMouseLeave={() => setHoveredSize(null)}
                      onFocus={() => setHoveredSize(row.size)}
                      onBlur={() => setHoveredSize(null)}
                      aria-pressed={isSelected}
                      aria-label={`Größe ${row.size}: ${row.children} bei Kindern, ${row.storage} im Lager`}
                    >
                      <span className="size-row-label">{row.size}</span>
                      <span className="size-row-track">
                        <span className="size-row-bar" style={{ width: `${(total / maxTotal) * 100}%` }}>
                          {row.children > 0 && <span className="size-seg size-seg-children" style={{ flexGrow: row.children }} />}
                          {row.storage > 0 && <span className="size-seg size-seg-storage" style={{ flexGrow: row.storage }} />}
                        </span>
                        <span className="size-row-total">{total}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-label="Inventarnummern">
            <div className="size-chart-header">
              <h4>
                Inventarnummern
                {selectedSize && (
                  <button type="button" className="filter-chip" onClick={() => setSelectedSize(null)}>
                    Größe {selectedSize} ✕
                  </button>
                )}
              </h4>
              <div className="segmented" role="tablist">
                {(
                  [
                    ['alle', 'Alle'],
                    ['kind', 'Bei Kindern'],
                    ['lager', 'Im Lager']
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={locationTab === value}
                    className={locationTab === value ? 'is-active' : ''}
                    onClick={() => setLocationTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {listedArticles.length === 0 ? (
              <p className="muted">Keine Artikel für diese Auswahl.</p>
            ) : (
              <div className="category-id-table-wrapper">
                <table className="user-table category-id-table">
                  <thead>
                    <tr>
                      <th>Inv.-Nr.</th>
                      <th>Größe</th>
                      <th>Bei / Ort</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listedArticles.map((article) => (
                      <tr key={article.id}>
                        <td>
                          <Link to={`/artikel/${article.id}`} className="audit-link" onClick={onClose}>
                            {article.id}
                          </Link>
                        </td>
                        <td>{article.size || '–'}</td>
                        <td>
                          <i className={`swatch ${article.location.type === 'kind' ? 'swatch-children' : 'swatch-storage'}`} />
                          {article.location.type === 'kind' ? article.location.name : 'Lager'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function compareSizes(a: string, b: string, presetOrder: string[]): number {
  if (a === NO_SIZE || b === NO_SIZE) {
    return a === NO_SIZE ? (b === NO_SIZE ? 0 : 1) : -1;
  }
  const presetA = presetOrder.indexOf(a);
  const presetB = presetOrder.indexOf(b);
  if (presetA !== -1 && presetB !== -1) {
    return presetA - presetB;
  }
  // Zahlengrößen zuerst, danach Buchstabengrößen von klein nach groß
  const letterA = letterSizeRank(a);
  const letterB = letterSizeRank(b);
  if (letterA !== null && letterB !== null) {
    return letterA - letterB || a.localeCompare(b, 'de-DE');
  }
  if ((letterA === null) !== (letterB === null)) {
    return letterA === null ? -1 : 1;
  }
  const numA = parseFloat(a.replace(',', '.'));
  const numB = parseFloat(b.replace(',', '.'));
  const isNumA = !Number.isNaN(numA) && /^\d/.test(a);
  const isNumB = !Number.isNaN(numB) && /^\d/.test(b);
  if (isNumA && isNumB) {
    return numA - numB || a.localeCompare(b, 'de-DE');
  }
  if (isNumA !== isNumB) {
    return isNumA ? -1 : 1;
  }
  return a.localeCompare(b, 'de-DE', { numeric: true });
}

/** S = -1, XS = -2, XXS/2XS = -3 …, M = 0, L = 1, XL = 2 …; null wenn keine Buchstabengröße */
function letterSizeRank(size: string): number | null {
  const match = LETTER_SIZE_PATTERN.exec(size.trim());
  if (!match) {
    return null;
  }
  const [, number, xs, letter] = match;
  const count = number ? parseFloat(number.replace(',', '.')) : xs.length;
  if (letter.toLowerCase() === 'm') {
    return 0;
  }
  return letter.toLowerCase() === 's' ? -(count + 1) : count + 1;
}
