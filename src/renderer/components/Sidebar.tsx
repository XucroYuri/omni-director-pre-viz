
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { GlobalConfig, Shot } from '@shared/types';
import { 
  Plus, User, Database, Palette, Sparkles, Loader2,
  ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, Trash2, Box, Map,
  Search, X, Hash, Image as ImageIcon, Check, Filter, Tag as TagIcon, ArrowUpDown, SortAsc, SortDesc, Clock,
  FileSearch, Download, Upload, FileJson, Info, FileText, Terminal, CheckCircle2, AlertCircle, Link2, Camera, Eraser, Wand2, Package
} from 'lucide-react';
import { enhanceAssetDescription, generateAssetImage } from '../services/geminiService';
import TaskPanel from './TaskPanel';

type NoticeTone = 'success' | 'error' | 'info';
type AssetKind = 'characters' | 'scenes' | 'props';
type ScriptTemplateOption = { id: string; name: string; script: string };

type PendingDelete = {
  token: string;
  type: AssetKind;
  item: any;
  index: number;
};

const UNDO_WINDOW_MS = 8000;

interface SidebarProps {
  config: GlobalConfig;
  setConfig: React.Dispatch<React.SetStateAction<GlobalConfig>>;
  shots: Shot[];
  selectedShotId: string | null;
  setSelectedShotId: (id: string) => void;
  isLoading: boolean;
  script: string;
  setScript: (s: string) => void;
  handleBreakdown: () => void;
  episodeId: string;
  setEpisodeId: (id: string) => void;
  onSaveEpisode: () => Promise<void> | void;
  onLoadEpisode: () => Promise<void> | void;
  isSavingEpisode?: boolean;
  isLoadingEpisode?: boolean;
  isElectronRuntime: boolean;
  notify?: (tone: NoticeTone, message: string) => void;
  scriptTemplates: ScriptTemplateOption[];
  onApplyScriptTemplate: (templateId: string) => void;
  onQuickStart: (templateId?: string) => void;
}

type SortOption = 'name' | 'newest';

