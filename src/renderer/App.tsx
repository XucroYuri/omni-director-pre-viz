import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Sidebar from './components/Sidebar';
import StoryboardEditor from './components/StoryboardEditor';
import GlobalOpsPanel from './components/GlobalOpsPanel';
import ProjectManager from './components/ProjectManager';
import {
  AICapability,
  DBTask,
  EpisodeSummary,
  GlobalConfig,
  ProjectSummary,
  ProviderId,
  RuntimeEnvConfig,
  Shot,
  ScriptBreakdownResponse,
} from '@shared/types';
import {
  ensurePromptListLength,
  getGridCellCount,
  normalizeGridLayout,
  normalizeIndexedList,
} from '@shared/utils';
import { DEFAULT_RUNTIME_ENV_CONFIG, DEFAULT_STYLE } from '@shared/constants';
import { AlertCircle, CheckCircle2, FolderKanban, Info, Loader2, Moon, Settings, Sun, X } from 'lucide-react';
import { breakdownScript, optimizePrompts, recommendAssets } from './services/geminiService';
import brandMark from './assets/brand-mark.svg';

const STORAGE_KEYS = {
  CONFIG: 'OMNI_DIRECTOR_CONFIG',
  SCRIPT: 'OMNI_DIRECTOR_SCRIPT',
  BREAKDOWN: 'OMNI_DIRECTOR_BREAKDOWN',
  SELECTED_SHOT_ID: 'OMNI_DIRECTOR_SELECTED_ID',
  EPISODE_ID: 'OMNI_DIRECTOR_EPISODE_ID',
  EPISODE_TITLE: 'OMNI_DIRECTOR_EPISODE_TITLE',
  PROJECT_ID: 'OMNI_DIRECTOR_PROJECT_ID',
  VIEW_MODE: 'OMNI_DIRECTOR_VIEW_MODE',
  ONBOARDING_DISMISSED: 'OMNI_DIRECTOR_ONBOARDING_DISMISSED',
  THEME_MODE: 'OMNI_DIRECTOR_THEME_MODE',
};

type ApiStatus = 'connected' | 'error' | 'idle';
type NoticeTone = 'success' | 'error' | 'info';
type ScriptTemplate = { id: string; name: string; script: string };
type ThemeMode = 'dark' | 'light';
type ViewMode = 'project' | 'workspace';

type UiNotice = {
  id: string;
  tone: NoticeTone;
  message: string;
};

const PROVIDER_UI_META: Record<ProviderId, { title: string; hint: string }> = {
  aihubmix: {
    title: 'AIHubMix',
    hint: '第三方聚合，当前版本完整支持 LLM / IMAGE / VIDEO。',
  },
  gemini: {
    title: 'Gemini API',
    hint: '官方 Gemini 通道，当前版本支持 LLM / IMAGE。',
  },
  volcengine: {
    title: '火山引擎',
    hint: '当前版本优先用于 VIDEO，LLM/IMAGE 已预留模型配置位。',
  },
};

const CAPABILITY_META: Array<{ key: AICapability; label: string }> = [
  { key: 'llm', label: 'LLM 模型池' },
  { key: 'image', label: 'IMAGE 模型池' },
  { key: 'video', label: 'VIDEO 模型池' },
  { key: 'tts', label: 'TTS 模型池（预留）' },
  { key: 'music', label: 'MUSIC 模型池（预留）' },
  { key: 'sfx', label: 'SFX 模型池（预留）' },
];

const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: 'neo-noir-chase',
    name: 'Neo-noir 夜间追逐',
    script: [
      'EXT. RAINY ALLEY - NIGHT',
      '霓虹灯反射在积水里，主角在狭窄巷道疾跑，身后传来急促脚步声。',
      '',
      'INT. SUBWAY ENTRANCE - CONTINUOUS',
      '主角冲进地铁入口，回头确认追兵位置，呼吸急促，镜头切到近景汗水与紧握的手。',
      '',
      'EXT. OVERPASS - LATER',
      '高架桥下车流穿梭，主角停下观察出口，远处警灯闪烁，空气压迫感增强。',
    ].join('\n'),
  },
  {
    id: 'sci-fi-lab',
    name: '科幻实验室异常',
    script: [
      'INT. RESEARCH LAB - NIGHT',
      '无菌实验室内，蓝白冷光照亮控制台，研究员盯着能量读数迅速攀升。',
      '',
      'INT. REACTOR CHAMBER - MOMENTS LATER',
      '反应舱内部出现不稳定脉冲，警报灯闪烁，机械臂开始异常抖动。',
      '',
      'INT. CONTROL ROOM - CONTINUOUS',
      '团队争分夺秒输入应急指令，主控屏幕弹出“临界阈值已突破”。',
    ].join('\n'),
  },
  {
    id: 'period-drama',
    name: '古典庭院对峙',
    script: [
      'EXT. COURTYARD - DUSK',
      '古宅庭院薄雾弥漫，女主缓步进入回廊，手持信笺，神情克制。',
      '',
      'INT. HALLWAY - CONTINUOUS',
      '男主在长廊尽头停下脚步，两人隔着灯影对视，空气中充满未言明的 tension。',
      '',
      'EXT. COURTYARD GATE - LATER',
      '风吹动门帘，马车轮声由远及近，家族长辈现身，局势骤然紧张。',
    ].join('\n'),
  },
];

function cloneRuntimeEnvConfig(source: RuntimeEnvConfig): RuntimeEnvConfig {
  return {
    apiProvider: source.apiProvider,
    providers: {
      aihubmix: {
        ...source.providers.aihubmix,
        apiKeys: [...source.providers.aihubmix.apiKeys],
        models: {
          llm: [...source.providers.aihubmix.models.llm],
          image: [...source.providers.aihubmix.models.image],
          video: [...source.providers.aihubmix.models.video],
          tts: [...source.providers.aihubmix.models.tts],
          music: [...source.providers.aihubmix.models.music],
          sfx: [...source.providers.aihubmix.models.sfx],
        },
      },
      gemini: {
        ...source.providers.gemini,
        apiKeys: [...source.providers.gemini.apiKeys],
        models: {
          llm: [...source.providers.gemini.models.llm],
          image: [...source.providers.gemini.models.image],
          video: [...source.providers.gemini.models.video],
          tts: [...source.providers.gemini.models.tts],
          music: [...source.providers.gemini.models.music],
          sfx: [...source.providers.gemini.models.sfx],
        },
      },
      volcengine: {
        ...source.providers.volcengine,
        apiKeys: [...source.providers.volcengine.apiKeys],
        models: {
          llm: [...source.providers.volcengine.models.llm],
          image: [...source.providers.volcengine.models.image],
          video: [...source.providers.volcengine.models.video],
          tts: [...source.providers.volcengine.models.tts],
          music: [...source.providers.volcengine.models.music],
          sfx: [...source.providers.volcengine.models.sfx],
        },
      },
    },
  };
}

const DEFAULT_RUNTIME_ENV: RuntimeEnvConfig = cloneRuntimeEnvConfig(DEFAULT_RUNTIME_ENV_CONFIG);

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isDataUri(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}

function stripDataUri(value: unknown): string | undefined {
  if (isDataUri(value)) return undefined;
  return typeof value === 'string' ? value : undefined;
}

function normalizeRendererErrorMessage(error: unknown): string {
  const raw = typeof (error as any)?.message === 'string' ? (error as any).message : String(error || '');
  return raw.replace(/^Error invoking remote method '[^']+':\s*/i, '').trim();
}

function isMissingApiCredentialMessage(message: string): boolean {
  return (
    message.includes('Missing AIHUBMIX_API_KEY') ||
    message.includes('AIHUBMIX_API_KEY_MISSING') ||
    message.includes('Missing API key') ||
    message.includes('API_CREDENTIAL_MISSING')
  );
}

