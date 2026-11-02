export const DEFAULT_SETTINGS = {
  quality: "high" as "high" | "low",
  lighting: true,
  shadows: true,
  ambientEffects: true,
  reducedMotion: false,
  muted: true,
  volume: 40,
};
export type GameSettings = typeof DEFAULT_SETTINGS;
export type SettingsState = GameSettings & { revision: number };
export function graphicsOptions(settings: GameSettings, systemReducedMotion = false) {
  return {
    lighting: settings.quality === "high" && settings.lighting,
    shadows: settings.shadows,
    effects: settings.quality === "high" && settings.ambientEffects,
    motion: !(settings.reducedMotion || systemReducedMotion),
  };
}