const Sidebar: React.FC<SidebarProps> = ({ 
  config, setConfig, shots, selectedShotId, setSelectedShotId, 
  isLoading, script, setScript, handleBreakdown, episodeId, setEpisodeId, onSaveEpisode, onLoadEpisode,
  isSavingEpisode = false, isLoadingEpisode = false, isElectronRuntime, notify,
  scriptTemplates, onApplyScriptTemplate, onQuickStart,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>('newest');
  const [isEnhancingId, setIsEnhancingId] = useState<string | null>(null);
  const [isGeneratingAssetId, setIsGeneratingAssetId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [createZip, setCreateZip] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(() => scriptTemplates[0]?.id || '');
  const [expanded, setExpanded] = useState({ style: true, characters: true, scenes: true, props: true, setup: false });
  const undoTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggle = (s: keyof typeof expanded) => setExpanded(p => ({ ...p, [s]: !p[s] }));

  const themeMap = {
    indigo: {
      text: 'text-indigo-400',
      border: 'hover:border-indigo-400/40',
      bg: 'bg-indigo-500',
      shadow: 'shadow-indigo-500/20',
      linkedCard: 'border-indigo-400 ring-1 ring-indigo-400/30 shadow-[0_0_20px_rgba(var(--indigo-rgb),0.25)]',
      badgeBg: 'bg-indigo-500',
    },
    amber: {
      text: 'text-amber-400',
      border: 'hover:border-amber-400/40',
      bg: 'bg-amber-500',
      shadow: 'shadow-amber-500/20',
      linkedCard: 'border-amber-400 ring-1 ring-amber-400/30 shadow-[0_0_20px_rgba(var(--amber-rgb),0.25)]',
      badgeBg: 'bg-amber-500',
    },
    emerald: {
      text: 'text-emerald-400',
      border: 'hover:border-emerald-400/40',
      bg: 'bg-emerald-500',
      shadow: 'shadow-emerald-500/20',
      linkedCard: 'border-emerald-400 ring-1 ring-emerald-400/30 shadow-[0_0_20px_rgba(var(--emerald-rgb),0.25)]',
      badgeBg: 'bg-emerald-500',
    },
  } as const;

  const selectedShot = useMemo(() => shots.find(s => s.id === selectedShotId), [shots, selectedShotId]);
  const renderedShotCount = useMemo(() => shots.filter((shot) => Boolean(shot.generatedImageUrl)).length, [shots]);

  const pushNotice = (tone: NoticeTone, message: string) => {
    if (notify) {
      notify(tone, message);
      return;
    }
    if (tone === 'error') {
      console.error(message);
    } else {
      console.info(message);
    }
  };

  useEffect(() => {
    if (!selectedTemplateId && scriptTemplates.length > 0) {
      setSelectedTemplateId(scriptTemplates[0].id);
      return;
    }
    const stillExists = scriptTemplates.some((template) => template.id === selectedTemplateId);
    if (!stillExists) {
      setSelectedTemplateId(scriptTemplates[0]?.id || '');
    }
  }, [scriptTemplates, selectedTemplateId]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  const handleExport = () => {
    const data = {
      version: '4.8',
      exportDate: new Date().toISOString(),
      artStyle: config.artStyle,
      characters: config.characters,
      scenes: config.scenes,
      props: config.props
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `omni_assets_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        if (!importedData.characters && !importedData.scenes && !importedData.props) {
          throw new Error('无效的资产库文件格式');
        }

        setConfig(prev => {
          const merge = (prevList: any[], newList: any[]) => {
            const existingIds = new Set(prevList.map(item => item.id));
            const filteredNew = (newList || []).filter(item => !existingIds.has(item.id));
            return [...prevList, ...filteredNew];
          };

          return {
            ...prev,
            artStyle: importedData.artStyle || prev.artStyle,
            characters: merge(prev.characters, importedData.characters),
            scenes: merge(prev.scenes, importedData.scenes),
            props: merge(prev.props, importedData.props)
          };
        });
        pushNotice('success', '资产库导入成功（已完成增量合并）。');
      } catch (err: any) {
        pushNotice('error', `导入失败：${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const addItem = (type: 'characters' | 'scenes' | 'props', prefix: string) => {
    const next = { id: `ast-${Date.now()}`, name: `新${prefix}`, description: '', tags: ['Manual'] };
    setConfig(prev => ({ ...prev, [type]: [next, ...prev[type]] }));
  };

  const schedulePendingDeleteExpiry = (token: string) => {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      setPendingDelete((current) => (current?.token === token ? null : current));
      undoTimerRef.current = null;
    }, UNDO_WINDOW_MS);
  };

  const handleUndoDelete = () => {
    if (!pendingDelete) return;
    const rollback = pendingDelete;
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setConfig((prev) => {
      const list = [...(prev[rollback.type] as any[])];
      const alreadyExists = list.some((item: any) => item.id === rollback.item.id);
      if (!alreadyExists) {
        const insertAt = Math.min(Math.max(rollback.index, 0), list.length);
        list.splice(insertAt, 0, rollback.item);
      }
      return { ...prev, [rollback.type]: list } as GlobalConfig;
    });
    setPendingDelete(null);
    pushNotice('success', `已撤销删除：${rollback.item.name}`);
  };

  const removeItem = (type: AssetKind, id: string) => {
    const currentList = config[type];
    const index = currentList.findIndex((item) => item.id === id);
    if (index === -1) return;

    const item = currentList[index];
    setConfig((prev) => ({ ...prev, [type]: prev[type].filter((asset) => asset.id !== id) }));

    const token = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setPendingDelete({ token, type, item, index });
    schedulePendingDeleteExpiry(token);
    pushNotice('info', `已删除资产「${item.name}」，可在 ${Math.floor(UNDO_WINDOW_MS / 1000)} 秒内撤销。`);
  };

  const updateItem = (type: 'characters' | 'scenes' | 'props', id: string, u: any) => {
    setConfig(prev => ({ ...prev, [type]: prev[type].map(x => x.id === id ? { ...x, ...u } : x) }));
  };

  const addTag = (type: 'characters' | 'scenes' | 'props', id: string, tag: string) => {
    const item = config[type].find(x => x.id === id);
    if (!item) return;
    const tags = item.tags || [];
    if (!tags.includes(tag)) updateItem(type, id, { tags: [...tags, tag] });
  };

  const removeTag = (type: 'characters' | 'scenes' | 'props', id: string, tag: string) => {
    const item = config[type].find(x => x.id === id);
    if (!item) return;
    updateItem(type, id, { tags: (item.tags || []).filter(t => t !== tag) });
  };

  const handleFileUpload = (type: 'characters' | 'scenes' | 'props', id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isElectronRuntime || !window.api?.app?.media?.putBytes) {
      pushNotice('error', '媒体上传仅在 Electron 桌面端可用。');
      return;
    }
    (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mimeType = file.type || 'application/octet-stream';
        const relativeBase = `episodes/${episodeId}/assets/${id}/ref_upload`;
        const url = await window.api!.app.media.putBytes({ bytes, mimeType, relativeBase });
        updateItem(type, id, { refImage: url });
        pushNotice('success', '参考图上传成功。');
      } catch (err: any) {
        pushNotice('error', `上传失败：${err?.message || err}`);
      } finally {
        e.target.value = '';
      }
    })();
  };

  const handleEnhanceDescription = async (type: 'characters' | 'scenes' | 'props', id: string) => {
    const item = config[type].find(x => x.id === id);
    if (!item || isEnhancingId) return;
    setIsEnhancingId(id);
    try {
      const enhanced = await enhanceAssetDescription(item.name, item.description);
      updateItem(type, id, { description: enhanced });
      pushNotice('success', 'AI 描述增强完成。');
    } catch (err: any) {
      pushNotice('error', `AI 增强失败：${err?.message || err}`);
    } finally { setIsEnhancingId(null); }
  };

  const handleGenerateAssetRef = async (type: 'characters' | 'scenes' | 'props', id: string) => {
    const item = config[type].find(x => x.id === id);
    if (!item || isGeneratingAssetId) return;
    
    setIsGeneratingAssetId(id);
    try {
      const imageUrl = await generateAssetImage(item.name, item.description || 'Professional cinematic concept art', config);
      updateItem(type, id, { refImage: imageUrl });
      pushNotice('success', 'AI 参考图生成完成。');
    } catch (err: any) {
      pushNotice('error', `参考图生成失败：${err?.message || err}`);
    } finally {
      setIsGeneratingAssetId(null);
    }
  };

  const handleExportEpisode = async () => {
    if (isExporting) return;
    if (!isElectronRuntime || !window.api?.app) {
      pushNotice('error', '导出仅在 Electron 桌面端可用。');
      return;
    }
    const exportShots = shots.filter((shot) => Boolean(shot.generatedImageUrl));
    if (exportShots.length === 0) {
      pushNotice('info', '当前没有可导出的镜头，请先生成母图。');
      return;
    }

    const exportEpisodeId = `EP_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    setIsExporting(true);
    try {
      const result = await window.api.app.exportEpisode({
        episodeId: exportEpisodeId,
        shots: exportShots,
        config,
        includeVideos: true,
        createZip: createZip,
      });
      if (result.success) {
        pushNotice(
          'success',
          `导出成功：${result.outputPath}${result.zipPath ? `（ZIP: ${result.zipPath}）` : ''}`,
        );
      } else {
        pushNotice('error', `导出失败：${result.error}`);
      }
    } catch (err: any) {
      pushNotice('error', `系统错误：${err.message || err}`);
    } finally {
      setIsExporting(false);
    }
  };

  const AssetCard = ({ item, type, label, colorKey }: { item: any, type: 'characters' | 'scenes' | 'props', label: string, colorKey: 'indigo' | 'amber' | 'emerald' }) => {
    const theme = themeMap[colorKey];
    const [tagInput, setTagInput] = useState('');
    const isGenerating = isGeneratingAssetId === item.id;
    
    const isLinkedToShot = useMemo(() => {
      if (!selectedShot) return false;
      const field = { characters: 'characterIds', scenes: 'sceneIds', props: 'propIds' }[type] as keyof Shot;
      const ids = (selectedShot[field] as string[]) || [];
      return ids.includes(item.id);
    }, [selectedShot, item.id, type]);

    return (
      <div className={`bg-[#1c2027]/80 border p-3 rounded-lg group relative transition-all duration-300 backdrop-blur-sm ${
        isLinkedToShot 
          ? theme.linkedCard
          : 'border-white/10 hover:border-white/20'
      }`}>
        {isLinkedToShot && (
          <div className={`absolute -top-1.5 -right-1.5 ${theme.badgeBg} text-white rounded-full p-1 shadow-xl z-20 border-2 border-[#1c2027] animate-in zoom-in`}>
             <Check size={8} strokeWidth={5} />
          </div>
        )}
        
        <div className="flex gap-3 mb-2">
          {/* 图片上传/预览/AI生成区 */}
          <div className="w-14 h-14 bg-black rounded-lg overflow-hidden border border-white/10 relative shrink-0 shadow-inner flex items-center justify-center group/img">
            {isGenerating ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-indigo-950/40">
                 <Loader2 size={16} className="text-indigo-400 animate-spin" />
                 <div className="absolute inset-x-0 h-[2px] bg-indigo-400/70 shadow-[0_0_10px_indigo] animate-[scanner_2s_infinite_ease-in-out]" />
                 <span className="text-[7px] text-indigo-400 font-black mt-1 uppercase tracking-tighter">Processing</span>
              </div>
            ) : item.refImage ? (
              <>
                <img src={item.refImage} className="w-full h-full object-cover transition-transform group-hover/img:scale-110" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/img:opacity-100 flex flex-col items-center justify-center gap-1 transition-opacity">
                  <Camera size={14} className="text-white" />
                  <span className="text-[7px] text-white font-bold uppercase">Change</span>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); updateItem(type, item.id, { refImage: undefined }); }}
                  className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full p-0.5 shadow-lg opacity-0 group-hover/img:opacity-100 transition-opacity z-10"
                  title="Remove Image"
                >
                  <X size={8} />
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-1 text-slate-500 transition-colors">
                <div className="flex gap-1">
                   <button 
                     onClick={() => handleGenerateAssetRef(type, item.id)}
                     className="p-1 text-indigo-400 hover:text-white hover:bg-indigo-500/30 rounded-md transition-all"
                     title="AI Generate Reference"
                   >
                     <Wand2 size={14} className="animate-pulse" />
                   </button>
                </div>
                <span className="text-[7px] font-bold uppercase text-slate-500">AI / Upload</span>
              </div>
            )}
            {!isGenerating && !item.refImage && (
              <input 
                type="file" 
                accept="image/*" 
                className="absolute inset-0 opacity-0 cursor-pointer z-0" 
                onChange={(e) => handleFileUpload(type, item.id, e)} 
              />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <input
              className="bg-transparent text-[12px] font-bold text-slate-100 outline-none w-full truncate mb-0.5 placeholder:text-slate-600"
              value={item.name}
              onChange={(e) => updateItem(type, item.id, { name: e.target.value })}
              placeholder={`${label}名称...`}
            />
            <div className="flex items-center gap-2">
               <span className={`text-[8px] font-black uppercase tracking-wider ${theme.text}`}>{label}</span>
               {item.tags?.includes('Auto-Scan') && <span className="text-[7px] px-1 bg-indigo-500/20 text-indigo-300 rounded-sm font-bold uppercase border border-indigo-500/10">Synced</span>}
               {isLinkedToShot && <span className={`text-[7px] px-1 bg-${colorKey}-500/20 text-${colorKey}-300 rounded-sm font-bold uppercase border border-${colorKey}-500/10`}>Linked</span>}
            </div>
          </div>
          
          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all">
            <button 
              onClick={() => handleEnhanceDescription(type, item.id)} 
              className="p-1.5 text-indigo-300 hover:bg-indigo-500/20 rounded-md transition-colors"
              title="AI Enhance"
            >
              {isEnhancingId === item.id ? <Loader2 size={12} className="animate-spin"/> : <Sparkles size={12}/>}
            </button>
            <button 
              onClick={() => removeItem(type, item.id)} 
              className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
            >
              <Trash2 size={12}/>
            </button>
          </div>
        </div>

        {/* 标签管理 */}
        <div className="mb-2 flex flex-wrap gap-1">
          {(item.tags || []).map((t: string) => (
            <span key={t} className="px-1.5 py-0.5 bg-slate-800 border border-white/5 rounded text-[8px] text-slate-300 flex items-center gap-1 hover:border-slate-500 transition-colors">
              {t}
              <button onClick={() => removeTag(type, item.id, t)} className="hover:text-red-400"><X size={6}/></button>
            </span>
          ))}
          <div className="flex items-center gap-1 bg-black/30 px-1.5 py-0.5 rounded border border-dashed border-white/10 focus-within:border-indigo-500/50 transition-colors">
            <Plus size={8} className="text-slate-600" />
            <input 
              type="text" 
              placeholder="Tag" 
              className="bg-transparent border-none text-[8px] outline-none text-slate-300 w-10 placeholder:text-slate-700"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  addTag(type, item.id, tagInput.trim());
                  setTagInput('');
                }
              }}
            />
          </div>
        </div>

        {/* 描述编辑 */}
        <div className="relative group/desc">
          <textarea
            className="w-full bg-black/40 border border-white/5 rounded-md p-2 text-[10px] leading-snug h-16 outline-none text-slate-300 focus:text-slate-100 focus:border-indigo-500/40 focus:bg-white/5 transition-all resize-none scrollbar-none placeholder:text-slate-700"
            value={item.description}
            onChange={(e) => updateItem(type, item.id, { description: e.target.value })}
            placeholder="Visual configuration details..."
          />
        </div>
      </div>
    );
  };

  const filtered = useMemo(() => {
    const process = (items: any[]) => {
      let result = items.filter(x => {
        const matchesSearch = x.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                              x.description.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesTags = selectedTags.length === 0 || (x.tags && selectedTags.every(t => x.tags.includes(t)));
        return matchesSearch && matchesTags;
      });
      if (sortOption === 'name') result.sort((a, b) => a.name.localeCompare(b.name));
      else if (sortOption === 'newest') result.sort((a, b) => b.id.localeCompare(a.id));
      return result;
    };
    return { c: process(config.characters), s: process(config.scenes), p: process(config.props) };
  }, [config, searchTerm, selectedTags, sortOption]);

  const canExportEpisode = isElectronRuntime && renderedShotCount > 0 && !isExporting;
  const canRunBreakdown = isElectronRuntime && !isLoading && Boolean(script.trim());
  const exportDisabledReason = !isElectronRuntime
    ? '导出仅支持 Electron 桌面端。'
    : renderedShotCount === 0
      ? '请先至少渲染一个镜头。'
      : '';
  const breakdownDisabledReason = !isElectronRuntime
    ? '脚本拆解仅在 Electron 桌面端可用。'
    : !script.trim()
      ? '请先输入剧本内容。'
      : '';
  const quickStartDisabledReason = !isElectronRuntime
    ? '一键跑通依赖 AI 拆解能力，仅在 Electron 桌面端可用。'
    : '';

  return (
    <div className={`h-full bg-[#16191f] border-r border-white/10 flex flex-col transition-all duration-300 shadow-2xl ${collapsed ? 'w-16' : 'w-80'}`}>
      <div className={`h-14 flex items-center border-b border-white/10 ${collapsed ? 'justify-center' : 'justify-between px-4'}`}>
        {!collapsed && (
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-indigo-500/20 rounded flex items-center justify-center border border-indigo-500/30"><Database size={12} className="text-indigo-400" /></div>
            <span className="text-[11px] font-black text-slate-100 tracking-[0.2em] uppercase">Control Center</span>
          </div>
        )}
        <button onClick={() => setCollapsed(!collapsed)} className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors">
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!collapsed && (
          <>
            {/* 剧本与镜头列表模块 */}
            <div className="border-b border-white/10 flex flex-col bg-[#16191f]/40 shrink-0">
              <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/30">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <FileText size={14} className="text-indigo-400" /> 脚本编辑
                </span>
                <button
                  onClick={handleBreakdown}
                  disabled={!canRunBreakdown}
                  className="text-[10px] font-black text-indigo-400 hover:text-white transition-all uppercase tracking-tight bg-indigo-500/10 px-2 py-1 rounded border border-indigo-500/20 hover:bg-indigo-500/30 disabled:opacity-40 disabled:hover:text-indigo-400 disabled:hover:bg-indigo-500/10"
                  title={breakdownDisabledReason}
                >
                  {isLoading ? '拆解中...' : '拆解脚本'}
                </button>
              </div>
              <textarea
                className="h-32 bg-transparent p-4 text-[12px] leading-relaxed text-slate-200 outline-none resize-none placeholder:text-slate-700 font-medium"
                value={script} onChange={(e) => setScript(e.target.value)} placeholder="在此粘贴剧本文本，开始 AI 拆解..."
              />

              <div className="px-4 pb-4 bg-black/20 border-t border-white/10 space-y-2">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">首日模板</div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    className="h-9 bg-black/40 border border-white/10 rounded-lg px-2 text-[10px] text-slate-200 outline-none focus:border-indigo-500/40"
                  >
                    {scriptTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => onApplyScriptTemplate(selectedTemplateId)}
                    disabled={!selectedTemplateId}
                    className="h-9 px-3 bg-white/5 border border-white/10 text-slate-300 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-widest disabled:opacity-40"
                  >
                    填充模板
                  </button>
                  <button
                    onClick={() => onQuickStart(selectedTemplateId)}
                    disabled={isLoading || !selectedTemplateId || !isElectronRuntime}
                    className="h-9 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[9px] font-black uppercase tracking-widest disabled:opacity-40"
                    title={quickStartDisabledReason}
                  >
                    一键跑通
                  </button>
                </div>
                {!isElectronRuntime && (
                  <p className="text-[10px] text-amber-300">
                    预览模式可填充模板，但 AI 拆解与一键跑通需在 Electron 桌面端执行。
                  </p>
                )}
              </div>
              
              <div className="border-t border-white/10 flex flex-col bg-black/40">
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">镜头时间线</span>
                </div>
                <div className="max-h-64 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
                  {shots.length === 0 ? (
                    <div className="h-24 flex flex-col items-center justify-center text-center p-6 space-y-3">
                      <Terminal size={24} className="text-slate-800 opacity-50" />
                      <span className="text-[9px] font-bold text-slate-700 uppercase">等待脚本拆解</span>
                    </div>
                  ) : (
                    shots.map((shot) => {
                      const hasAssets = (shot.characterIds?.length || 0) + (shot.sceneIds?.length || 0) + (shot.propIds?.length || 0) > 0;
                      const hasPrompts = (shot.matrixPrompts?.length || 0) >= 9;
                      const isRendered = !!shot.generatedImageUrl;
                      const isSelected = selectedShotId === shot.id;

                      return (
                        <div 
                          key={shot.id} 
                          onClick={() => setSelectedShotId(shot.id)} 
                          className={`group p-3 rounded-lg cursor-pointer transition-all border relative overflow-hidden ${isSelected ? 'bg-indigo-500/15 border-indigo-400/50 shadow-inner' : 'bg-transparent border-transparent hover:bg-white/5 hover:border-white/10'}`}
                        >
                          <div className="flex items-center justify-between mb-1 relative z-10">
                             <div className="flex items-center gap-2">
                               <span className={`text-[10px] font-mono font-bold ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`}>SH_{shot.id.substring(0, 4)}</span>
                             </div>
                             <div className="flex items-center gap-1.5">
                               {shot.status === 'failed' && <AlertCircle size={10} className="text-red-500" />}
                               {isRendered && <CheckCircle2 size={10} className="text-emerald-400" />}
                               <span className={`text-[8px] font-black uppercase px-1 rounded ${isSelected ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-600'}`}>{shot.contextTag}</span>
                             </div>
                          </div>
                          <p className={`text-[11px] leading-snug line-clamp-1 font-medium relative z-10 ${isSelected ? 'text-slate-100' : 'text-slate-400'}`}>{shot.visualTranslation}</p>
                          
                          {/* 镜头就绪度雷达图 (迷你进度条) */}
                          <div className="absolute bottom-0 left-0 w-full h-[2px] flex">
                             <div className={`h-full transition-all duration-500 ${hasAssets ? 'bg-emerald-500 w-1/3' : 'bg-white/5 w-1/3'}`} />
                             <div className={`h-full transition-all duration-500 ${hasPrompts ? 'bg-indigo-500 w-1/3' : 'bg-white/5 w-1/3'}`} />
                             <div className={`h-full transition-all duration-500 ${isRendered ? 'bg-white w-1/3' : 'bg-white/5 w-1/3'}`} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* 资产库搜索排序模块 */}
            <div className="p-4 space-y-5">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative group flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-indigo-400" />
                    <input 
                      type="text" 
                      placeholder="搜索资产..." 
                      className="w-full bg-black/40 border border-white/10 rounded-lg py-2 pl-9 pr-3 text-[11px] outline-none text-slate-200 focus:border-indigo-500/50 focus:bg-white/5" 
                      value={searchTerm} 
                      onChange={(e) => setSearchTerm(e.target.value)} 
                    />
                  </div>
                  <div className="flex gap-1">
                    <button onClick={handleExport} className="p-2 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-indigo-400 rounded-lg transition-all border border-white/5"><Download size={14} /></button>
                    <button onClick={() => fileInputRef.current?.click()} className="p-2 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-amber-400 rounded-lg transition-all border border-white/5"><Upload size={14} /></button>
                    <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleImport} />
                  </div>
                </div>
              </div>

              {pendingDelete && (
                <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 flex items-center justify-between gap-3">
                  <div className="text-[10px] text-amber-200 truncate">
                    已删除 <span className="font-bold">{pendingDelete.item.name}</span>，可撤销。
                  </div>
                  <button
                    onClick={handleUndoDelete}
                    className="h-7 px-2 rounded-md bg-amber-400/20 border border-amber-300/40 text-amber-100 hover:bg-amber-300/30 text-[9px] font-black uppercase tracking-widest shrink-0"
                  >
                    Undo
                  </button>
                </div>
              )}

              <section className="bg-slate-500/5 rounded-xl border border-white/10 p-4">
                <div className="flex items-center justify-between mb-4 cursor-pointer group" onClick={() => toggle('setup')}>
                  <div className="flex items-center gap-2">
                    <Filter size={14} className="text-slate-300" />
                    <span className="text-[10px] font-black text-slate-200 uppercase tracking-widest">输出配置</span>
                  </div>
                  {expanded.setup ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
                {expanded.setup && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      比例
                      <select
                        className="mt-2 w-full bg-black/40 border border-white/10 rounded-lg py-2 px-2 text-[11px] text-slate-200 outline-none focus:border-indigo-500/40"
                        value={config.aspectRatio}
                        onChange={(e) => setConfig(p => ({ ...p, aspectRatio: e.target.value as GlobalConfig['aspectRatio'] }))}
                      >
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                      </select>
                    </label>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      分辨率
                      <select
                        className="mt-2 w-full bg-black/40 border border-white/10 rounded-lg py-2 px-2 text-[11px] text-slate-200 outline-none focus:border-indigo-500/40"
                        value={config.resolution}
                        onChange={(e) => setConfig(p => ({ ...p, resolution: e.target.value as GlobalConfig['resolution'] }))}
                      >
                        <option value="2K">2K</option>
                      </select>
                    </label>
                  </div>
                )}
              </section>

              <section className="bg-indigo-500/5 rounded-xl border border-indigo-400/20 p-4">
                <div className="flex items-center justify-between mb-4 cursor-pointer group" onClick={() => toggle('style')}>
                  <div className="flex items-center gap-2">
                    <Palette size={14} className="text-indigo-400" />
                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">全局美术风格</span>
                  </div>
                  {expanded.style ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
                {expanded.style && (
                  <textarea 
                    className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-[11px] h-24 outline-none resize-none text-slate-200 font-medium leading-relaxed focus:border-indigo-400/40 focus:bg-white/5 transition-all" 
                    value={config.artStyle} 
                    onChange={(e) => setConfig(p => ({ ...p, artStyle: e.target.value }))} 
                  />
                )}
              </section>

              {[
                { key: 'characters', label: 'Cast (Characters)', color: 'indigo', items: filtered.c, prefix: '角色' },
                { key: 'scenes', label: 'Environments', color: 'amber', items: filtered.s, prefix: '场景' },
                { key: 'props', label: 'Objects & Props', color: 'emerald', items: filtered.p, prefix: '道具' }
              ].map(cat => (
                <section key={cat.key}>
                  <div className={`flex items-center justify-between mb-4`}>
                    <div className="flex items-center gap-2 cursor-pointer group" onClick={() => toggle(cat.key as any)}>
                      <div className={`w-2 h-2 rounded-full ${themeMap[cat.color as 'indigo'].bg}`} />
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{cat.label} ({cat.items.length})</span>
                    </div>
                    <button onClick={() => addItem(cat.key as any, cat.prefix)} className="p-1.5 bg-white/5 hover:bg-white/15 rounded-md border border-white/5 text-slate-400 hover:text-white transition-all"><Plus size={14}/></button>
                  </div>
                  {expanded[cat.key as keyof typeof expanded] && (
                    <div className="space-y-4">
                      {cat.items.map(i => <AssetCard key={i.id} item={i} type={cat.key as any} label={cat.prefix} colorKey={cat.color as any} />)}
                    </div>
                  )}
                </section>
              ))}

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
                    id="createZip"
                    checked={createZip}
                    onChange={(e) => setCreateZip(e.target.checked)}
                    className="w-3 h-3 accent-indigo-500 bg-transparent border-white/20 rounded cursor-pointer"
                  />
                  <label htmlFor="createZip" className="text-[10px] text-slate-400 cursor-pointer select-none">
                    生成 ZIP 包
                  </label>
                </div>
                <button
                  onClick={handleExportEpisode}
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
                  <span className="text-[10px] font-black text-slate-200 uppercase tracking-widest">Database</span>
                </div>
                {!isElectronRuntime ? (
                  <p className="mb-3 text-[10px] text-amber-300">当前为浏览器预览模式，数据库功能不可用。</p>
                ) : null}
                <div className="mb-3">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                    Episode ID
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

              <div className="min-w-0">
                <TaskPanel />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
