import type { Prisma } from "@prisma/client";
import { ensureEconomy } from "../economy-store.js";
import { WorldError } from "../exploration.js";
import { consumable } from "../../../shared/items.js";
export async function requireConsumable(tx: Prisma.TransactionClient, userId: string, itemId: string) {
  if (!consumable(itemId)) throw new WorldError(400, "사용할 수 없는 전투 아이템입니다.");
  await ensureEconomy(tx, userId);
  const row = await tx.inventory.findUnique({ where: { userId_itemId: { userId, itemId } } });
  if (!row || row.quantity < 1) throw new WorldError(409, "보유한 전투 아이템이 부족합니다.");
}
export async function consumeItems(tx: Prisma.TransactionClient, uses: { userId: string; itemId: string }[]) {
  for (const { userId, itemId } of uses) {
    if (!consumable(itemId)) throw new WorldError(400, "사용할 수 없는 전투 아이템입니다.");
    const spent = await tx.inventory.updateMany({ where: { userId, itemId, quantity: { gte: 1 } }, data: { quantity: { decrement: 1 } } });
    if (spent.count !== 1) throw new WorldError(409, "보유한 전투 아이템이 부족합니다.");
  }
}
