'use client';

import React, { useMemo } from 'react';
import { WORLD_COUNTRY_PATHS } from '@/data/maps/worldCountries';
import { US_STATE_PATHS } from '@/data/maps/usStates';
import {
  normalizeCountryInput,
  resolveSupplierCoverageForMarket,
} from '@/lib/domain/coverage';
import { useLanguage } from '@/components/providers/LanguageProvider';
import type { CoverageItem } from '@/types/domain';

interface MapSupplierInput {
  id: string;
  coverage: CoverageItem[];
}

type MapState = 'direct' | 'local' | 'unavailable' | 'nodata';

function mapFill(state: MapState): string {
  if (state === 'direct') return '#4f8e6d';
  if (state === 'local') return '#e6bd69';
  if (state === 'unavailable') return '#d98179';
  return '#e5e9e6';
}

function countryViewBox(countryName: string): { viewBox: string; width: number } {
  const f = WORLD_COUNTRY_PATHS.find((x) => x.n === countryName);
  if (!f) return { viewBox: '0 0 1000 500', width: 1000 };
  const [x0, y0, x1, y1] = f.b;
  const rawW = Math.max(x1 - x0, 8);
  const rawH = Math.max(y1 - y0, 6);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  // Keep a comfortable regional zoom (~3x-4x max) so neighboring countries stay visible
  let w = Math.max(rawW * 2.2, rawH * 4.0, 260);
  w = Math.min(w, 1000);
  const h = w / 2;

  const vx = Math.max(0, Math.min(1000 - w, cx - w / 2));
  const vy = Math.max(0, Math.min(500 - h, cy - h / 2));

  return {
    viewBox: `${vx.toFixed(1)} ${vy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`,
    width: w,
  };
}

function aggregateState(items: Array<CoverageItem | null>): { state: MapState; count: number } {
  const valid = items.filter((x): x is CoverageItem => Boolean(x));
  if (!valid.length) return { state: 'nodata', count: 0 };
  const direct = valid.some((x) => x.deliveryMode === 'DIRECT');
  if (direct) return { state: 'direct', count: valid.length };
  const local = valid.some((x) => x.deliveryMode === 'LOCAL_PARTNER');
  if (local) return { state: 'local', count: valid.length };
  return { state: 'unavailable', count: valid.length };
}

