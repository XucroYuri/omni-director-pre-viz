import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Sidebar from './components/Sidebar';
import MatrixPromptEditor from './components/MatrixPromptEditor';
import GlobalOpsPanel from './components/GlobalOpsPanel';
import { DBTask, GlobalConfig, Shot, ScriptBreakdownResponse } from '@shared/types';
import { DEFAULT_STYLE } from '@shared/constants';
import { AlertCircle, BookOpenText, CheckCircle2, Cpu, Info, Keyboard, PanelLeft, PanelRight, Settings, X } from 'lucide-react';
import { breakdownScript } from './services/geminiService';

const STORAGE_KEYS = {
  CONFIG: 'OMNI_DIRECTOR_CONFIG',
  SCRIPT: 'OMNI_DIRECTOR_SCRIPT',
  BREAKDOWN: 'OMNI_DIRECTOR_BREAKDOWN',
  SELECTED_SHOT_ID: 'OMNI_DIRECTOR_SELECTED_ID',
  EPISODE_ID: 'OMNI_DIRECTOR_EPISODE_ID',
  ONBOARDING_DISMISSED: 'OMNI_DIRECTOR_ONBOARDING_DISMISSED',
};

type ApiStatus = 'connected' | 'error' | 'idle';
type NoticeTone = 'success' | 'error' | 'info';
type ScriptTemplate = { id: string; name: string; script: string };

