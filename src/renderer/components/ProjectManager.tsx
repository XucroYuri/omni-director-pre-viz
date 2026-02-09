import React, { useMemo, useState } from 'react';
import type { EpisodeSummary, ProjectSummary } from '@shared/types';
import { BookOpenText, FolderKanban, Loader2, Plus, Sparkles } from 'lucide-react';

interface ProjectManagerProps {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  isElectronRuntime: boolean;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (name: string, description?: string) => Promise<void>;
  onCreateEpisode: (projectId: string, title?: string) => Promise<void>;
  onOpenEpisode: (episode: EpisodeSummary) => Promise<void> | void;
}

const ProjectManager: React.FC<ProjectManagerProps> = ({
  projects,
  selectedProjectId,
  isElectronRuntime,
  onSelectProject,
  onCreateProject,
  onCreateEpisode,
  onOpenEpisode,
}) => {
  const [projectName, setProjectName] = useState('');
  const [projectDesc, setProjectDesc] = useState('');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isCreatingEpisode, setIsCreatingEpisode] = useState(false);
  const [openingEpisodeId, setOpeningEpisodeId] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((item) => item.projectId === selectedProjectId) || projects[0],
    [projects, selectedProjectId],
  );

  const handleCreateProject = async () => {
    if (!projectName.trim()) return;
    setIsCreatingProject(true);
    try {
      await onCreateProject(projectName.trim(), projectDesc.trim() || undefined);
      setProjectName('');
      setProjectDesc('');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleCreateEpisode = async () => {
    if (!selectedProject) return;
    setIsCreatingEpisode(true);
    try {
      await onCreateEpisode(selectedProject.projectId, episodeTitle.trim() || undefined);
      setEpisodeTitle('');
    } finally {
      setIsCreatingEpisode(false);
    }
  };

  return (
    <div className="od-page h-full p-4 sm:p-6 bg-[#0d0f13] overflow-auto">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <header className="od-card rounded-2xl border border-white/10 bg-[#16191f] p-5 sm:p-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] od-tone-primary font-black">Project</div>
            <h2 className="mt-1 text-xl sm:text-2xl font-black text-white">项目与单集管理</h2>
            <p className="mt-2 text-[12px] text-slate-400 max-w-3xl">
              项目（Project）下管理多集（Episode），点击单集可进入当前分镜创作工作区。
            </p>
          </div>
          {!isElectronRuntime && (
            <div className="od-alert-warning rounded-lg px-3 py-2 text-[11px]">
              浏览器预览模式仅展示界面；项目与单集数据写入需在 Electron 桌面端执行。
            </div>
          )}
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
          <aside className="od-card rounded-2xl border border-white/10 bg-[#16191f] min-h-[620px] flex flex-col">
            <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between">
              <span className="text-[10px] font-black tracking-widest text-slate-300 uppercase">项目列表</span>
              <FolderKanban size={14} className="od-tone-primary" />
            </div>

            <div className="px-4 py-3 border-b border-white/10 space-y-2">
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="新项目名称"
                className="od-input w-full h-9 rounded-lg px-3 text-[11px] outline-none"
              />
              <input
                value={projectDesc}
                onChange={(event) => setProjectDesc(event.target.value)}
                placeholder="项目说明（可选）"
                className="od-input w-full h-9 rounded-lg px-3 text-[11px] outline-none"
              />
              <button
                onClick={handleCreateProject}
                disabled={!isElectronRuntime || isCreatingProject || !projectName.trim()}
                className="od-btn-primary w-full h-9 rounded-lg text-[10px] font-black tracking-widest flex items-center justify-center gap-2"
              >
                {isCreatingProject ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                新建项目
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-2">
              {projects.length === 0 ? (
                <div className="h-28 rounded-lg border border-dashed border-white/10 flex items-center justify-center text-[11px] text-slate-500">
                  还没有项目，先创建一个
                </div>
              ) : (
                projects.map((project) => {
                  const active = project.projectId === selectedProject?.projectId;
                  return (
                    <button
                      key={project.projectId}
                      onClick={() => onSelectProject(project.projectId)}
                      className={`w-full text-left rounded-xl border p-3 transition-all ${
                        active
                          ? 'od-chip-primary'
                          : 'border-white/10 bg-black/20 hover:border-white/20'
                      }`}
                    >
                      <div className="text-[11px] font-black text-white">{project.name}</div>
                      <div className="mt-1 text-[10px] text-slate-400 line-clamp-2">
                        {project.description || '暂无项目描述'}
                      </div>
                      <div className="mt-2 text-[10px] text-slate-500">单集数：{project.episodes.length}</div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="od-card rounded-2xl border border-white/10 bg-[#16191f] min-h-[620px] flex flex-col">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black tracking-widest text-slate-400 uppercase">Episode</div>
                <div className="text-[14px] text-white font-black">{selectedProject?.name || '未选择项目'}</div>
              </div>
              <Sparkles size={14} className="od-tone-primary" />
            </div>

            <div className="px-5 py-3 border-b border-white/10 flex flex-wrap gap-2">
              <input
                value={episodeTitle}
                onChange={(event) => setEpisodeTitle(event.target.value)}
                placeholder="新单集标题（可选）"
                className="od-input flex-1 min-w-[220px] h-9 rounded-lg px-3 text-[11px] outline-none"
              />
              <button
                onClick={handleCreateEpisode}
                disabled={!isElectronRuntime || !selectedProject || isCreatingEpisode}
                className="od-btn-primary h-9 px-4 rounded-lg text-[10px] font-black tracking-widest flex items-center gap-2"
              >
                {isCreatingEpisode ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                新建单集
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
              {!selectedProject ? (
                <div className="h-28 rounded-lg border border-dashed border-white/10 flex items-center justify-center text-[11px] text-slate-500">
                  请选择左侧项目
                </div>
              ) : selectedProject.episodes.length === 0 ? (
                <div className="h-28 rounded-lg border border-dashed border-white/10 flex items-center justify-center text-[11px] text-slate-500">
                  当前项目暂无单集，点击上方按钮创建
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedProject.episodes.map((episode) => (
                    <div
                      key={episode.episodeId}
                      className="rounded-xl border border-white/10 bg-black/20 p-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="od-chip-primary inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-black">
                            第 {episode.episodeNo} 集
                          </span>
                          <span className="text-[12px] font-bold text-white truncate">{episode.title}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500 flex items-center gap-2">
                          <BookOpenText size={11} />
                          镜头数：{episode.shotCount}
                          <span>·</span>
                          更新：{new Date(episode.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          setOpeningEpisodeId(episode.episodeId);
                          try {
                            await onOpenEpisode(episode);
                          } finally {
                            setOpeningEpisodeId(null);
                          }
                        }}
                        className="od-btn-ghost h-8 px-3 rounded-lg text-[10px] font-black tracking-widest"
                        disabled={!isElectronRuntime || openingEpisodeId === episode.episodeId}
                      >
                        {openingEpisodeId === episode.episodeId ? '进入中...' : '进入创作'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default ProjectManager;
