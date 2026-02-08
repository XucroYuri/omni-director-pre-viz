import React, { useMemo } from 'react';
import { Database, Download, Loader2, Package } from 'lucide-react';
import type { Shot } from '@shared/types';
import TaskPanel from './TaskPanel';

interface GlobalOpsPanelProps {
  shots: Shot[];
  episodeId: string;
  setEpisodeId: (id: string) => void;
  onSaveEpisode: () => Promise<void> | void;
  onLoadEpisode: () => Promise<void> | void;
  onExportEpisode: () => Promise<void> | void;
  isSavingEpisode: boolean;
  isLoadingEpisode: boolean;
  isExporting: boolean;
  createZip: boolean;
  setCreateZip: (next: boolean) => void;
  isElectronRuntime: boolean;
}

const GlobalOpsPanel: React.FC<GlobalOpsPanelProps> = ({
  shots,
  episodeId,
  setEpisodeId,
  onSaveEpisode,
  onLoadEpisode,
  onExportEpisode,
  isSavingEpisode,
  isLoadingEpisode,
  isExporting,
  createZip,
  setCreateZip,
  isElectronRuntime,
}) => {
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

  return (
    <aside className="w-80 bg-[#16191f] border-l border-white/10 flex flex-col shrink-0">
      <div className="h-14 border-b border-white/10 px-4 flex items-center">
        <span className="text-[11px] font-black text-slate-100 tracking-[0.12em]">全局操作</span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        <section className="bg-slate-500/5 rounded-xl border border-white/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package size={14} className="text-slate-300" />
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
            className="w-full h-9 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:hover:bg-indigo-600"
            title={exportDisabledReason}
          >
            {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            导出分集
          </button>
          {exportDisabledReason ? (
            <p className="mt-2 text-[10px] text-amber-300">{exportDisabledReason}</p>
          ) : null}
        </section>

        <section className="bg-slate-500/5 rounded-xl border border-white/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Database size={14} className="text-slate-300" />
            <span className="text-[10px] font-black text-slate-200 tracking-widest">数据库</span>
          </div>
          {!isElectronRuntime ? (
            <p className="mb-3 text-[10px] text-amber-300">当前为浏览器预览模式，数据库功能不可用。</p>
          ) : null}
          <div className="mb-3">
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              分集 ID
            </label>
            <input
              value={episodeId}
              onChange={(e) => setEpisodeId(e.target.value)}
              className="mt-2 w-full bg-black/40 border border-white/10 rounded-lg py-2 px-2 text-[11px] text-slate-200 outline-none focus:border-indigo-500/40 disabled:opacity-60"
              disabled={!isElectronRuntime || isSavingEpisode || isLoadingEpisode}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onLoadEpisode}
              disabled={!isElectronRuntime || isSavingEpisode || isLoadingEpisode}
              className="h-9 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:hover:bg-white/5"
            >
              {isLoadingEpisode ? '读取中...' : '读取'}
            </button>
            <button
              onClick={onSaveEpisode}
              disabled={!isElectronRuntime || isSavingEpisode || isLoadingEpisode}
              className="h-9 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:hover:bg-indigo-600"
            >
              {isSavingEpisode ? '保存中...' : '保存'}
            </button>
          </div>
        </section>

        <TaskPanel />
      </div>
    </aside>
  );
};

export default GlobalOpsPanel;
