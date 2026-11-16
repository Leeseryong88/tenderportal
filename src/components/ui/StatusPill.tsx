'use client';

import React from 'react';
import { useLanguage } from '@/components/providers/LanguageProvider';
import type { I18nKey } from '@/i18n/en';

export function StatusPill({
  status,
  labelOverride,
}: {
  status: string;
  labelOverride?: string;
}) {
  const { tr, lang } = useLanguage();

  const tone =
    status === 'OPEN' ||
    status === 'Open' ||
    status === 'In Progress' ||
    status === 'Active' ||
    status === 'ACTIVE' ||
    status === 'Signed' ||
    status === 'Not Required' ||
    status === 'SUBMITTED' ||
    status === 'CLEAN' ||
    status === 'DIRECT'
      ? 'green'
      : status === 'RECEIVING' || status === 'CLOSED' || status === 'Closed'
        ? 'blue'
        : status === 'Not Signed' ||
            status === 'REJECTED' ||
            status === 'DISABLED' ||
            status === 'INFECTED' ||
            status === 'FAILED' ||
            status === 'UNAVAILABLE'
          ? 'red'
          : 'amber';

  const keyMap: Record<string, I18nKey> = {
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

  const koSimple: Record<string, string> = {
    Planning: '기획',
    'In Progress': '진행 중',
    Completed: '완료',
    Active: '활성',
    Inactive: '비활성',
    Signed: '체결',
    'Not Signed': '미체결',
    'Not Checked': '미확인',
    'Not Required': '해당 없음',
    CLEAN: '검사 완료',
    INFECTED: '위험 탐지',
    FAILED: '검사 실패',
  };

  let text = labelOverride || '';
  if (!text) {
    if (keyMap[status]) {
      text = tr(keyMap[status]);
    } else if (lang === 'ko' && koSimple[status]) {
      text = koSimple[status];
    } else {
      text = status;
    }
  }

  return (
    <span className={`pill ${tone}`}>
      <i className="dot" />
      {text}
    </span>
  );
}
