
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Shot, GlobalConfig, Character, Scene, Prop, ShotHistoryItem } from '../types';
import { 
  Zap, RefreshCw, Wand2, Maximize2, User, Info, Check, X, Plus,
  Monitor, Layout, Layers, Box, Camera, Target, Map, Clock, History, Upload,
  UserPlus, MapPin, PackagePlus, Download, FileJson, Sparkles, Loader2,
  ScanSearch, Undo2, Redo2, BoxSelect, Columns, Layers2, Lightbulb,
  ShieldCheck, AlertTriangle, Search, Link2, Unlink, Package, Map as MapIcon,
  CheckCircle2, ChevronRight, Wand, Play, Film, Video
} from 'lucide-react';
// Removed suggestIndividualPrompt and deconstructPrompt as they are not exported or used.
import { 
  enhanceAssetDescription, 
  discoverMissingAssets,
  generateMatrixPrompts,
  generateShotVideo
} from '../services/geminiService';

interface MatrixPromptEditorProps {
  shot: Shot;
  allShots: Shot[];
  config: GlobalConfig;
  onUpdatePrompts: (prompts: string[]) => void;
  onUpdateShot: (updates: Partial<Shot>) => void;
  onGenerateImage: () => void;
  onRestoreHistory: (index: number) => void;
  onAddGlobalAsset: (type: 'characters' | 'scenes' | 'props', name?: string, description?: string) => void;
  onDeleteGlobalAsset: (type: 'characters' | 'scenes' | 'props', id: string) => void;
  onUpdateGlobalAsset: (type: 'characters' | 'scenes' | 'props', id: string, updates: any) => void;
  onOptimizePrompts: () => Promise<void>;
  onAutoLinkAssets: () => Promise<void>;
  isGeneratingPrompts: boolean;
  isGeneratingImage: boolean;
  isOptimizing: boolean;
  isAutoLinking: boolean;
  isRebuildingCache?: boolean;
}

