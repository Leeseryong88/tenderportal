'use client';

import React from 'react';
import { useLanguage } from '@/components/providers/LanguageProvider';
import type { I18nKey } from '@/i18n/en';

const GREEN = new Set([
  'OPEN',
  'Open',
  'In Progress',
  'Active',
  'ACTIVE',
  'Signed',
  'Current',
  'Not Required',
  'SUBMITTED',
  'CLEAN',
  'DIRECT',
]);
const BLUE = new Set(['RECEIVING', 'CLOSED', 'Closed', 'Completed']);
const RED = new Set([
  'Not Signed',
  'REJECTED',
  'DISABLED',
  'INFECTED',
  'FAILED',
  'UNAVAILABLE',
  'Inactive',
  'Renewal Pending',
]);

const KEY_MAP: Record<string, I18nKey> = {
  DRAFT: 'tenders.status.DRAFT',
  OPEN: 'tenders.status.OPEN',
  RECEIVING: 'tenders.status.RECEIVING',
  CLOSED: 'tenders.status.CLOSED',
  PENDING: 'status.PENDING',
  ACTIVE: 'status.ACTIVE',
  REJECTED: 'status.REJECTED',
  DISABLED: 'status.DISABLED',
  DIRECT: 'suppliers.delivery.DIRECT',
  LOCAL_PARTNER: 'suppliers.delivery.LOCAL_PARTNER',
  UNAVAILABLE: 'suppliers.delivery.UNAVAILABLE',
  NOT_SUBMITTED: 'supplierPortal.ownState.NOT_SUBMITTED',
  SUBMITTED: 'supplierPortal.ownState.SUBMITTED',
};

const VALUE_PREFIXES = ['projectStatus', 'companyStatus', 'nda', 'license', 'priority'];

export function StatusPill({ status, labelOverride }: { status: string; labelOverride?: string }) {
  const { tr, trv } = useLanguage();

  const tone = GREEN.has(status) ? 'green' : BLUE.has(status) ? 'blue' : RED.has(status) ? 'red' : 'amber';

  let text = labelOverride || '';
  if (!text) {
    if (KEY_MAP[status]) {
      text = tr(KEY_MAP[status]);
    } else {
      text = status;
      for (const prefix of VALUE_PREFIXES) {
        const translated = trv(prefix, status);
        if (translated !== status) {
          text = translated;
          break;
        }
      }
    }
  }

  return (
    <span className={`pill ${tone}`}>
      <i className="dot" />
      {text}
    </span>
  );
}
