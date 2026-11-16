'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { compareLabels, matchesSearch } from '@/lib/text/collate';

export interface SelectOption {
  value: string;
  label: string;
  /** Extra text matched by search but not shown, e.g. English name or ISO code. */
  keywords?: string;
  group?: string;
}

const SEARCH_THRESHOLD = 7;
const POPOVER_MAX_HEIGHT = 320;

export function SearchableSelect({
  value,
  onChange,
  options,
  leadingOptions = [],
  placeholder,
  id,
  ariaLabel,
  className,
  disabled,
  sort = true,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Pinned above the sorted list, e.g. "All" or an empty choice. */
  leadingOptions?: SelectOption[];
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  sort?: boolean;
  testId?: string;
}) {
  const { lang, tr } = useLanguage();
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<React.CSSProperties>({});

  const sorted = useMemo(() => {
    if (!sort) return options;
    const compare = compareLabels(lang);
    const groupOrder = [...new Set(options.map((o) => o.group || ''))];
    return [...options].sort(
      (a, b) =>
        groupOrder.indexOf(a.group || '') - groupOrder.indexOf(b.group || '') ||
        compare(a.label, b.label)
    );
  }, [options, sort, lang]);

  const searchable = options.length + leadingOptions.length > SEARCH_THRESHOLD;
  const visible = useMemo(() => {
    const q = query.trim();
    const pool = q ? sorted : [...leadingOptions, ...sorted];
    return q
      ? pool.filter((o) => matchesSearch(`${o.label} ${o.keywords || ''}`, q))
      : pool;
  }, [sorted, leadingOptions, query]);

  const selected = [...leadingOptions, ...options].find((o) => o.value === value);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 220);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom;
    const openUp = below < POPOVER_MAX_HEIGHT && rect.top > below;
    setPosition(
      openUp
        ? { left, width, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(POPOVER_MAX_HEIGHT, rect.top - 12) }
        : { left, width, top: rect.bottom + 4, maxHeight: Math.min(POPOVER_MAX_HEIGHT, below - 12) }
    );
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openWith = (initialQuery = '') => {
    if (disabled) return;
    setQuery(initialQuery);
    const pool = [...leadingOptions, ...sorted];
    setActiveIndex(initialQuery ? 0 : Math.max(0, pool.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    if (!searchable) listRef.current?.focus();
  }, [open, place, searchable]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      place();
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place, close]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const choose = (option: SelectOption | undefined) => {
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    close();
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(visible[activeIndex]);
    } else if (e.key === 'Escape') {
      // Keep the surrounding modal open; only the dropdown should close.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openWith();
    } else if (searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      openWith(e.key);
    }
  };

  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className={`select-trigger${className ? ` ${className}` : ''}`}
        disabled={disabled}
        title={selected?.label}
        onClick={() => (open ? close() : openWith())}
        onKeyDown={onTriggerKeyDown}
        data-testid={testId}
      >
        <span className={selected ? undefined : 'select-placeholder'}>
          {selected?.label ?? placeholder ?? '—'}
        </span>
        <span className="select-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="select-popover"
            style={position}
            onKeyDown={onListKeyDown}
          >
            {searchable && (
              <input
                autoFocus
                className="select-search"
                type="search"
                value={query}
                placeholder={tr('common.search')}
                aria-label={tr('common.search')}
                aria-controls={listId}
                aria-activedescendant={visible[activeIndex] ? `${listId}-${activeIndex}` : undefined}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
              />
            )}
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              className="select-options"
              tabIndex={searchable ? -1 : 0}
              aria-activedescendant={visible[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            >
              {visible.length === 0 && <li className="select-empty">{tr('common.noResults')}</li>}
              {visible.map((o, i) => {
                const header = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                return (
                  <React.Fragment key={`${o.group || ''}:${o.value}`}>
                    {header && (
                      <li className="select-group" role="presentation">
                        {header}
                      </li>
                    )}
                    <li
                      id={`${listId}-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={o.value === value}
                      className={`select-option${i === activeIndex ? ' active' : ''}${o.value === value ? ' selected' : ''}`}
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                    >
                      {o.label}
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
