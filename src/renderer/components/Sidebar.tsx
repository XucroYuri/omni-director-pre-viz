
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { BeatTableItem, GlobalConfig, SceneTableItem, Shot } from '@shared/types';
import { getGridCellCount, normalizeGridLayout } from '@shared/utils';
import { 
  Plus, User, Database, Sparkles, Loader2,
  ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen, Trash2, Box, Map,
  Search, X, Hash, Image as ImageIcon, Check, Tag as TagIcon, ArrowUpDown, SortAsc, SortDesc, Clock,
  FileSearch, Download, Upload, FileJson, Info, FileText, Terminal, CheckCircle2, AlertCircle, Link2, Camera, Eraser, Wand2, LayoutGrid, ScrollText, SlidersHorizontal
} from 'lucide-react';
import { enhanceAssetDescription, generateAssetImage } from '../services/geminiService';

type NoticeTone = 'success' | 'error' | 'info';
type AssetKind = 'characters' | 'scenes' | 'props';

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
  scriptOverview?: string;
  sceneTable?: SceneTableItem[];
  beatTable?: BeatTableItem[];
  episodeId: string;
  isElectronRuntime: boolean;
  notify?: (tone: NoticeTone, message: string) => void;
  onUpdateSelectedShotGridLayout?: (layout: { rows: number; cols: number }) => void;
}

type SortOption = 'name' | 'newest';
const GRID_VALUES = [1, 2, 3, 4, 5] as const;