const MatrixPromptEditor: React.FC<MatrixPromptEditorProps> = ({ 
  shot, allShots, config, onUpdatePrompts, onUpdateShot, onGenerateImage, onRestoreHistory, 
  onAddGlobalAsset, onDeleteGlobalAsset, onUpdateGlobalAsset, onOptimizePrompts, 
  onAutoLinkAssets, isGeneratingImage, isOptimizing, isAutoLinking,
  isRebuildingCache
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredAssets, setDiscoveredAssets] = useState<any[]>([]);
  const [isPromptingAll, setIsPromptingAll] = useState(false);
  const [activePreviewIndex, setActivePreviewIndex] = useState<number | null>(null);

  const prompts = shot.matrixPrompts || Array(9).fill('');
  const camNames = ['全景 (EST)', '过肩 (OTS)', '特写 (CU)', '中景 (MS)', '仰拍 (LOW)', '俯拍 (HI)', '侧面 (SIDE)', '极特写 (ECU)', '斜角 (DUTCH)'];

  useEffect(() => {
    handleDiscoverAssets();
  }, [shot.id]);

  const handlePromptChange = (i: number, val: string) => {
    const next = [...prompts];
    next[i] = val;
    onUpdatePrompts(next);
  };

  const handleInitializeShot = async () => {
    setIsPromptingAll(true);
    try {
      if (!shot.matrixPrompts || shot.matrixPrompts.length < 9) {
        const generated = await generateMatrixPrompts(shot, config);
        onUpdatePrompts(generated);
      }
    } catch (err) { console.error(err); } finally { setIsPromptingAll(false); }
  };

  const handleDiscoverAssets = async () => {
    if (isScanning) return;
    setIsScanning(true);
    try {
      const findings = await discoverMissingAssets(shot, config);
      const combined = [
        ...findings.characters.map((c: any) => ({ ...c, type: 'characters' as const })),
        ...findings.scenes.map((s: any) => ({ ...s, type: 'scenes' as const })),
        ...findings.props.map((p: any) => ({ ...p, type: 'props' as const }))
      ];
      setDiscoveredAssets(combined);
    } catch (err) { console.error(err); } finally { setIsScanning(false); }
  };

  const handleCreateShotVideo = async (index: number) => {
    if (!shot.splitImages || !shot.splitImages[index] || shot.videoStatus?.[index] === 'processing') return;
    
    // API Key selection for Veo models
    if (window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
      await window.aistudio.openSelectKey();
    }

    const nextStatus = [...(shot.videoStatus || Array(9).fill('idle'))];
    nextStatus[index] = 'processing';
    onUpdateShot({ videoStatus: nextStatus });

    try {
      const videoUrl = await generateShotVideo(shot.splitImages[index], prompts[index], config);
      const nextUrls = [...(shot.videoUrls || Array(9).fill(null))];
      nextUrls[index] = videoUrl;
      const finalStatus = [...nextStatus];
      finalStatus[index] = 'completed';
      onUpdateShot({ videoUrls: nextUrls, videoStatus: finalStatus });
    } catch (err) {
      console.error(err);
      const finalStatus = [...nextStatus];
      finalStatus[index] = 'failed';
      onUpdateShot({ videoStatus: finalStatus });
    }
  };

  const handleBatchDownload = () => {
    if (!shot.splitImages) return;
    shot.splitImages.forEach((img, idx) => {
      const a = document.createElement('a');
      a.href = img;
      a.download = `S_${shot.id.substring(0,4)}_${camNames[idx].split(' ')[0]}.png`;
      a.click();
    });
  };

  const AssetBubble = ({ item, active, onUnlink, onUpload, accentColor, typeIcon }: any) => (
    <div className="relative group/asset shrink-0">
      <div 
        onClick={() => !active && onUnlink()}
        className={`w-11 h-11 rounded-full border-2 transition-all cursor-pointer overflow-hidden flex items-center justify-center relative ${
          active 
            ? `border-${accentColor}-400 ring-4 ring-${accentColor}-400/30 scale-110 z-10` 
            : 'border-white/10 grayscale opacity-40 hover:opacity-100 hover:grayscale-0'
        }`}
      >
        {item.refImage ? (
          <img src={item.refImage} className="w-full h-full object-cover" />
        ) : (
          <div className={`w-full h-full flex flex-col items-center justify-center bg-${accentColor}-500/10 transition-colors`}>
             <div className={`text-${accentColor}-400 mb-0.5`}>{typeIcon}</div>
             <span className={`text-[6px] font-black text-${accentColor}-500 tracking-tighter uppercase`}>No Ref</span>
          </div>
        )}
        {active && (
          <div className={`absolute inset-0 bg-${accentColor}-500/20 flex items-center justify-center`}>
            <div className={`bg-${accentColor}-500 text-white rounded-full p-1 shadow-2xl border border-white/20 transform scale-110`}>
              <Check size={10} strokeWidth={4} />
            </div>
          </div>
        )}
        <label className="absolute inset-0 bg-black/70 opacity-0 group-hover/asset:opacity-100 flex items-center justify-center transition-opacity cursor-pointer z-10" onClick={(e) => e.stopPropagation()}>
          <Camera size={16} className="text-white" />
          <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
        </label>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0f1115]">
      {/* 工具栏 */}
      <div className="h-14 border-b border-white/10 flex items-center justify-between px-6 shrink-0 bg-[#16191f]/80 backdrop-blur-md z-20">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Selected Shot</span>
            <span className="text-[12px] font-mono font-black text-indigo-400">SH_{shot.id.substring(0, 4)}</span>
          </div>
          <div className="h-6 w-px bg-white/10" />
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Logic Breakdown</span>
            <span className="text-[12px] text-slate-100 font-medium italic truncate max-w-[300px]">"{shot.visualTranslation}"</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleBatchDownload} disabled={!shot.splitImages} className="h-9 px-4 bg-white/5 border border-white/10 text-slate-400 hover:text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2">
            <Download size={14} /> Download All
          </button>
          <div className="h-6 w-px bg-white/10" />
          <button onClick={handleInitializeShot} disabled={isPromptingAll || isAutoLinking} className={`h-9 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-lg ${isPromptingAll ? 'animate-pulse' : ''}`}>
            {isPromptingAll ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            初始化矩阵 (Initialize)
          </button>
          <button onClick={onGenerateImage} disabled={isGeneratingImage || prompts.every(p => !p)} className="px-6 h-9 bg-slate-100 text-black hover:bg-indigo-500 hover:text-white disabled:opacity-20 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-xl">
            {isGeneratingImage ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
            渲染矩阵母图
          </button>
        </div>
      </div>

      {/* AI 提案 */}
      {discoveredAssets.length > 0 && (
        <div className="h-12 bg-amber-500/10 border-b border-amber-500/20 flex items-center px-6 gap-4 shrink-0 z-10 overflow-hidden">
           <div className="flex items-center gap-2 text-amber-500 shrink-0">
             <Lightbulb size={14} className="animate-pulse" /><span className="text-[9px] font-black uppercase">提案发现:</span>
           </div>
           <div className="flex-1 flex gap-3 overflow-x-auto scrollbar-none py-1">
             {discoveredAssets.map((asset, idx) => (
               <div key={idx} onClick={() => onAddGlobalAsset(asset.type, asset.name, asset.description)} className="flex items-center gap-2 bg-black/40 border border-white/5 rounded-full px-3 py-0.5 cursor-pointer hover:border-amber-500/50 transition-all shrink-0">
                 <span className="text-[8px] font-bold text-slate-200">{asset.name}</span><Plus size={8} className="text-amber-500" />
               </div>
             ))}
           </div>
           <button onClick={() => setDiscoveredAssets([])} className="text-slate-500"><X size={14} /></button>
        </div>
      )}

      {/* 资产区 */}
      <div className="h-24 border-b border-white/10 bg-[#0f1115] flex items-center px-6 gap-8 shrink-0 overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-4 border-r border-white/10 pr-8">
          <div className="flex flex-col items-center gap-1"><User size={12} className="text-indigo-400" /><span className="text-[8px] font-black uppercase text-slate-500">Cast</span></div>
          {config.characters.map(char => (
            <AssetBubble key={char.id} item={char} accentColor="indigo" active={shot.characterIds?.includes(char.id)} onUnlink={() => {}} typeIcon={<User size={16}/>} />
          ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-1"><MapIcon size={12} className="text-amber-400" /><span className="text-[8px] font-black uppercase text-slate-500">Env</span></div>
          {config.scenes.map(scene => (
            <AssetBubble key={scene.id} item={scene} accentColor="amber" active={shot.sceneIds?.includes(scene.id)} onUnlink={() => {}} typeIcon={<MapIcon size={16}/>} />
          ))}
        </div>
      </div>

      {/* 矩阵核心：单母图模式 vs 子图模式 */}
      <div className="flex-1 p-4 bg-[#0d0f13] overflow-hidden flex items-center justify-center relative">
        <div className="grid grid-cols-3 grid-rows-3 gap-2.5 w-full h-full">
          {prompts.map((p, idx) => {
            const hasSlicing = !!shot.splitImages?.[idx];
            const videoUrl = shot.videoUrls?.[idx];
            const videoStatus = shot.videoStatus?.[idx] || 'idle';

            return (
              <div key={idx} className={`relative group rounded-xl border-2 transition-all duration-500 flex flex-col h-full bg-[#16191f] overflow-hidden ${hasSlicing ? 'border-indigo-500/10' : 'border-white/5 hover:border-indigo-500/30'}`}>
                {/* 悬浮标签 */}
                <div className="absolute top-2 left-2 z-30 pointer-events-none">
                  <span className="text-[9px] font-mono font-black text-white bg-black/60 px-2 py-0.5 rounded border border-white/10 backdrop-blur-md uppercase tracking-tighter">
                    {camNames[idx]}
                  </span>
                </div>

                {/* 交互操作栏 (仅生成后) */}
                {hasSlicing && (
                  <div className="absolute top-2 right-2 z-30 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => handleCreateShotVideo(idx)}
                      disabled={videoStatus === 'processing'}
                      className={`p-1.5 rounded-lg border border-white/10 backdrop-blur-md transition-all ${videoStatus === 'completed' ? 'bg-emerald-500 text-white' : 'bg-black/60 text-slate-200 hover:bg-indigo-600'}`}
                      title="生成视频预演 (Veo I2V)"
                    >
                      {videoStatus === 'processing' ? <Loader2 size={12} className="animate-spin"/> : <Video size={12}/>}
                    </button>
                    <button 
                      onClick={() => setActivePreviewIndex(idx)}
                      className="p-1.5 bg-black/60 text-slate-200 hover:bg-white hover:text-black rounded-lg border border-white/10 backdrop-blur-md transition-all"
                    >
                      <Maximize2 size={12}/>
                    </button>
                  </div>
                )}

                {/* 内容层 */}
                {hasSlicing ? (
                  <div className="relative flex-1 w-full h-full overflow-hidden">
                    {videoUrl ? (
                      <video src={videoUrl} className="w-full h-full object-cover" autoPlay loop muted playsInline />
                    ) : (
                      <img src={shot.splitImages![idx]} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                    )}
                    {videoStatus === 'processing' && (
                      <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                        <Loader2 size={24} className="text-indigo-400 animate-spin" />
                        <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Veo Processing...</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 relative flex flex-col">
                    <textarea 
                      className="flex-1 w-full h-full p-4 pt-10 bg-transparent text-[11px] font-medium leading-relaxed text-slate-100 outline-none resize-none placeholder:text-slate-800 focus:bg-white/5 transition-all scrollbar-none"
                      value={p}
                      onChange={(e) => handlePromptChange(idx, e.target.value)}
                      placeholder="等待生成指令参数..."
                    />
                    {(isGeneratingImage || isPromptingAll) && (
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2">
                         <Loader2 size={16} className="text-indigo-400 animate-spin" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 沉浸式预览弹窗 */}
      {activePreviewIndex !== null && (
        <div className="fixed inset-0 bg-black/98 z-[200] flex items-center justify-center p-12" onClick={() => setActivePreviewIndex(null)}>
           <div className="relative w-full h-full max-w-5xl flex flex-col items-center gap-6" onClick={e => e.stopPropagation()}>
              <div className="absolute top-0 right-0 p-4">
                 <button onClick={() => setActivePreviewIndex(null)} className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-all">
                    <X size={24} className="text-white" />
                 </button>
              </div>
              <div className="flex-1 w-full bg-black rounded-3xl overflow-hidden border border-white/10 shadow-[0_0_100px_rgba(99,102,241,0.2)]">
                {shot.videoUrls?.[activePreviewIndex] ? (
                  <video src={shot.videoUrls[activePreviewIndex]!} className="w-full h-full object-contain" controls autoPlay loop />
                ) : (
                  <img src={shot.splitImages?.[activePreviewIndex]} className="w-full h-full object-contain" />
                )}
              </div>
              <div className="bg-white/5 backdrop-blur-xl p-8 rounded-2xl border border-white/10 w-full">
                 <div className="flex items-center gap-3 mb-3">
                   <span className="px-3 py-1 bg-indigo-500 text-white text-[10px] font-black rounded-lg uppercase">{camNames[activePreviewIndex]}</span>
                   <span className="text-slate-500 text-xs font-mono">SHOT: {shot.id}</span>
                 </div>
                 <p className="text-slate-200 text-sm leading-relaxed italic">"{prompts[activePreviewIndex]}"</p>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default MatrixPromptEditor;
