import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { AuthUser } from '@api/client';
import { ROLE_LABELS } from '../auth';

type Props = {
  user: AuthUser;
  onLogout: () => void;
};

/** Rundes Porträt-Symbol (Kopf und Schultern) */
function AvatarIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className="user-avatar-icon">
      <defs>
        <clipPath id="user-avatar-clip">
          <circle cx="20" cy="20" r="20" />
        </clipPath>
      </defs>
      <g clipPath="url(#user-avatar-clip)">
        <rect width="40" height="40" className="user-avatar-bg" />
        <circle cx="20" cy="15.5" r="7" className="user-avatar-figure" />
        <path d="M5 40c0-9 6.7-14.5 15-14.5S35 31 35 40z" className="user-avatar-figure" />
      </g>
    </svg>
  );
}

/**
 * Benutzermenü oben rechts: Konto, Benutzerverwaltung (Admin) und Abmelden.
 */
export default function UserMenu({ user, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Schließen bei Seitenwechsel, Klick daneben oder Esc
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const roles = user.roles.map((role) => ROLE_LABELS[role] ?? role).join(', ');

  return (
    <div className="user-menu" ref={containerRef}>
      <button
        type="button"
        className={`user-avatar ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((state) => !state)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Benutzermenü für ${user.email}`}
        title={user.email}
      >
        <AvatarIcon />
      </button>
      {open && (
        <div className="user-dropdown" role="menu">
          <div className="user-dropdown-head">
            <strong>{user.email}</strong>
            {roles && <span className="muted">{roles}</span>}
          </div>
          <Link to="/konto" role="menuitem">Mein Konto</Link>
          {user.permissions.includes('users.manage') && (
            <Link to="/benutzer" role="menuitem">Benutzer verwalten</Link>
          )}
          <button type="button" role="menuitem" className="user-dropdown-logout" onClick={onLogout}>
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}
