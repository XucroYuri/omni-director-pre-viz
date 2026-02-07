'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type QueueMetrics = {
  queuedTotal: number;
  queuedReady: number;
  queuedDelayed: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  deadLetterCount: number;
};

type KindSummary = {
  job_kind: string;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  dead_letter: number;
};

type TaskItem = {
  id: string;
  trace_id: string;
  job_kind: string;
  error_code: string | null;
  error_message: string | null;
  status: string;
  attempt_count: number;
  max_attempts: number;
  updated_at: string;
};

type DeadLetterItem = {
  task_id: string;
  trace_id: string;
  job_kind: string;
  dead_reason: string;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
};

type TaskAuditLogItem = {
  id: string;
  batch_id: string | null;
  task_id: string | null;
  trace_id: string | null;
  job_kind: string | null;
  action: string;
  actor: string;
  message: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

type OpsSnapshot = {
  queue: QueueMetrics;
  summaryByKind: KindSummary[];
  recentFailedTasks: TaskItem[];
  recentDeadLetters: DeadLetterItem[];
  recentAuditLogs: TaskAuditLogItem[];
  auditPagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
};

type BulkRetryResult = {
  mode: 'dry_run' | 'executed';
  batchId: string;
  selected: number;
  retried: number;
  skipped: number;
  selectedTaskIds: string[];
  retriedTaskIds: string[];
};

type PreviewDeadLetterMatchesResult = {
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  taskIds: string[];
};

type AuditExportFormat = 'json' | 'csv';
type AuditPruneMode = 'dry_run' | 'executed';

type AuditPruneResult = {
  mode: AuditPruneMode;
  batchId: string;
  cutoffAt: string;
  matched: number;
  selected: number;
  deleted: number;
  sampleIds: string[];
};

const POLL_MS = 3000;

function shortId(value: string | null | undefined): string {
  if (!value) return '-';
  if (value.length <= 10) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function formatTime(value: string): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function toQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    sp.set(key, trimmed);
  }
  return sp.toString();
}

function toMetadataPreview(value: unknown): string {
  if (!value || typeof value !== 'object') return '-';
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= 120) return serialized;
    return `${serialized.slice(0, 117)}...`;
  } catch {
    return '[unserializable]';
  }
}

function parseOptionalPositiveInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseOptionalNonNegativeInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

async function fetchSnapshot(filters: {
  episodeId: string;
  jobKind: string;
  traceId: string;
  auditAction: string;
  auditActor: string;
  auditPage: number;
  auditPageSize: number;
}): Promise<OpsSnapshot> {
  const query = toQuery({
    episodeId: filters.episodeId,
    jobKind: filters.jobKind,
    traceId: filters.traceId,
    limit: '80',
    auditAction: filters.auditAction,
    auditActor: filters.auditActor,
    auditPage: String(filters.auditPage),
    auditPageSize: String(filters.auditPageSize),
  });
  const response = await fetch(`/api/tasks/ops${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Load ops snapshot failed (${response.status}): ${text}`);
  }
  return response.json();
}

async function retryTask(taskId: string, payload: { actor?: string; reason?: string } = {}): Promise<void> {
  const response = await fetch(`/api/tasks/${taskId}/retry`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Retry task failed (${response.status}): ${text}`);
  }
}

async function retryDeadLettersInBulk(payload: {
  episodeId?: string;
  jobKind?: string;
  traceId?: string;
  deadReason?: string;
  errorCode?: string;
  taskIds?: string[];
  limit?: number;
  actor?: string;
  reason?: string;
  dryRun?: boolean;
}): Promise<BulkRetryResult> {
  const response = await fetch('/api/tasks/dead-letters/retry', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bulk retry dead letters failed (${response.status}): ${text}`);
  }
  const data = (await response.json()) as { result: BulkRetryResult };
  return data.result;
}

async function previewDeadLettersInBulk(payload: {
  episodeId?: string;
  jobKind?: string;
  traceId?: string;
  deadReason?: string;
  errorCode?: string;
  page?: number;
  pageSize?: number;
}): Promise<PreviewDeadLetterMatchesResult> {
  const query = toQuery({
    episodeId: payload.episodeId,
    jobKind: payload.jobKind,
    traceId: payload.traceId,
    deadReason: payload.deadReason,
    errorCode: payload.errorCode,
    page: payload.page !== undefined ? String(payload.page) : undefined,
    pageSize: payload.pageSize !== undefined ? String(payload.pageSize) : undefined,
  });
  const response = await fetch(`/api/tasks/dead-letters/preview${query ? `?${query}` : ''}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Preview dead letters failed (${response.status}): ${text}`);
  }
  const data = (await response.json()) as { preview: PreviewDeadLetterMatchesResult };
  return data.preview;
}

