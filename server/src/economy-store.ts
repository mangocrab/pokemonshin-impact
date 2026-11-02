import type { Prisma } from "@prisma/client";
import { materialId } from "../../shared/economy.js";
export async function ensureEconomy(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const created = await tx.wallet.createMany({
    data: [{ userId }],
    skipDuplicates: true,
  });
  if (created.count) {
    await tx.inventory.createMany({
      data: [
        { userId, itemId: "training-book", quantity: 20 },
        { userId, itemId: "weapon-ore", quantity: 10 },
        { userId, itemId: "growth-stone", quantity: 15 },
        ...["haerin", "luna", "somi", "taeo"].map((id) => ({
          userId,
          itemId: materialId(id),
          quantity: 5,
        })),
      ],
    });
    await tx.userWeapon.create({ data: { userId, weaponId: "shellWand" } });
  }
}
export async function addItem(
  tx: Prisma.TransactionClient,
  userId: string,
  itemId: string,
  quantity: number,
) {
  await tx.inventory.upsert({
    where: { userId_itemId: { userId, itemId } },
    create: { userId, itemId, quantity },
    update: { quantity: { increment: quantity } },
  });
}
export async function grantLoot(
  tx: Prisma.TransactionClient,
  userId: string,
  ids: string[],
  cooperative = false,
) {
  await ensureEconomy(tx, userId);
  await tx.wallet.update({
    where: { userId },
    data: {
      conch: { increment: cooperative ? 40 : 20 },
      shell: { increment: cooperative ? 500 : 250 },
      revision: { increment: 1 },
    },
  });
  for (const [id, amount] of [
    ["training-book", 1],
    ["weapon-ore", 2],
    ["growth-stone", 2],
  ] as const)
    await addItem(tx, userId, id, amount);
  for (const id of new Set(ids)) await addItem(tx, userId, materialId(id), 1);
}
