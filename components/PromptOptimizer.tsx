
import React from 'react';
import { Shot, PromptOptimization } from '../types';
import { 
  X, Wand2, Loader2, MessageSquare, 
  Sparkles, CheckCircle, RefreshCw, Check,
  Monitor
} from 'lucide-react';

interface PromptOptimizerProps {
  shot: Shot;
  isOptimizing: boolean;
  onOptimize: () => void;
  onApply: (optimizedPrompts: string[]) => void;
  onClose: () => void;
}

const PromptOptimizer: React.FC<PromptOptimizerProps> = ({
  shot, isOptimizing, onOptimize, onApply, onClose
}) => {
  const optimization = shot.optimization;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[150] flex items-center justify-center p-6 animate-in fade-in">
      <div className="bg-[#16191f] border border-white/10 rounded-xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* 标题栏 */}
        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#0f1115]">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-indigo-500/10 rounded flex items-center justify-center text-indigo-400">
              <Wand2 size={20} />
            </div>
            <div>
              <h2 className="font-bold text-sm text-white uppercase tracking-widest">
                AI 镜头优化审计 <span className="text-slate-600">镜头: S_{shot.id.substring(0, 4)}</span>
              </h2>
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                视觉一致性与语义对齐深度分析
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-white transition-all"><X size={24} /></button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
          {isOptimizing ? (
            <div className="py-20 flex flex-col items-center justify-center space-y-4">
              <Loader2 size={32} className="text-indigo-400 animate-spin" />
              <div className="text-center">
                <p className="text-indigo-400 text-[10px] font-bold uppercase tracking-widest">正在扫描电影元数据...</p>
                <p className="text-slate-600 text-[9px] font-bold uppercase tracking-widest">正在评估 3x3 矩阵一致性...</p>
              </div>
            </div>
          ) : optimization ? (
            <div className="space-y-8 animate-in slide-in-from-bottom-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <section className="bg-[#0f1115] p-5 rounded border border-white/5">
                  <h4 className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <MessageSquare size={12} /> AI 导演点评
                  </h4>
                  <p className="text-slate-300 text-[11px] leading-relaxed italic">"{optimization.critique}"</p>
                </section>

                <section className="bg-[#0f1115] p-5 rounded border border-white/5">
                  <h4 className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Sparkles size={12} /> 改进建议
                  </h4>
                  <ul className="space-y-2">
                    {optimization.suggestions.map((s, idx) => (
                      <li key={idx} className="flex gap-2 items-start text-[11px] text-slate-400">
                        <span className="text-emerald-500 font-bold">•</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <section className="bg-black/20 p-6 rounded border border-white/5">
                <div className="flex items-center justify-between mb-6">
                  <h4 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <CheckCircle size={12} /> 优化后的提示词矩阵
                  </h4>
                  <div className="flex gap-2">
                    <button 
                      onClick={onOptimize}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded text-[9px] font-bold uppercase transition-all"
                    >
                      <RefreshCw size={12} /> 重新审计
                    </button>
                    <button 
                      onClick={() => onApply(optimization.optimizedPrompts)}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[9px] font-bold uppercase transition-all shadow-lg"
                    >
                      <Check size={14} /> 应用优化建议
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  {optimization.optimizedPrompts.map((p, i) => (
                    <div key={i} className="flex gap-3 items-center p-2 bg-[#1c2027] rounded border border-white/5 group hover:border-indigo-500/20">
                      <span className="text-[8px] font-mono text-slate-600 w-8 shrink-0">#{i + 1}</span>
                      <p className="text-[10px] font-mono text-slate-400 truncate flex-1">{p}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="text-center py-16 space-y-6">
              <div className="w-16 h-16 bg-slate-800/20 rounded-full flex items-center justify-center mx-auto">
                <Monitor size={32} className="text-slate-800" />
              </div>
              <div className="max-w-xs mx-auto">
                <h3 className="text-white font-bold text-sm uppercase tracking-widest mb-2">初始化视觉审计</h3>
                <p className="text-slate-500 text-[10px] leading-relaxed uppercase tracking-widest">
                  AI 将分析剧本上下文、资产一致性以及跨机位的灯光参数。
                </p>
              </div>
              <button 
                onClick={onOptimize}
                className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold uppercase tracking-widest transition-all shadow-xl flex items-center gap-2 mx-auto"
              >
                <Sparkles size={16} /> 开始深度审计
              </button>
            </div>
          )}
        </div>

        {/* 页脚 */}
        <div className="px-6 py-4 bg-[#0f1115] border-t border-white/5 flex items-center justify-between">
           <p className="text-[9px] font-bold text-slate-700 uppercase tracking-widest">Gemini 神经处理引擎 v3.0</p>
           {optimization && <span className="text-[9px] font-bold text-emerald-500 uppercase">验证通过 - 视觉一致性增强已就绪</span>}
        </div>
      </div>
    </div>
  );
};

export default PromptOptimizer;