async function pruneAuditLogs(payload: {
  olderThanDays?: number;
  episodeId?: string;
  jobKind?: string;
  traceId?: string;
  auditAction?: string;
  auditActor?: string;
  batchId?: string;
  limit?: number;
  actor?: string;
  reason?: string;
  dryRun?: boolean;
}): Promise<AuditPruneResult> {
  const response = await fetch('/api/tasks/audit-logs/prune', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Prune audit logs failed (${response.status}): ${text}`);
  }
  const data = (await response.json()) as { result: AuditPruneResult };
  return data.result;
}

function triggerBrowserDownload(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function QueueOpsPage() {
  const [draftEpisodeId, setDraftEpisodeId] = useState('');
  const [draftJobKind, setDraftJobKind] = useState('');
  const [draftTraceId, setDraftTraceId] = useState('');
  const [draftAuditAction, setDraftAuditAction] = useState('');
  const [draftAuditActor, setDraftAuditActor] = useState('');
  const [auditPageSizeDraft, setAuditPageSizeDraft] = useState('20');
  const [filters, setFilters] = useState({ episodeId: '', jobKind: '', traceId: '', auditAction: '', auditActor: '' });
  const [auditPage, setAuditPage] = useState(1);

  const [bulkDeadReason, setBulkDeadReason] = useState('');
  const [bulkErrorCode, setBulkErrorCode] = useState('');
  const [bulkLimit, setBulkLimit] = useState('100');
  const [bulkReason, setBulkReason] = useState('');

  const [data, setData] = useState<OpsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionTaskId, setActionTaskId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkPreviewPending, setBulkPreviewPending] = useState(false);
  const [bulkPreviewOpen, setBulkPreviewOpen] = useState(false);
  const [selectedPreviewTaskIds, setSelectedPreviewTaskIds] = useState<string[]>([]);
  const [auditPruneDaysDraft, setAuditPruneDaysDraft] = useState('30');
  const [auditPruneLimitDraft, setAuditPruneLimitDraft] = useState('500');
  const [auditPrunePending, setAuditPrunePending] = useState<AuditPruneMode | null>(null);
  const [auditPruneResult, setAuditPruneResult] = useState<AuditPruneResult | null>(null);
  const [auditExportPending, setAuditExportPending] = useState<AuditExportFormat | null>(null);
  const [bulkPreview, setBulkPreview] = useState<PreviewDeadLetterMatchesResult | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkRetryResult | null>(null);
  const auditPageSize = parseOptionalPositiveInt(auditPageSizeDraft) || 20;

  const load = useCallback(
    async (withLoading: boolean) => {
      if (withLoading) setLoading(true);
      try {
        const snapshot = await fetchSnapshot({
          ...filters,
          auditPage,
          auditPageSize,
        });
        setData(snapshot);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (withLoading) setLoading(false);
      }
    },
    [auditPage, auditPageSize, filters],
  );

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => {
      void load(false);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const queue = data?.queue;
  const summaryByKind = useMemo(() => data?.summaryByKind || [], [data?.summaryByKind]);
  const failedTasks = useMemo(() => data?.recentFailedTasks || [], [data?.recentFailedTasks]);
  const deadLetters = useMemo(() => data?.recentDeadLetters || [], [data?.recentDeadLetters]);
  const auditLogs = useMemo(() => data?.recentAuditLogs || [], [data?.recentAuditLogs]);
  const auditPagination = data?.auditPagination;
  const previewPageAllSelected = useMemo(() => {
    if (!bulkPreview || bulkPreview.taskIds.length === 0) return false;
    return bulkPreview.taskIds.every((taskId) => selectedPreviewTaskIds.includes(taskId));
  }, [bulkPreview, selectedPreviewTaskIds]);

  const applyFilters = () => {
    setFilters({
      episodeId: draftEpisodeId.trim(),
      jobKind: draftJobKind.trim(),
      traceId: draftTraceId.trim(),
      auditAction: draftAuditAction.trim(),
      auditActor: draftAuditActor.trim(),
    });
    setAuditPage(1);
    setBulkPreview(null);
    setBulkPreviewOpen(false);
    setSelectedPreviewTaskIds([]);
  };

  const clearFilters = () => {
    setDraftEpisodeId('');
    setDraftJobKind('');
    setDraftTraceId('');
    setDraftAuditAction('');
    setDraftAuditActor('');
    setAuditPageSizeDraft('20');
    setFilters({ episodeId: '', jobKind: '', traceId: '', auditAction: '', auditActor: '' });
    setAuditPage(1);
    setBulkPreview(null);
    setBulkPreviewOpen(false);
    setSelectedPreviewTaskIds([]);
  };

  const handleRetry = async (taskId: string) => {
    setActionError(null);
    setActionTaskId(taskId);
    try {
      await retryTask(taskId, {
        actor: 'ops-console',
        reason: 'ops_console_single_retry',
      });
      await load(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionTaskId(null);
    }
  };

  const loadBulkPreviewPage = async (targetPage: number) => {
    const pageSize = parseOptionalPositiveInt(bulkLimit) || 100;
    const preview = await previewDeadLettersInBulk({
      episodeId: filters.episodeId || undefined,
      jobKind: filters.jobKind || undefined,
      traceId: filters.traceId || undefined,
      deadReason: bulkDeadReason.trim() || undefined,
      errorCode: bulkErrorCode.trim() || undefined,
      page: targetPage,
      pageSize,
    });
    setBulkPreview(preview);
    setSelectedPreviewTaskIds(preview.taskIds);
    return preview;
  };

  const handleBulkRetry = async (taskIds?: string[]) => {
    setActionError(null);
    setBulkPending(true);
    try {
      const result = await retryDeadLettersInBulk({
        episodeId: filters.episodeId || undefined,
        jobKind: filters.jobKind || undefined,
        traceId: filters.traceId || undefined,
        deadReason: bulkDeadReason.trim() || undefined,
        errorCode: bulkErrorCode.trim() || undefined,
        taskIds: taskIds && taskIds.length > 0 ? taskIds : undefined,
        limit: parseOptionalPositiveInt(bulkLimit),
        actor: 'ops-console',
        reason: bulkReason.trim() || undefined,
        dryRun: false,
      });
      setBulkResult(result);
      setBulkPreview(null);
      setBulkPreviewOpen(false);
      setSelectedPreviewTaskIds([]);
      await load(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkPending(false);
    }
  };

  const handlePreviewBulkRetry = async () => {
    setActionError(null);
    setBulkPreviewPending(true);
    try {
      await loadBulkPreviewPage(1);
      setBulkPreviewOpen(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkPreviewPending(false);
    }
  };

  const handlePreviewPageChange = async (targetPage: number) => {
    if (bulkPreviewPending) return;
    setActionError(null);
    setBulkPreviewPending(true);
    try {
      await loadBulkPreviewPage(targetPage);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkPreviewPending(false);
    }
  };

  const handleTogglePreviewTaskSelection = (taskId: string, checked: boolean) => {
    setSelectedPreviewTaskIds((current) => {
      if (checked) {
        if (current.includes(taskId)) return current;
        return [...current, taskId];
      }
      return current.filter((item) => item !== taskId);
    });
  };

  const handleToggleSelectAllPreviewPage = (checked: boolean) => {
    if (!bulkPreview) return;
    if (checked) {
      setSelectedPreviewTaskIds(bulkPreview.taskIds);
      return;
    }
    setSelectedPreviewTaskIds([]);
  };

  const handleBulkRetrySelected = async () => {
    if (selectedPreviewTaskIds.length === 0) {
      setActionError('No preview task selected for retry.');
      return;
    }
    await handleBulkRetry(selectedPreviewTaskIds);
  };

  const handleExportAuditLogs = async (format: AuditExportFormat) => {
    setActionError(null);
    setAuditExportPending(format);
    try {
      const query = toQuery({
        episodeId: filters.episodeId,
        jobKind: filters.jobKind,
        traceId: filters.traceId,
        auditAction: filters.auditAction,
        auditActor: filters.auditActor,
        format,
        limit: '2000',
      });
      const response = await fetch(`/api/tasks/audit-logs/export${query ? `?${query}` : ''}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Export audit logs failed (${response.status}): ${text}`);
      }

      if (format === 'csv') {
        const csv = await response.text();
        triggerBrowserDownload(csv, `task-audit-logs-${Date.now()}.csv`, 'text/csv;charset=utf-8');
        return;
      }

      const data = await response.json();
      triggerBrowserDownload(
        JSON.stringify(data, null, 2),
        `task-audit-logs-${Date.now()}.json`,
        'application/json;charset=utf-8',
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuditExportPending(null);
    }
  };

  const handlePruneAuditLogs = async (mode: AuditPruneMode) => {
    setActionError(null);
    setAuditPrunePending(mode);
    try {
      const result = await pruneAuditLogs({
        olderThanDays: parseOptionalNonNegativeInt(auditPruneDaysDraft) ?? 30,
        episodeId: filters.episodeId || undefined,
        jobKind: filters.jobKind || undefined,
        traceId: filters.traceId || undefined,
        auditAction: filters.auditAction || undefined,
        auditActor: filters.auditActor || undefined,
        limit: parseOptionalPositiveInt(auditPruneLimitDraft) ?? 500,
        actor: 'ops-console',
        reason: 'ops_manual_audit_prune',
        dryRun: mode === 'dry_run',
      });
      setAuditPruneResult(result);
      await load(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuditPrunePending(null);
    }
  };

  return (
    <main className="min-h-screen p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6 rounded-2xl border border-slate-300/70 bg-white/85 p-6 shadow-xl shadow-slate-300/30 backdrop-blur">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Queue Ops Console</h1>
            <p className="text-sm text-slate-600">按 job_kind 观察任务流、dead-letter、批量重试与审计日志</p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back To Home
          </Link>
        </header>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <input
              value={draftEpisodeId}
              onChange={(e) => setDraftEpisodeId(e.target.value)}
              placeholder="episodeId (optional)"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-1"
            />
            <input
              value={draftJobKind}
              onChange={(e) => setDraftJobKind(e.target.value)}
              placeholder="jobKind (optional)"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-1"
            />
            <input
              value={draftTraceId}
              onChange={(e) => setDraftTraceId(e.target.value)}
              placeholder="traceId contains (optional)"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-1"
            />
            <input
              value={auditPageSizeDraft}
              onChange={(e) => setAuditPageSizeDraft(e.target.value)}
              placeholder="audit page size (default 20)"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-1"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <input
              value={draftAuditAction}
              onChange={(e) => setDraftAuditAction(e.target.value)}
              placeholder="audit action (optional)"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-1"
            />
            <input
              value={draftAuditActor}
              onChange={(e) => setDraftAuditActor(e.target.value)}
              placeholder="audit actor contains (optional)"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-1"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={applyFilters}
                className="rounded-md border border-indigo-500 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Dead-letter Bulk Retry</h2>
            <div className="text-xs text-slate-600">
              scope: episode={shortId(filters.episodeId)} | kind={filters.jobKind || '-'} | trace={shortId(filters.traceId)}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <input
              value={bulkDeadReason}
              onChange={(e) => setBulkDeadReason(e.target.value)}
              placeholder="deadReason (optional)"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-1"
            />
            <input
              value={bulkErrorCode}
              onChange={(e) => setBulkErrorCode(e.target.value)}
              placeholder="errorCode (optional)"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-1"
            />
            <input
              value={bulkLimit}
              onChange={(e) => setBulkLimit(e.target.value)}
              placeholder="limit (default 100)"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-1"
            />
            <input
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="reason (optional)"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePreviewBulkRetry}
              disabled={bulkPreviewPending}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {bulkPreviewPending ? 'Previewing...' : 'Preview Match'}
            </button>
            <button
              type="button"
              onClick={() => void handleBulkRetry()}
              disabled={bulkPending}
              className="rounded-md border border-emerald-600 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {bulkPending ? 'Retrying...' : 'Bulk Retry Dead Letters'}
            </button>
            <button
              type="button"
              onClick={() => void handleBulkRetrySelected()}
              disabled={bulkPending || selectedPreviewTaskIds.length === 0}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
            >
              {bulkPending ? 'Retrying...' : `Retry Selected (${selectedPreviewTaskIds.length})`}
            </button>
            <span className="text-xs text-slate-500">仅重试当前仍处于 failed/cancelled 的 dead-letter 任务</span>
          </div>
          {bulkPreview && (
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  preview total={bulkPreview.total} | page {bulkPreview.page}/{Math.max(1, Math.ceil(bulkPreview.total / bulkPreview.pageSize))}
                </div>
                <button
                  type="button"
                  onClick={() => setBulkPreviewOpen((open) => !open)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {bulkPreviewOpen ? 'Hide Matched task_id' : 'View Matched task_id'}
                </button>
              </div>
              {bulkPreviewOpen && (
                <div className="mt-2 space-y-2">
                  <label className="inline-flex items-center gap-2 text-[11px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={previewPageAllSelected}
                      onChange={(e) => handleToggleSelectAllPreviewPage(e.target.checked)}
                    />
                    select all task_id on current page
                  </label>
                  <div className="grid gap-1">
                    {bulkPreview.taskIds.length === 0 ? (
                      <div className="text-[11px] text-slate-500">No task matched.</div>
                    ) : (
                      bulkPreview.taskIds.map((taskId) => (
                        <label key={taskId} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedPreviewTaskIds.includes(taskId)}
                            onChange={(e) => handleTogglePreviewTaskSelection(taskId, e.target.checked)}
                          />
                          <a
                            href={`/api/tasks/${taskId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[11px] text-indigo-700 hover:underline"
                          >
                            {taskId}
                          </a>
                        </label>
                      ))
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    selected {selectedPreviewTaskIds.length} / {bulkPreview.taskIds.length} on this page
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void handlePreviewPageChange(Math.max(1, bulkPreview.page - 1))}
                      disabled={bulkPreviewPending || bulkPreview.page <= 1}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePreviewPageChange(bulkPreview.page + 1)}
                      disabled={bulkPreviewPending || !bulkPreview.hasMore}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {bulkResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              batch={shortId(bulkResult.batchId)} | selected={bulkResult.selected} | retried={bulkResult.retried} | skipped={bulkResult.skipped}
            </div>
          )}
        </section>

        {loading && <div className="text-sm text-slate-500">Loading ops snapshot...</div>}
        {error && <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {actionError && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">{actionError}</div>
        )}

        {queue && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase text-slate-500">Queued</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{queue.queuedTotal}</div>
              <div className="mt-1 text-xs text-slate-500">
                ready {queue.queuedReady} / delayed {queue.queuedDelayed}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase text-slate-500">Running</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{queue.running}</div>
              <div className="mt-1 text-xs text-slate-500">completed {queue.completed}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase text-slate-500">Failed</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{queue.failed}</div>
              <div className="mt-1 text-xs text-slate-500">cancelled {queue.cancelled}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs uppercase text-slate-500">Dead Letters</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">{queue.deadLetterCount}</div>
              <div className="mt-1 text-xs text-slate-500">global count</div>
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">By Job Kind</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">job_kind</th>
                  <th className="px-3 py-2">queued</th>
                  <th className="px-3 py-2">running</th>
                  <th className="px-3 py-2">completed</th>
                  <th className="px-3 py-2">failed</th>
                  <th className="px-3 py-2">cancelled</th>
                  <th className="px-3 py-2">dead_letter</th>
                </tr>
              </thead>
              <tbody>
                {summaryByKind.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={7}>
                      No data
                    </td>
                  </tr>
                ) : (
                  summaryByKind.map((row) => (
                    <tr key={row.job_kind} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs text-indigo-700">{row.job_kind}</td>
                      <td className="px-3 py-2">{row.queued}</td>
                      <td className="px-3 py-2">{row.running}</td>
                      <td className="px-3 py-2">{row.completed}</td>
                      <td className="px-3 py-2">{row.failed}</td>
                      <td className="px-3 py-2">{row.cancelled}</td>
                      <td className="px-3 py-2">{row.dead_letter}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">Recent Failed Tasks</h2>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">task</th>
                    <th className="px-3 py-2">trace</th>
                    <th className="px-3 py-2">job_kind</th>
                    <th className="px-3 py-2">error</th>
                    <th className="px-3 py-2">attempt</th>
                    <th className="px-3 py-2">updated</th>
                    <th className="px-3 py-2">action</th>
                  </tr>
                </thead>
                <tbody>
                  {failedTasks.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={7}>
                        No failed tasks
                      </td>
                    </tr>
                  ) : (
                    failedTasks.map((task) => (
                      <tr key={task.id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{shortId(task.id)}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{shortId(task.trace_id)}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-indigo-700">{task.job_kind}</td>
                        <td className="px-3 py-2 text-[11px] text-red-700">
                          {task.error_code || '-'}
                          {task.error_message ? `: ${task.error_message.slice(0, 80)}` : ''}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-700">
                          {task.attempt_count}/{task.max_attempts}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-500">{formatTime(task.updated_at)}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => handleRetry(task.id)}
                            disabled={actionTaskId === task.id}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            {actionTaskId === task.id ? 'Retrying...' : 'Retry'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">Recent Dead Letters</h2>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-slate-100 uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">task</th>
                    <th className="px-3 py-2">trace</th>
                    <th className="px-3 py-2">job_kind</th>
                    <th className="px-3 py-2">reason</th>
                    <th className="px-3 py-2">error</th>
                    <th className="px-3 py-2">attempt</th>
                    <th className="px-3 py-2">action</th>
                  </tr>
                </thead>
                <tbody>
                  {deadLetters.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={7}>
                        No dead letters
                      </td>
                    </tr>
                  ) : (
                    deadLetters.map((item) => (
                      <tr key={item.task_id} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{shortId(item.task_id)}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{shortId(item.trace_id)}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-indigo-700">{item.job_kind}</td>
                        <td className="px-3 py-2 text-[11px] text-slate-700">{item.dead_reason}</td>
                        <td className="px-3 py-2 text-[11px] text-red-700">
                          {item.error_code || '-'}
                          {item.error_message ? `: ${item.error_message.slice(0, 60)}` : ''}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-700">
                          {item.attempts}/{item.max_attempts}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => handleRetry(item.task_id)}
                            disabled={actionTaskId === item.task_id}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            {actionTaskId === item.task_id ? 'Retrying...' : 'Retry'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Recent Audit Logs</h2>
            <div className="flex items-center gap-2">
              <div className="text-xs text-slate-600">
                action={filters.auditAction || '-'} | actor={filters.auditActor || '-'} | total={auditPagination?.total ?? 0}
              </div>
              <input
                value={auditPruneDaysDraft}
                onChange={(e) => setAuditPruneDaysDraft(e.target.value)}
                placeholder="TTL days"
                className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs outline-none ring-indigo-500 focus:ring-1"
              />
              <input
                value={auditPruneLimitDraft}
                onChange={(e) => setAuditPruneLimitDraft(e.target.value)}
                placeholder="limit"
                className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs outline-none ring-indigo-500 focus:ring-1"
              />
              <button
                type="button"
                onClick={() => void handlePruneAuditLogs('dry_run')}
                disabled={auditPrunePending !== null}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {auditPrunePending === 'dry_run' ? 'Dry Running...' : 'Prune Dry-Run'}
              </button>
              <button
                type="button"
                onClick={() => void handlePruneAuditLogs('executed')}
                disabled={auditPrunePending !== null}
                className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
              >
                {auditPrunePending === 'executed' ? 'Pruning...' : 'Prune Execute'}
              </button>
              <button
                type="button"
                onClick={() => handleExportAuditLogs('json')}
                disabled={auditExportPending !== null}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {auditExportPending === 'json' ? 'Exporting...' : 'Export JSON'}
              </button>
              <button
                type="button"
                onClick={() => handleExportAuditLogs('csv')}
                disabled={auditExportPending !== null}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {auditExportPending === 'csv' ? 'Exporting...' : 'Export CSV'}
              </button>
            </div>
          </div>
          {auditPruneResult && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              mode={auditPruneResult.mode} | batch={shortId(auditPruneResult.batchId)} | cutoff={formatTime(auditPruneResult.cutoffAt)} |
              matched={auditPruneResult.matched} | selected={auditPruneResult.selected} | deleted={auditPruneResult.deleted}
            </div>
          )}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-100 uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">time</th>
                  <th className="px-3 py-2">action</th>
                  <th className="px-3 py-2">actor</th>
                  <th className="px-3 py-2">task</th>
                  <th className="px-3 py-2">trace</th>
                  <th className="px-3 py-2">job_kind</th>
                  <th className="px-3 py-2">message</th>
                  <th className="px-3 py-2">metadata</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={8}>
                      No audit logs
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 text-[11px] text-slate-500">{formatTime(item.created_at)}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-indigo-700">{item.action}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{item.actor}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{shortId(item.task_id)}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{shortId(item.trace_id)}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{item.job_kind || '-'}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-700">{item.message}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{toMetadataPreview(item.metadata_json)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setAuditPage((current) => Math.max(1, current - 1))}
              disabled={auditPage <= 1}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Prev
            </button>
            <span className="text-xs text-slate-600">
              Page {auditPagination?.page ?? auditPage} / {Math.max(1, Math.ceil((auditPagination?.total || 0) / (auditPagination?.pageSize || auditPageSize)))}
            </span>
            <button
              type="button"
              onClick={() => setAuditPage((current) => current + 1)}
              disabled={!auditPagination?.hasMore}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
