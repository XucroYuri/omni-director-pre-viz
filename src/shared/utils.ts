import type { GlobalConfig, GridLayout, Shot } from './types';

export const GRID_MIN = 1;
export const GRID_MAX = 5;
export const DEFAULT_GRID_LAYOUT: GridLayout = { rows: 3, cols: 3 };

export type MatrixPromptPayload = string[] | { prompts?: string[]; gridLayout?: Partial<GridLayout> | null };

function clampGridValue(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.max(GRID_MIN, Math.min(GRID_MAX, Math.round(value)));
}

export function normalizeGridLayout(
  layout?: Partial<GridLayout> | null,
  fallback: GridLayout = DEFAULT_GRID_LAYOUT,
): GridLayout {
  return {
    rows: clampGridValue(typeof layout?.rows === 'number' ? layout.rows : fallback.rows),
    cols: clampGridValue(typeof layout?.cols === 'number' ? layout.cols : fallback.cols),
  };
}

export function getGridCellCount(layout?: Partial<GridLayout> | null): number {
  const normalized = normalizeGridLayout(layout);
  return normalized.rows * normalized.cols;
}

export function getAngleLabel(index: number): string {
  return `Angle_${String(index + 1).padStart(2, '0')}`;
}

export function ensurePromptListLength(
  prompts: string[] | undefined | null,
  layout?: Partial<GridLayout> | null,
): string[] {
  const total = getGridCellCount(layout);
  const source = Array.isArray(prompts) ? prompts : [];
  const next = Array.from({ length: total }, (_item, index) => String(source[index] || ''));
  return next;
}

export function normalizeIndexedList<T>(
  source: Array<T | null | undefined> | undefined | null,
  length: number,
  fallback: T,
): T[] {
  const base = Array.isArray(source) ? source : [];
  return Array.from({ length }, (_item, index) => (base[index] ?? fallback) as T);
}

export function parseMatrixPromptPayload(
  value: unknown,
  fallbackLayout?: Partial<GridLayout> | null,
): { prompts: string[]; gridLayout: GridLayout } {
  const fallback = normalizeGridLayout(fallbackLayout);
  if (Array.isArray(value)) {
    const prompts = ensurePromptListLength(value.map((item) => String(item || '')), fallback);
    return { prompts, gridLayout: fallback };
  }

  if (value && typeof value === 'object') {
    const payload = value as { prompts?: unknown; gridLayout?: Partial<GridLayout> | null };
    const gridLayout = normalizeGridLayout(payload.gridLayout, fallback);
    const prompts = ensurePromptListLength(
      Array.isArray(payload.prompts) ? payload.prompts.map((item) => String(item || '')) : [],
      gridLayout,
    );
    return { prompts, gridLayout };
  }

  return { prompts: ensurePromptListLength([], fallback), gridLayout: fallback };
}

export function serializeMatrixPromptPayload(
  prompts: string[] | undefined | null,
  gridLayout?: Partial<GridLayout> | null,
): { prompts: string[]; gridLayout: GridLayout } {
  const normalized = normalizeGridLayout(gridLayout);
  return {
    prompts: ensurePromptListLength(prompts, normalized),
    gridLayout: normalized,
  };
}

export function getBoundAssets(shot: Shot, config: GlobalConfig) {
  const characters =
    shot.characterIds && shot.characterIds.length > 0
      ? config.characters.filter((c) => shot.characterIds?.includes(c.id))
      : [];
  const scenes =
    shot.sceneIds && shot.sceneIds.length > 0 ? config.scenes.filter((s) => shot.sceneIds?.includes(s.id)) : [];
  const props =
    shot.propIds && shot.propIds.length > 0 ? config.props.filter((p) => shot.propIds?.includes(p.id)) : [];
  return { characters, scenes, props };
}

export function buildAssetInjection(shot: Shot, config: GlobalConfig): string {
  const { characters, scenes, props } = getBoundAssets(shot, config);
  const parts: string[] = [];
  if (characters.length > 0) {
    parts.push(...characters.map((c) => `[Character: ${c.name}, ${c.description}]`));
  }
  if (scenes.length > 0) {
    parts.push(...scenes.map((s) => `[Environment: ${s.name}, ${s.description}]`));
  }
  if (props.length > 0) {
    parts.push(...props.map((p) => `[Prop: ${p.name}, ${p.description}]`));
  }
  return parts.join(' ');
}
