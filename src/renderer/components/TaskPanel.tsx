import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
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

const TaskPanel: React.FC = () => {
  const [tasks, setTasks] = useState<DBTask[]>([]);

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
    const taskApi = window.api?.app?.task;
    if (!taskApi?.onUpdate || !taskApi?.offUpdate) return () => {};

    const handleUpdate = (task: DBTask) => {
      setTasks((prev) => {
        const index = prev.findIndex((item) => item.id === task.id);
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

  return (
    <section className="mt-4 bg-slate-500/5 rounded-xl border border-white/10 p-4">
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
                <div className="flex items-center justify-between">
                  <div className={`font-black uppercase tracking-wider ${typeTone[task.type] || 'text-slate-300'}`}>
                    {task.type}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {renderStatusIcon(task.status)}
                    <span className="text-[9px] uppercase text-slate-400">{statusLabel[task.status]}</span>
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