function normalizeShotState(rawShot: Shot): Shot {
  const gridLayout = normalizeGridLayout(rawShot.gridLayout);
  const cellCount = getGridCellCount(gridLayout);
  const history = (rawShot.history || []).map((entry) => {
    const historyLayout = normalizeGridLayout(entry.gridLayout, gridLayout);
    const historyCellCount = getGridCellCount(historyLayout);
    return {
      ...entry,
      gridLayout: historyLayout,
      prompts: ensurePromptListLength(entry.prompts, historyLayout),
      splitImages: normalizeIndexedList<string>(entry.splitImages, historyCellCount, ''),
      videoUrls: normalizeIndexedList<string | null>(entry.videoUrls, historyCellCount, null),
    };
  });

  return {
    ...rawShot,
    gridLayout,
    matrixPrompts: ensurePromptListLength(rawShot.matrixPrompts, gridLayout),
    splitImages: normalizeIndexedList<string>(rawShot.splitImages, cellCount, ''),
    videoUrls: normalizeIndexedList<string | null>(rawShot.videoUrls, cellCount, null),
    videoStatus: normalizeIndexedList<Shot['videoStatus'][number]>(rawShot.videoStatus, cellCount, 'idle'),
    history: history.length > 0 ? history : rawShot.history,
  };
}

function sanitizeHistoryForStorage(shot: Shot) {
  if (!shot.history || shot.history.length === 0) return shot.history;
  return shot.history.map((entry) => {
    const layout = normalizeGridLayout(entry.gridLayout, shot.gridLayout);
    const cellCount = getGridCellCount(layout);
    return {
      ...entry,
      gridLayout: layout,
      imageUrl: stripDataUri(entry.imageUrl) || '',
      prompts: ensurePromptListLength(entry.prompts, layout),
      splitImages: normalizeIndexedList<string>(entry.splitImages, cellCount, '').map((img) => stripDataUri(img) || ''),
      videoUrls: normalizeIndexedList<string | null>(entry.videoUrls, cellCount, null).map(
        (url) => stripDataUri(url) ?? null,
      ),
    };
  });
}

