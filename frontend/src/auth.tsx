import { createContext, useContext } from 'react';
import type { AuthUser } from '@api/client';

// Rechte kommen vom Server (/api/auth/me), siehe ROLE_PERMISSIONS in src/app/auth.php.
// Das Frontend blendet damit nur Buttons aus, geprüft wird immer im Backend.
export type Permission =
  | 'children.view'
  | 'children.create'
  | 'children.edit'
  | 'children.csv'
  | 'articles.assign'
  | 'articles.edit'
  | 'inventory.export'
  | 'inventory.import'
  | 'users.manage'
  | 'data.backup'
  | 'audit.view'
  | 'todos.manage'
  | 'movements.manage';

// Muss zu PASSWORD_MIN_LENGTH in src/app/auth.php passen
export const PASSWORD_MIN_LENGTH = 4;

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  betreuer: 'Betreuer',
  datenbank: 'Datenbank'
};

export const AuthContext = createContext<AuthUser | null>(null);

export function useAuth() {
  const user = useContext(AuthContext);

  return {
    user,
    can: (permission: Permission) => Boolean(user?.permissions.includes(permission))
  };
}
