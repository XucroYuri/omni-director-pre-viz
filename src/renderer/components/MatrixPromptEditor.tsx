import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DBTask, Shot, GlobalConfig, Character, Scene, Prop } from '@shared/types';
import { ensurePromptListLength, getAngleLabel, getGridCellCount, normalizeGridLayout, normalizeIndexedList } from '@shared/utils';
import {
  AlertTriangle,
  Box,
  Camera,
  Check,
  Clock3,
  Download,
  Film,
  History,
  Layout,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Sparkles,
  User,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import { discoverMissingAssets, generateMatrixPrompts } from '../services/geminiService';
import { splitGridImageByCanvas } from '../utils/imageUtils';

interface MatrixPromptEditorProps {
  shot: Shot;
  allShots: Shot[];
  config: GlobalConfig;
  episodeId: string;
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

type AssetCollectionKey = 'characterIds' | 'sceneIds' | 'propIds';
type ShotVideoStatus = NonNullable<Shot['videoStatus']>[number];

const VIDEO_STATUS_TEXT: Record<ShotVideoStatus, string> = {
  idle: '待命',
  queued: '排队',
  processing: '处理中',
  downloading: '下载中',
  completed: '完成',
  failed: '失败',
};

const ACCENT_STYLES = {
  indigo: {
    active: 'border-indigo-400 ring-4 ring-indigo-400/30 scale-110 z-10',
    fallbackBg: 'bg-indigo-500/10',
    fallbackText: 'text-indigo-400',
    fallbackSubtext: 'text-indigo-500',
    activeOverlay: 'bg-indigo-500/20',
    activeBadge: 'bg-indigo-500',
  },
  amber: {
    active: 'border-amber-400 ring-4 ring-amber-400/30 scale-110 z-10',
    fallbackBg: 'bg-amber-500/10',
    fallbackText: 'text-amber-400',
    fallbackSubtext: 'text-amber-500',
    activeOverlay: 'bg-amber-500/20',
    activeBadge: 'bg-amber-500',
  },
  emerald: {
    active: 'border-emerald-400 ring-4 ring-emerald-400/30 scale-110 z-10',
    fallbackBg: 'bg-emerald-500/10',
    fallbackText: 'text-emerald-400',
    fallbackSubtext: 'text-emerald-500',
    activeOverlay: 'bg-emerald-500/20',
    activeBadge: 'bg-emerald-500',
  },
} as const;

const GRID_VALUES = [1, 2, 3, 4, 5] as const;

const MatrixPromptEditor: React.FC<MatrixPromptEditorProps> = ({
  shot,
  config,
  episodeId,
  onUpdatePrompts,
  onUpdateShot,
  onGenerateImage,
  onRestoreHistory,
  onAddGlobalAsset,
  onUpdateGlobalAsset,
  onOptimizePrompts,
  onAutoLinkAssets,
  isGeneratingPrompts,
  isGeneratingImage,
  isOptimizing,
  isAutoLinking,
}) => {
  const shotRef = useRef(shot);
  const videoTimersRef = useRef<
    Record<number, { processing?: ReturnType<typeof setTimeout>; downloading?: ReturnType<typeof setTimeout> }>
  >({});

  const [isPromptingAll, setIsPromptingAll] = useState(false);
  const [activePreviewIndex, setActivePreviewIndex] = useState<number | null>(null);
  const [videoModalIndex, setVideoModalIndex] = useState<number | null>(null);
  const [videoPromptDraft, setVideoPromptDraft] = useState('');
  const [syncVideoPrompt, setSyncVideoPrompt] = useState(true);
  const [isGeneratingAnimatic, setIsGeneratingAnimatic] = useState(false);
  const [showAnimaticPreview, setShowAnimaticPreview] = useState(false);
  const [isGeneratingAssetVideo, setIsGeneratingAssetVideo] = useState(false);
  const [showAssetVideoPreview, setShowAssetVideoPreview] = useState(false);
  const [showRenderSettings, setShowRenderSettings] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [activeHistoryIndex, setActiveHistoryIndex] = useState(0);
  const [discoveredAssets, setDiscoveredAssets] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [canvasSplitImages, setCanvasSplitImages] = useState<string[]>([]);
  const [isCanvasSlicing, setIsCanvasSlicing] = useState(false);

  useEffect(() => {
    shotRef.current = shot;
  }, [shot]);

  useEffect(() => {
    setActiveHistoryIndex(0);
    setShowHistory(false);
    setActivePreviewIndex(null);
    setVideoModalIndex(null);
  }, [shot.id]);

  const gridLayout = normalizeGridLayout(shot.gridLayout);
  const cellCount = getGridCellCount(gridLayout);
  const prompts = useMemo(() => ensurePromptListLength(shot.matrixPrompts, gridLayout), [shot.matrixPrompts, gridLayout]);
  const splitImages = useMemo(
    () => normalizeIndexedList<string>(shot.splitImages, cellCount, ''),
    [shot.splitImages, cellCount],
  );
  const videoUrls = useMemo(
    () => normalizeIndexedList<string | null>(shot.videoUrls, cellCount, null),
    [shot.videoUrls, cellCount],
  );
  const videoStatus = useMemo(
    () => normalizeIndexedList<ShotVideoStatus>(shot.videoStatus, cellCount, 'idle'),
    [shot.videoStatus, cellCount],
  );

  const hasPersistedSlices = splitImages.some((item) => Boolean(item));
  const displaySplitImages = hasPersistedSlices
    ? splitImages
    : normalizeIndexedList<string>(canvasSplitImages, cellCount, '');

  useEffect(() => {
    let active = true;
    if (!shot.generatedImageUrl || hasPersistedSlices) {
      setCanvasSplitImages([]);
      setIsCanvasSlicing(false);
      return () => {
        active = false;
      };
    }

    setIsCanvasSlicing(true);
    splitGridImageByCanvas(shot.generatedImageUrl, gridLayout)
      .then((slices) => {
        if (!active) return;
        setCanvasSplitImages(normalizeIndexedList<string>(slices, cellCount, ''));
      })
      .catch((error) => {
        console.warn('Canvas split failed', error);
        if (!active) return;
        setCanvasSplitImages([]);
      })
      .finally(() => {
        if (!active) return;
        setIsCanvasSlicing(false);
      });

    return () => {
      active = false;
    };
  }, [shot.generatedImageUrl, gridLayout.rows, gridLayout.cols, cellCount, hasPersistedSlices]);

  const boundCharacters = config.characters.filter((item) => shot.characterIds?.includes(item.id));
  const boundScenes = config.scenes.filter((item) => shot.sceneIds?.includes(item.id));
  const boundProps = config.props.filter((item) => shot.propIds?.includes(item.id));

  const hasBoundAssets = boundCharacters.length + boundScenes.length + boundProps.length > 0;
  const hasAssetRefs =
    boundCharacters.some((item) => item.refImage) ||
    boundScenes.some((item) => item.refImage) ||
    boundProps.some((item) => item.refImage);
  const hasPromptContent = prompts.some((item) => item.trim().length > 0);
  const hasSceneBinding = boundScenes.length > 0;

  const canRenderMatrix = hasSceneBinding && hasPromptContent && !isGeneratingImage;
  const canDownloadAll = displaySplitImages.some((item) => Boolean(item));
  const canGenerateAnimatic = Boolean(shot.animaticVideoUrl) || (Boolean(shot.generatedImageUrl) && !isGeneratingAnimatic);
  const canGenerateAssetVideo =
    Boolean(shot.assetVideoUrl) || (hasBoundAssets && hasAssetRefs && !isGeneratingAssetVideo);

  const inlineHints = [
    !hasSceneBinding ? '未绑定场景：请在下方资产条至少绑定一个场景。' : '',
    !hasPromptContent ? '当前提示词为空：先生成分镜提示词，或手动填写。' : '',
    !shot.generatedImageUrl ? '尚未生成分镜网格图。' : '',
    hasBoundAssets && !hasAssetRefs ? '资产已绑定但缺少参考图：建议补图后再生成资产视频。' : '',
  ].filter(Boolean);

  const renderDisabledReason = !hasSceneBinding
    ? '请先绑定至少一个场景。'
    : !hasPromptContent
      ? '请先生成或填写提示词。'
      : isGeneratingImage
        ? '分镜网格图生成中。'
        : '';

  const animaticDisabledReason = shot.animaticVideoUrl
    ? ''
    : !shot.generatedImageUrl
      ? '请先生成分镜网格图。'
      : isGeneratingAnimatic
        ? '镜头预演正在生成。'
        : '';

  const assetVideoDisabledReason = shot.assetVideoUrl
    ? ''
    : !hasBoundAssets
      ? '请先绑定角色/场景/道具。'
      : !hasAssetRefs
        ? '请先为已绑定资产上传参考图。'
        : isGeneratingAssetVideo
          ? '资产视频正在生成。'
          : '';

  const historyItems = shot.history || [];

  const assetRailSections: Array<{
    key: AssetCollectionKey;
    assetType: 'characters' | 'scenes' | 'props';
    label: string;
    accentColor: keyof typeof ACCENT_STYLES;
    items: Array<Character | Scene | Prop>;
    icon: React.ReactNode;
  }> = [
    {
      key: 'characterIds',
      assetType: 'characters',
      label: '角色',
      accentColor: 'indigo',
      items: config.characters,
      icon: <User size={12} className="text-indigo-400" />,
    },
    {
      key: 'sceneIds',
      assetType: 'scenes',
      label: '场景',
      accentColor: 'amber',
      items: config.scenes,
      icon: <MapIcon size={12} className="text-amber-400" />,
    },
    {
      key: 'propIds',
      assetType: 'props',
      label: '道具',
      accentColor: 'emerald',
      items: config.props,
      icon: <Box size={12} className="text-emerald-400" />,
    },
  ];

  useEffect(() => {
    if (!window.api?.ai?.discoverMissingAssets) {
      setDiscoveredAssets([]);
      return;
    }
    if (isScanning) return;
    setIsScanning(true);
    discoverMissingAssets(shot, config)
      .then((findings) => {
        const merged = [
          ...findings.characters.map((item: any) => ({ ...item, type: 'characters' as const })),
          ...findings.scenes.map((item: any) => ({ ...item, type: 'scenes' as const })),
          ...findings.props.map((item: any) => ({ ...item, type: 'props' as const })),
        ];
        setDiscoveredAssets(merged);
      })
      .catch((error) => {
        console.warn('discoverMissingAssets failed', error);
      })
      .finally(() => {
        setIsScanning(false);
      });
  }, [shot.id, shot.visualTranslation, config.characters, config.scenes, config.props]);

  const handlePromptChange = (index: number, value: string) => {
    const next = [...prompts];
    next[index] = value;
    onUpdatePrompts(next);
  };

  const handleGridLayoutChange = (field: 'rows' | 'cols', value: number) => {
    const nextLayout = normalizeGridLayout({ ...gridLayout, [field]: value });
    const nextCellCount = getGridCellCount(nextLayout);
    const nextPrompts = ensurePromptListLength(prompts, nextLayout);

    setCanvasSplitImages([]);
    onUpdateShot({
      gridLayout: nextLayout,
      matrixPrompts: nextPrompts,
      generatedImageUrl: undefined,
      splitImages: [],
      videoUrls: Array(nextCellCount).fill(null),
      videoStatus: Array(nextCellCount).fill('idle'),
      animaticVideoUrl: undefined,
    });
  };

  const handleInitializeShot = async () => {
    setIsPromptingAll(true);
    try {
      const current = ensurePromptListLength(shot.matrixPrompts, gridLayout);
      const needsFreshGeneration = current.every((prompt) => !prompt?.trim());
      const needsPatchGeneration = current.some((prompt) => !prompt?.trim());
      if (!needsFreshGeneration && !needsPatchGeneration) return;

      const generated = await generateMatrixPrompts({ ...shot, gridLayout, matrixPrompts: current }, config);
      const normalizedGenerated = ensurePromptListLength(generated, gridLayout);

      if (needsFreshGeneration) {
        onUpdatePrompts(normalizedGenerated);
        return;
      }

      const merged = current.map((prompt, index) => (prompt?.trim() ? prompt : normalizedGenerated[index] || ''));
      onUpdatePrompts(merged);
    } catch (error) {
      console.error(error);
    } finally {
      setIsPromptingAll(false);
    }
  };

  const setVideoStatus = (index: number, status: ShotVideoStatus) => {
    const nextStatus = normalizeIndexedList<ShotVideoStatus>(shotRef.current.videoStatus, cellCount, 'idle');
    nextStatus[index] = status;
    onUpdateShot({ videoStatus: nextStatus });
  };

  const clearVideoTimers = (index: number) => {
    const timers = videoTimersRef.current[index];
    if (!timers) return;
    if (timers.processing) clearTimeout(timers.processing);
    if (timers.downloading) clearTimeout(timers.downloading);
    delete videoTimersRef.current[index];
  };

  const scheduleVideoStages = (index: number) => {
    clearVideoTimers(index);
    const processing = setTimeout(() => {
      const status = shotRef.current.videoStatus?.[index];
      if (status === 'queued') setVideoStatus(index, 'processing');
    }, 800);

    const downloading = setTimeout(() => {
      const status = shotRef.current.videoStatus?.[index];
      if (status === 'queued' || status === 'processing') setVideoStatus(index, 'downloading');
    }, 12000);

    videoTimersRef.current[index] = { processing, downloading };
  };

  useEffect(() => {
    return () => {
      Object.keys(videoTimersRef.current).forEach((key) => clearVideoTimers(Number(key)));
    };
  }, []);

  const submitVideoTask = async (payload: {
    inputMode: 'IMAGE_FIRST_FRAME' | 'MATRIX_FRAME' | 'ASSET_COLLAGE' | 'TEXT_ONLY';
    angleIndex?: number;
    prompt?: string;
  }) => {
    if (!window.api?.app?.task?.submit) {
      throw new Error('Task queue is not available in this runtime.');
    }
    const now = Date.now();
    const taskId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `task_${now}_${Math.random().toString(16).slice(2, 10)}`;

    const task: DBTask = {
      id: taskId,
      episode_id: episodeId,
      shot_id: shotRef.current.id,
      type: 'VIDEO',
      status: 'queued',
      progress: 0,
      payload_json: JSON.stringify({
        jobKind: 'VIDEO_GEN',
        episodeId,
        shotId: shotRef.current.id,
        ...payload,
      }),
      result_json: '',
      error: null,
      created_at: now,
      updated_at: now,
    };
    await window.api.app.task.submit(task);
  };

  const openVideoModal = (index: number) => {
    setVideoModalIndex(index);
    setVideoPromptDraft(prompts[index] || shot.visualTranslation);
    setSyncVideoPrompt(true);
  };

  const handleCreateShotVideo = async (index: number, promptOverride?: string) => {
    if (!splitImages[index]) return;
    const status = videoStatus[index];
    if (status === 'queued' || status === 'processing' || status === 'downloading') return;

    setVideoStatus(index, 'queued');
    scheduleVideoStages(index);

    try {
      const prompt = (promptOverride || prompts[index] || shot.visualTranslation).trim();
      await submitVideoTask({ inputMode: 'IMAGE_FIRST_FRAME', angleIndex: index, prompt });
    } catch (error) {
      console.error(error);
      clearVideoTimers(index);
      const nextStatus = normalizeIndexedList<ShotVideoStatus>(shotRef.current.videoStatus, cellCount, 'idle');
      nextStatus[index] = 'failed';
      onUpdateShot({ videoStatus: nextStatus });
    }
  };

  const handleGenerateAnimatic = async () => {
    if (!shot.generatedImageUrl || isGeneratingAnimatic) return;
    setIsGeneratingAnimatic(true);
    try {
      await submitVideoTask({ inputMode: 'MATRIX_FRAME' });
    } catch (error) {
      console.error(error);
    } finally {
      setIsGeneratingAnimatic(false);
    }
  };

  const handleGenerateAssetVideo = async () => {
    if (!hasAssetRefs || isGeneratingAssetVideo) return;
    setIsGeneratingAssetVideo(true);
    try {
      await submitVideoTask({ inputMode: 'ASSET_COLLAGE' });
    } catch (error) {
      console.error(error);
    } finally {
      setIsGeneratingAssetVideo(false);
    }
  };

  const handleBatchDownload = () => {
    displaySplitImages.forEach((img, index) => {
      if (!img) return;
      const anchor = document.createElement('a');
      anchor.href = img;
      anchor.download = `S_${shot.id.substring(0, 4)}_${getAngleLabel(index)}.png`;
      anchor.click();
    });
  };

  const toggleAssetBinding = (collection: AssetCollectionKey, assetId: string) => {
    const next = new Set(shot[collection] || []);
    if (next.has(assetId)) {
      next.delete(assetId);
    } else {
      next.add(assetId);
    }
    onUpdateShot({ [collection]: Array.from(next) } as Partial<Shot>);
  };

  const AssetBubble = ({ item, active, onToggle, onUpload, accentColor, typeIcon }: any) => {
    const accent = ACCENT_STYLES[accentColor as keyof typeof ACCENT_STYLES] || ACCENT_STYLES.indigo;
    return (
      <div className="relative group/asset shrink-0">
        <div
          onClick={onToggle}
          className={`w-11 h-11 rounded-full border-2 transition-all cursor-pointer overflow-hidden flex items-center justify-center relative ${
            active ? accent.active : 'border-white/10 grayscale opacity-40 hover:opacity-100 hover:grayscale-0'
          }`}
          title={active ? `点击取消绑定 ${item.name}` : `点击绑定 ${item.name}`}
        >
          {item.refImage ? (
            <img src={item.refImage} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full flex flex-col items-center justify-center transition-colors ${accent.fallbackBg}`}>
              <div className={`mb-0.5 ${accent.fallbackText}`}>{typeIcon}</div>
              <span className={`text-[6px] font-black tracking-tighter uppercase ${accent.fallbackSubtext}`}>No Ref</span>
            </div>
          )}
          {active && (
            <div className={`absolute inset-0 flex items-center justify-center ${accent.activeOverlay}`}>
              <div className={`text-white rounded-full p-1 shadow-2xl border border-white/20 transform scale-110 ${accent.activeBadge}`}>
                <Check size={10} strokeWidth={4} />
              </div>
            </div>
          )}
          <label
            className="absolute inset-0 bg-black/70 opacity-0 group-hover/asset:opacity-100 flex items-center justify-center transition-opacity cursor-pointer z-10"
            onClick={(event) => event.stopPropagation()}
          >
            <Camera size={16} className="text-white" />
            <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
          </label>
        </div>
      </div>
    );
  };

  const applyPromptOptimization = async () => {
    if (isOptimizing) return;
    await onOptimizePrompts();
  };

  const applyAutoLink = async () => {
    if (isAutoLinking) return;
    await onAutoLinkAssets();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0f1115]">
      <div className="border-b border-white/10 bg-[#16191f]/80 px-4 py-3 sm:px-6 shrink-0 backdrop-blur-md z-20 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex flex-1 items-center gap-3 sm:gap-5">
          <div className="flex shrink-0 flex-col">
            <span className="text-[9px] font-black text-slate-500 tracking-widest">当前镜头</span>
            <span className="text-[12px] font-mono font-black text-indigo-400">SH_{shot.id.substring(0, 4)}</span>
          </div>
          <div className="h-6 w-px bg-white/10 shrink-0" />
          <div className="min-w-0 flex flex-col">
            <span className="text-[9px] font-black text-slate-500 tracking-widest">视觉拆解</span>
            <span className="text-[12px] text-slate-100 font-medium italic truncate max-w-full sm:max-w-[420px]">"{shot.visualTranslation}"</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowRenderSettings((prev) => !prev)}
            className="h-9 w-9 bg-white/5 border border-white/10 text-slate-300 hover:text-white rounded-lg transition-all flex items-center justify-center"
            title={showRenderSettings ? '收起网格布局' : '展开网格布局'}
            aria-label={showRenderSettings ? '收起网格布局' : '展开网格布局'}
          >
            <Layout size={14} />
          </button>

          <button
            onClick={() => setShowHistory((prev) => !prev)}
            className={`h-9 px-3 rounded-lg border text-[10px] font-black tracking-widest transition-all flex items-center gap-2 ${
              showHistory
                ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200'
                : 'bg-white/5 border-white/10 text-slate-300 hover:text-white'
            }`}
            title="切换历史版本面板"
          >
            <History size={14} />
            历史
          </button>

          <button
            onClick={applyPromptOptimization}
            disabled={isOptimizing}
            className="h-9 px-3 bg-white/5 border border-white/10 text-slate-300 hover:text-white rounded-lg text-[10px] font-black tracking-widest transition-all flex items-center gap-2 disabled:opacity-40"
            title="优化当前镜头提示词"
          >
            {isOptimizing ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            优化
          </button>

          <button
            onClick={applyAutoLink}
            disabled={isAutoLinking}
            className="h-9 px-3 bg-white/5 border border-white/10 text-slate-300 hover:text-white rounded-lg text-[10px] font-black tracking-widest transition-all flex items-center gap-2 disabled:opacity-40"
            title="根据文本自动关联资产"
          >
            {isAutoLinking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            关联资产
          </button>

          <button
            onClick={() => {
              if (shot.animaticVideoUrl) {
                setShowAnimaticPreview(true);
              } else {
                handleGenerateAnimatic();
              }
            }}
            disabled={!canGenerateAnimatic}
            className="h-9 px-4 bg-white/5 border border-white/10 text-slate-300 hover:text-white rounded-lg text-[10px] font-black tracking-widest transition-all flex items-center gap-2 disabled:opacity-40"
            title={animaticDisabledReason || '生成或查看镜头预演'}
          >
            {isGeneratingAnimatic ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
            {shot.animaticVideoUrl ? '查看镜头预演' : '生成镜头预演'}
          </button>

          <button
            onClick={() => {
              if (shot.assetVideoUrl) {
                setShowAssetVideoPreview(true);
              } else {
                handleGenerateAssetVideo();
              }
            }}
            disabled={!canGenerateAssetVideo}
            className="h-9 px-4 bg-white/5 border border-white/10 text-slate-300 hover:text-white rounded-lg text-[10px] font-black tracking-widest transition-all flex items-center gap-2 disabled:opacity-40"
            title={assetVideoDisabledReason || '生成或查看资产视频'}
          >
            {isGeneratingAssetVideo ? <Loader2 size={14} className="animate-spin" /> : <Video size={14} />}
            {shot.assetVideoUrl ? '查看资产视频' : '生成资产视频'}
          </button>

          <button
            onClick={handleBatchDownload}
            disabled={!canDownloadAll}
            className="h-9 px-4 bg-white/5 border border-white/10 text-slate-400 hover:text-white rounded-lg text-[10px] font-black tracking-widest transition-all flex items-center gap-2 disabled:opacity-40"
            title={!canDownloadAll ? '暂无可下载图像' : '下载当前网格切片'}
          >
            <Download size={14} /> 下载
          </button>

          <button
            onClick={handleInitializeShot}
            disabled={isPromptingAll || isGeneratingPrompts}
            className={`h-9 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-black tracking-widest transition-all flex items-center gap-2 shadow-lg ${
              isPromptingAll || isGeneratingPrompts ? 'animate-pulse' : ''
            }`}
          >
            {isPromptingAll || isGeneratingPrompts ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            分镜提示词
          </button>

          <button
            onClick={onGenerateImage}
            disabled={!canRenderMatrix}
            className="px-6 h-9 bg-slate-100 text-black hover:bg-indigo-500 hover:text-white disabled:opacity-20 rounded-lg text-[11px] font-black tracking-widest transition-all flex items-center gap-2 shadow-xl"
            title={renderDisabledReason}
          >
            {isGeneratingImage ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            分镜网格图
          </button>
        </div>
      </div>

      {showHistory && (
        <div className="border-b border-white/10 bg-[#121722] px-4 sm:px-6 py-3">
          {historyItems.length === 0 ? (
            <div className="text-[10px] text-slate-500">暂无历史版本。</div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {historyItems.map((item, index) => {
                const active = index === activeHistoryIndex;
                const layout = normalizeGridLayout(item.gridLayout, gridLayout);
                return (
                  <button
                    key={`${item.timestamp}-${index}`}
                    onClick={() => setActiveHistoryIndex(index)}
                    className={`px-3 py-1.5 rounded-lg border text-[10px] transition-all ${
                      active
                        ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-100'
                        : 'bg-white/5 border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    <span className="font-black">V{historyItems.length - index}</span>
                    <span className="mx-1 text-slate-500">|</span>
                    {layout.rows}x{layout.cols}
                    <span className="mx-1 text-slate-500">|</span>
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </button>
                );
              })}
              <button
                onClick={() => onRestoreHistory(activeHistoryIndex)}
                className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black tracking-widest"
              >
                恢复此版本
              </button>
            </div>
          )}
        </div>
      )}

      {showRenderSettings && (
        <div className="border-b border-white/10 bg-[#121722] px-4 sm:px-6 py-3 shrink-0">
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-black tracking-widest text-slate-400">网格布局</span>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] text-slate-500">行</span>
              <select
                value={gridLayout.rows}
                onChange={(event) => handleGridLayoutChange('rows', Number(event.target.value))}
                className="h-8 rounded-md border border-white/10 bg-black/40 px-2 text-[10px] font-black text-slate-200 outline-none focus:border-indigo-500/40"
              >
                {GRID_VALUES.map((value) => (
                  <option key={`row-${value}`} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <span className="text-[10px] font-black text-slate-500">x</span>
              <span className="text-[10px] text-slate-500">列</span>
              <select
                value={gridLayout.cols}
                onChange={(event) => handleGridLayoutChange('cols', Number(event.target.value))}
                className="h-8 rounded-md border border-white/10 bg-black/40 px-2 text-[10px] font-black text-slate-200 outline-none focus:border-indigo-500/40"
              >
                {GRID_VALUES.map((value) => (
                  <option key={`col-${value}`} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-[10px] text-slate-500">
              当前 {gridLayout.rows}x{gridLayout.cols} / 共 {cellCount} 格
            </span>
          </div>
        </div>
      )}

      {inlineHints.length > 0 && (
        <div className="border-b border-white/10 bg-amber-500/10 px-4 sm:px-6 py-2 flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-[9px] font-black uppercase tracking-widest text-amber-300">提示</span>
          {inlineHints.map((hint) => (
            <span
              key={hint}
              className="text-[9px] font-medium text-amber-200 bg-black/30 border border-amber-300/20 rounded-full px-2 py-0.5"
            >
              {hint}
            </span>
          ))}
        </div>
      )}

      {discoveredAssets.length > 0 && (
        <div className="h-12 bg-amber-500/10 border-b border-amber-500/20 flex items-center px-4 sm:px-6 gap-4 shrink-0 z-10 overflow-hidden">
          <div className="flex items-center gap-2 text-amber-500 shrink-0">
            <Sparkles size={14} className="animate-pulse" />
            <span className="text-[9px] font-black uppercase">提案发现</span>
          </div>
          <div className="flex-1 flex gap-3 overflow-x-auto scrollbar-none py-1">
            {discoveredAssets.map((asset, index) => (
              <div
                key={`${asset.name}-${index}`}
                onClick={() => onAddGlobalAsset(asset.type, asset.name, asset.description)}
                className="flex items-center gap-2 bg-black/40 border border-white/5 rounded-full px-3 py-0.5 cursor-pointer hover:border-amber-500/50 transition-all shrink-0"
              >
                <span className="text-[8px] font-bold text-slate-200">{asset.name}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setDiscoveredAssets([])} className="text-slate-500">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="min-h-24 border-b border-white/10 bg-[#0f1115] flex items-center px-4 sm:px-6 gap-5 shrink-0 overflow-x-auto scrollbar-none py-3">
        {assetRailSections.map((section, sectionIndex) => {
          const linkedSet = new Set(shot[section.key] || []);
          return (
            <div
              key={section.key}
              className={`flex items-center gap-3 ${sectionIndex < assetRailSections.length - 1 ? 'border-r border-white/10 pr-5' : ''}`}
            >
              <div className="flex flex-col items-center gap-1 shrink-0">
                {section.icon}
                <span className="text-[8px] font-black text-slate-500">{section.label}</span>
              </div>
              <div className="flex items-center gap-2.5">
                {section.items.length === 0 ? (
                  <span className="text-[9px] text-slate-600">暂无</span>
                ) : (
                  section.items.map((asset) => (
                    <AssetBubble
                      key={asset.id}
                      item={asset}
                      accentColor={section.accentColor}
                      active={linkedSet.has(asset.id)}
                      onToggle={() => toggleAssetBinding(section.key, asset.id)}
                      onUpload={(event: React.ChangeEvent<HTMLInputElement>) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          const refImage = typeof reader.result === 'string' ? reader.result : '';
                          if (refImage) {
                            onUpdateGlobalAsset(section.assetType, asset.id, { refImage });
                          }
                        };
                        reader.readAsDataURL(file);
                        event.target.value = '';
                      }}
                      typeIcon={
                        section.key === 'characterIds' ? (
                          <User size={16} />
                        ) : section.key === 'sceneIds' ? (
                          <MapIcon size={16} />
                        ) : (
                          <Box size={16} />
                        )
                      }
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 p-3 sm:p-4 bg-[#0d0f13] overflow-hidden">
        <div className="h-full min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] gap-3">
          <section className="min-h-0 rounded-xl border border-white/10 bg-[#131722] overflow-hidden flex flex-col">
            <div className="h-11 px-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black tracking-widest text-slate-300">分镜网格</span>
                <span className="text-[10px] text-slate-500">{gridLayout.rows}x{gridLayout.cols}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                {isCanvasSlicing && (
                  <span className="inline-flex items-center gap-1 text-indigo-300">
                    <Loader2 size={12} className="animate-spin" /> Canvas 切片中
                  </span>
                )}
                <button
                  onClick={() => setActivePreviewIndex(0)}
                  disabled={!shot.generatedImageUrl && !displaySplitImages.some(Boolean)}
                  className="h-7 px-2 rounded bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30"
                  title="打开大图预览"
                >
                  <Maximize2 size={12} />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 p-3 overflow-auto">
              {displaySplitImages.some(Boolean) ? (
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${gridLayout.cols}, minmax(0, 1fr))` }}>
                  {Array.from({ length: cellCount }, (_item, index) => {
                    const label = getAngleLabel(index);
                    const status = videoStatus[index];
                    const image = displaySplitImages[index];
                    const video = videoUrls[index];
                    return (
                      <button
                        key={label}
                        onClick={() => setActivePreviewIndex(index)}
                        className="relative group rounded-lg overflow-hidden border border-white/10 bg-black/40 min-h-[84px]"
                        title={`${label} - 点击预览`}
                      >
                        {video ? (
                          <video src={video} className="w-full h-full object-cover" autoPlay loop muted playsInline />
                        ) : image ? (
                          <img src={image} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-600">暂无图像</div>
                        )}
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-black text-slate-100 border border-white/10">
                          {label}
                        </div>
                        {(status === 'queued' || status === 'processing' || status === 'downloading') && (
                          <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-1">
                            <Loader2 size={16} className="animate-spin text-indigo-300" />
                            <span className="text-[9px] text-indigo-200">{VIDEO_STATUS_TEXT[status]}</span>
                          </div>
                        )}
                        {status === 'failed' && (
                          <div className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center gap-1">
                            <AlertTriangle size={16} className="text-rose-300" />
                            <span className="text-[9px] text-rose-200">失败</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : shot.generatedImageUrl ? (
                <div className="h-full flex items-center justify-center rounded-lg border border-white/10 bg-black/40 overflow-hidden">
                  <img src={shot.generatedImageUrl} className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="h-full rounded-lg border border-dashed border-white/10 bg-black/20 flex flex-col items-center justify-center gap-2 text-slate-500 text-[11px]">
                  <Clock3 size={18} />
                  <span>尚未生成分镜网格图</span>
                </div>
              )}
            </div>
          </section>

          <section className="min-h-0 rounded-xl border border-white/10 bg-[#131722] overflow-hidden flex flex-col">
            <div className="h-11 px-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black tracking-widest text-slate-300">分镜提示词列表</span>
                <span className="text-[10px] text-slate-500">{cellCount} 条</span>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-3 space-y-2">
              {prompts.map((prompt, index) => {
                const label = getAngleLabel(index);
                const status = videoStatus[index];
                const statusText = VIDEO_STATUS_TEXT[status];
                const canOpenVideoModal = Boolean(splitImages[index]);
                const isVideoBusy = status === 'queued' || status === 'processing' || status === 'downloading';
                return (
                  <div key={label} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-black text-indigo-300 shrink-0">{label}</span>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded border ${
                            status === 'completed'
                              ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200'
                              : status === 'failed'
                                ? 'border-rose-400/30 bg-rose-500/15 text-rose-200'
                                : 'border-white/10 bg-white/5 text-slate-400'
                          }`}
                        >
                          {statusText}
                        </span>
                      </div>
                      <button
                        onClick={() => openVideoModal(index)}
                        disabled={!canOpenVideoModal || isVideoBusy}
                        className="h-7 px-2 rounded bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 text-[10px] flex items-center gap-1"
                        title={
                          !canOpenVideoModal
                            ? '请先生成并保存网格切片后再生成机位视频'
                            : isVideoBusy
                              ? `当前状态：${statusText}`
                              : '生成该机位视频'
                        }
                      >
                        {isVideoBusy ? <Loader2 size={12} className="animate-spin" /> : <Video size={12} />}
                        机位视频
                      </button>
                    </div>
                    <textarea
                      className="w-full h-20 bg-black/30 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-slate-100 outline-none resize-y min-h-[72px] focus:border-indigo-500/40"
                      value={prompt}
                      onChange={(event) => handlePromptChange(index, event.target.value)}
                      placeholder="输入该格提示词..."
                    />
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {activePreviewIndex !== null && (
        <div className="fixed inset-0 bg-black/95 z-[200] flex items-center justify-center p-8" onClick={() => setActivePreviewIndex(null)}>
          <div className="relative w-full h-full max-w-6xl flex flex-col items-center gap-4" onClick={(event) => event.stopPropagation()}>
            <div className="absolute top-0 right-0 p-4">
              <button onClick={() => setActivePreviewIndex(null)} className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-all">
                <X size={20} className="text-white" />
              </button>
            </div>
            <div className="flex-1 w-full bg-black rounded-2xl overflow-hidden border border-white/10 shadow-[0_0_80px_rgba(99,102,241,0.2)]">
              {videoUrls[activePreviewIndex] ? (
                <video src={videoUrls[activePreviewIndex] || undefined} className="w-full h-full object-contain" controls autoPlay loop />
              ) : displaySplitImages[activePreviewIndex] ? (
                <img src={displaySplitImages[activePreviewIndex]} className="w-full h-full object-contain" />
              ) : shot.generatedImageUrl ? (
                <img src={shot.generatedImageUrl} className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-500">暂无预览内容</div>
              )}
            </div>
            <div className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded bg-indigo-500 text-white text-[10px] font-black">{getAngleLabel(activePreviewIndex)}</span>
                <span className="text-[10px] text-slate-500">镜头：{shot.id}</span>
              </div>
              <p className="text-[12px] text-slate-200 leading-relaxed">{prompts[activePreviewIndex]}</p>
            </div>
          </div>
        </div>
      )}

      {showAnimaticPreview && shot.animaticVideoUrl && (
        <div className="fixed inset-0 bg-black/95 z-[210] flex items-center justify-center p-10" onClick={() => setShowAnimaticPreview(false)}>
          <div className="relative w-full h-full max-w-6xl flex flex-col items-center gap-6" onClick={(event) => event.stopPropagation()}>
            <div className="absolute top-0 right-0 p-4">
              <button onClick={() => setShowAnimaticPreview(false)} className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-all">
                <X size={24} className="text-white" />
              </button>
            </div>
            <div className="flex-1 w-full bg-black rounded-3xl overflow-hidden border border-white/10 shadow-[0_0_80px_rgba(99,102,241,0.25)]">
              <video src={shot.animaticVideoUrl} className="w-full h-full object-contain" controls autoPlay />
            </div>
          </div>
        </div>
      )}

      {showAssetVideoPreview && shot.assetVideoUrl && (
        <div className="fixed inset-0 bg-black/95 z-[215] flex items-center justify-center p-10" onClick={() => setShowAssetVideoPreview(false)}>
          <div className="relative w-full h-full max-w-6xl flex flex-col items-center gap-6" onClick={(event) => event.stopPropagation()}>
            <div className="absolute top-0 right-0 p-4">
              <button onClick={() => setShowAssetVideoPreview(false)} className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-all">
                <X size={24} className="text-white" />
              </button>
            </div>
            <div className="flex-1 w-full bg-black rounded-3xl overflow-hidden border border-white/10 shadow-[0_0_80px_rgba(16,185,129,0.25)]">
              <video src={shot.assetVideoUrl} className="w-full h-full object-contain" controls autoPlay />
            </div>
          </div>
        </div>
      )}

      {videoModalIndex !== null && (
        <div className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-4xl bg-[#141821] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center">
                  <Film size={18} />
                </div>
                <div>
                  <div className="text-[11px] font-black tracking-widest text-slate-300">机位视频生成</div>
                  <div className="text-[10px] text-slate-500">确认后开始调用 Sora-2</div>
                </div>
              </div>
              <button onClick={() => setVideoModalIndex(null)} className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-all">
                <X size={16} className="text-slate-300" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 px-6 py-5">
              <div className="space-y-4">
                <div className="text-[10px] font-black tracking-widest text-slate-400">参考帧</div>
                <div className="aspect-video bg-black/40 border border-white/10 rounded-xl overflow-hidden">
                  {splitImages[videoModalIndex] ? (
                    <img src={splitImages[videoModalIndex]} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">暂无图像</div>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>镜头: SH_{shot.id.substring(0, 4)}</span>
                  <span>{getAngleLabel(videoModalIndex)}</span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black tracking-widest text-slate-400">视频提示词</span>
                  <button
                    onClick={() => {
                      setVideoPromptDraft(prompts[videoModalIndex] || shot.visualTranslation);
                      setSyncVideoPrompt(true);
                    }}
                    className="text-[10px] font-black text-indigo-300 hover:text-indigo-200"
                  >
                    使用当前机位提示词
                  </button>
                </div>
                <textarea
                  value={videoPromptDraft}
                  onChange={(event) => setVideoPromptDraft(event.target.value)}
                  className="w-full h-40 bg-black/40 border border-white/10 rounded-xl p-3 text-[11px] text-slate-200 outline-none resize-none focus:border-indigo-500/50 focus:bg-white/5"
                  placeholder="为视频补充动作/镜头描述..."
                />
                <label className="flex items-center gap-2 text-[10px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={syncVideoPrompt}
                    onChange={(event) => setSyncVideoPrompt(event.target.checked)}
                    className="accent-indigo-500"
                  />
                  同步更新该机位提示词
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-[#10131a]">
              <div className="text-[10px] text-slate-500">状态流转：排队 → 处理中 → 下载中 → 完成</div>
              <div className="flex items-center gap-3">
                <button onClick={() => setVideoModalIndex(null)} className="h-9 px-4 rounded-lg bg-white/5 text-slate-300 hover:bg-white/10 text-[10px] font-black tracking-widest">
                  取消
                </button>
                <button
                  onClick={() => {
                    const finalPrompt = videoPromptDraft.trim() || prompts[videoModalIndex] || shot.visualTranslation;
                    if (syncVideoPrompt) {
                      const next = [...prompts];
                      next[videoModalIndex] = finalPrompt;
                      onUpdatePrompts(next);
                    }
                    handleCreateShotVideo(videoModalIndex, finalPrompt);
                    setVideoModalIndex(null);
                  }}
                  disabled={!splitImages[videoModalIndex]}
                  className="h-9 px-5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 text-[10px] font-black tracking-widest shadow-lg disabled:opacity-40"
                >
                  开始生成
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MatrixPromptEditor;
