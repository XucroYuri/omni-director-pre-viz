#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ALLOWED_STATUS = new Set(['ACTIVE', 'REFERENCE', 'SUPERSEDED', 'ARCHIVED']);

function listMarkdownFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const result = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && full.endsWith('.md')) {
        result.push(full);
      }
    }
  }
  return result.sort();
}

function rel(filePath) {
  return filePath.split(path.sep).join('/');
}

function parseFrontMatterStatus(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length < 3 || lines[0].trim() !== '---') {
    return { hasFrontMatter: false, status: null };
  }
  for (let i = 1; i < Math.min(lines.length, 120); i += 1) {
    const line = lines[i].trim();
    if (line === '---') {
      const block = lines.slice(1, i);
      const statusLine = block.find((item) => item.trim().startsWith('status:'));
      if (!statusLine) {
        return { hasFrontMatter: true, status: null };
      }
      const status = statusLine.split(':').slice(1).join(':').trim().toUpperCase();
      return { hasFrontMatter: true, status };
    }
  }
  return { hasFrontMatter: false, status: null };
}

function checkDevStatus() {
  const files = listMarkdownFiles('dev');
  const missing = [];
  const invalid = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const { status } = parseFrontMatterStatus(text);
    if (!status) {
      missing.push(rel(file));
      continue;
    }
    if (!ALLOWED_STATUS.has(status)) {
      invalid.push({ file: rel(file), status });
    }
  }

  return { total: files.length, missing, invalid };
}

function checkAuditIndex() {
  const indexPath = path.join('docs', 'audit', 'README.md');
  const indexExists = fs.existsSync(indexPath);
  if (!indexExists) {
    return { indexExists: false, missingEntries: [] };
  }

  const indexText = fs.readFileSync(indexPath, 'utf8');
  const auditFiles = listMarkdownFiles(path.join('docs', 'audit'))
    .map(rel)
    .filter((file) => file !== 'docs/audit/README.md');

  const missingEntries = auditFiles.filter((file) => !indexText.includes(file));
  return { indexExists: true, missingEntries };
}

function checkLedgerSection() {
  const ledgerPath = path.join('docs', 'audit', 'Legacy-Docs-Ledger.md');
  if (!fs.existsSync(ledgerPath)) {
    return { exists: false, hasSection: false };
  }
  const text = fs.readFileSync(ledgerPath, 'utf8');
  return {
    exists: true,
    hasSection: text.includes('## 5. Front-Matter 完整性检查'),
  };
}

function checkLegacyRefsInActiveDocs() {
  const legacyRefs = [
    'dev/Plan-Codex.md',
    'dev/Guardrails.md',
    'dev/Consensus-Lock.md',
    'dev/Plan-Electron-Standalone.md',
    'dev/Phase9-Web-Migration-Plan.md',
    'dev/Phase9-2-Worker-Kickoff.md',
    'dev/Phase9-Web-First-RFC.md',
  ];

  const activeFiles = [];
  const rootCandidates = ['README.md', 'rules.md', 'apps/web/README.md'];
  for (const candidate of rootCandidates) {
    if (fs.existsSync(candidate)) {
      activeFiles.push(candidate);
    }
  }
  activeFiles.push(...listMarkdownFiles('docs').map(rel));
  activeFiles.push(...listMarkdownFiles('.trae/rules').map(rel));

  const scopedFiles = activeFiles.filter((file) => {
    if (file.startsWith('docs/audit/')) return false;
    if (file === 'docs/roadmap/Phase9-Execution-Detail.md') return false;
    return true;
  });

  const hits = [];
  for (const file of scopedFiles) {
    const text = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < text.length; i += 1) {
      for (const ref of legacyRefs) {
        if (text[i].includes(ref)) {
          hits.push({ file, line: i + 1, ref });
        }
      }
    }
  }

  return hits;
}

function printSection(title) {
  console.log(`\n== ${title} ==`);
}

function main() {
  let hasFailure = false;

  const devStatus = checkDevStatus();
  printSection('Dev Front-Matter Status');
  console.log(`Total dev markdown files: ${devStatus.total}`);
  console.log(`Missing status: ${devStatus.missing.length}`);
  console.log(`Invalid status: ${devStatus.invalid.length}`);
  if (devStatus.missing.length > 0) {
    hasFailure = true;
    devStatus.missing.forEach((file) => console.log(`  - missing: ${file}`));
  }
  if (devStatus.invalid.length > 0) {
    hasFailure = true;
    devStatus.invalid.forEach((item) => console.log(`  - invalid: ${item.file} => ${item.status}`));
  }

  const auditIndex = checkAuditIndex();
  printSection('Audit Index');
  if (!auditIndex.indexExists) {
    hasFailure = true;
    console.log('docs/audit/README.md is missing');
  } else {
    console.log(`Missing index entries: ${auditIndex.missingEntries.length}`);
    if (auditIndex.missingEntries.length > 0) {
      hasFailure = true;
      auditIndex.missingEntries.forEach((file) => console.log(`  - not indexed: ${file}`));
    }
  }

  const ledgerCheck = checkLedgerSection();
  printSection('Ledger Section');
  console.log(`Ledger exists: ${ledgerCheck.exists}`);
  console.log(`Front-Matter section exists: ${ledgerCheck.hasSection}`);
  if (!ledgerCheck.exists || !ledgerCheck.hasSection) {
    hasFailure = true;
  }

  const legacyHits = checkLegacyRefsInActiveDocs();
  printSection('Legacy Refs In Active Docs');
  console.log(`Hits: ${legacyHits.length}`);
  if (legacyHits.length > 0) {
    hasFailure = true;
    legacyHits.forEach((hit) => console.log(`  - ${hit.file}:${hit.line} => ${hit.ref}`));
  }

  if (hasFailure) {
    console.error('\nDocs governance audit failed.');
    process.exit(1);
  }

  console.log('\nDocs governance audit passed.');
}

main();
