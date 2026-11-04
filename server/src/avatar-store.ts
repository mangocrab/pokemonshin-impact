import { db } from "./auth.js";
import { effectiveAvatar, type AvatarState } from "../../shared/avatars.js";
export async function avatarState(userId: string): Promise<AvatarState> {
  const row = await db.userSettings.upsert({ where: { userId }, create: { userId }, update: {} });
  const owned = await db.userCharacter.findUnique({ where: { userId_characterId: { userId, characterId: "haerin" } } });
  const available = owned != null && owned.slot != null && owned.slot >= 0 && owned.slot < 4;
  return { avatarId: effectiveAvatar(row.avatarId, available), revision: row.avatarRevision,
    available: available ? ["traveler", "haerin"] : ["traveler"] };
}
