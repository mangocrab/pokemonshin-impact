import { ART } from "./art-manifest";
export type ArtSet = keyof typeof ART;
/** Same atlas frames as Phaser; each portrait stays within its own SVG viewport. */
export function Art({ id, label, set = "heroes", className = "" }: { id: string; label: string; set?: ArtSet; className?: string }) {
  const sheet = ART[set], frames: Record<string, { x: number; y: number; w: number; h: number }> = sheet.frames;
  const f = frames[id];
  if (!f) return null;
  return <svg className={`illustration ${className}`} role="img" aria-label={label} viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`} preserveAspectRatio="xMidYMid meet">
    <title>{label}</title><image href={sheet.url} width={sheet.width} height={sheet.height} />
  </svg>;
}
