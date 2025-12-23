import type { GlobalConfig, Shot } from './types';

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
