'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/client/api';
import { TENDER_MILESTONES } from '@/lib/domain/schedule';
import { dateInTimeZone, formatDateTimeInZone } from '@/lib/domain/timezone';
import { PortalShell } from '@/components/layout/PortalShell';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useToast } from '@/components/providers/ToastProvider';
import { StatusPill } from '@/components/ui/StatusPill';
import { Modal } from '@/components/ui/Modal';
import type {
  AuditLogRecord,
  DashboardTask,
  ProjectRecord,
  TenderAdminDTO,
} from '@/types/domain';
import type { I18nKey } from '@/i18n/en';

interface DashboardPayload {
  serverNowIso: string;
  serverToday: string;
  displayTimeZone: string;
  projects: ProjectRecord[];
  tenders: TenderAdminDTO[];
  tasks: DashboardTask[];
  recentAudit: AuditLogRecord[];
}

interface AgendaEvent {
  id: string;
  type: 'task' | 'milestone' | 'deadline';
  dateLocal: string;
  title: string;
  subtitle: string;
  priority: 'High' | 'Normal';
  done: boolean;
  href?: string;
}

export function AdminDashboardClient({
  displayName,
  email,
  organizationName,
}: {
  displayName: string;
  email: string;
  organizationName: string;
}) {
  const { lang, tr, trv, trError } = useLanguage();
  const { showToast } = useToast();

  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [monthCursor, setMonthCursor] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [showAddTask, setShowAddTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState<'High' | 'Normal'>('Normal');
  const [taskProjectId, setTaskProjectId] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const payload = await apiFetch<DashboardPayload>('/api/admin/dashboard');
      setData(payload);
      setSelectedDate((prev) => prev || payload.serverToday);
    } catch (err) {
      showToast(trError(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, trError]);

  useEffect(() => {
    void loadDashboard();
    const timer = setInterval(() => void loadDashboard(), 30_000);
    return () => clearInterval(timer);
  }, [loadDashboard]);

  const events = useMemo<AgendaEvent[]>(() => {
    if (!data) return [];
    const projMap = new Map(data.projects.map((p) => [p.id, p]));
    const out: AgendaEvent[] = [];

    for (const task of data.tasks) {
      const p = task.projectId ? projMap.get(task.projectId) : null;
      out.push({
        id: task.id,
        type: 'task',
        dateLocal: task.dateLocal,
        title: task.title,
        subtitle: p
          ? `${p.name} · ${trv('priority', task.priority)}`
          : trv('priority', task.priority),
        priority: task.priority,
        done: task.done,
      });
    }

    // Prevent duplicate inherited calendar events:
    // Show active tenders' schedules; show project schedule ONLY when project has no active tenders.
    for (const p of data.projects) {
      const activeTenders = data.tenders.filter(
        (t) => t.projectId === p.id && t.computedStatus !== 'CLOSED'
      );
      if (activeTenders.length > 0) {
        for (const t of activeTenders) {
          for (const stage of TENDER_MILESTONES) {
            const entry = t.schedule?.[stage.key];
            if (!entry || entry.status !== 'PLANNED' || !entry.dateLocal) continue;
            out.push({
              id: `mile-${t.id}-${stage.key}`,
              type: 'milestone',
              dateLocal: entry.dateLocal,
              title: `${tr(stage.labelKey as I18nKey)} · ${t.name}`,
              subtitle: `${p.name} (${t.code})`,
              priority: 'Normal',
              done: false,
              href: '/admin/tenders',
            });
          }
        }
      } else {
        for (const stage of TENDER_MILESTONES) {
          const entry = p.masterSchedule?.[stage.key];
          if (!entry || entry.status !== 'PLANNED' || !entry.dateLocal) continue;
          out.push({
            id: `mile-${p.id}-${stage.key}`,
            type: 'milestone',
            dateLocal: entry.dateLocal,
            title: `${tr(stage.labelKey as I18nKey)} · ${p.name}`,
            subtitle: `${p.code}`,
            priority: 'Normal',
            done: false,
            href: '/admin/projects',
          });
        }
      }
    }

    // Deadlines (preserve closed tender history on calendar too, while highlighting active)
    for (const t of data.tenders) {
      if (!t.deadlineAt || t.computedStatus === 'DRAFT') continue;
      const p = projMap.get(t.projectId);
      const localDueDate = dateInTimeZone(t.deadlineAt, t.timeZone || 'UTC');
      const adminDueDate = dateInTimeZone(t.deadlineAt, data.displayTimeZone || 'Asia/Seoul');
      const tzDiffNote =
        localDueDate !== adminDueDate
          ? ` (${t.timeZone}: ${localDueDate} / ${data.displayTimeZone}: ${adminDueDate})`
          : '';
      out.push({
        id: `deadline-${t.id}`,
        type: 'deadline',
        dateLocal: adminDueDate,
        title: `${t.name} · ${tr('tenders.deadline')}`,
        subtitle: `${p?.name || ''}${tzDiffNote}`,
        priority: 'High',
        done: t.computedStatus === 'CLOSED',
        href: '/admin/tenders',
      });
    }

    return out.sort(
      (a, b) =>
        a.dateLocal.localeCompare(b.dateLocal) || (a.priority === 'High' ? -1 : 1)
    );
  }, [data, tr, trv]);

  const handleToggleTask = async (task: DashboardTask) => {
    try {
      await apiFetch(`/api/admin/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ done: !task.done }),
      });
      await loadDashboard();
    } catch (err) {
      showToast(trError(err), 'error');
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingTask || !taskTitle.trim()) return;
    setCreatingTask(true);
    try {
      await apiFetch('/api/admin/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: taskTitle.trim(),
          projectId: taskProjectId || null,
          dateLocal: selectedDate || data?.serverToday,
          priority: taskPriority,
        }),
      });
      setTaskTitle('');
      setTaskPriority('Normal');
      setTaskProjectId('');
      setShowAddTask(false);
      await loadDashboard();
    } catch (err) {
      showToast(trError(err), 'error');
    } finally {
      setCreatingTask(false);
    }
  };

  const todayIso = data?.serverToday || new Date().toISOString().slice(0, 10);
  const activeDate = selectedDate || todayIso;
  const dayEvents = events.filter((e) => e.dateLocal === activeDate);
  const eventDatesSet = new Set(events.map((e) => e.dateLocal));

  // Calendar grid (42 days)
  const monthStart = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const calStart = new Date(monthStart);
  calStart.setDate(1 - monthStart.getDay());
  const calendarDays = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(calStart);
    d.setDate(calStart.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    return {
      iso,
      dayNum: d.getDate(),
      sameMonth: d.getMonth() === monthCursor.getMonth(),
      hasEvents: eventDatesSet.has(iso),
    };
  });

  const dateHeadingLabel = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    return new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(d);
  };

  const monthHeadingLabel = new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'long',
  }).format(monthCursor);

  const tenders = data?.tenders || [];
  const projects = data?.projects || [];
  const totalTenders = tenders.length;
  const openCount = tenders.filter((t) => t.computedStatus === 'OPEN').length;
  const receivingCount = tenders.filter((t) => t.computedStatus === 'RECEIVING').length;
  const draftCount = tenders.filter((t) => t.computedStatus === 'DRAFT').length;
  const closedCount = tenders.filter((t) => t.computedStatus === 'CLOSED').length;
  const activeTenderCount = openCount + receivingCount;

  const invitedTotal = tenders.reduce((sum, t) => sum + t.invitedCompanyIds.length, 0);
  const receivedTotal = tenders.reduce((sum, t) => sum + t.receivedCompanyCount, 0);
  const ratePct = invitedTotal ? Math.round((receivedTotal / invitedTotal) * 100) : 0;

  const openPct = totalTenders ? (openCount / totalTenders) * 100 : 0;
  const draftEnd = totalTenders ? ((openCount + draftCount) / totalTenders) * 100 : 0;
  const recEnd = totalTenders ? ((openCount + draftCount + receivingCount) / totalTenders) * 100 : 0;

  const countriesSet = new Set(projects.map((p) => p.countryName).filter(Boolean));
  const perCountry = [...countriesSet]
    .map((name) => ({
      name,
      count: projects.filter((p) => p.countryName === name).length,
    }))
    .sort((a, b) => b.count - a.count);

  const upcomingDeadlines = tenders
    .filter((t) => (t.computedStatus === 'OPEN' || t.computedStatus === 'RECEIVING') && t.deadlineAt)
    .sort((a, b) => String(a.deadlineAt).localeCompare(String(b.deadlineAt)))
    .slice(0, 4);

  const weekdayLabels =
    lang === 'ko'
      ? ['일', '월', '화', '수', '목', '금', '토']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <PortalShell
      role="ADMIN"
      displayName={displayName}
      email={email}
      organizationName={organizationName}
      crumbTitle={tr('nav.dashboard')}
    >
      {/* NOTE: No duplicate "Create tender" button on dashboard */}
      <div className="heading">
        <div>
          <h1>{tr('dashboard.title')}</h1>
          <p>{tr('dashboard.sub')}</p>
        </div>
      </div>

      {loading && !data ? (
        <div className="card panel empty">{tr('common.loading')}</div>
      ) : (
        <>
          <section className="dashboard-agenda">
            <div className="card today-agenda-card">
              <div className="today-date-block">
                <div>
                  <span className="schedule-eyebrow">
                    {activeDate === todayIso ? tr('dashboard.today') : tr('dashboard.selectedDate')}
                  </span>
                  <h2>{dateHeadingLabel(activeDate)}</h2>
                  <p>
                    {tr('dashboard.todayGlance')} ({data?.displayTimeZone})
                  </p>
                </div>
                <div className="agenda-count">
                  <strong>{dayEvents.filter((e) => !e.done).length}</strong>
                  <span>{tr('dashboard.scheduledItems')}</span>
                </div>
              </div>

              <div className="agenda-heading">
                <b>{activeDate === todayIso ? tr('dashboard.myTasks') : tr('dashboard.schedule')}</b>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="subtle">
                    {dayEvents.length} {tr('dashboard.scheduledItems')}
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setShowAddTask(true)}
                  >
                    + {tr('dashboard.addTask')}
                  </button>
                </div>
              </div>

              <div className="agenda-list">
                {dayEvents.length === 0 ? (
                  <div className="agenda-empty">
                    <span>✓</span>
                    <div>
                      <b>{tr('dashboard.noTasksDay')}</b>
                      <small>{dateHeadingLabel(activeDate)}</small>
                    </div>
                  </div>
                ) : (
                  dayEvents.map((ev) => {
                    const taskObj =
                      ev.type === 'task' ? data?.tasks.find((t) => t.id === ev.id) : null;
                    return (
                      <div key={ev.id} className={`agenda-item${ev.done ? ' done' : ''}`}>
                        <span className={`agenda-type ${ev.type}`}>
                          {ev.type === 'deadline' ? '!' : '•'}
                        </span>
                        <div className="agenda-copy">
                          <b>{ev.title}</b>
                          <small>{ev.subtitle}</small>
                        </div>
                        {taskObj ? (
                          <button
                            type="button"
                            className="agenda-check"
                            onClick={() => handleToggleTask(taskObj)}
                            title={tr('dashboard.toggleTask')}
                            aria-label={tr('dashboard.toggleTask')}
                            aria-pressed={ev.done}
                          >
                            {ev.done ? '✓' : ''}
                          </button>
                        ) : (
                          <Link href={ev.href || '/admin/tenders'} className="agenda-open">
                            ↗
                          </Link>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="card dashboard-calendar-card">
              <div className="calendar-head">
                <div>
                  <span className="schedule-eyebrow">{tr('dashboard.calendar')}</span>
                  <b>{monthHeadingLabel}</b>
                </div>
                <div className="calendar-nav">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() =>
                      setMonthCursor(
                        new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1)
                      )
                    }
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() =>
                      setMonthCursor(
                        new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1)
                      )
                    }
                  >
                    ›
                  </button>
                </div>
              </div>

              <div className="calendar-weekdays">
                {weekdayLabels.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="calendar-grid">
                {calendarDays.map((d) => (
                  <button
                    key={d.iso}
                    type="button"
                    className={`calendar-day${d.sameMonth ? '' : ' outside'}${
                      d.iso === todayIso ? ' today' : ''
                    }${d.iso === activeDate ? ' selected' : ''}`}
                    onClick={() => {
                      setSelectedDate(d.iso);
                      if (!d.sameMonth) {
                        const [y, m] = d.iso.split('-').map(Number);
                        setMonthCursor(new Date(y!, m! - 1, 1));
                      }
                    }}
                    aria-label={d.iso}
                    aria-pressed={d.iso === activeDate}
                  >
                    <span>{d.dayNum}</span>
                    {d.hasEvents && <i />}
                  </button>
                ))}
              </div>
              <div className="calendar-foot">
                <i />
                {tr('dashboard.scheduledItems')}
              </div>
            </div>
          </section>

          <section className="stats">
            <div className="card stat">
              <div className="stat-label">{tr('dashboard.activeProjects')}</div>
              <div className="stat-value">
                {projects.filter((p) => p.status !== 'Completed').length}
              </div>
              <div className="stat-foot">
                {tr('dashboard.acrossCountries', { count: countriesSet.size })}
              </div>
            </div>
            <div className="card stat">
              <div className="stat-label">{tr('dashboard.activeTenders')}</div>
              <div className="stat-value">{activeTenderCount}</div>
              <div className="stat-foot">
                {openCount} {tr('tenders.status.OPEN')} · {receivingCount} {tr('tenders.status.RECEIVING')}
              </div>
            </div>
            <div className="card stat">
              <div className="stat-label">{tr('dashboard.invitedSuppliers')}</div>
              <div className="stat-value">{invitedTotal}</div>
              <div className="stat-foot">{tr('dashboard.acrossActiveTenders')}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">{tr('dashboard.submissionRate')}</div>
              <div className="stat-value">{ratePct}%</div>
              <div className="stat-foot">
                {tr('dashboard.responsesReceived', {
                  submitted: receivedTotal,
                  invited: invitedTotal,
                })}
              </div>
            </div>
          </section>

          <section className="dashboard-charts">
            <div className="card chart-card">
              <div className="chart-title">{tr('dashboard.tenderStatus')}</div>
              <div className="chart-sub">{tr('dashboard.portfolioOverview')}</div>
              <div className="status-chart">
                <div
                  className="donut"
                  style={{
                    background: totalTenders
                      ? `conic-gradient(#245b45 0 ${openPct}%, #d5a34a ${openPct}% ${draftEnd}%, #3d6796 ${draftEnd}% ${recEnd}%, #8ea4bd ${recEnd}% 100%)`
                      : '#edf0ed',
                  }}
                >
                  <div className="donut-center">
                    {totalTenders}
                    <small>{tr('dashboard.tendersUnit')}</small>
                  </div>
                </div>
                <div className="legend-list">
                  <div className="legend-row">
                    <span className="legend-key">
                      <i className="legend-dot" style={{ background: '#245b45' }} />
                      {tr('tenders.status.OPEN')}
                    </span>
                    <b>{openCount}</b>
                  </div>
                  <div className="legend-row">
                    <span className="legend-key">
                      <i className="legend-dot" style={{ background: '#d5a34a' }} />
                      {tr('tenders.status.DRAFT')}
                    </span>
                    <b>{draftCount}</b>
                  </div>
                  <div className="legend-row">
                    <span className="legend-key">
                      <i className="legend-dot" style={{ background: '#3d6796' }} />
                      {tr('tenders.status.RECEIVING')}
                    </span>
                    <b>{receivingCount}</b>
                  </div>
                  <div className="legend-row">
                    <span className="legend-key">
                      <i className="legend-dot" style={{ background: '#8ea4bd' }} />
                      {tr('tenders.status.CLOSED')}
                    </span>
                    <b>{closedCount}</b>
                  </div>
                </div>
              </div>
            </div>

            <div className="card chart-card">
              <div className="chart-title">{tr('dashboard.submissionProgress')}</div>
              <div className="chart-sub">{tr('dashboard.responsesByTender')}</div>
              <div className="meter-list">
                {tenders.slice(0, 5).map((t) => {
                  const got = t.receivedCompanyCount;
                  const all = t.invitedCompanyIds.length;
                  const pct = all ? Math.round((got / all) * 100) : 0;
                  return (
                    <div key={t.id} className="meter-row">
                      <span className="meter-name" title={t.name}>
                        {t.name}
                      </span>
                      <div className="meter-track">
                        <div className="meter-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="meter-value">
                        {got}/{all}
                      </span>
                    </div>
                  );
                })}
                {tenders.length === 0 && <div className="empty">{tr('common.noResults')}</div>}
              </div>
            </div>
          </section>

          <section className="dashboard-lower">
            <div className="card panel">
              <div className="panel-head">
                <div className="panel-title">{tr('dashboard.upcomingDeadlines')}</div>
                <Link href="/admin/tenders" className="btn small">
                  {tr('dashboard.viewAll')} →
                </Link>
              </div>
              <div className="deadline-list">
                {upcomingDeadlines.length === 0 ? (
                  <div className="empty">{tr('dashboard.noUpcoming')}</div>
                ) : (
                  upcomingDeadlines.map((t) => {
                    const localDate = dateInTimeZone(t.deadlineAt!, t.timeZone);
                    const adminDate = dateInTimeZone(t.deadlineAt!, data!.displayTimeZone);
                    return (
                      <div key={t.id} className="deadline-item">
                        <div>
                          <b>{t.name}</b>
                          <span className="secondary">{t.projectName}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div>{formatDateTimeInZone(t.deadlineAt, t.timeZone, lang)}</div>
                          {localDate !== adminDate && (
                            <span className="secondary">
                              {data!.displayTimeZone}:{' '}
                              {formatDateTimeInZone(t.deadlineAt, data!.displayTimeZone, lang)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="card panel">
              <div className="panel-head">
                <div className="panel-title">{tr('dashboard.projectsByCountry')}</div>
                <Link href="/admin/projects" className="btn small">
                  {tr('dashboard.manageProjects')} →
                </Link>
              </div>
              <div className="meter-list">
                {perCountry.slice(0, 5).map((x) => (
                  <div key={x.name} className="meter-row">
                    <span className="meter-name">{x.name}</span>
                    <div className="meter-track">
                      <div
                        className="meter-fill"
                        style={{
                          width: `${Math.max(
                            10,
                            (x.count / Math.max(1, perCountry[0]?.count || 1)) * 100
                          )}%`,
                          background: '#7595b9',
                        }}
                      />
                    </div>
                    <span className="meter-value">{x.count}</span>
                  </div>
                ))}
                {perCountry.length === 0 && <div className="empty">{tr('common.noResults')}</div>}
              </div>
            </div>
          </section>

          <section className="card panel" style={{ marginBottom: 16 }}>
            <div className="panel-head">
              <div className="panel-title">{tr('dashboard.recentActivity')}</div>
              <span className="subtle">{tr('dashboard.latestUpdates')}</span>
            </div>
            <div className="activity">
              {(data?.recentAudit || []).length === 0 ? (
                <div className="empty">{tr('common.noResults')}</div>
              ) : (
                data!.recentAudit.slice(0, 5).map((log) => (
                  <div key={log.id} className="activity-item">
                    <div className="activity-icon">•</div>
                    <div className="activity-text">
                      <b>{log.action}</b> · {log.targetType} ({log.targetId})
                      <small>
                        {formatDateTimeInZone(log.createdAt, data!.displayTimeZone, lang)}
                      </small>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="card panel">
            <div className="panel-head">
              <div className="panel-title">{tr('dashboard.recentTenders')}</div>
              <Link href="/admin/tenders" className="btn small">
                {tr('dashboard.viewAll')} →
              </Link>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{tr('tenders.name')}</th>
                    <th>{tr('tenders.project')}</th>
                    <th>{tr('tenders.deadline')}</th>
                    <th>{tr('tenders.tabSubmissions')}</th>
                    <th>{tr('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tenders.slice(0, 6).map((t) => (
                    <tr key={t.id}>
                      <td>
                        <span className="primary-text">{t.name || t.code}</span>
                        <span className="secondary">{t.code}</span>
                      </td>
                      <td className="cell-wrap">{t.projectName}</td>
                      <td>{formatDateTimeInZone(t.deadlineAt, t.timeZone, lang)}</td>
                      <td>
                        {t.receivedCompanyCount} / {t.invitedCompanyIds.length}
                      </td>
                      <td>
                        <StatusPill status={t.computedStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {showAddTask && (
        <Modal
          title={tr('dashboard.addTask')}
          subtitle={activeDate}
          onClose={() => setShowAddTask(false)}
          maxWidth={460}
        >
          <form onSubmit={handleCreateTask} style={{ display: 'grid', gap: 12 }}>
            <div className="field">
              <label htmlFor="task-title">{tr('dashboard.taskTitle')} *</label>
              <input
                id="task-title"
                required
                autoFocus
                maxLength={200}
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
              />
            </div>
            <div className="field">
              <label>{tr('tenders.project')}</label>
              <select value={taskProjectId} onChange={(e) => setTaskProjectId(e.target.value)}>
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{tr('common.priority')}</label>
              <select
                value={taskPriority}
                onChange={(e) => setTaskPriority(e.target.value as 'High' | 'Normal')}
              >
                <option value="Normal">{trv('priority', 'Normal')}</option>
                <option value="High">{trv('priority', 'High')}</option>
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowAddTask(false)}>
                {tr('common.cancel')}
              </button>
              <button type="submit" className="btn primary" disabled={creatingTask || !taskTitle.trim()}>
                {creatingTask ? tr('common.loading') : tr('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </PortalShell>
  );
}