export function SupplierCoverageMap({
  suppliers,
  selectedCountryCode,
  selectedSubdivisionCode,
  onSelectCountry,
  onSelectSubdivision,
  compact = false,
}: {
  suppliers: MapSupplierInput[];
  selectedCountryCode: string; // 'ALL' or ISO alpha-2 e.g. 'US', 'AU'
  selectedSubdivisionCode: string; // 'ALL' or ISO 3166-2 e.g. 'US-TX'
  onSelectCountry?: (countryCode: string) => void;
  onSelectSubdivision?: (subdivisionCode: string) => void;
  compact?: boolean;
}) {
  const { lang, tr } = useLanguage();
  const isUS = selectedCountryCode === 'US' || selectedSubdivisionCode.startsWith('US-');

  const activeCountryName = useMemo(() => {
    if (selectedCountryCode === 'ALL') return null;
    const norm = normalizeCountryInput(selectedCountryCode);
    return norm.recognized ? norm.countryName : null;
  }, [selectedCountryCode]);

  const marketCountrySet = useMemo(() => {
    const set = new Set<string>();
    for (const s of suppliers) {
      for (const c of s.coverage) {
        if (c.countryCode && c.countryCode !== 'UNMAPPED') {
          set.add(c.countryCode);
        }
      }
    }
    return set;
  }, [suppliers]);

  if (isUS) {
    return (
      <div>
        <div className="coverage-map-wrap">
          <svg
            className="geography-map us-geography"
            style={compact ? { maxHeight: 245, minWidth: 0 } : undefined}
            viewBox="0 0 1000 620"
            role="img"
            aria-label={tr('suppliers.usMapTitle')}
          >
            {US_STATE_PATHS.map((f) => {
              const subCode = `US-${f.c}`;
              const resolved = suppliers.map((s) =>
                resolveSupplierCoverageForMarket(s.coverage, { subdivisionCode: subCode })
              );
              const agg = aggregateState(resolved);
              const selected = selectedSubdivisionCode === subCode;
              const label = lang === 'ko' ? f.ko : f.n;
              return (
                <path
                  key={f.c}
                  className={`geo-state${selected ? ' selected' : ''}`}
                  d={f.d}
                  fill={mapFill(agg.state)}
                  stroke={selected ? '#204b38' : '#fff'}
                  strokeWidth={selected ? 2.2 : 1.15}
                  tabIndex={onSelectSubdivision ? 0 : undefined}
                  role={onSelectSubdivision ? 'button' : undefined}
                  aria-label={`${label} (${f.c}) · ${agg.count}`}
                  onClick={() => onSelectSubdivision?.(subCode)}
                  onKeyDown={(e) => {
                    if (onSelectSubdivision && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onSelectSubdivision(subCode);
                    }
                  }}
                >
                  <title>{`${label} (${f.c}) · ${agg.count}`}</title>
                </path>
              );
            })}
            {US_STATE_PATHS.map((f) => (
              <text
                key={`lbl-${f.c}`}
                className="state-code-label"
                x={f.x}
                y={f.y}
                textAnchor="middle"
                pointerEvents="none"
              >
                {f.c}
              </text>
            ))}
          </svg>
          <div className="map-caption">
            {lang === 'ko'
              ? '미국 주를 클릭하면 해당 주 수행 가능 협력사로 필터링됩니다. 알래스카와 하와이는 별도 위치에 표시됩니다.'
              : 'Click a U.S. state to filter suppliers by regional coverage. Alaska and Hawaii are shown in insets.'}
            <span className="map-data-credit">{tr('suppliers.mapCredit')}</span>
          </div>
        </div>
        {!compact && (
          <div className="map-legend">
            <span>
              <i style={{ background: '#4f8e6d' }} />
              {tr('suppliers.delivery.DIRECT')}
            </span>
            <span>
              <i style={{ background: '#e6bd69' }} />
              {tr('suppliers.delivery.LOCAL_PARTNER')}
            </span>
            <span>
              <i style={{ background: '#d98179' }} />
              {tr('suppliers.delivery.UNAVAILABLE')}
            </span>
            <span>
              <i style={{ background: '#e9edeb' }} />
              {tr('suppliers.noData')}
            </span>
          </div>
        )}
      </div>
    );
  }

  const vb = activeCountryName
    ? countryViewBox(activeCountryName)
    : { viewBox: '0 0 1000 500', width: 1000 };
  const scale = vb.width / 1000;
  const labelFontSize = (compact ? 11 : 8.5) * scale;
  const selectedFontSize = (compact ? 16 : 12) * scale;
  const labelStrokeWidth = 2.2 * scale;

  return (
    <div>
      <div className="coverage-map-wrap">
        <svg
          className="geography-map world-geography"
          style={compact ? { maxHeight: 245, minWidth: 0 } : undefined}
          viewBox={vb.viewBox}
          role="img"
          aria-label={tr('suppliers.globalMapTitle')}
        >
          {WORLD_COUNTRY_PATHS.map((f) => {
            const norm = normalizeCountryInput(f.iso);
            const code = norm.countryCode;
            const resolved = suppliers.map((s) =>
              resolveSupplierCoverageForMarket(s.coverage, { countryCode: code })
            );
            const agg = aggregateState(resolved);
            const selected = activeCountryName === f.n;
            const label = lang === 'ko' ? f.ko : f.n;
            return (
              <path
                key={f.iso}
                className={`geo-country${selected ? ' selected' : ''}`}
                d={f.d}
                fill={mapFill(agg.state)}
                stroke={selected ? '#244b3a' : '#fff'}
                strokeWidth={(selected ? 1.8 : 0.8) * scale}
                vectorEffect="non-scaling-stroke"
                tabIndex={onSelectCountry ? 0 : undefined}
                role={onSelectCountry ? 'button' : undefined}
                aria-label={`${label}: ${agg.count}`}
                onClick={() => onSelectCountry?.(code)}
                onKeyDown={(e) => {
                  if (onSelectCountry && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelectCountry(code);
                  }
                }}
              >
                <title>{`${label} · ${agg.count}`}</title>
              </path>
            );
          })}

          {WORLD_COUNTRY_PATHS.filter((f) => {
            const code = normalizeCountryInput(f.iso).countryCode;
            return marketCountrySet.has(code) && f.n !== activeCountryName;
          }).map((f) => (
            <text
              key={`lbl-${f.iso}`}
              className="geo-label"
              x={f.x}
              y={f.y}
              textAnchor="middle"
              dominantBaseline="central"
              style={{
                fontSize: `${labelFontSize}px`,
                strokeWidth: `${labelStrokeWidth}px`,
              }}
            >
              {lang === 'ko' ? f.ko : f.n}
            </text>
          ))}

          {activeCountryName &&
            (() => {
              const f = WORLD_COUNTRY_PATHS.find((x) => x.n === activeCountryName);
              if (!f) return null;
              return (
                <text
                  className="geo-label geo-label-selected"
                  x={f.x}
                  y={f.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontSize: `${selectedFontSize}px`,
                    strokeWidth: `${labelStrokeWidth}px`,
                  }}
                >
                  {lang === 'ko' ? f.ko : f.n}
                </text>
              );
            })()}
        </svg>

        <div className="map-caption">
          {activeCountryName
            ? lang === 'ko'
              ? '선택 국가를 강조하고 인접 국가 경계도 함께 표시합니다. (다른 국가의 주 경계는 국가 단위로 표시됩니다)'
              : 'Selected country highlighted · adjacent borders provide geographic context (country-level view).'
            : lang === 'ko'
              ? '세계지도에서 색상으로 수행 커버리지를 확인하고 국가를 클릭해 확대할 수 있습니다.'
              : 'World map · colored markets show supplier coverage. Select a country to focus the map.'}
          <span className="map-data-credit">{tr('suppliers.mapCredit')}</span>
        </div>
      </div>

      {!compact && (
        <div className="map-legend">
          <span>
            <i style={{ background: '#4f8e6d' }} />
            {tr('suppliers.delivery.DIRECT')}
          </span>
          <span>
            <i style={{ background: '#e6bd69' }} />
            {tr('suppliers.delivery.LOCAL_PARTNER')}
          </span>
          <span>
            <i style={{ background: '#d98179' }} />
            {tr('suppliers.delivery.UNAVAILABLE')}
          </span>
          <span>
            <i style={{ background: '#e9edeb' }} />
            {tr('suppliers.noData')}
          </span>
        </div>
      )}
    </div>
  );
}