const App: React.FC = () => {
  const isElectronRuntime = Boolean(window.api?.app);

  const [config, setConfig] = useState<GlobalConfig>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CONFIG);
    const parsed = safeJsonParse<GlobalConfig | null>(saved, null);
    if (parsed) {
      const provider =
        parsed.apiProvider === 'auto' ||
        parsed.apiProvider === 'aihubmix' ||
        parsed.apiProvider === 'gemini' ||
        parsed.apiProvider === 'volcengine'
          ? parsed.apiProvider
          : 'auto';
      return {
        ...parsed,
        apiProvider: provider,
        characters: parsed.characters.map((c) => ({ ...c, refImage: stripDataUri(c.refImage) })),
        scenes: parsed.scenes.map((s) => ({ ...s, refImage: stripDataUri(s.refImage) })),
        props: parsed.props.map((p) => ({ ...p, refImage: stripDataUri(p.refImage) })),
      };
    }
    return {
      artStyle: DEFAULT_STYLE,
      aspectRatio: '16:9',
      resolution: '2K',
      characters: [],
      scenes: [],
      props: [],
      apiProvider: 'auto',
    };
  });

  const [script, setScript] = useState(() => localStorage.getItem(STORAGE_KEYS.SCRIPT) || '');
  const [breakdown, setBreakdown] = useState<ScriptBreakdownResponse | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.BREAKDOWN);
    const parsed = safeJsonParse<ScriptBreakdownResponse | null>(saved, null);
    if (!parsed) return null;
    return {
      ...parsed,
      shots: (parsed.shots || []).map((shot) => {
        const normalized = normalizeShotState(shot);
        return {
          ...normalized,
          generatedImageUrl: stripDataUri(normalized.generatedImageUrl),
          splitImages: normalized.splitImages?.map((img) => stripDataUri(img) || ''),
          videoUrls: normalized.videoUrls?.map((url) => stripDataUri(url) ?? null),
          animaticVideoUrl: stripDataUri(normalized.animaticVideoUrl),
          assetVideoUrl: stripDataUri(normalized.assetVideoUrl),
          history: sanitizeHistoryForStorage(normalized),
        } as Shot;
      }),
    };
  });
  const [selectedShotId, setSelectedShotId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEYS.SELECTED_SHOT_ID) || null,
  );
  const [episodeId, setEpisodeId] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.EPISODE_ID);
    if (saved) return saved;
    return `ep_${Date.now()}`;
  });
  const [episodeTitle, setEpisodeTitle] = useState(
    () => localStorage.getItem(STORAGE_KEYS.EPISODE_TITLE) || '第 1 集',
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEYS.PROJECT_ID) || null,
  );
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.VIEW_MODE);
    return saved === 'workspace' ? 'workspace' : 'project';
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isRefreshingProjects, setIsRefreshingProjects] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isSavingEpisode, setIsSavingEpisode] = useState(false);
  const [isLoadingEpisode, setIsLoadingEpisode] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<number | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [createZip, setCreateZip] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isAutoLinking, setIsAutoLinking] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('idle');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [runtimeEnvDraft, setRuntimeEnvDraft] = useState<RuntimeEnvConfig>(() =>
    cloneRuntimeEnvConfig(DEFAULT_RUNTIME_ENV),
  );
  const [isLoadingRuntimeEnv, setIsLoadingRuntimeEnv] = useState(false);
  const [isSavingRuntimeEnv, setIsSavingRuntimeEnv] = useState(false);
  const [runtimeEnvNotice, setRuntimeEnvNotice] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME_MODE);
    return saved === 'light' ? 'light' : 'dark';
  });
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [notices, setNotices] = useState<UiNotice[]>([]);

  const isReloadingRef = useRef(false);
  const hasInitializedOnboardingRef = useRef(false);
  const noticeTimersRef = useRef<Map<string, number>>(new Map());
  const autoSaveTimerRef = useRef<number | null>(null);
  const lastPersistedSnapshotRef = useRef('');
  const persistTimers = useRef<{
    config?: number;
    script?: number;
    breakdown?: number;
    selected?: number;
    episodeTitle?: number;
    projectId?: number;
    viewMode?: number;
  }>({});

  const shots = breakdown?.shots || [];
  const isProjectMode = viewMode === 'project';
  const selectedShot = useMemo(
    () => shots.find((shot) => shot.id === selectedShotId) || null,
    [shots, selectedShotId],
  );

  const normalizePolicyError = (message: string) => {
    if (!message) return message;
    if (!message.includes('POLICY_VIOLATION')) return message;
    if (message.includes('Missing Scene')) return '生成失败：请先绑定场景。';
    return '生成失败：未满足资产绑定规则。';
  };

  const dismissNotice = useCallback((id: string) => {
    setNotices((prev) => prev.filter((notice) => notice.id !== id));
    const timer = noticeTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      noticeTimersRef.current.delete(id);
    }
  }, []);

  const pushNotice = useCallback(
    (tone: NoticeTone, message: string) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      setNotices((prev) => [...prev, { id, tone, message }]);
      const timer = window.setTimeout(() => {
        dismissNotice(id);
      }, 5200);
      noticeTimersRef.current.set(id, timer);
    },
    [dismissNotice],
  );

  const promptConfigureApi = useCallback((message?: string) => {
    setRuntimeEnvNotice(message || '缺少可用 API Key，请先在设置中完成服务商与密钥配置。');
    setShowSettings(true);
  }, []);

  const parseListInput = useCallback((value: string) => {
    return value
      .split(/[\n,]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }, []);

  const updateRuntimeProvider = useCallback((providerId: ProviderId, updates: Partial<RuntimeEnvConfig['providers'][ProviderId]>) => {
    setRuntimeEnvDraft((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [providerId]: {
          ...prev.providers[providerId],
          ...updates,
        },
      },
    }));
  }, []);

  const updateRuntimeProviderModels = useCallback(
    (providerId: ProviderId, capability: AICapability, value: string) => {
      const parsed = parseListInput(value);
      setRuntimeEnvDraft((prev) => ({
        ...prev,
        providers: {
          ...prev.providers,
          [providerId]: {
            ...prev.providers[providerId],
            models: {
              ...prev.providers[providerId].models,
              [capability]: parsed,
            },
          },
        },
      }));
    },
    [parseListInput],
  );

  const refreshProjects = useCallback(async () => {
    if (!window.api?.app?.project?.list) return;
    setIsRefreshingProjects(true);
    try {
      const data = await window.api.app.project.list();
      setProjects(data);
      if (!selectedProjectId && data.length > 0) {
        setSelectedProjectId(data[0].projectId);
      }
    } catch (error: any) {
      console.error('Failed to refresh projects', error);
    } finally {
      setIsRefreshingProjects(false);
    }
  }, [selectedProjectId]);

  const persistOnboardingDismissed = useCallback(() => {
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_DISMISSED, '1');
  }, []);

  const hideOnboarding = useCallback(
    (persist = true) => {
      setShowOnboarding(false);
      if (persist) {
        persistOnboardingDismissed();
      }
    },
    [persistOnboardingDismissed],
  );

  useEffect(() => {
    return () => {
      noticeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      noticeTimersRef.current.clear();
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isElectronRuntime) return;
    refreshProjects().catch((error) => {
      console.error('Initial project refresh failed', error);
    });
  }, [isElectronRuntime, refreshProjects]);

  useEffect(() => {
    if (hasInitializedOnboardingRef.current) return;
    hasInitializedOnboardingRef.current = true;
    const dismissed = localStorage.getItem(STORAGE_KEYS.ONBOARDING_DISMISSED) === '1';
    if (!dismissed && !script.trim() && shots.length === 0) {
      setShowOnboarding(true);
    }
  }, [script, shots.length]);

  useEffect(() => {
    if (projects.length === 0) return;
    if (!selectedProjectId || !projects.some((item) => item.projectId === selectedProjectId)) {
      setSelectedProjectId(projects[0].projectId);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.THEME_MODE, themeMode);
    document.documentElement.setAttribute('data-theme-mode', themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!showSettings) return;
    if (!window.api?.app?.settings?.getRuntimeEnv) {
      setRuntimeEnvNotice('当前环境不支持 API 配置写入（仅 Electron 桌面端可用）。');
      return;
    }

    let cancelled = false;
    setIsLoadingRuntimeEnv(true);
    window.api.app.settings.getRuntimeEnv()
      .then((envConfig) => {
        if (cancelled) return;
        setRuntimeEnvDraft(cloneRuntimeEnvConfig(envConfig));
      })
      .catch((error) => {
        if (cancelled) return;
        const message = normalizeRendererErrorMessage(error) || '读取 API 配置失败';
        setRuntimeEnvNotice(message);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingRuntimeEnv(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showSettings]);

  useEffect(() => {
    const timer = persistTimers.current.config;
    if (timer) window.clearTimeout(timer);

    const sanitized: GlobalConfig = {
      ...config,
      characters: config.characters.map((c) => ({ ...c, refImage: stripDataUri(c.refImage) })),
      scenes: config.scenes.map((s) => ({ ...s, refImage: stripDataUri(s.refImage) })),
      props: config.props.map((p) => ({ ...p, refImage: stripDataUri(p.refImage) })),
    };

    persistTimers.current.config = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(sanitized));
    }, 400);

    return () => {
      const t = persistTimers.current.config;
      if (t) window.clearTimeout(t);
    };
  }, [config]);

  useEffect(() => {
    const timer = persistTimers.current.script;
    if (timer) window.clearTimeout(timer);
    persistTimers.current.script = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEYS.SCRIPT, script);
    }, 400);
    return () => {
      const t = persistTimers.current.script;
      if (t) window.clearTimeout(t);
    };
  }, [script]);

  useEffect(() => {
    const timer = persistTimers.current.breakdown;
    if (timer) window.clearTimeout(timer);
    if (!breakdown) return;

    const sanitized: ScriptBreakdownResponse = {
      ...breakdown,
      shots: breakdown.shots.map((shot) => {
        const normalized = normalizeShotState(shot);
        return {
          ...normalized,
          generatedImageUrl: stripDataUri(normalized.generatedImageUrl),
          splitImages: normalized.splitImages?.map((img) => stripDataUri(img) || ''),
          videoUrls: normalized.videoUrls?.map((url) => stripDataUri(url) ?? null),
          animaticVideoUrl: stripDataUri(normalized.animaticVideoUrl),
          assetVideoUrl: stripDataUri(normalized.assetVideoUrl),
          history: sanitizeHistoryForStorage(normalized),
        };
      }),
    };

    persistTimers.current.breakdown = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEYS.BREAKDOWN, JSON.stringify(sanitized));
    }, 900);

    return () => {
      const t = persistTimers.current.breakdown;
      if (t) window.clearTimeout(t);
    };
  }, [breakdown]);

  useEffect(() => {
    const timer = persistTimers.current.selected;
    if (timer) window.clearTimeout(timer);
    persistTimers.current.selected = window.setTimeout(() => {
      if (selectedShotId) localStorage.setItem(STORAGE_KEYS.SELECTED_SHOT_ID, selectedShotId);
      else localStorage.removeItem(STORAGE_KEYS.SELECTED_SHOT_ID);
    }, 200);
    return () => {
      const t = persistTimers.current.selected;
      if (t) window.clearTimeout(t);
    };
  }, [selectedShotId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.EPISODE_ID, episodeId);
  }, [episodeId]);

  useEffect(() => {
    const timer = persistTimers.current.episodeTitle;
    if (timer) window.clearTimeout(timer);
    persistTimers.current.episodeTitle = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEYS.EPISODE_TITLE, episodeTitle);
    }, 200);
    return () => {
      const t = persistTimers.current.episodeTitle;
      if (t) window.clearTimeout(t);
    };
  }, [episodeTitle]);

  useEffect(() => {
    const timer = persistTimers.current.projectId;
    if (timer) window.clearTimeout(timer);
    persistTimers.current.projectId = window.setTimeout(() => {
      if (selectedProjectId) localStorage.setItem(STORAGE_KEYS.PROJECT_ID, selectedProjectId);
      else localStorage.removeItem(STORAGE_KEYS.PROJECT_ID);
    }, 200);
    return () => {
      const t = persistTimers.current.projectId;
      if (t) window.clearTimeout(t);
    };
  }, [selectedProjectId]);

  useEffect(() => {
    const timer = persistTimers.current.viewMode;
    if (timer) window.clearTimeout(timer);
    persistTimers.current.viewMode = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEYS.VIEW_MODE, viewMode);
    }, 120);
    return () => {
      const t = persistTimers.current.viewMode;
      if (t) window.clearTimeout(t);
    };
  }, [viewMode]);

  useEffect(() => {
    if (shots.length === 0) {
      if (selectedShotId !== null) setSelectedShotId(null);
      return;
    }
    if (!selectedShotId || !selectedShot) {
      setSelectedShotId(shots[0].id);
    }
  }, [shots, selectedShot, selectedShotId]);

  const updateShot = useCallback((id: string, updates: Partial<Shot>) => {
    setBreakdown((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        shots: prev.shots.map((s) => (s.id === id ? normalizeShotState({ ...s, ...updates }) : s)),
      };
    });
  }, []);

  const handleUpdateSelectedShotGridLayout = useCallback(
    (layoutInput: { rows: number; cols: number }) => {
      if (!selectedShotId) return;
      const shot = shots.find((item) => item.id === selectedShotId);
      if (!shot) return;

      const currentLayout = normalizeGridLayout(shot.gridLayout);
      const nextLayout = normalizeGridLayout(layoutInput, currentLayout);
      if (currentLayout.rows === nextLayout.rows && currentLayout.cols === nextLayout.cols) return;

      const nextCellCount = getGridCellCount(nextLayout);
      const nextPrompts = ensurePromptListLength(shot.matrixPrompts, nextLayout);
      updateShot(selectedShotId, {
        gridLayout: nextLayout,
        matrixPrompts: nextPrompts,
        generatedImageUrl: undefined,
        splitImages: [],
        videoUrls: Array(nextCellCount).fill(null),
        videoStatus: Array(nextCellCount).fill('idle'),
        animaticVideoUrl: undefined,
        assetVideoUrl: undefined,
      });
      pushNotice('info', `已切换网格布局为 ${nextLayout.rows}x${nextLayout.cols}。`);
    },
    [pushNotice, selectedShotId, shots, updateShot],
  );

  const handleOptimizePrompts = useCallback(async () => {
    if (!selectedShot || isOptimizing) return;
    if (!window.api?.ai?.optimizePrompts) {
      pushNotice('error', '提示词优化仅在 Electron 桌面端可用。');
      return;
    }

    setIsOptimizing(true);
    try {
      const optimization = await optimizePrompts(selectedShot, config);
      const layout = normalizeGridLayout(selectedShot.gridLayout);
      const nextPrompts = ensurePromptListLength(optimization.optimizedPrompts, layout);
      const hasPromptOutput = nextPrompts.some((prompt) => prompt.trim().length > 0);

      updateShot(selectedShot.id, {
        optimization,
        matrixPrompts: hasPromptOutput ? nextPrompts : ensurePromptListLength(selectedShot.matrixPrompts, layout),
      });
      setApiStatus('connected');
      pushNotice(
        hasPromptOutput ? 'success' : 'info',
        hasPromptOutput ? '提示词优化完成，已同步到当前镜头。' : '优化完成，但未返回可用提示词，保留原内容。',
      );
    } catch (error: any) {
      const message = normalizeRendererErrorMessage(error) || '提示词优化失败，请稍后重试。';
      if (isMissingApiCredentialMessage(message)) {
        const hint = '缺少可用 API Key，请先在设置中填写后再优化。';
        promptConfigureApi(hint);
        pushNotice('error', hint);
      } else {
        pushNotice('error', message);
      }
      setApiStatus('error');
    } finally {
      setIsOptimizing(false);
    }
  }, [config, isOptimizing, promptConfigureApi, pushNotice, selectedShot, updateShot]);

  const handleAutoLinkAssets = useCallback(async () => {
    if (!selectedShot || isAutoLinking) return;
    if (!window.api?.ai?.recommendAssets) {
      pushNotice('error', '自动关联资产仅在 Electron 桌面端可用。');
      return;
    }

    setIsAutoLinking(true);
    try {
      const recommendation = await recommendAssets(selectedShot, config);

      const knownCharacterIds = new Set(config.characters.map((item) => item.id));
      const knownSceneIds = new Set(config.scenes.map((item) => item.id));
      const knownPropIds = new Set(config.props.map((item) => item.id));

      const mergeIds = (current: string[] | undefined, next: string[] | undefined, known: Set<string>) =>
        Array.from(new Set([...(current || []), ...(next || [])])).filter((id) => known.has(id));
      const countAdded = (current: string[] | undefined, next: string[]) => {
        const currentSet = new Set(current || []);
        return next.filter((id) => !currentSet.has(id)).length;
      };

      const nextCharacterIds = mergeIds(selectedShot.characterIds, recommendation.characterIds, knownCharacterIds);
      const nextSceneIds = mergeIds(selectedShot.sceneIds, recommendation.sceneIds, knownSceneIds);
      const nextPropIds = mergeIds(selectedShot.propIds, recommendation.propIds, knownPropIds);

      const addedCharacters = countAdded(selectedShot.characterIds, nextCharacterIds);
      const addedScenes = countAdded(selectedShot.sceneIds, nextSceneIds);
      const addedProps = countAdded(selectedShot.propIds, nextPropIds);
      const totalAdded = addedCharacters + addedScenes + addedProps;

      if (totalAdded === 0) {
        pushNotice('info', '自动关联完成：未发现可新增的资产关联。');
        setApiStatus('connected');
        return;
      }

      updateShot(selectedShot.id, {
        characterIds: nextCharacterIds,
        sceneIds: nextSceneIds,
        propIds: nextPropIds,
      });
      setApiStatus('connected');
      pushNotice(
        'success',
        `自动关联完成：新增 ${addedCharacters} 个角色 / ${addedScenes} 个场景 / ${addedProps} 个道具。`,
      );
    } catch (error: any) {
      const message = normalizeRendererErrorMessage(error) || '自动关联资产失败，请稍后重试。';
      if (isMissingApiCredentialMessage(message)) {
        const hint = '缺少可用 API Key，请先在设置中填写后再自动关联。';
        promptConfigureApi(hint);
        pushNotice('error', hint);
      } else {
        pushNotice('error', message);
      }
      setApiStatus('error');
    } finally {
      setIsAutoLinking(false);
    }
  }, [config, isAutoLinking, promptConfigureApi, pushNotice, selectedShot, updateShot]);

  const handleGenerateImage = useCallback(
    async (shotId: string) => {
      const shot = shots.find((s) => s.id === shotId);
      if (!shot || isGeneratingImage) return;
      if (!window.api?.app?.task?.submit) {
        pushNotice('error', '当前运行在浏览器预览模式，任务队列仅在 Electron 桌面端可用。');
        return;
      }

      setIsGeneratingImage(true);

      try {
        const now = Date.now();
        const taskId =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `task_${now}_${Math.random().toString(16).slice(2, 10)}`;

        const sanitizeAssets = <T extends { refImage?: string }>(items: T[]) =>
          items.map(({ refImage, ...rest }) => rest);

        const normalizedShot = normalizeShotState(shot);
        const taskShot = {
          id: shot.id,
          originalText: shot.originalText,
          visualTranslation: shot.visualTranslation,
          contextTag: shot.contextTag,
          gridLayout: normalizedShot.gridLayout,
          matrixPrompts: normalizedShot.matrixPrompts,
          characterIds: shot.characterIds,
          sceneIds: shot.sceneIds,
          propIds: shot.propIds,
        };

        const taskConfig = {
          ...config,
          characters: sanitizeAssets(config.characters),
          scenes: sanitizeAssets(config.scenes),
          props: sanitizeAssets(config.props),
        };

        const payload = {
          jobKind: 'MATRIX_GEN',
          shot: taskShot,
          config: taskConfig,
        };

        const task: DBTask = {
          id: taskId,
          episode_id: episodeId,
          shot_id: shot.id,
          type: 'IMAGE',
          status: 'queued',
          progress: 0,
          payload_json: JSON.stringify(payload),
          result_json: '',
          error: null,
          created_at: now,
          updated_at: now,
        };

        await window.api.app.task.submit(task);
        updateShot(shotId, { status: 'processing', lastAccessedAt: now });
        setApiStatus('connected');
        pushNotice('info', '镜头渲染任务已加入队列。');
      } catch (error: any) {
        const message = normalizeRendererErrorMessage(error) || 'Unknown error';
        if (isMissingApiCredentialMessage(message)) {
          const hint = '缺少可用 API Key，请先在设置中配置服务商与密钥后再生成。';
          promptConfigureApi(hint);
          pushNotice('error', hint);
        } else {
          pushNotice('error', normalizePolicyError(message));
        }
        setApiStatus('error');
      } finally {
        setIsGeneratingImage(false);
      }
    },
    [config, episodeId, isGeneratingImage, promptConfigureApi, pushNotice, shots],
  );

  const runBreakdownForScript = useCallback(
    async (sourceScript: string, sourceLabel = '脚本') => {
      const trimmed = sourceScript.trim();
      if (!trimmed) {
        pushNotice('info', '请先输入剧本文本，再执行脚本拆解。');
        return false;
      }

      if (!window.api?.ai?.breakdownScript) {
        pushNotice('error', '脚本拆解仅在 Electron 桌面端可用，请使用 `npm run dev` 启动。');
        setApiStatus('error');
        return false;
      }

      setIsLoading(true);
      try {
        const result = await breakdownScript(trimmed, config);
        const normalizedResult: ScriptBreakdownResponse = {
          ...result,
          shots: (result.shots || []).map((shot) => normalizeShotState(shot)),
        };
        setBreakdown(normalizedResult);
        setViewMode('workspace');
        if (!episodeTitle.trim() || /^第\s*\d+\s*集$/.test(episodeTitle.trim())) {
          const inferredTitle =
            normalizedResult.sceneTable?.[0]?.title ||
            trimmed.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ||
            episodeTitle;
          if (inferredTitle) {
            setEpisodeTitle(inferredTitle.slice(0, 64));
          }
        }
        if (normalizedResult.shots.length > 0) {
          setSelectedShotId(normalizedResult.shots[0].id);
        }
        setApiStatus('connected');
        pushNotice('success', `${sourceLabel}拆解完成：共生成 ${normalizedResult.shots.length} 个镜头。`);
        return true;
      } catch (error: any) {
        const message = normalizeRendererErrorMessage(error) || '脚本拆解失败，请稍后重试。';
        if (isMissingApiCredentialMessage(message)) {
          const hint = '缺少可用 API Key，请在设置中填写后重试。';
          promptConfigureApi(hint);
          pushNotice('error', hint);
        } else {
          pushNotice('error', message);
        }
        setApiStatus('error');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [config, episodeTitle, promptConfigureApi, pushNotice],
  );

  const handleBreakdown = useCallback(async () => {
    await runBreakdownForScript(script, '脚本');
  }, [runBreakdownForScript, script]);

  const handleApplyScriptTemplate = useCallback(
    (templateId: string) => {
      const template = SCRIPT_TEMPLATES.find((item) => item.id === templateId);
      if (!template) {
        pushNotice('error', '未找到指定模板。');
        return;
      }
      setScript(template.script);
      setApiStatus('idle');
      pushNotice('info', `已填充模板：${template.name}。`);
    },
    [pushNotice],
  );

  const handleQuickStart = useCallback(
    async (templateId?: string) => {
      const template =
        SCRIPT_TEMPLATES.find((item) => item.id === templateId) || SCRIPT_TEMPLATES[0];
      if (!template) return;
      setScript(template.script);
      const success = await runBreakdownForScript(template.script, `模板《${template.name}》`);
      if (success) {
        hideOnboarding();
        pushNotice('info', '下一步：点击「Storyboard 脚本」后再生成「Storyboard 板图」。');
      }
    },
    [hideOnboarding, pushNotice, runBreakdownForScript],
  );

  const handleSaveRuntimeEnv = useCallback(async () => {
    if (isSavingRuntimeEnv) return;
    if (!window.api?.app?.settings?.saveRuntimeEnv) {
      pushNotice('error', '当前环境不支持 API 配置写入。');
      return;
    }

    setIsSavingRuntimeEnv(true);
    try {
      const saved = await window.api.app.settings.saveRuntimeEnv(runtimeEnvDraft);
      setRuntimeEnvDraft(cloneRuntimeEnvConfig(saved));
      setConfig((prev) => ({ ...prev, apiProvider: saved.apiProvider }));
      const keyCount = Object.values(saved.providers).reduce(
        (total, provider) => total + provider.apiKeys.length,
        0,
      );
      const noticeMessage =
        keyCount > 0
          ? 'API 路由配置已保存，自动降级与多 Key 负载均衡已生效。'
          : '配置已保存，但尚未填写任何 API Key。';
      setRuntimeEnvNotice(noticeMessage);
      pushNotice(keyCount > 0 ? 'success' : 'info', noticeMessage);
    } catch (error) {
      const message = normalizeRendererErrorMessage(error) || '保存 API 配置失败';
      setRuntimeEnvNotice(message);
      pushNotice('error', message);
    } finally {
      setIsSavingRuntimeEnv(false);
    }
  }, [isSavingRuntimeEnv, pushNotice, runtimeEnvDraft]);

  const handleExportEpisode = useCallback(async () => {
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
        createZip,
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
      pushNotice('error', `系统错误：${err?.message || err}`);
    } finally {
      setIsExporting(false);
    }
  }, [config, createZip, isElectronRuntime, isExporting, pushNotice, shots]);

  const buildEpisodePayload = useCallback(() => {
    return {
      episodeId,
      projectId: selectedProjectId || undefined,
      title: episodeTitle,
      script,
      context: breakdown?.context || '',
      scriptOverview: breakdown?.scriptOverview,
      sceneTable: breakdown?.sceneTable,
      beatTable: breakdown?.beatTable,
      config,
      shots,
      assets: {
        characters: config.characters,
        scenes: config.scenes,
        props: config.props,
      },
    };
  }, [breakdown, config, episodeId, episodeTitle, script, selectedProjectId, shots]);

  const handleSaveEpisode = useCallback(async () => {
    if (isSavingEpisode) return;
    if (!window.api?.app?.db) {
      pushNotice('error', '数据库读写仅在 Electron 桌面端可用。');
      return;
    }

    const data = buildEpisodePayload();
    const snapshot = JSON.stringify(data);

    setIsSavingEpisode(true);
    try {
      await window.api.app.db.saveEpisode(data);
      lastPersistedSnapshotRef.current = snapshot;
      setLastAutoSavedAt(Date.now());
      pushNotice('success', `Episode ${episodeId} 已保存。`);
      setApiStatus('connected');
      refreshProjects().catch(() => {});
    } catch (error: any) {
      pushNotice('error', `保存失败：${error?.message || error}`);
      setApiStatus('error');
    } finally {
      setIsSavingEpisode(false);
    }
  }, [buildEpisodePayload, episodeId, isSavingEpisode, pushNotice, refreshProjects]);

  const reloadEpisode = useCallback(
    async (options?: { notify?: boolean; markBusy?: boolean; episodeId?: string }) => {
      const { notify = false, markBusy = false, episodeId: explicitEpisodeId } = options || {};
      const targetEpisodeId = explicitEpisodeId || episodeId;

      if (!window.api?.app?.db) {
        if (notify) pushNotice('error', '数据库读写仅在 Electron 桌面端可用。');
        return;
      }

      if (markBusy) {
        setIsLoadingEpisode(true);
      }

      try {
        const data = await window.api.app.db.loadEpisode(targetEpisodeId);
        if (!data) {
          if (notify) pushNotice('info', `未找到 Episode：${targetEpisodeId}`);
          return;
        }
        const normalizedShots = data.shots.map((shot) => normalizeShotState(shot));
        setConfig(data.config);
        setEpisodeId(data.episodeId);
        setEpisodeTitle(data.title || `第 ${data.episodeNo || 1} 集`);
        setScript(data.script || '');
        setSelectedProjectId(data.projectId || selectedProjectId);
        setBreakdown({
          context: data.context || '',
          scriptOverview: data.scriptOverview,
          sceneTable: data.sceneTable,
          beatTable: data.beatTable,
          shots: normalizedShots,
          characters: data.assets.characters.map((c) => ({ name: c.name, description: c.description })),
        });
        setSelectedShotId(normalizedShots[0]?.id || null);
        setViewMode('workspace');
        setApiStatus('connected');
        lastPersistedSnapshotRef.current = JSON.stringify({
          episodeId: data.episodeId,
          projectId: data.projectId || selectedProjectId || undefined,
          title: data.title || `第 ${data.episodeNo || 1} 集`,
          script: data.script || '',
          context: data.context || '',
          scriptOverview: data.scriptOverview,
          sceneTable: data.sceneTable,
          beatTable: data.beatTable,
          config: data.config,
          shots: normalizedShots,
          assets: data.assets,
        });
        setLastAutoSavedAt(Date.now());
        if (notify) pushNotice('success', `Episode ${data.episodeId} 已加载。`);
      } catch (error: any) {
        if (notify) pushNotice('error', `读取失败：${error?.message || error}`);
        setApiStatus('error');
      } finally {
        if (markBusy) {
          setIsLoadingEpisode(false);
        }
      }
    },
    [episodeId, pushNotice, selectedProjectId],
  );

  const handleCreateProject = useCallback(
    async (name: string, description?: string) => {
      if (!window.api?.app?.project?.create) {
        pushNotice('error', '项目管理仅在 Electron 桌面端可用。');
        return;
      }
      try {
        const created = await window.api.app.project.create({ name, description });
        setSelectedProjectId(created.projectId);
        await refreshProjects();
        pushNotice('success', `项目「${created.name}」已创建。`);
      } catch (error: any) {
        pushNotice('error', `创建项目失败：${error?.message || error}`);
      }
    },
    [pushNotice, refreshProjects],
  );

  const handleCreateEpisode = useCallback(
    async (projectId: string, title?: string) => {
      if (!window.api?.app?.project?.createEpisode) {
        pushNotice('error', '项目管理仅在 Electron 桌面端可用。');
        return;
      }
      try {
        const created = await window.api.app.project.createEpisode({ projectId, title });
        setSelectedProjectId(created.projectId);
        setEpisodeId(created.episodeId);
        setEpisodeTitle(created.title);
        setScript('');
        setBreakdown(null);
        setSelectedShotId(null);
        await refreshProjects();
        pushNotice('success', `已创建单集：${created.title}`);
      } catch (error: any) {
        pushNotice('error', `创建单集失败：${error?.message || error}`);
      }
    },
    [pushNotice, refreshProjects],
  );

  const handleOpenEpisodeFromProject = useCallback(
    async (episode: EpisodeSummary) => {
      setSelectedProjectId(episode.projectId);
      setViewMode('workspace');
      await reloadEpisode({ notify: true, markBusy: true, episodeId: episode.episodeId });
    },
    [reloadEpisode],
  );

  useEffect(() => {
    if (!isElectronRuntime || !window.api?.app?.db) return;
    if (isProjectMode || isLoading || isLoadingEpisode || isSavingEpisode) return;

    const payload = buildEpisodePayload();
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastPersistedSnapshotRef.current) return;

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = window.setTimeout(async () => {
      try {
        setIsAutoSaving(true);
        await window.api!.app.db.saveEpisode(payload);
        lastPersistedSnapshotRef.current = snapshot;
        setLastAutoSavedAt(Date.now());
        setApiStatus('connected');
      } catch (error) {
        console.error('Auto save failed', error);
        setApiStatus('error');
      } finally {
        setIsAutoSaving(false);
      }
    }, 1400);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [buildEpisodePayload, isElectronRuntime, isLoading, isLoadingEpisode, isProjectMode, isSavingEpisode]);

  useEffect(() => {
    const taskApi = window.api?.app?.task;
    if (!taskApi?.onUpdate || !taskApi?.offUpdate) return () => {};

    const handleUpdate = (task: DBTask) => {
      if (task.status !== 'completed') return;
      if (task.episode_id !== episodeId) return;
      if (isReloadingRef.current) return;
      isReloadingRef.current = true;
      reloadEpisode()
        .then(() => refreshProjects())
        .catch((err) => console.error('Episode reload failed', err))
        .finally(() => {
          isReloadingRef.current = false;
        });
    };

    taskApi.onUpdate(handleUpdate);
    return () => taskApi.offUpdate(handleUpdate);
  }, [episodeId, refreshProjects, reloadEpisode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true;
      const isPrimary = event.metaKey || event.ctrlKey;

      if (event.key === 'Escape') {
        setShowShortcuts(false);
        setShowSettings(false);
      }

      if (!isPrimary || isTyping) return;

      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSaveEpisode().catch((error) => {
          console.error('Save shortcut failed', error);
        });
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        handleBreakdown().catch((error) => {
          console.error('Breakdown shortcut failed', error);
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [handleBreakdown, handleSaveEpisode]);

  const quickStartDisabledReason = !isElectronRuntime
    ? '一键跑通依赖 AI 解析能力，仅在 Electron 桌面端可用。'
    : '';

  const sidebarNode = (
    <Sidebar
      config={config}
      setConfig={setConfig}
      shots={shots}
      selectedShotId={selectedShotId}
      setSelectedShotId={(id) => {
        setSelectedShotId(id);
      }}
      isLoading={isLoading}
      script={script}
      setScript={setScript}
      handleBreakdown={handleBreakdown}
      scriptOverview={breakdown?.scriptOverview}
      sceneTable={breakdown?.sceneTable}
      beatTable={breakdown?.beatTable}
      episodeId={episodeId}
      isElectronRuntime={isElectronRuntime}
      notify={pushNotice}
      onUpdateSelectedShotGridLayout={handleUpdateSelectedShotGridLayout}
    />
  );

  const globalOpsNode = (
    <GlobalOpsPanel
      shots={shots}
      onExportEpisode={handleExportEpisode}
      isExporting={isExporting}
      createZip={createZip}
      setCreateZip={setCreateZip}
      isElectronRuntime={isElectronRuntime}
      apiStatus={apiStatus}
      isAutoSaving={isAutoSaving}
      lastAutoSavedAt={lastAutoSavedAt}
    />
  );

  const projectNode = (
    <ProjectManager
      projects={projects}
      selectedProjectId={selectedProjectId}
      isElectronRuntime={isElectronRuntime}
      onSelectProject={(projectId) => setSelectedProjectId(projectId)}
      onCreateProject={handleCreateProject}
      onCreateEpisode={handleCreateEpisode}
      onOpenEpisode={handleOpenEpisodeFromProject}
    />
  );

  return (
    <div
      data-theme-mode={themeMode}
      className="od-shell relative flex h-screen w-full overflow-hidden bg-[#0f1115] text-slate-300 font-sans"
    >
      {!isProjectMode ? sidebarNode : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {!isElectronRuntime && (
          <div className="od-alert-warning min-h-10 border-b px-4 py-2 sm:px-6 flex flex-wrap items-center gap-2 justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
              <Info size={12} /> 浏览器预览模式
            </div>
            <span className="text-[10px] leading-relaxed opacity-90">
              任务队列与交付导出仅在 Electron 桌面端生效。
            </span>
          </div>
        )}

        <header className="od-topbar border-b border-white/10 bg-[#16191f]/80 px-4 py-2 sm:px-6 backdrop-blur-md flex flex-wrap items-center gap-3 justify-between">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <div className="w-8 h-8 rounded-lg overflow-hidden border border-white/10 bg-[#101827] flex items-center justify-center">
              <img src={brandMark} alt="HC Timeline logo" className="w-full h-full object-cover" />
            </div>
            <div className="flex min-w-0 flex-col">
              <h1 className="text-sm font-black text-white tracking-wide uppercase truncate">
                HC Timeline <span className="od-tone-primary">v1.0</span>
              </h1>
              <span className="text-[9px] text-slate-500 tracking-wider">
                {isProjectMode ? '项目管理' : `预演工作站 · ${episodeTitle}`}
              </span>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <button
              onClick={() => setViewMode((prev) => (prev === 'project' ? 'workspace' : 'project'))}
              className={`h-8 px-2 rounded-lg border text-[10px] font-black tracking-wide flex items-center gap-1.5 ${
                isProjectMode
                  ? 'od-chip-primary'
                  : 'od-btn-ghost'
              }`}
              title={isProjectMode ? '返回单集创作页面' : '打开项目管理页面'}
            >
              {isRefreshingProjects ? <Loader2 size={14} className="animate-spin" /> : <FolderKanban size={14} />}
              项目
            </button>

            <button
              onClick={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              className="od-btn-ghost h-8 w-8 rounded-lg flex items-center justify-center"
              title={themeMode === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
              aria-label={themeMode === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            >
              {themeMode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <button
              onClick={() => {
                setShowShortcuts(false);
                setRuntimeEnvNotice(null);
                setShowSettings((prev) => !prev);
              }}
              className="od-btn-ghost h-8 w-8 rounded-lg text-slate-400 flex items-center justify-center"
              title="帮助与设置"
            >
              <Settings size={15} />
            </button>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-hidden">
          {isProjectMode ? (
            projectNode
          ) : selectedShot ? (
            <StoryboardEditor
              shot={selectedShot}
              allShots={shots}
              config={config}
              episodeId={episodeId}
              onUpdatePrompts={(p) => updateShot(selectedShot.id, { matrixPrompts: p })}
              onUpdateShot={(u) => updateShot(selectedShot.id, u)}
              onGenerateImage={() => handleGenerateImage(selectedShot.id)}
              onRestoreHistory={(i) => {
                const currentShot = shots.find((sh) => sh.id === selectedShot.id);
                const historyItem = currentShot?.history?.[i];
                if (!historyItem) return;
                const restoredLayout = normalizeGridLayout(historyItem.gridLayout, currentShot?.gridLayout);
                const restoredCellCount = getGridCellCount(restoredLayout);
                updateShot(selectedShot.id, {
                  gridLayout: restoredLayout,
                  generatedImageUrl: historyItem.imageUrl,
                  splitImages: normalizeIndexedList<string>(historyItem.splitImages, restoredCellCount, ''),
                  matrixPrompts: ensurePromptListLength(historyItem.prompts, restoredLayout),
                  videoUrls: normalizeIndexedList<string | null>(historyItem.videoUrls, restoredCellCount, null),
                  videoStatus: Array(restoredCellCount).fill('idle'),
                  animaticVideoUrl: undefined,
                });
              }}
              onAddGlobalAsset={(type, name, desc) => {
                const id = `ast-${Date.now()}`;
                setConfig((prev) => ({ ...prev, [type]: [...prev[type], { id, name, description: desc || '' }] }));
              }}
              onDeleteGlobalAsset={(type, id) => {
                setConfig((prev) => ({
                  ...prev,
                  [type]: prev[type].filter((item) => item.id !== id),
                }));
              }}
              onUpdateGlobalAsset={(type, id, updates) => {
                setConfig((prev) => ({
                  ...prev,
                  [type]: prev[type].map((item) => (item.id === id ? { ...item, ...updates } : item)),
                }));
              }}
              onOptimizePrompts={handleOptimizePrompts}
              onAutoLinkAssets={handleAutoLinkAssets}
              isGeneratingPrompts={false}
              isGeneratingImage={isGeneratingImage}
              isOptimizing={isOptimizing}
              isAutoLinking={isAutoLinking}
            />
          ) : shots.length > 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-500 px-8">
              <p className="text-[11px] tracking-widest">当前未选中镜头</p>
              <button
                onClick={() => setSelectedShotId(shots[0].id)}
                className="od-btn-primary h-10 px-5 rounded-lg text-[10px] font-black tracking-widest"
              >
                选中第一个镜头
              </button>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-5 text-slate-500 px-8">
              <p className="text-[11px] tracking-widest">开始创建你的第一组分镜</p>
              <div className="max-w-xl text-center text-[11px] leading-relaxed text-slate-400">
                在左侧粘贴剧本，点击 <span className="od-tone-primary font-bold">开始解析剧本</span> 自动拆解镜头，然后在主区域生成 storyboard 板图与视频预演。
              </div>
              <button
                onClick={() => {
                  if (!isElectronRuntime) return;
                  if (script.trim()) {
                    handleBreakdown().catch((error) => {
                      console.error('Breakdown failed', error);
                    });
                  } else {
                    handleQuickStart().catch((error) => {
                      console.error('Quick start failed', error);
                    });
                  }
                }}
                disabled={!isElectronRuntime || isLoading}
                className="od-btn-primary h-10 px-5 rounded-lg text-[10px] font-black tracking-widest"
                title={quickStartDisabledReason}
              >
                一键跑通首个镜头
              </button>
              {!isElectronRuntime && (
                <p className="text-[10px] od-tone-warning text-center">
                  当前为浏览器预览模式，请使用 Electron 桌面端执行 AI 拆解与一键跑通。
                </p>
              )}
            </div>
          )}
        </main>
      </div>

      {!isProjectMode ? globalOpsNode : null}

      {notices.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[320] flex flex-col gap-2 max-w-[420px]">
          {notices.map((notice) => {
            const toneClass =
              notice.tone === 'success'
                ? 'od-chip-success'
                : notice.tone === 'error'
                  ? 'od-chip-danger'
                  : 'od-chip-primary';
            const Icon = notice.tone === 'success' ? CheckCircle2 : notice.tone === 'error' ? AlertCircle : Info;

            return (
              <div key={notice.id} className={`rounded-lg border px-3 py-2 shadow-xl ${toneClass}`} role="status" aria-live="polite">
                <div className="flex items-start gap-2">
                  <Icon size={14} className="shrink-0 mt-0.5" />
                  <p className="text-[11px] leading-relaxed flex-1">{notice.message}</p>
                  <button onClick={() => dismissNotice(notice.id)} className="text-current/70 hover:text-current">
                    <X size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showOnboarding && (
        <div className="fixed inset-0 z-[330] bg-black/75 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="od-modal-surface w-full max-w-4xl rounded-2xl border border-white/10 bg-[#121722] shadow-2xl overflow-hidden">
            <div className="h-14 px-6 border-b border-white/10 flex items-center justify-between">
              <div className="text-[11px] font-black uppercase tracking-widest text-white">首日上手引导</div>
              <button onClick={() => hideOnboarding()} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  '1. 选择一个示例模板',
                  '2. 一键拆解镜头并自动选中首镜头',
                  '3. 先生成 storyboard 脚本，再生成 storyboard 板图',
                ].map((step) => (
                  <div key={step} className="od-panel rounded-lg px-3 py-3 text-[11px] text-slate-300">
                    {step}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {SCRIPT_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => {
                      handleApplyScriptTemplate(template.id);
                    }}
                    className="od-panel-soft od-hover-primary text-left rounded-lg p-4 transition-all"
                  >
                    <div className="text-[10px] font-black uppercase tracking-widest od-tone-primary mb-2">{template.name}</div>
                    <div className="text-[11px] text-slate-300 line-clamp-4 whitespace-pre-line">{template.script}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="h-14 px-6 border-t border-white/10 bg-[#0f131d] flex items-center justify-between">
              <button
                onClick={() => hideOnboarding()}
                className="od-btn-ghost h-9 px-4 rounded-lg text-[10px] font-black uppercase tracking-widest"
              >
                稍后再说
              </button>
              <button
                onClick={() => {
                  if (!isElectronRuntime) return;
                  handleQuickStart().catch((error) => {
                    console.error('Quick start from onboarding failed', error);
                  });
                }}
                disabled={!isElectronRuntime || isLoading}
                className="od-btn-primary h-9 px-5 rounded-lg text-[10px] font-black uppercase tracking-widest"
                title={quickStartDisabledReason}
              >
                使用默认模板一键跑通
              </button>
            </div>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className="fixed inset-0 z-[310] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="od-modal-surface w-full max-w-2xl rounded-xl border border-white/10 bg-[#151922] shadow-2xl overflow-hidden">
            <div className="h-12 px-5 border-b border-white/10 flex items-center justify-between">
              <div className="text-[11px] font-black uppercase tracking-widest text-white">操作提示</div>
              <button onClick={() => setShowShortcuts(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-5 text-[11px] text-slate-300">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">快捷键</div>
                <ul className="space-y-1">
                  <li><span className="od-tone-primary font-bold">Ctrl/Cmd + Enter</span>：执行剧本解析</li>
                  <li><span className="od-tone-primary font-bold">Ctrl/Cmd + S</span>：立即保存当前单集</li>
                  <li><span className="od-tone-primary font-bold">Esc</span>：关闭当前提示面板</li>
                </ul>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">建议流程</div>
                <ul className="space-y-1">
                  <li>1. 先在左侧导入/配置资产并填写 Script。</li>
                  <li>2. 执行剧本解析后逐镜头生成 storyboard 脚本。</li>
                  <li>3. 生成 storyboard 板图后再做子机位视频生成，效率更高。</li>
                  <li>4. 每轮关键改动后保存 Episode，避免会话丢失。</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-[315] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="od-modal-surface w-full max-w-6xl max-h-[92vh] rounded-xl border border-white/10 bg-[#151922] shadow-2xl overflow-hidden flex flex-col">
            <div className="h-12 px-5 border-b border-white/10 flex items-center justify-between">
              <div className="text-[11px] font-black uppercase tracking-widest text-white">设置</div>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4 text-[11px] text-slate-300 overflow-y-auto custom-scrollbar">
              <div className="od-panel rounded-lg px-3 py-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">运行模式</div>
                <p className={isElectronRuntime ? 'od-tone-success' : 'od-tone-warning'}>
                  {isElectronRuntime ? 'Electron 桌面端' : '浏览器预览模式'}
                </p>
              </div>

              <div className="od-panel rounded-lg px-3 py-3 space-y-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">API 路由与环境变量</div>
                {isLoadingRuntimeEnv ? (
                  <div className="text-[10px] text-slate-400">读取配置中...</div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="space-y-1">
                        <div className="text-[9px] font-black tracking-widest text-slate-500 uppercase">默认路由策略</div>
                        <select
                          value={runtimeEnvDraft.apiProvider}
                          onChange={(event) => {
                            const value = event.target.value as RuntimeEnvConfig['apiProvider'];
                            setRuntimeEnvDraft((prev) => ({ ...prev, apiProvider: value }));
                            setConfig((prev) => ({ ...prev, apiProvider: value }));
                          }}
                          className="od-input w-full h-9 rounded-lg px-2 text-[10px] outline-none"
                        >
                          <option value="auto">Auto（按优先级自动降级）</option>
                          <option value="aihubmix">AIHubMix 优先</option>
                          <option value="gemini">Gemini 优先</option>
                          <option value="volcengine">火山引擎优先</option>
                        </select>
                      </label>
                      <div className="od-panel-soft rounded-lg px-3 py-2 text-[10px] text-slate-400 leading-5">
                        优先级数字越小越优先。单个服务商异常时会自动切换到下一个可用服务商；每个服务商内部会对多 API Key 进行轮转与并发分摊。
                      </div>
                    </div>

                    {(['aihubmix', 'gemini', 'volcengine'] as const).map((providerId) => {
                      const provider = runtimeEnvDraft.providers[providerId];
                      const meta = PROVIDER_UI_META[providerId];
                      return (
                        <div key={providerId} className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-[10px] font-black uppercase tracking-widest text-slate-200">
                                {meta.title}
                              </div>
                              <div className="text-[10px] text-slate-500 mt-1">{meta.hint}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1.5 text-[10px] text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={provider.enabled}
                                  onChange={(event) => updateRuntimeProvider(providerId, { enabled: event.target.checked })}
                                  className="w-3.5 h-3.5 accent-indigo-500"
                                />
                                启用
                              </label>
                              <label className="flex items-center gap-1.5 text-[10px] text-slate-300">
                                优先级
                                <input
                                  type="number"
                                  min={1}
                                  value={provider.priority}
                                  onChange={(event) => {
                                    const next = Number(event.target.value);
                                    updateRuntimeProvider(providerId, {
                                      priority: Number.isFinite(next) && next > 0 ? Math.round(next) : 1,
                                    });
                                  }}
                                  className="od-input w-16 h-7 rounded-md px-2 text-[10px] outline-none"
                                />
                              </label>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="space-y-1">
                              <div className="text-[9px] font-black tracking-widest text-slate-500 uppercase">
                                API Keys（逗号/换行分隔）
                              </div>
                              <textarea
                                value={provider.apiKeys.join('\n')}
                                onChange={(event) =>
                                  updateRuntimeProvider(providerId, { apiKeys: parseListInput(event.target.value) })
                                }
                                rows={3}
                                placeholder="key_1&#10;key_2"
                                className="od-input w-full rounded-lg px-2 py-2 text-[10px] outline-none placeholder:text-slate-600"
                              />
                            </label>
                            <div className="grid grid-cols-1 gap-3">
                              <label className="space-y-1">
                                <div className="text-[9px] font-black tracking-widest text-slate-500 uppercase">Gemini Base URL</div>
                                <input
                                  value={provider.geminiBaseUrl || ''}
                                  onChange={(event) => updateRuntimeProvider(providerId, { geminiBaseUrl: event.target.value })}
                                  placeholder="https://..."
                                  className="od-input w-full h-9 rounded-lg px-2 text-[10px] outline-none placeholder:text-slate-600"
                                />
                              </label>
                              <label className="space-y-1">
                                <div className="text-[9px] font-black tracking-widest text-slate-500 uppercase">OpenAI Base URL</div>
                                <input
                                  value={provider.openaiBaseUrl || ''}
                                  onChange={(event) => updateRuntimeProvider(providerId, { openaiBaseUrl: event.target.value })}
                                  placeholder="https://..."
                                  className="od-input w-full h-9 rounded-lg px-2 text-[10px] outline-none placeholder:text-slate-600"
                                />
                              </label>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {CAPABILITY_META.map((capability) => (
                              <label key={`${providerId}-${capability.key}`} className="space-y-1">
                                <div className="text-[9px] font-black tracking-widest text-slate-500 uppercase">
                                  {capability.label}
                                </div>
                                <input
                                  value={provider.models[capability.key].join(', ')}
                                  onChange={(event) => updateRuntimeProviderModels(providerId, capability.key, event.target.value)}
                                  placeholder="model-a, model-b"
                                  className="od-input w-full h-9 rounded-lg px-2 text-[10px] outline-none placeholder:text-slate-600"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] text-slate-400">
                        保存后将立即更新进程环境。任务调用会按优先级自动降级，并在同服务商内按 Key 轮转分配负载。
                      </p>
                      <button
                        onClick={() => {
                          handleSaveRuntimeEnv().catch((error) => {
                            console.error('Save runtime env failed', error);
                          });
                        }}
                        disabled={isSavingRuntimeEnv}
                        className="od-btn-primary h-9 px-4 rounded-lg text-[10px] font-black uppercase tracking-widest"
                      >
                        {isSavingRuntimeEnv ? '保存中...' : '保存路由配置'}
                      </button>
                    </div>

                    {runtimeEnvNotice ? <p className="text-[10px] od-tone-warning">{runtimeEnvNotice}</p> : null}
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    setShowSettings(false);
                    setShowOnboarding(true);
                  }}
                  className="od-btn-ghost h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                >
                  打开首日引导
                </button>
                <button
                  onClick={() => {
                    setShowSettings(false);
                    setShowShortcuts(true);
                  }}
                  className="od-btn-ghost h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                >
                  打开快捷键说明
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
