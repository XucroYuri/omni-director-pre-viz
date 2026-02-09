import React, { useMemo, useRef, useState } from 'react';
import { Activity, Download, FileDown, ListChecks, Loader2, PanelRightClose, PanelRightOpen, Save } from 'lucide-react';
import type { Shot } from '@shared/types';
import TaskPanel from './TaskPanel';

interface GlobalOpsPanelProps {
  shots: Shot[];
  onExportEpisode: () => Promise<void> | void;
  isExporting: boolean;
  createZip: boolean;
  setCreateZip: (next: boolean) => void;
  isElectronRuntime: boolean;
  apiStatus: 'connected' | 'error' | 'idle';
  isAutoSaving: boolean;
  lastAutoSavedAt: number | null;
}

const GlobalOpsPanel: React.FC<GlobalOpsPanelProps> = ({
  shots,
  onExportEpisode,
  isExporting,
  createZip,
  setCreateZip,
  isElectronRuntime,
  apiStatus,
  isAutoSaving,
  lastAutoSavedAt,
}) => {
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1600 : false,
  );
  const statusSectionRef = useRef<HTMLElement | null>(null);
  const exportSectionRef = useRef<HTMLElement | null>(null);
  const taskSectionRef = useRef<HTMLDivElement | null>(null);
  const renderedShotCount = useMemo(
    () => shots.filter((shot) => Boolean(shot.generatedImageUrl)).length,
    [shots],
  );

  const canExportEpisode = isElectronRuntime && renderedShotCount > 0 && !isExporting;
  const exportDisabledReason = !isElectronRuntime
    ? '导出仅支持 Electron 桌面端。'
    : renderedShotCount === 0
      ? '请先至少渲染一个镜头。'
      : '';

  const statusMeta: Record<GlobalOpsPanelProps['apiStatus'], { text: string; dot: string; textTone: string }> = {
    connected: { text: '服务正常', dot: 'od-dot-success', textTone: 'od-tone-success' },
    error: { text: '需要处理', dot: 'od-dot-danger', textTone: 'od-tone-danger' },
    idle: { text: '待命中', dot: 'od-dot-muted', textTone: 'text-slate-300' },
  };

  const autoSaveText = !isElectronRuntime
    ? '浏览器预览模式：仅本地缓存'
    : isAutoSaving
      ? '自动保存中...'
      : lastAutoSavedAt
        ? `最近保存 ${new Date(lastAutoSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : '自动保存已启用';

  const openDrawerSection = (section: 'status' | 'export' | 'tasks') => {
    const scrollToTarget = () => {
      const target =
        section === 'status'
          ? statusSectionRef.current
          : section === 'export'
            ? exportSectionRef.current
            : taskSectionRef.current;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    if (collapsed) {
      setCollapsed(false);
      window.setTimeout(scrollToTarget, 180);
      return;
    }

    scrollToTarget();
  };

  return (
    <aside
      className={`od-drawer h-full shrink-0 bg-[#16191f] border-l border-white/10 flex flex-col transition-all duration-300 shadow-2xl ${
        collapsed ? 'w-16' : 'w-80'
      }`}
    >
      <div
        className={`h-12 border-b border-white/10 flex items-center ${
          collapsed ? 'justify-center' : 'justify-between px-2.5'
        }`}
      >
        {!collapsed ? (
          <span className="text-[11px] font-black text-slate-100 tracking-[0.12em]">全局操作</span>
        ) : null}
        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className="h-8 w-8 text-slate-400 hover:text-white rounded-lg transition-colors flex items-center justify-center"
          title={collapsed ? '展开右侧栏内容' : '折叠右侧栏内容'}
          aria-label={collapsed ? '展开右侧栏内容' : '折叠右侧栏内容'}
        >
          {collapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
        </button>
      </div>

      {!collapsed ? (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
          <section ref={statusSectionRef} className="bg-slate-500/5 rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black text-slate-200 tracking-widest">任务状态</span>
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${statusMeta[apiStatus].dot}`} />
                <span className={`text-[10px] font-black ${statusMeta[apiStatus].textTone}`}>{statusMeta[apiStatus].text}</span>
              </span>
            </div>
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <Save size={12} />
                <span className="font-black tracking-widest">自动保存</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-300">{autoSaveText}</p>
            </div>
          </section>

          <div ref={taskSectionRef}>
            <TaskPanel />
          </div>

          <section ref={exportSectionRef} className="bg-slate-500/5 rounded-xl border border-white/10 p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileDown size={14} className="od-tone-primary" />
              <span className="text-[10px] font-black text-slate-200 uppercase tracking-widest">交付导出</span>
            </div>
            <div className="mb-2 text-[10px] text-slate-500">
              可导出镜头：<span className="text-slate-300 font-bold">{renderedShotCount}</span>
            </div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <input
                type="checkbox"
                id="globalCreateZip"
                checked={createZip}
                onChange={(e) => setCreateZip(e.target.checked)}
                className="w-3 h-3 accent-indigo-500 bg-transparent border-white/20 rounded cursor-pointer"
              />
              <label htmlFor="globalCreateZip" className="text-[10px] text-slate-400 cursor-pointer select-none">
                生成 ZIP 包
              </label>
            </div>
            <button
              onClick={onExportEpisode}
              disabled={!canExportEpisode}
              className="od-btn-primary w-full h-9 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
              title={exportDisabledReason}
            >
              {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              导出分集
            </button>
            {exportDisabledReason ? (
              <p className="mt-2 text-[10px] od-tone-warning">{exportDisabledReason}</p>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-between py-3">
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => openDrawerSection('status')}
              title="展开任务状态抽屉"
              aria-label="展开任务状态抽屉"
              className="od-tile-success w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all"
            >
              <Activity size={15} />
              <span className="text-[8px] font-black tracking-wide">状态</span>
            </button>
            <button
              onClick={() => openDrawerSection('tasks')}
              title="展开任务队列抽屉"
              aria-label="展开任务队列抽屉"
              className="od-tile-warning w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all"
            >
              <ListChecks size={15} />
              <span className="text-[8px] font-black tracking-wide">任务</span>
            </button>
          </div>
          <button
            onClick={() => openDrawerSection('export')}
            title="展开交付导出抽屉"
            aria-label="展开交付导出抽屉"
            className="od-tile-primary w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all"
          >
            <FileDown size={15} />
            <span className="text-[8px] font-black tracking-wide">导出</span>
          </button>
        </div>
      )}
    </aside>
  );
};

export default GlobalOpsPanel;
