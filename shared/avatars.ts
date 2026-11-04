export const AVATAR_IDS = ["traveler", "haerin"] as const;
export type AvatarId = typeof AVATAR_IDS[number];
export type AvatarState = { avatarId: AvatarId; revision: number; available: AvatarId[] };
export function effectiveAvatar(requested: string, equippedHaerin: boolean): AvatarId {
  return requested === "haerin" && equippedHaerin ? "haerin" : "traveler";
}
