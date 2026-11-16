'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { getFirebaseClientAuth } from '@/lib/firebase/client';
import { apiFetch } from '@/lib/client/api';
import { LanguageSwitcher, useLanguage } from '@/components/providers/LanguageProvider';
import type { Role } from '@/types/domain';
import type { I18nKey } from '@/i18n/en';

interface NavItem {
  href: string;
  icon: string;
  labelKey: I18nKey;
}

const ADMIN_NAV: NavItem[] = [
  { href: '/admin/dashboard', icon: '▦', labelKey: 'nav.dashboard' },
  { href: '/admin/projects', icon: '◇', labelKey: 'nav.projects' },
  { href: '/admin/tenders', icon: '▤', labelKey: 'nav.tenders' },
  { href: '/admin/suppliers', icon: '♧', labelKey: 'nav.suppliers' },
  { href: '/admin/users', icon: '♙', labelKey: 'nav.users' },
  { href: '/admin/audit', icon: '≡', labelKey: 'nav.audit' },
  { href: '/admin/settings', icon: '⚙', labelKey: 'nav.settings' },
];

const DEPT_NAV: NavItem[] = [
  { href: '/department/suppliers', icon: '♧', labelKey: 'nav.suppliers' },
];

const SUPPLIER_NAV: NavItem[] = [
  { href: '/supplier/tenders', icon: '▤', labelKey: 'nav.myTenders' },
];

export function PortalShell({
  role,
  displayName,
  email,
  organizationName = 'IICOMBINED',
  crumbTitle,
  children,
}: {
  role: Role;
  displayName: string;
  email: string;
  organizationName?: string;
  crumbTitle: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { tr } = useLanguage();

  const navItems =
    role === 'ADMIN' ? ADMIN_NAV : role === 'USER_DEPARTMENT' ? DEPT_NAV : SUPPLIER_NAV;

  const roleLabelKey: I18nKey =
    role === 'ADMIN'
      ? 'role.ADMIN'
      : role === 'USER_DEPARTMENT'
        ? 'role.USER_DEPARTMENT'
        : 'role.SUPPLIER';

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/session', { method: 'DELETE' });
    } catch {
      // Proceed to clear client auth anyway
    }
    try {
      await signOut(getFirebaseClientAuth());
    } catch {
      // Ignore
    }
    router.replace('/login');
    router.refresh();
  };

  const initial = (displayName || email || 'U').slice(0, 1).toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <b>{organizationName}</b>
          <span>{tr('app.portal')}</span>
        </div>
        <div className="workspace-label">{tr('app.workspace')}</div>
        <nav className="nav" aria-label="Primary navigation">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? 'active' : undefined}
              >
                <span className="ico">{item.icon}</span>
                <span>{tr(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="profile" title={email ? `${displayName} · ${email}` : displayName}>
            <div className="avatar">{initial}</div>
            <div className="profile-text">
              <b>{displayName}</b>
              {email && email !== displayName && <span className="profile-email">{email}</span>}
              <small>{tr(roleLabelKey)}</small>
            </div>
          </div>
          <button
            type="button"
            className="btn small logout-btn"
            onClick={handleLogout}
            data-testid="logout-btn"
            title={tr('app.logout')}
          >
            <span className="ico">⎋</span>
            <span>{tr('app.logout')}</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb" title={`${organizationName} / ${crumbTitle}`}>
            {organizationName} <span style={{ color: '#aab0ac' }}>/</span> <b>{crumbTitle}</b>
          </div>
          <div className="top-actions">
            <span className="top-user" title={email}>{email}</span>
            <LanguageSwitcher />
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