const Sidebar: React.FC<SidebarProps> = ({ 
  config, setConfig, shots, selectedShotId, setSelectedShotId, 
  isLoading, script, setScript, handleBreakdown, scriptOverview, sceneTable, beatTable, episodeId, isElectronRuntime, notify,
  onUpdateSelectedShotGridLayout,
}) => {
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1600 : false,
  );
  const [editorTab, setEditorTab] = useState<'script' | 'timeline' | 'visuals'>('script');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>('newest');
  const [isEnhancingId, setIsEnhancingId] = useState<string | null>(null);
  const [isGeneratingAssetId, setIsGeneratingAssetId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [showGlobalWorkbench, setShowGlobalWorkbench] = useState(false);
  const [expanded, setExpanded] = useState({ characters: true, scenes: true, props: true });
  const undoTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggle = (s: keyof typeof expanded) => setExpanded(p => ({ ...p, [s]: !p[s] }));

  const themeMap = {
    indigo: {
      text: 'od-tone-primary',
      linkedCard: 'od-linked-primary ring-1',
      badgeBg: 'od-bg-primary',
      linkedPill: 'od-pill-primary',
      iconTone: 'od-tone-primary',
      focusWithin: 'od-focus-primary',
    },
    amber: {
      text: 'od-tone-warning',
      linkedCard: 'od-linked-warning ring-1',
      badgeBg: 'od-bg-warning',
      linkedPill: 'od-pill-warning',
      iconTone: 'od-tone-warning',
      focusWithin: 'od-focus-warning',
    },
    emerald: {
      text: 'od-tone-success',
      linkedCard: 'od-linked-success ring-1',
      badgeBg: 'od-bg-success',
      linkedPill: 'od-pill-success',
      iconTone: 'od-tone-success',
      focusWithin: 'od-focus-success',
    },
  } as const;

  const selectedShot = useMemo(() => shots.find(s => s.id === selectedShotId), [shots, selectedShotId]);
  const selectedShotGridLayout = useMemo(
    () => (selectedShot ? normalizeGridLayout(selectedShot.gridLayout) : null),
    [selectedShot],
  );
  const selectedShotCellCount = selectedShotGridLayout ? getGridCellCount(selectedShotGridLayout) : 0;

  const handleGridLayoutChange = (field: 'rows' | 'cols', value: number) => {
    if (!selectedShotGridLayout || !onUpdateSelectedShotGridLayout) return;
    const nextLayout = normalizeGridLayout({ ...selectedShotGridLayout, [field]: value }, selectedShotGridLayout);
    onUpdateSelectedShotGridLayout(nextLayout);
  };

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
    return () => {
      if (undoTimerRef.current) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (collapsed) {
      setShowGlobalWorkbench(false);
    }
  }, [collapsed]);

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
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
                 <Loader2 size={16} className="od-tone-primary animate-spin" />
                 <div className="absolute inset-x-0 h-[2px] od-fill-primary shadow-[0_0_10px_rgba(var(--primary-rgb),0.9)] animate-[scanner_2s_infinite_ease-in-out]" />
                 <span className="text-[7px] od-tone-primary font-black mt-1 tracking-tighter">处理中</span>
              </div>
            ) : item.refImage ? (
              <>
                <img src={item.refImage} className="w-full h-full object-cover transition-transform group-hover/img:scale-110" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/img:opacity-100 flex flex-col items-center justify-center gap-1 transition-opacity">
                  <Camera size={14} className="text-white" />
                  <span className="text-[7px] text-white font-bold">更换</span>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); updateItem(type, item.id, { refImage: undefined }); }}
                  className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full p-0.5 shadow-lg opacity-0 group-hover/img:opacity-100 transition-opacity z-10"
                  title="移除参考图"
                >
                  <X size={8} />
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-1 text-slate-500 transition-colors">
                <div className="flex gap-1">
                   <button 
                     onClick={() => handleGenerateAssetRef(type, item.id)}
                     className="p-1 od-tone-primary hover:text-white od-hover-primary rounded-md transition-all"
                     title="AI 生成参考图"
                   >
                     <Wand2 size={14} className="animate-pulse" />
                   </button>
                </div>
                <span className="text-[7px] font-bold text-slate-500">AI / 上传</span>
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
               {item.tags?.includes('Auto-Scan') && <span className="text-[7px] px-1 od-chip-primary rounded-sm font-bold border">已同步</span>}
               {isLinkedToShot && <span className={`text-[7px] px-1 rounded-sm font-bold border ${theme.linkedPill}`}>已绑定</span>}
            </div>
          </div>
          
          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all">
            <button 
              onClick={() => handleEnhanceDescription(type, item.id)} 
              className="p-1.5 od-tone-primary od-hover-primary rounded-md transition-colors"
              title="AI 增强描述"
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
          <div className={`flex items-center gap-1 bg-black/30 px-1.5 py-0.5 rounded border border-dashed border-white/10 transition-colors ${theme.focusWithin}`}>
            <Plus size={8} className="text-slate-600" />
            <input 
              type="text" 
              placeholder="标签" 
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
            className="od-input w-full rounded-md p-2 text-[10px] leading-snug h-16 outline-none focus:text-slate-100 transition-all resize-none scrollbar-none placeholder:text-slate-700"
            value={item.description}
            onChange={(e) => updateItem(type, item.id, { description: e.target.value })}
            placeholder="填写资产外观、材质、动作特征..."
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

  const visualRefCount = config.characters.length + config.scenes.length + config.props.length;
  const visualCategories = [
    { key: 'characters', label: '角色参考', color: 'indigo' as const, items: filtered.c, prefix: '角色', Icon: User },
    { key: 'scenes', label: '场景参考', color: 'amber' as const, items: filtered.s, prefix: '场景', Icon: Map },
    { key: 'props', label: '道具参考', color: 'emerald' as const, items: filtered.p, prefix: '道具', Icon: Box },
  ];

  const canRunBreakdown = isElectronRuntime && !isLoading && Boolean(script.trim());
  const breakdownDisabledReason = !isElectronRuntime
    ? '剧本解析仅在 Electron 桌面端可用。'
    : !script.trim()
      ? '请先输入剧本内容。'
      : '';

  const openDrawerTab = (tab: 'script' | 'timeline' | 'visuals') => {
    setEditorTab(tab);
    setCollapsed(false);
  };

  return (
    <div className={`od-drawer h-full shrink-0 bg-[#16191f] border-r border-white/10 flex flex-col transition-all duration-300 shadow-2xl ${collapsed ? 'w-16' : 'w-80'}`}>
      <div className={`h-12 flex items-center border-b border-white/10 ${collapsed ? 'justify-center' : 'justify-between px-2.5'}`}>
        {!collapsed && (
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 od-bg-primary-soft rounded flex items-center justify-center border border-white/15"><Database size={12} className="od-tone-primary" /></div>
            <span className="text-[11px] font-black text-slate-100 tracking-[0.12em]">控制中心</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="h-8 w-8 text-slate-400 hover:text-white rounded-lg transition-colors flex items-center justify-center"
          title={collapsed ? '展开左侧栏' : '折叠左侧栏'}
          aria-label={collapsed ? '展开左侧栏' : '折叠左侧栏'}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {collapsed ? (
          <div className="flex-1 flex flex-col items-center justify-between py-3">
            <div className="flex flex-col items-center gap-2">
              {[
                { tab: 'script' as const, label: '剧本', title: '展开剧本抽屉', Icon: FileText },
                { tab: 'timeline' as const, label: '分镜', title: '展开分镜抽屉', Icon: ScrollText },
                { tab: 'visuals' as const, label: '美术', title: '展开美术抽屉', Icon: LayoutGrid },
              ].map(({ tab, label, title, Icon }) => {
                const active = editorTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => openDrawerTab(tab)}
                    title={title}
                    aria-label={title}
                    className={`w-11 h-11 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-all ${
                      active
                        ? 'od-chip-primary'
                        : 'od-btn-ghost'
                    }`}
                  >
                    <Icon size={15} />
                    <span className="text-[8px] font-black tracking-wide">{label}</span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => {
                setEditorTab('script');
                setShowGlobalWorkbench(true);
                setCollapsed(false);
              }}
              title="展开全局工作台抽屉"
              aria-label="展开全局工作台抽屉"
              className={`w-11 h-11 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-all ${
                showGlobalWorkbench
                  ? 'od-chip-primary'
                  : 'od-btn-ghost'
              }`}
            >
              <SlidersHorizontal size={15} />
              <span className="text-[8px] font-black tracking-wide">全局</span>
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 flex flex-col min-h-0 border-b border-white/10 bg-[#16191f]/40">
              <div className="p-2 border-b border-white/10 bg-black/30 grid grid-cols-3 gap-2">
                <button
                  onClick={() => setEditorTab('script')}
                  className={`h-9 rounded-lg text-[10px] font-black tracking-widest transition-all flex items-center justify-center gap-1.5 ${
                    editorTab === 'script'
                      ? 'od-btn-primary'
                      : 'od-btn-ghost'
                  }`}
                >
                  <FileText size={13} />
                  剧本
                </button>
                <button
                  onClick={() => setEditorTab('timeline')}
                  className={`h-9 rounded-lg text-[10px] font-black tracking-widest transition-all flex items-center justify-center gap-1.5 ${
                    editorTab === 'timeline'
                      ? 'od-btn-primary'
                      : 'od-btn-ghost'
                  }`}
                >
                  <ScrollText size={13} />
                  分镜
                </button>
                <button
                  onClick={() => setEditorTab('visuals')}
                  className={`h-9 rounded-lg text-[10px] font-black tracking-widest transition-all flex items-center justify-center gap-1.5 ${
                    editorTab === 'visuals'
                      ? 'od-btn-primary'
                      : 'od-btn-ghost'
                  }`}
                >
                  <LayoutGrid size={13} />
                  美术
                </button>
              </div>

              {editorTab === 'script' && (
                <div className="flex-1 min-h-0 p-3 flex flex-col">
                  <textarea
                    className="flex-1 min-h-[220px] w-full bg-transparent text-[12px] leading-relaxed text-slate-200 outline-none resize-none placeholder:text-slate-700 font-medium"
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    placeholder="在此粘贴剧本文本，开始 AI 解析..."
                  />
                  <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 space-y-1.5">
                    <div className="text-[9px] font-black tracking-widest text-slate-500 uppercase">结构化解析摘要</div>
                    <div className="text-[10px] text-slate-300 leading-relaxed line-clamp-4">
                      {scriptOverview || '尚未生成剧本概述。执行解析后可查看全局压缩上下文。'}
                    </div>
                    <div className="flex items-center gap-3 text-[9px] text-slate-500">
                      <span>场景：{sceneTable?.length || 0}</span>
                      <span>节拍：{beatTable?.length || 0}</span>
                      <span>镜头：{shots.length}</span>
                    </div>
                  </div>
                  {!isElectronRuntime ? (
                    <p className="mt-2 text-[10px] od-tone-warning">
                      当前为浏览器预览模式，剧本解析仅在 Electron 桌面端可用。
                    </p>
                  ) : null}
                </div>
              )}

              {editorTab === 'timeline' && (
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-1.5 space-y-1">
                  {shots.length === 0 ? (
                    <div className="h-24 flex flex-col items-center justify-center text-center p-6 space-y-3">
                      <Terminal size={24} className="text-slate-800 opacity-50" />
                      <span className="text-[9px] font-bold text-slate-700">等待剧本解析</span>
                    </div>
                  ) : (
                    shots.map((shot) => {
                      const hasAssets = (shot.characterIds?.length || 0) + (shot.sceneIds?.length || 0) + (shot.propIds?.length || 0) > 0;
                      const hasPrompts = (shot.matrixPrompts?.length || 0) >= getGridCellCount(normalizeGridLayout(shot.gridLayout));
                      const isRendered = !!shot.generatedImageUrl;
                      const isSelected = selectedShotId === shot.id;

                      return (
                        <div
                          key={shot.id}
                          onClick={() => setSelectedShotId(shot.id)}
                          className={`group px-2.5 py-2 rounded-md cursor-pointer transition-all border ${
                            isSelected
                              ? 'od-selected-primary shadow-inner'
                              : 'bg-transparent border-transparent hover:bg-white/5 hover:border-white/10'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[9px] font-mono font-bold ${isSelected ? 'od-tone-primary' : 'text-slate-500'}`}>SH_{shot.id.substring(0, 4)}</span>
                                <span className={`text-[7px] font-black px-1 rounded ${isSelected ? 'od-bg-primary text-white' : 'bg-white/5 text-slate-600'}`}>{shot.contextTag}</span>
                              </div>
                              <p className={`mt-0.5 text-[10px] leading-snug line-clamp-1 font-medium ${isSelected ? 'text-slate-100' : 'text-slate-400'}`}>{shot.visualTranslation}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 pt-0.5">
                              {shot.status === 'failed' && <AlertCircle size={9} className="text-red-500" />}
                              {isRendered && <CheckCircle2 size={9} className="od-tone-success" />}
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-1">
                            <span className={`inline-flex items-center justify-center min-w-4 h-4 rounded text-[7px] font-black ${hasAssets ? 'od-pill-success' : 'bg-white/5 text-slate-600 border border-white/5'}`}>资</span>
                            <span className={`inline-flex items-center justify-center min-w-4 h-4 rounded text-[7px] font-black ${hasPrompts ? 'od-pill-primary' : 'bg-white/5 text-slate-600 border border-white/5'}`}>词</span>
                            <span className={`inline-flex items-center justify-center min-w-4 h-4 rounded text-[7px] font-black ${isRendered ? 'bg-slate-200/30 text-slate-100 border border-slate-300/40' : 'bg-white/5 text-slate-600 border border-white/5'}`}>图</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {editorTab === 'visuals' && (
                <div className="flex-1 min-h-0 p-3 flex flex-col gap-3">
                  <div className="rounded-lg border border-white/10 bg-[#11151d] px-3 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-slate-200 tracking-widest">美术参考</span>
                      <span className="text-[9px] text-slate-500">共 {visualRefCount} 项</span>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-400 leading-relaxed">
                      维护镜头所需的角色、场景和道具参考，供中间画布快速绑定。
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative group flex-1">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 od-group-focus-primary" />
                      <input
                        type="text"
                        placeholder="搜索美术参考..."
                        className="od-input w-full rounded-lg py-2 pl-9 pr-3 text-[11px] outline-none"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-1">
                      <button onClick={handleExport} className="od-btn-ghost od-hover-tone-primary p-2 rounded-lg text-slate-400 transition-all" title="导出美术参考库"><Download size={14} /></button>
                      <button onClick={() => fileInputRef.current?.click()} className="od-btn-ghost od-hover-tone-warning p-2 rounded-lg text-slate-400 transition-all" title="导入美术参考库"><Upload size={14} /></button>
                      <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleImport} />
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                    {pendingDelete && (
                      <div className="rounded-lg od-alert-warning px-3 py-2 flex items-center justify-between gap-3">
                        <div className="text-[10px] truncate">
                          已删除 <span className="font-bold">{pendingDelete.item.name}</span>，可撤销。
                        </div>
                        <button
                          onClick={handleUndoDelete}
                          className="h-7 px-2 rounded-md od-tile-warning text-[9px] font-black uppercase tracking-widest shrink-0"
                        >
                          撤销
                        </button>
                      </div>
                    )}

                    {visualCategories.map((cat) => (
                      <section key={cat.key} className="rounded-lg border border-white/10 bg-white/[0.02] px-2 py-2">
                        <div className="flex items-center justify-between mb-2 px-1">
                          <div className="flex items-center gap-2 cursor-pointer group" onClick={() => toggle(cat.key as keyof typeof expanded)}>
                            <cat.Icon size={12} className={themeMap[cat.color].iconTone} />
                            <span className="text-[10px] font-black text-slate-300 tracking-widest">{cat.label}</span>
                            <span className="text-[9px] text-slate-500">({cat.items.length})</span>
                          </div>
                          <button onClick={() => addItem(cat.key as any, cat.prefix)} className="od-btn-ghost p-1.5 rounded-md text-slate-400 hover:text-white transition-all" title={`新增${cat.prefix}`}><Plus size={14} /></button>
                        </div>
                        {expanded[cat.key as keyof typeof expanded] && (
                          <div className="space-y-3 px-1">
                            {cat.items.map((i) => <AssetCard key={i.id} item={i} type={cat.key as any} label={cat.prefix} colorKey={cat.color as any} />)}
                          </div>
                        )}
                      </section>
                    ))}
                    {visualCategories.every((cat) => cat.items.length === 0) && (
                      <div className="h-24 rounded-lg border border-dashed border-white/10 flex items-center justify-center text-[10px] text-slate-500">
                        暂无美术参考，点击分类右侧 + 新增
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="relative p-3 border-t border-white/10 bg-[#12151c]">
          {showGlobalWorkbench && (
            <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl border border-white/10 bg-[#11161f] p-3 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[9px] font-black tracking-widest text-slate-300">全局工作台</span>
                <button
                  onClick={() => setShowGlobalWorkbench(false)}
                  className="text-slate-500 hover:text-slate-200"
                  title="收起全局设置"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[9px] font-black tracking-widest text-slate-500">画幅比例</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['16:9', '9:16'] as const).map((ratio) => {
                      const active = config.aspectRatio === ratio;
                      return (
                        <button
                          key={ratio}
                          onClick={() => setConfig((prev) => ({ ...prev, aspectRatio: ratio }))}
                          className={`h-8 rounded-lg border text-[10px] font-black transition-all ${
                            active
                              ? 'od-pill-primary'
                              : 'border-white/10 bg-black/30 text-slate-300 hover:border-white/30'
                          }`}
                        >
                          {ratio}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-[9px] font-black tracking-widest text-slate-500">输出分辨率</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['1K', '2K', '4K'] as const).map((resolution) => {
                      const active = config.resolution === resolution;
                      return (
                        <button
                          key={resolution}
                          onClick={() => setConfig((prev) => ({ ...prev, resolution }))}
                          className={`h-8 rounded-lg border text-[10px] font-black transition-all ${
                            active
                              ? 'od-pill-primary'
                              : 'border-white/10 bg-black/30 text-slate-300 hover:border-white/30'
                          }`}
                        >
                          {resolution}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-[9px] font-black tracking-widest text-slate-500">网格布局（当前镜头）</div>
                  {!selectedShot || !selectedShotGridLayout ? (
                    <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-2.5 py-2 text-[10px] text-slate-500">
                      请选择镜头后再设置网格布局。
                    </div>
                  ) : (
                    <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 space-y-2">
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="font-mono font-black od-tone-primary">SH_{selectedShot.id.substring(0, 4)}</span>
                        <span className="text-slate-500">
                          {selectedShotGridLayout.rows}x{selectedShotGridLayout.cols} / {selectedShotCellCount} 格
                        </span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-end gap-1.5">
                        <label className="block">
                          <span className="mb-1 block text-[9px] text-slate-500">行</span>
                          <select
                            value={selectedShotGridLayout.rows}
                            onChange={(event) => handleGridLayoutChange('rows', Number(event.target.value))}
                            className="od-input h-8 w-full rounded-lg px-2 text-[10px] font-black outline-none"
                          >
                            {GRID_VALUES.map((value) => (
                              <option key={`wb-row-${value}`} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </label>
                        <span className="text-center text-[10px] font-black text-slate-500">x</span>
                        <label className="block">
                          <span className="mb-1 block text-[9px] text-slate-500">列</span>
                          <select
                            value={selectedShotGridLayout.cols}
                            onChange={(event) => handleGridLayoutChange('cols', Number(event.target.value))}
                            className="od-input h-8 w-full rounded-lg px-2 text-[10px] font-black outline-none"
                          >
                            {GRID_VALUES.map((value) => (
                              <option key={`wb-col-${value}`} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="text-[9px] leading-relaxed text-slate-500">
                        修改网格会重置当前镜头母图、切片与视频状态，以保证流程闭环一致。
                      </div>
                    </div>
                  )}
                </div>

                <label className="block">
                  <div className="mb-1 text-[9px] font-black tracking-widest text-slate-500">美术风格（全局）</div>
                  <textarea
                    rows={3}
                    value={config.artStyle}
                    onChange={(event) => setConfig((prev) => ({ ...prev, artStyle: event.target.value }))}
                    className="od-input w-full resize-none rounded-lg px-2 py-2 text-[10px] outline-none"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleBreakdown}
              disabled={!canRunBreakdown}
              title={breakdownDisabledReason}
              className="od-btn-primary flex-1 h-11 rounded-xl text-[11px] font-black tracking-widest transition-all"
            >
              {isLoading ? '剧本解析中...' : '开始解析剧本'}
            </button>

            <button
              onClick={() => setShowGlobalWorkbench((prev) => !prev)}
              className={`h-11 w-11 rounded-xl border transition-all flex items-center justify-center ${
                showGlobalWorkbench
                  ? 'od-chip-primary'
                  : 'od-btn-ghost'
              }`}
              title={showGlobalWorkbench ? '收起全局工作台' : '展开全局工作台'}
              aria-label={showGlobalWorkbench ? '收起全局工作台' : '展开全局工作台'}
            >
              <SlidersHorizontal size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
