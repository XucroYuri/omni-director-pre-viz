
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import MatrixPromptEditor from './components/MatrixPromptEditor';
import { GlobalConfig, Shot, ScriptBreakdownResponse, Character, ShotHistoryItem } from '@shared/types';
import { DEFAULT_STYLE } from '@shared/constants';
import { 
  FileText, Terminal, Settings, X, RefreshCw, Zap, Clock, 
  CheckCircle2, AlertCircle, Loader2, Cpu, Monitor, FastForward,
  Database, Layout, Sparkles
} from 'lucide-react';
import { breakdownScript, generateGridImage, optimizePrompts, generateMatrixPrompts, recommendAssets } from './services/geminiService';
import { splitGridImage } from './utils/imageUtils';

const STORAGE_KEYS = {
  CONFIG: 'OMNI_DIRECTOR_CONFIG',
  SCRIPT: 'OMNI_DIRECTOR_SCRIPT',
  BREAKDOWN: 'OMNI_DIRECTOR_BREAKDOWN',
  SELECTED_SHOT_ID: 'OMNI_DIRECTOR_SELECTED_ID',
  EPISODE_ID: 'OMNI_DIRECTOR_EPISODE_ID'
};

const App: React.FC = () => {
  const [config, setConfig] = useState<GlobalConfig>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CONFIG);
    if (saved) return JSON.parse(saved);
    return {
      artStyle: DEFAULT_STYLE,
      aspectRatio: '16:9',
      resolution: '2K',
      characters: [],
      scenes: [],
      props: [],
      apiProvider: 'aihubmix'
    };
  });

  const [script, setScript] = useState(() => localStorage.getItem(STORAGE_KEYS.SCRIPT) || '');
  const [breakdown, setBreakdown] = useState<ScriptBreakdownResponse | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.BREAKDOWN);
    return saved ? JSON.parse(saved) : null;
  });
  const [selectedShotId, setSelectedShotId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEYS.SELECTED_SHOT_ID) || null);
  const [episodeId, setEpisodeId] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.EPISODE_ID);
    if (saved) return saved;
    return `ep_${Date.now()}`;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isAutoLinking, setIsAutoLinking] = useState(false);
  const [apiStatus, setApiStatus] = useState<'connected' | 'error' | 'idle'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const normalizePolicyError = (message: string) => {
    if (!message) return message;
    if (!message.includes('POLICY_VIOLATION')) return message;
    if (message.includes('Missing Scene')) return '生成失败：请先绑定场景。';
    if (message.includes('Missing Character')) return '生成失败：请先绑定角色，或将镜头标记为 ENV 纯环境。';
    return '生成失败：未满足资产绑定规则。';
  };

  useEffect(() => { localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config)); }, [config]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.SCRIPT, script); }, [script]);
  useEffect(() => { 
    if (breakdown) localStorage.setItem(STORAGE_KEYS.BREAKDOWN, JSON.stringify(breakdown));
  }, [breakdown]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.EPISODE_ID, episodeId); }, [episodeId]);

  const updateShot = (id: string, updates: Partial<Shot>) => {
    setBreakdown(prev => {
      if (!prev) return null;
      return { ...prev, shots: prev.shots.map(s => s.id === id ? { ...s, ...updates } : s) };
    });
  };

  const handleGenerateImage = async (shotId: string) => {
    const shot = breakdown?.shots.find(s => s.id === shotId);
    if (!shot || isGeneratingImage) return;

    setIsGeneratingImage(true);
    setErrorMessage(null);
    try {
      // 1. 生成单张母图
      const imageUrl = await generateGridImage(shot, config);
      
      // 2. 物理切片处理
      const splitImages = await splitGridImage(imageUrl);
      
      const historyItem: ShotHistoryItem = {
        timestamp: Date.now(),
        imageUrl,
        splitImages,
        prompts: [...(shot.matrixPrompts || [])],
        videoUrls: Array(9).fill(null)
      };

      updateShot(shotId, {
        generatedImageUrl: imageUrl,
        splitImages,
        videoUrls: Array(9).fill(null),
        videoStatus: Array(9).fill('idle'),
        status: 'completed',
        history: [historyItem, ...(shot.history || [])],
        lastAccessedAt: Date.now()
      });
      setApiStatus('connected');
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : 'Unknown error';
      setErrorMessage(normalizePolicyError(message));
      setApiStatus('error');
    } finally { setIsGeneratingImage(false); }
  };

  const handleBreakdown = async () => {
    if (!script.trim()) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await breakdownScript(script, config);
      setBreakdown(result);
      if (result.shots.length > 0) setSelectedShotId(result.shots[0].id);
      setApiStatus('connected');
    } catch (error: any) {
      setErrorMessage(error.message);
      setApiStatus('error');
    } finally { setIsLoading(false); }
  };

  const handleSaveEpisode = async () => {
    if (!window.api?.app?.db) {
      alert('DB 功能仅在 Electron 环境可用。');
      return;
    }
    const shots = breakdown?.shots || [];
    const data = {
      episodeId,
      config,
      shots,
      assets: {
        characters: config.characters,
        scenes: config.scenes,
        props: config.props,
      },
    };
    try {
      await window.api.app.db.saveEpisode(data);
      alert('保存成功（Save to DB）。');
    } catch (error: any) {
      alert(`保存失败: ${error?.message || error}`);
    }
  };

  const handleLoadEpisode = async () => {
    if (!window.api?.app?.db) {
      alert('DB 功能仅在 Electron 环境可用。');
      return;
    }
    try {
      const data = await window.api.app.db.loadEpisode(episodeId);
      if (!data) {
        alert('未找到对应 Episode。');
        return;
      }
      setConfig(data.config);
      setBreakdown({
        context: '',
        shots: data.shots,
        characters: data.assets.characters.map((c) => ({ name: c.name, description: c.description })),
      });
      setSelectedShotId(data.shots[0]?.id || null);
      setApiStatus('connected');
    } catch (error: any) {
      alert(`读取失败: ${error?.message || error}`);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0f1115] text-slate-300 overflow-hidden font-sans">
      <Sidebar 
        config={config} setConfig={setConfig} 
        shots={breakdown?.shots || []} 
        selectedShotId={selectedShotId} 
        setSelectedShotId={setSelectedShotId} 
        isLoading={isLoading} script={script} setScript={setScript} 
        handleBreakdown={handleBreakdown}
        episodeId={episodeId}
        setEpisodeId={setEpisodeId}
        onSaveEpisode={handleSaveEpisode}
        onLoadEpisode={handleLoadEpisode}
      />
      <div className="flex-1 flex flex-col">
        <header className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[#16191f]/80 backdrop-blur-md">
           <div className="flex items-center gap-4">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center"><Cpu size={18} className="text-white" /></div>
              <h1 className="text-sm font-black text-white tracking-widest uppercase">Omni Director <span className="text-indigo-500">v5.0</span></h1>
           </div>
           <div className="flex items-center gap-4">
              <div className={`w-2 h-2 rounded-full ${apiStatus === 'connected' ? 'bg-emerald-500' : 'bg-slate-600'}`} />
              <button onClick={() => {}} className="p-2 text-slate-500 hover:text-white"><Settings size={20} /></button>
           </div>
        </header>
        <main className="flex-1 overflow-hidden">
          {selectedShotId ? (
            <MatrixPromptEditor 
              shot={breakdown!.shots.find(s => s.id === selectedShotId)!}
              allShots={breakdown!.shots} config={config}
              onUpdatePrompts={(p) => updateShot(selectedShotId, { matrixPrompts: p })}
              onUpdateShot={(u) => updateShot(selectedShotId, u)}
              onGenerateImage={() => handleGenerateImage(selectedShotId)}
              onRestoreHistory={(i) => {
                const s = breakdown!.shots.find(sh => sh.id === selectedShotId)!;
                const h = s.history![i];
                updateShot(selectedShotId, { generatedImageUrl: h.imageUrl, splitImages: h.splitImages, matrixPrompts: [...h.prompts] });
              }}
              onAddGlobalAsset={(type, name, desc) => {
                const id = `ast-${Date.now()}`;
                setConfig(prev => ({ ...prev, [type]: [...prev[type], { id, name, description: desc || '' }] }));
              }}
              onDeleteGlobalAsset={() => {}} onUpdateGlobalAsset={() => {}} 
              onOptimizePrompts={async () => {}} onAutoLinkAssets={async () => {}}
              isGeneratingPrompts={false} isGeneratingImage={isGeneratingImage}
              isOptimizing={isOptimizing} isAutoLinking={isAutoLinking}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 uppercase text-[10px] tracking-widest">Select a shot to begin</div>
          )}
        </main>
      </div>
      {errorMessage && <div className="fixed bottom-6 right-6 bg-red-950 border border-red-500 p-4 rounded-lg z-[300] flex items-center gap-3"><AlertCircle className="text-red-500" /><p className="text-xs">{errorMessage}</p><button onClick={() => setErrorMessage(null)}><X size={14}/></button></div>}
    </div>
  );
};

export default App;
