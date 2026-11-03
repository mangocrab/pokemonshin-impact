/** Fit illustrations without changing their authored body/material proportions. */
export function artScale(width: number, height: number, maxWidth: number, maxHeight: number) {
  return Math.min(maxWidth / width, maxHeight / height);
}
export const TRAVELER_DISPLAY_SIZE = 92;
