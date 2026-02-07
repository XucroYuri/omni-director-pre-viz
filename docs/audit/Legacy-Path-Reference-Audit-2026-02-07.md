# 历史路径引用审计报告（2026-02-07）

## 目标
对历史文档内部的旧路径引用做自动化检视，输出待修列表，避免误导链接。

## 扫描规则
旧路径关键词：
- `dev/Plan-Codex.md`
- `dev/Guardrails.md`
- `dev/Consensus-Lock.md`
- `dev/Plan-Electron-Standalone.md`
- `dev/Phase9-Web-Migration-Plan.md`
- `dev/Phase9-2-Worker-Kickoff.md`
- `dev/Phase9-Web-First-RFC.md`

扫描范围：
1. `dev/**/*.md`
2. `docs/**/*.md` + `README.md` + `rules.md`

## 审计结果

### A. `dev/**/*.md`
- 命中总数：`33`
- 命中分布：
  - `REFERENCE`: 20
  - `SUPERSEDED`: 6
  - `ARCHIVED`: 7

结论：
- 命中全部位于历史文档（`REFERENCE/SUPERSEDED/ARCHIVED`），且已通过文档头部“历史说明”降权，不构成当前实施误导。

### B. `docs/**/*.md` + `README.md` + `rules.md`
- 命中总数：`13`
- 命中文件：
  - `docs/audit/Legacy-Docs-Ledger.md`（台账映射，预期）
  - `docs/audit/Dev-Status-Frontmatter-Report-2026-02-07.md`（审计报告，预期）
  - `docs/roadmap/Phase9-Execution-Detail.md`（历史来源说明，预期）

结论：
- 命中均为“审计/溯源”用途，无错误权威指向。

## 待修列表

### 高优先级
- 无。

### 中优先级
- 无。

### 低优先级（可选）
1. 对历史文档中的旧路径引用增加“历史来源”统一前缀（例如 `[历史来源]`），提升可读性一致性。

## 复检命令
```bash
node -e 'const fs=require("fs"),path=require("path");const legacy=["dev/Plan-Codex.md","dev/Guardrails.md","dev/Consensus-Lock.md","dev/Plan-Electron-Standalone.md","dev/Phase9-Web-Migration-Plan.md","dev/Phase9-2-Worker-Kickoff.md","dev/Phase9-Web-First-RFC.md"];function w(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=path.join(d,e.name);return e.isDirectory()?w(p):e.isFile()&&p.endsWith(".md")?[p]:[]})};const files=[...w("dev"),...w("docs"),"README.md","rules.md"].filter(f=>fs.existsSync(f));let n=0;for(const f of files){const t=fs.readFileSync(f,"utf8").split(/\r?\n/);for(let i=0;i<t.length;i++)for(const p of legacy)if(t[i].includes(p)){n++;console.log(`${f}:${i+1}:${p}`)}}console.error(`total=${n}`);'
```
