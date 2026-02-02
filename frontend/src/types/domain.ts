export type ArticleWarning = {
  type: 'pruefung' | 'ablauf';
  date: string;
  windowDays: number;
};

export type ArticleLocation = {
  type: 'kind' | 'lager';
  name: string;
  kindId: number | null;
};

export type ArticleMovement = {
  id: number;
  action: string;
  eventType: string | null;
  performedAt: string;
  from: ArticleLocation | null;
  to: ArticleLocation | null;
};

export type ArticleNoteEntry = {
  id: string;
  timestamp: string | null;
  label: string | null;
  text: string;
};

export type ArticleStatus = 'frei' | 'ausgegeben' | 'warnung';

export type Article = {
  id: string;
  category: string;
  label: string;
  size: string | null;
  notes: string | null;
  status: ArticleStatus;
  location: ArticleLocation;
  assignedAt: string;
  expiryDate: string | null;
  helmetNextCheck: string | null;
  helmetLastCheck: string | null;
  helmetManufacturedAt: string | null;
  warning: ArticleWarning | null;
  movementHistory?: ArticleMovement[];
  noteEntries?: ArticleNoteEntry[];
};

export type ChildStatus = 'aktiv' | 'inaktiv';

export type Child = {
  id: number;
  firstName: string;
  lastName: string;
  status: ChildStatus;
  createdAt: string;
  articleCount?: number;
};

export type UserRole = 'leser' | 'verwalter' | 'admin';

export type AppUser = {
  id: number;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
};
