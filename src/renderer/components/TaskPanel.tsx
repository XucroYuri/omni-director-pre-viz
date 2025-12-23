import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw, StopCircle, XCircle } from 'lucide-react';
import type { DBTask, TaskStatus, TaskType } from '@shared/types';

const statusLabel: Record<TaskStatus, string> = {
  queued: 'Pending',
  running: 'Running',
  completed: 'Success',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const typeTone: Record<TaskType, string> = {
  LLM: 'text-indigo-300',
  IMAGE: 'text-amber-300',
  VIDEO: 'text-emerald-300',
  EXPORT: 'text-slate-300',
};

type ToastTone = 'success' | 'error';

type ToastMessage = {
  id: string;
  message: string;
  tone: ToastTone;
};

const TaskPanel: React.FC = () => {
  const [tasks, setTasks] = useState<DBTask[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let active = true;
    const taskApi = window.api?.app?.task;
    if (!taskApi?.list) return () => {};

    taskApi
      .list()
      .then((list) => {
        if (active) setTasks(list);
      })
      .catch((err) => {
        console.error('Task list failed', err);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      toastTimers.current.forEach((timer) => window.clearTimeout(timer));
      toastTimers.current.clear();
    };
  }, []);

  const pushToast = (message: string, tone: ToastTone) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      toastTimers.current.delete(id);
    }, 3500);
    toastTimers.current.set(id, timer);
  };

  useEffect(() => {
    const taskApi = window.api?.app?.task;
    if (!taskApi?.onUpdate || !taskApi?.offUpdate) return () => {};

    const handleUpdate = (task: DBTask) => {
      if (task.status === 'cancelled') {
        console.info('Task cancelled', task.id);
      }
      setTasks((prev) => {
        const index = prev.findIndex((item) => item.id === task.id);
        const prevStatus = index === -1 ? undefined : prev[index].status;
        if (prevStatus === 'running' && task.status === 'completed') {
          pushToast(`${task.type} task completed`, 'success');
        }
        if (task.status === 'failed' && prevStatus !== 'failed') {
          pushToast(`${task.type} task failed`, 'error');
        }
        if (index === -1) return [...prev, task];
        const next = [...prev];
        next[index] = task;
        return next;
      });
    };

    taskApi.onUpdate(handleUpdate);
    return () => taskApi.offUpdate(handleUpdate);
  }, []);

  const renderStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case 'running':
        return <Loader2 size={12} className="text-indigo-400 animate-spin" />;
      case 'completed':
        return <CheckCircle2 size={12} className="text-emerald-400" />;
      case 'failed':
        return <AlertCircle size={12} className="text-red-400" />;
      case 'cancelled':
        return <XCircle size={12} className="text-slate-500" />;
      case 'queued':
      default:
        return <Clock size={12} className="text-slate-400" />;
    }
  };

  const handleCancel = async (task: DBTask) => {
    const taskApi = window.api?.app?.task;
    if (!taskApi?.cancel) {
      console.warn('Task cancel unavailable');
      return;
    }

    setTasks((prev) =>
      prev.map((item) =>
        item.id === task.id ? { ...item, status: 'cancelled', error: 'cancelled' } : item,
      ),
    );

    try {
      await taskApi.cancel(task.id);
    } catch (err) {
      console.error('Task cancel failed', err);
      setTasks((prev) =>
        prev.map((item) =>
          item.id === task.id ? { ...item, status: task.status, error: task.error } : item,
        ),
      );
    }
  };

  const handleRetry = async (task: DBTask) => {
    const taskApi = window.api?.app?.task;
    if (!taskApi?.retry) {
      console.warn('Task retry unavailable');
      return;
    }

    setTasks((prev) =>
      prev.map((item) =>
        item.id === task.id ? { ...item, status: 'queued', error: null, progress: null } : item,
      ),
    );

    try {
      await taskApi.retry(task.id);
    } catch (err) {
      console.error('Task retry failed', err);
      setTasks((prev) =>
        prev.map((item) =>
          item.id === task.id
            ? { ...item, status: task.status, error: task.error, progress: task.progress }
            : item,
        ),
      );
    }
  };

  return (
    <section className="mt-4 bg-slate-500/5 rounded-xl border border-white/10 p-4">
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 space-y-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`rounded-lg border px-3 py-2 text-[10px] font-bold uppercase tracking-widest shadow-lg ${
                toast.tone === 'success'
                  ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-400/40 bg-red-500/10 text-red-200'
              }`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-black text-slate-200 uppercase tracking-widest">Task Queue</span>
      </div>

      <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-2">
        {tasks.length === 0 ? (
          <div className="text-[10px] text-slate-500 py-2">No tasks yet.</div>
        ) : (
          tasks.map((task) => {
            const progress =
              task.status === 'running' && typeof task.progress === 'number'
                ? Math.max(0, Math.min(1, task.progress))
                : null;
            const canCancel = task.status === 'running' || task.status === 'queued';
            const canRetry = task.status === 'failed' || task.status === 'cancelled';
            const tooltip = [
              `ID: ${task.id}`,
              task.error ? `Error: ${task.error}` : '',
            ]
              .filter(Boolean)
              .join('\n');

            return (
              <div
                key={task.id}
                className="bg-[#10141a]/80 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-slate-300 hover:border-white/10 transition-colors"
                title={tooltip}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className={`font-black uppercase tracking-wider ${typeTone[task.type] || 'text-slate-300'}`}>
                    {task.type}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <div className="flex items-center gap-1.5">
                      {renderStatusIcon(task.status)}
                      <span className="text-[9px] uppercase text-slate-400">{statusLabel[task.status]}</span>
                    </div>
                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => handleCancel(task)}
                        className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] uppercase text-slate-300 hover:text-white hover:border-white/20 hover:bg-white/10 transition-colors"
                        title="Cancel task"
                      >
                        <StopCircle size={12} className="text-slate-400" />
                        <span>Cancel</span>
                      </button>
                    )}
                    {canRetry && (
                      <button
                        type="button"
                        onClick={() => handleRetry(task)}
                        className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] uppercase text-slate-300 hover:text-white hover:border-white/20 hover:bg-white/10 transition-colors"
                        title="Retry task"
                      >
                        <RefreshCw size={12} className="text-slate-400" />
                        <span>Retry</span>
                      </button>
                    )}
                  </div>
                </div>
                {progress !== null && (
                  <div className="mt-2">
                    <div className="h-1 rounded-full bg-white/5">
                      <div
                        className="h-1 rounded-full bg-indigo-400 transition-all"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[8px] text-slate-500">{Math.round(progress * 100)}%</div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default TaskPanel;