type UiNotice = {
  id: string;
  tone: NoticeTone;
  message: string;
};

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const App: React.FC = () => {
  const isElectronRuntime = Boolean(window.api?.app);

  const [config, setConfig] = useState<GlobalConfig>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CONFIG);
    const parsed = safeJsonParse<GlobalConfig | null>(saved, null);
    if (parsed) {
      return {
        ...parsed,
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
      apiProvider: 'aihubmix',
    };
  });

  const [script, setScript] = useState(() => localStorage.getItem(STORAGE_KEYS.SCRIPT) || '');
  const [breakdown, setBreakdown] = useState<ScriptBreakdownResponse | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.BREAKDOWN);
    const parsed = safeJsonParse<ScriptBreakdownResponse | null>(saved, null);
    if (!parsed) return null;
    return {
      ...parsed,
      shots: (parsed.shots || []).map((shot) => ({
        ...shot,
        generatedImageUrl: stripDataUri(shot.generatedImageUrl),
        splitImages: shot.splitImages?.map((img) => stripDataUri(img)).filter(isNonEmptyString),
        videoUrls: shot.videoUrls?.map((url) => stripDataUri(url) ?? null),
        animaticVideoUrl: stripDataUri(shot.animaticVideoUrl),
        assetVideoUrl: stripDataUri(shot.assetVideoUrl),
        history: undefined,
      })),
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

  const [isLoading, setIsLoading] = useState(false);
  const [isSavingEpisode, setIsSavingEpisode] = useState(false);
  const [isLoadingEpisode, setIsLoadingEpisode] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [createZip, setCreateZip] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isAutoLinking, setIsAutoLinking] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('idle');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLeftDrawer, setShowLeftDrawer] = useState(false);
  const [showRightDrawer, setShowRightDrawer] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1536 : true,
  );
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [notices, setNotices] = useState<UiNotice[]>([]);

  const isReloadingRef = useRef(false);
  const hasInitializedOnboardingRef = useRef(false);
  const noticeTimersRef = useRef<Map<string, number>>(new Map());
  const persistTimers = useRef<{ config?: number; script?: number; breakdown?: number; selected?: number }>({});

  const shots = breakdown?.shots || [];
  const selectedShot = useMemo(
    () => shots.find((shot) => shot.id === selectedShotId) || null,
    [shots, selectedShotId],
  );

  const statusMeta: Record<ApiStatus, { text: string; dot: string; textTone: string }> = {
    connected: {
      text: '服务正常',
      dot: 'bg-emerald-500',
      textTone: 'text-emerald-300',
    },
    error: {
      text: '需要处理',
      dot: 'bg-red-500',
      textTone: 'text-red-300',
    },
    idle: {
      text: '待机',
      dot: 'bg-slate-500',
      textTone: 'text-slate-300',
    },
  };

  const normalizePolicyError = (message: string) => {
    if (!message) return message;
    if (!message.includes('POLICY_VIOLATION')) return message;
    if (message.includes('Missing Scene')) return '生成失败：请先绑定场景。';
    if (message.includes('Missing Character')) return '生成失败：请先绑定角色，或将镜头标记为 ENV 纯环境。';
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
    };
  }, []);

  useEffect(() => {
    if (hasInitializedOnboardingRef.current) return;
    hasInitializedOnboardingRef.current = true;
    const dismissed = localStorage.getItem(STORAGE_KEYS.ONBOARDING_DISMISSED) === '1';
    if (!dismissed && !script.trim() && shots.length === 0) {
      setShowOnboarding(true);
    }
  }, [script, shots.length]);

  useEffect(() => {
    const onResize = () => {
      setIsWideLayout(window.innerWidth >= 1536);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    if (isWideLayout) {
      setShowLeftDrawer(false);
      setShowRightDrawer(false);
    }
  }, [isWideLayout]);

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
      shots: breakdown.shots.map((shot) => ({
        ...shot,
        generatedImageUrl: stripDataUri(shot.generatedImageUrl),
        splitImages: shot.splitImages?.map((img) => stripDataUri(img)).filter(isNonEmptyString),
        videoUrls: shot.videoUrls?.map((url) => stripDataUri(url) ?? null),
        animaticVideoUrl: stripDataUri(shot.animaticVideoUrl),
        assetVideoUrl: stripDataUri(shot.assetVideoUrl),
        history: undefined,
      })),
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
    if (shots.length === 0) {
      if (selectedShotId !== null) setSelectedShotId(null);
      return;
    }
    if (!selectedShotId || !selectedShot) {
      setSelectedShotId(shots[0].id);
    }
  }, [shots, selectedShot, selectedShotId]);

  const updateShot = (id: string, updates: Partial<Shot>) => {
    setBreakdown((prev) => {
      if (!prev) return null;
      return { ...prev, shots: prev.shots.map((s) => (s.id === id ? { ...s, ...updates } : s)) };
    });
  };

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

        const taskShot = {
          id: shot.id,
          originalText: shot.originalText,
          visualTranslation: shot.visualTranslation,
          contextTag: shot.contextTag,
          shotKind: shot.shotKind,
          matrixPrompts: shot.matrixPrompts,
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
        const message = typeof error?.message === 'string' ? error.message : 'Unknown error';
        pushNotice('error', normalizePolicyError(message));
        setApiStatus('error');
      } finally {
        setIsGeneratingImage(false);
      }
    },
    [config, episodeId, isGeneratingImage, pushNotice, shots],
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
        setBreakdown(result);
        if (result.shots.length > 0) {
          setSelectedShotId(result.shots[0].id);
        }
        setApiStatus('connected');
        pushNotice('success', `${sourceLabel}拆解完成：共生成 ${result.shots.length} 个镜头。`);
        return true;
      } catch (error: any) {
        pushNotice('error', error?.message || '脚本拆解失败，请稍后重试。');
        setApiStatus('error');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [config, pushNotice],
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
        pushNotice('info', '下一步：点击「初始化矩阵」后再渲染母图。');
      }
    },
    [hideOnboarding, pushNotice, runBreakdownForScript],
  );

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

  const handleSaveEpisode = useCallback(async () => {
    if (isSavingEpisode) return;
    if (!window.api?.app?.db) {
      pushNotice('error', '数据库读写仅在 Electron 桌面端可用。');
      return;
    }

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

    setIsSavingEpisode(true);
    try {
      await window.api.app.db.saveEpisode(data);
      pushNotice('success', `Episode ${episodeId} 已保存。`);
      setApiStatus('connected');
    } catch (error: any) {
      pushNotice('error', `保存失败：${error?.message || error}`);
      setApiStatus('error');
    } finally {
      setIsSavingEpisode(false);
    }
  }, [config, episodeId, isSavingEpisode, pushNotice, shots]);

  const reloadEpisode = useCallback(
    async (options?: { notify?: boolean; markBusy?: boolean }) => {
      const { notify = false, markBusy = false } = options || {};

      if (!window.api?.app?.db) {
        if (notify) pushNotice('error', '数据库读写仅在 Electron 桌面端可用。');
        return;
      }

      if (markBusy) {
        setIsLoadingEpisode(true);
      }

      try {
        const data = await window.api.app.db.loadEpisode(episodeId);
        if (!data) {
          if (notify) pushNotice('info', `未找到 Episode：${episodeId}`);
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
        if (notify) pushNotice('success', `Episode ${episodeId} 已加载。`);
      } catch (error: any) {
        if (notify) pushNotice('error', `读取失败：${error?.message || error}`);
        setApiStatus('error');
      } finally {
        if (markBusy) {
          setIsLoadingEpisode(false);
        }
      }
    },
    [episodeId, pushNotice],
  );

  const handleLoadEpisode = useCallback(async () => {
    await reloadEpisode({ notify: true, markBusy: true });
  }, [reloadEpisode]);

  useEffect(() => {
    const taskApi = window.api?.app?.task;
    if (!taskApi?.onUpdate || !taskApi?.offUpdate) return () => {};

    const handleUpdate = (task: DBTask) => {
      if (task.status !== 'completed') return;
      if (task.episode_id !== episodeId) return;
      if (isReloadingRef.current) return;
      isReloadingRef.current = true;
      reloadEpisode()
        .catch((err) => console.error('Episode reload failed', err))
        .finally(() => {
          isReloadingRef.current = false;
        });
    };

    taskApi.onUpdate(handleUpdate);
    return () => taskApi.offUpdate(handleUpdate);
  }, [episodeId, reloadEpisode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true;
      const isPrimary = event.metaKey || event.ctrlKey;

      if (event.key === 'Escape') {
        setShowShortcuts(false);
        setShowSettings(false);
        setShowLeftDrawer(false);
        setShowRightDrawer(false);
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
    ? '一键跑通依赖 AI 拆解能力，仅在 Electron 桌面端可用。'
    : '';

  const sidebarNode = (
    <Sidebar
      config={config}
      setConfig={setConfig}
      shots={shots}
      selectedShotId={selectedShotId}
      setSelectedShotId={(id) => {
        setSelectedShotId(id);
        if (!isWideLayout) setShowLeftDrawer(false);
      }}
      isLoading={isLoading}
      script={script}
      setScript={setScript}
      handleBreakdown={handleBreakdown}
      episodeId={episodeId}
      isElectronRuntime={isElectronRuntime}
      notify={pushNotice}
    />
  );

  const globalOpsNode = (
    <GlobalOpsPanel
      shots={shots}
      episodeId={episodeId}
      setEpisodeId={setEpisodeId}
      onSaveEpisode={handleSaveEpisode}
      onLoadEpisode={handleLoadEpisode}
      onExportEpisode={handleExportEpisode}
      isSavingEpisode={isSavingEpisode}
      isLoadingEpisode={isLoadingEpisode}
      isExporting={isExporting}
      createZip={createZip}
      setCreateZip={setCreateZip}
      isElectronRuntime={isElectronRuntime}
    />
  );

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-[#0f1115] text-slate-300 font-sans">
      {isWideLayout ? sidebarNode : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {!isElectronRuntime && (
          <div className="min-h-10 border-b border-amber-400/20 bg-amber-500/10 px-4 py-2 sm:px-6 flex flex-wrap items-center gap-2 justify-between">
            <div className="flex items-center gap-2 text-amber-200 text-[10px] font-bold uppercase tracking-widest">
              <Info size={12} /> 浏览器预览模式
            </div>
            <span className="text-[10px] text-amber-200/80 leading-relaxed">
              任务队列、数据库和导出功能在 Electron 桌面端生效。
            </span>
          </div>
        )}

        <header className="border-b border-white/10 bg-[#16191f]/80 px-4 py-2 sm:px-6 backdrop-blur-md flex flex-wrap items-center gap-3 justify-between">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            {!isWideLayout && (
              <button
                onClick={() => {
                  setShowRightDrawer(false);
                  setShowLeftDrawer((prev) => !prev);
                }}
                className="h-8 px-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 text-[10px] font-black tracking-wide flex items-center gap-1.5"
                title="打开脚本与资产面板"
              >
                <PanelLeft size={14} />
                资产
              </button>
            )}
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Cpu size={18} className="text-white" />
            </div>
            <div className="flex min-w-0 flex-col">
              <h1 className="text-sm font-black text-white tracking-wide uppercase truncate">
                Omni Director <span className="text-indigo-500">v5.0</span>
              </h1>
              <span className="text-[9px] text-slate-500 tracking-wider">预演工作站</span>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
              <span className={`w-2 h-2 rounded-full ${statusMeta[apiStatus].dot}`} />
              <span className={`text-[9px] font-black uppercase tracking-widest ${statusMeta[apiStatus].textTone}`}>
                {statusMeta[apiStatus].text}
              </span>
            </div>

            {!isWideLayout && (
              <button
                onClick={() => {
                  setShowLeftDrawer(false);
                  setShowRightDrawer((prev) => !prev);
                }}
                className="h-8 px-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 text-[10px] font-black tracking-wide flex items-center gap-1.5"
                title="打开导出与任务面板"
              >
                <PanelRight size={14} />
                任务
              </button>
            )}

            <button
              onClick={() => setShowOnboarding(true)}
              className="h-8 px-3 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 text-[10px] font-black tracking-wide flex items-center gap-2"
              title="重新打开首日上手引导"
            >
              <BookOpenText size={14} />
              引导
            </button>

            <button
              onClick={() => {
                setShowSettings(false);
                setShowShortcuts((prev) => !prev);
              }}
              className="h-8 px-3 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 text-[10px] font-black tracking-wide flex items-center gap-2"
              title="快捷键与工作流提示"
            >
              <Keyboard size={14} />
              快捷键
            </button>

            <button
              onClick={() => {
                setShowShortcuts(false);
                setShowSettings((prev) => !prev);
              }}
              className="h-8 w-8 rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center"
              title="帮助与设置"
            >
              <Settings size={15} />
            </button>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-hidden">
          {selectedShot ? (
            <MatrixPromptEditor
              shot={selectedShot}
              allShots={shots}
              config={config}
              episodeId={episodeId}
              onUpdateConfig={(updates) => setConfig((prev) => ({ ...prev, ...updates }))}
              onUpdatePrompts={(p) => updateShot(selectedShot.id, { matrixPrompts: p })}
              onUpdateShot={(u) => updateShot(selectedShot.id, u)}
              onGenerateImage={() => handleGenerateImage(selectedShot.id)}
              onRestoreHistory={(i) => {
                const currentShot = shots.find((sh) => sh.id === selectedShot.id);
                const historyItem = currentShot?.history?.[i];
                if (!historyItem) return;
                updateShot(selectedShot.id, {
                  generatedImageUrl: historyItem.imageUrl,
                  splitImages: historyItem.splitImages,
                  matrixPrompts: [...historyItem.prompts],
                });
              }}
              onAddGlobalAsset={(type, name, desc) => {
                const id = `ast-${Date.now()}`;
                setConfig((prev) => ({ ...prev, [type]: [...prev[type], { id, name, description: desc || '' }] }));
              }}
              onDeleteGlobalAsset={() => {}}
              onUpdateGlobalAsset={() => {}}
              onOptimizePrompts={async () => {}}
              onAutoLinkAssets={async () => {}}
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
                className="h-10 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black tracking-widest"
              >
                选中第一个镜头
              </button>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-5 text-slate-500 px-8">
              <p className="text-[11px] tracking-widest">开始创建你的第一组分镜</p>
              <div className="max-w-xl text-center text-[11px] leading-relaxed text-slate-400">
                在左侧粘贴剧本，点击 <span className="text-indigo-300 font-bold">拆解脚本</span> 自动拆解镜头，然后在主区域生成矩阵母图与视频预演。
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
                className="h-10 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black tracking-widest disabled:opacity-40 disabled:hover:bg-indigo-600"
                title={quickStartDisabledReason}
              >
                一键跑通首个镜头
              </button>
              {!isElectronRuntime && (
                <p className="text-[10px] text-amber-300 text-center">
                  当前为浏览器预览模式，请使用 Electron 桌面端执行 AI 拆解与一键跑通。
                </p>
              )}
            </div>
          )}
        </main>
      </div>

      {isWideLayout ? globalOpsNode : null}

      {!isWideLayout && showLeftDrawer && (
        <div className="fixed inset-0 z-[250] flex">
          <button
            aria-label="关闭左侧面板"
            className="absolute inset-0 bg-black/65"
            onClick={() => setShowLeftDrawer(false)}
          />
          <div className="relative h-full w-[min(20rem,92vw)]">{sidebarNode}</div>
        </div>
      )}

      {!isWideLayout && showRightDrawer && (
        <div className="fixed inset-0 z-[250] flex justify-end">
          <button
            aria-label="关闭右侧面板"
            className="absolute inset-0 bg-black/65"
            onClick={() => setShowRightDrawer(false)}
          />
          <div className="relative h-full w-[min(20rem,92vw)]">{globalOpsNode}</div>
        </div>
      )}

      {notices.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[320] flex flex-col gap-2 max-w-[420px]">
          {notices.map((notice) => {
            const toneClass =
              notice.tone === 'success'
                ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                : notice.tone === 'error'
                  ? 'border-red-400/40 bg-red-500/15 text-red-100'
                  : 'border-indigo-400/40 bg-indigo-500/15 text-indigo-100';
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
          <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-[#121722] shadow-2xl overflow-hidden">
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
                  '3. 初始化矩阵 Prompt 后渲染母图',
                ].map((step) => (
                  <div key={step} className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-[11px] text-slate-300">
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
                    className="text-left rounded-lg border border-white/10 bg-black/30 p-4 hover:border-indigo-400/40 hover:bg-indigo-500/10 transition-all"
                  >
                    <div className="text-[10px] font-black uppercase tracking-widest text-indigo-300 mb-2">{template.name}</div>
                    <div className="text-[11px] text-slate-300 line-clamp-4 whitespace-pre-line">{template.script}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="h-14 px-6 border-t border-white/10 bg-[#0f131d] flex items-center justify-between">
              <button
                onClick={() => hideOnboarding()}
                className="h-9 px-4 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 text-[10px] font-black uppercase tracking-widest"
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
                className="h-9 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40 disabled:hover:bg-indigo-600"
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
          <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#151922] shadow-2xl overflow-hidden">
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
                  <li><span className="text-indigo-300 font-bold">Ctrl/Cmd + Enter</span>：执行脚本拆解</li>
                  <li><span className="text-indigo-300 font-bold">Ctrl/Cmd + S</span>：保存当前 Episode 到数据库</li>
                  <li><span className="text-indigo-300 font-bold">Esc</span>：关闭当前提示面板</li>
                </ul>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">建议流程</div>
                <ul className="space-y-1">
                  <li>1. 先在左侧导入/配置资产并填写 Script。</li>
                  <li>2. 执行脚本拆解后逐镜头初始化矩阵 Prompt。</li>
                  <li>3. 渲染母图后再做子机位视频生成，效率更高。</li>
                  <li>4. 每轮关键改动后保存 Episode，避免会话丢失。</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-[315] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-xl border border-white/10 bg-[#151922] shadow-2xl overflow-hidden">
            <div className="h-12 px-5 border-b border-white/10 flex items-center justify-between">
              <div className="text-[11px] font-black uppercase tracking-widest text-white">设置</div>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4 text-[11px] text-slate-300">
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">运行模式</div>
                <p className={isElectronRuntime ? 'text-emerald-300' : 'text-amber-300'}>
                  {isElectronRuntime ? 'Electron 桌面端' : '浏览器预览模式'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    setShowSettings(false);
                    setShowOnboarding(true);
                  }}
                  className="h-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest"
                >
                  打开首日引导
                </button>
                <button
                  onClick={() => {
                    setShowSettings(false);
                    setShowShortcuts(true);
                  }}
                  className="h-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest"
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
