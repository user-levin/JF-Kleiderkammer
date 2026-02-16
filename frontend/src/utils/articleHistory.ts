import { Article, ArticleLocation, ArticleMovement } from 'types/domain';

export type TimelineEntry = {
  label: string;
  date: string;
  meta?: string;
};

type InternalTimelineEntry = TimelineEntry & { sortValue: number };

const TIMELINE_DATE_TIME = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export function buildArticleTimeline(article: Article): TimelineEntry[] {
  const entries: InternalTimelineEntry[] = [];
  const movementHistory = (article.movementHistory ?? []).slice(0, 3);

  movementHistory.forEach((movement) => {
    const timestamp = movement.performedAt;
    entries.push({
      label: describeMovementLabel(movement),
      date: formatWithTime(timestamp),
      meta: describeMovementMeta(movement),
      sortValue: buildSortValue(timestamp),
    });
  });

  const noteEntries = (article.noteEntries ?? []).slice(0, 10);
  noteEntries.forEach((note, index) => {
    const timestamp = note.timestamp;
    const fallbackDate = note.label ?? `Notiz ${index + 1}`;
    entries.push({
      label: note.label ? `Notiz (${note.label})` : 'Notiz',
      date: timestamp ? formatWithTime(timestamp) : fallbackDate,
      meta: note.text,
      sortValue: buildSortValue(timestamp),
    });
  });

  if (entries.length === 0) {
    entries.push({
      label: 'Zuletzt bewegt',
      date: formatWithTime(article.assignedAt),
      meta: article.location.type === 'kind' ? `Aktuell bei ${article.location.name}` : 'Aktuell im Lager',
      sortValue: buildSortValue(article.assignedAt),
    });
  }

  return entries
    .sort((a, b) => b.sortValue - a.sortValue)
    .map(({ sortValue, ...timelineEntry }) => timelineEntry);
}

function describeMovementLabel(movement: ArticleMovement): string {
  const target = summarizeLocation(movement.to);
  const origin = summarizeLocation(movement.from);

  switch (movement.action) {
    case 'ausgabe':
      return movement.to?.type === 'kind' ? `Ausgabe an ${target}` : 'Ausgabe';
    case 'rueckgabe':
      return movement.from?.type === 'kind' ? `Rückgabe von ${origin}` : 'Rückgabe ins Lager';
    case 'transfer':
      return `Transfer nach ${target}`;
    case 'create':
      return 'Artikel angelegt';
    case 'delete':
      return 'Artikel entfernt';
    case 'pruefung_update':
      return 'Prüfung dokumentiert';
    default:
      return 'Aktualisierung';
  }
}

function describeMovementMeta(movement: ArticleMovement): string | undefined {
  const from = movement.from ? summarizeLocation(movement.from) : null;
  const to = movement.to ? summarizeLocation(movement.to) : null;

  if (from && to) {
    return `${from} → ${to}`;
  }

  if (to) {
    return `Nach ${to}`;
  }

  if (from) {
    return `Von ${from}`;
  }

  return undefined;
}

function summarizeLocation(location?: ArticleLocation | null): string {
  if (!location) {
    return 'Unbekannt';
  }

  if (location.name?.trim()) {
    return location.name;
  }

  return location.type === 'kind' ? 'Kind' : 'Lager';
}

function buildSortValue(value?: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatWithTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : TIMELINE_DATE_TIME.format(date);
}
