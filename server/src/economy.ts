import { Router } from "express";
import { Prisma } from "@prisma/client";
import { randomInt, createHash } from "node:crypto";
import { z } from "zod";
import { authenticate, db } from "./auth.js";
import { serial, WorldError } from "./exploration.js";
import { ensureRoster, grantExperience, roster } from "./training.js";
import { ensureEconomy, addItem } from "./economy-store.js";
import { CHARACTERS } from "../../shared/combat.js";
import {
  BANNER,
  WEAPONS,
  materialId,
  levelCap,
  rollPull,
  duplicateReward,
  type WeaponId,
} from "../../shared/economy.js";
const rng = () => randomInt(0, 0x100000000) / 0x100000000;
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const key = z.string().min(1).max(80);
const base = z.object({
  requestId: z.string().min(8).max(100),
  expectedRevision: z.number().int().nonnegative(),
});
const schemas: Record<string, z.ZodTypeAny> = {
  pull: base
    .extend({
      count: z.union([z.literal(1), z.literal(10)]),
      bannerId: z.literal(BANNER.id),
    })
    .strict(),
  team: base
    .extend({ characterId: key, slot: z.number().int().min(0).max(3) })
    .strict(),
  equip: base.extend({ characterId: key, weaponId: key.nullable() }).strict(),
  weapon: base.extend({ weaponId: key }).strict(),
  train: base
    .extend({ characterId: key, count: z.number().int().min(1).max(10) })
    .strict(),
  ascend: base.extend({ characterId: key }).strict(),
  liberate: base.extend({ characterId: key }).strict(),
  skill: base.extend({ characterId: key }).strict(),
};
function canonical(v: any): any {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
async function spendItem(
  tx: Prisma.TransactionClient,
  userId: string,
  itemId: string,
  quantity: number,
) {
  const spent = await tx.inventory.updateMany({
    where: { userId, itemId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (spent.count !== 1)
    throw new WorldError(409, "필요한 성장 재료가 부족합니다.");
}
export const economyRouter = Router();
economyRouter.use(async (req, res, next) => {
  const user = await authenticate(req);
  if (!user) {
    res.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  res.locals.user = user;
  next();
});
economyRouter.get("/", async (_req, res) => {
  const userId = res.locals.user.id;
  await db.$transaction(async (tx) => {
    await ensureRoster(tx, userId);
    await ensureEconomy(tx, userId);
  });
  const [wallet, inventory, weapons, pity, history, characters] =
    await Promise.all([
      db.wallet.findUniqueOrThrow({ where: { userId } }),
      db.inventory.findMany({ where: { userId }, orderBy: { itemId: "asc" } }),
      db.userWeapon.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      db.gachaPity.findUnique({
        where: { userId_bannerId: { userId, bannerId: BANNER.id } },
      }),
      db.gachaHistory.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      }),
      roster(userId),
    ]);
  res.json({
    wallet,
    inventory,
    weapons,
    pity: pity ?? { five: 0, four: 0, guaranteed: false },
    history,
    characters,
    banner: BANNER,
  });
});
economyRouter.post("/:operation", async (req, res, next) => {
  try {
    const operation = req.params.operation,
      schema = schemas[operation];
    if (!schema) throw new WorldError(404, "알 수 없는 성장 요청입니다.");
    const body = schema.parse(req.body) as any;
    const hash = createHash("sha256")
      .update(JSON.stringify(canonical(body)))
      .digest("hex");
    const receipt = await serial(async () =>
      db.$transaction(
        async (tx) => {
          const userId = res.locals.user.id;
          const existing = await tx.economyMutation.findUnique({
            where: { userId_requestId: { userId, requestId: body.requestId } },
          });
          if (existing) {
            if (existing.hash !== hash || existing.operation !== operation)
              throw new WorldError(
                409,
                "같은 요청 ID를 다른 작업에 사용할 수 없습니다.",
              );
            return existing.result;
          }
          if (
            (await tx.battle.findUnique({ where: { activeUserId: userId } })) ||
            (await tx.coopMember.findUnique({
              where: { activeUserId: userId },
            }))
          )
            throw new WorldError(409, "전투를 마친 뒤 수집·강화를 진행하세요.");
          await ensureRoster(tx, userId);
          await ensureEconomy(tx, userId);
          const wallet = await tx.wallet.findUniqueOrThrow({
            where: { userId },
          });
          if (wallet.revision !== body.expectedRevision)
            throw new WorldError(
              409,
              "재화 정보가 갱신되었습니다. 새로 확인하세요.",
            );
          let conchCost = 0,
            shellCost = 0,
            dustGain = 0;
          const details: any = { operation };
          if (operation === "pull") {
            conchCost = BANNER.cost * body.count;
            if (wallet.conch < conchCost)
              throw new WorldError(409, "소라가 부족합니다.");
            const p = await tx.gachaPity.upsert({
              where: { userId_bannerId: { userId, bannerId: BANNER.id } },
              create: { userId, bannerId: BANNER.id },
              update: {},
            });
            let pity = { five: p.five, four: p.four, guaranteed: p.guaranteed };
            const pulls = [];
            for (let i = 0; i < body.count; i++) {
              const result = rollPull(pity, rng);
              pity = result.pity;
              const pull = result.pull;
              let duplicate = false,
                tokens = 0,
                dust = 0;
              if (pull.kind === "character") {
                const c = await tx.userCharacter.findUnique({
                  where: {
                    userId_characterId: { userId, characterId: pull.id },
                  },
                });
                if (!c) {
                  await tx.userCharacter.create({
                    data: { userId, characterId: pull.id, slot: null },
                  });
                  await addItem(tx, userId, materialId(pull.id), 3);
                } else {
                  duplicate = true;
                  const reward = duplicateReward(
                    c.copies,
                    c.liberationGranted,
                    pull.rarity,
                  );
                  tokens = reward.tokens;
                  dust = reward.dust;
                  dustGain += dust;
                  await tx.userCharacter.update({
                    where: {
                      userId_characterId: { userId, characterId: pull.id },
                    },
                    data: {
                      copies: { increment: 1 },
                      liberationTokens: { increment: tokens },
                      liberationGranted: { increment: tokens },
                      revision: { increment: 1 },
                    },
                  });
                }
              } else
                await tx.userWeapon.create({
                  data: { userId, weaponId: pull.id },
                });
              const record = await tx.gachaHistory.create({
                data: {
                  userId,
                  bannerId: BANNER.id,
                  kind: pull.kind,
                  itemId: pull.id,
                  rarity: pull.rarity,
                  featured: pull.featured,
                },
              });
              pulls.push({
                ...pull,
                id: pull.id,
                historyId: record.id,
                duplicate,
                tokens,
                dust,
              });
            }
            await tx.gachaPity.update({
              where: { userId_bannerId: { userId, bannerId: BANNER.id } },
              data: pity,
            });
            details.pulls = pulls;
            details.pity = pity;
          } else if (operation === "weapon") {
            const w = await tx.userWeapon.findFirst({
              where: { id: body.weaponId, userId },
            });
            if (!w) throw new WorldError(404, "보유하지 않은 무기입니다.");
            if (w.level >= 40)
              throw new WorldError(409, "무기 최대 레벨입니다.");
            shellCost = 100 * w.level;
            await spendItem(tx, userId, "weapon-ore", 1);
            await tx.userWeapon.update({
              where: { id: w.id },
              data: { level: { increment: 1 } },
            });
            details.level = w.level + 1;
          } else {
            const c = await tx.userCharacter.findUnique({
              where: {
                userId_characterId: { userId, characterId: body.characterId },
              },
            });
            if (!c) throw new WorldError(404, "보유하지 않은 캐릭터입니다.");
            if (operation === "team") {
              const prior = await tx.userCharacter.findFirst({
                where: { userId, slot: body.slot },
              });
              if (prior)
                await tx.userCharacter.update({
                  where: {
                    userId_characterId: {
                      userId,
                      characterId: prior.characterId,
                    },
                  },
                  data: { slot: null, revision: { increment: 1 } },
                });
              await tx.userCharacter.update({
                where: {
                  userId_characterId: { userId, characterId: c.characterId },
                },
                data: { slot: body.slot, revision: { increment: 1 } },
              });
              if (
                prior &&
                prior.characterId !== c.characterId &&
                c.slot !== null
              )
                await tx.userCharacter.update({
                  where: {
                    userId_characterId: {
                      userId,
                      characterId: prior.characterId,
                    },
                  },
                  data: { slot: c.slot, revision: { increment: 1 } },
                });
            } else if (operation === "equip") {
              if (body.weaponId) {
                const w = await tx.userWeapon.findFirst({
                  where: { id: body.weaponId, userId },
                });
                if (!w) throw new WorldError(404, "보유하지 않은 무기입니다.");
                await tx.userWeapon.updateMany({
                  where: { userId, equippedCharacterId: c.characterId },
                  data: { equippedCharacterId: null },
                });
                await tx.userWeapon.update({
                  where: { id: w.id },
                  data: { equippedCharacterId: c.characterId },
                });
              } else
                await tx.userWeapon.updateMany({
                  where: { userId, equippedCharacterId: c.characterId },
                  data: { equippedCharacterId: null },
                });
            } else if (operation === "train") {
              if (c.level >= levelCap(c.ascension))
                throw new WorldError(
                  409,
                  "현재 레벨 상한입니다. 돌파가 필요합니다.",
                );
              shellCost = 100 * body.count;
              await spendItem(tx, userId, "training-book", body.count);
              details.progress = await grantExperience(
                tx,
                userId,
                [c.characterId],
                80 * body.count,
              );
            } else if (operation === "ascend") {
              if (c.ascension >= 3 || c.level < levelCap(c.ascension))
                throw new WorldError(
                  409,
                  "돌파 레벨 조건을 충족하지 않았습니다.",
                );
              shellCost = 1000 * (c.ascension + 1);
              await spendItem(
                tx,
                userId,
                "growth-stone",
                3 * (c.ascension + 1),
              );
              await spendItem(
                tx,
                userId,
                materialId(c.characterId),
                2 * (c.ascension + 1),
              );
              await tx.userCharacter.update({
                where: {
                  userId_characterId: { userId, characterId: c.characterId },
                },
                data: {
                  ascension: { increment: 1 },
                  revision: { increment: 1 },
                },
              });
              details.levelCap = levelCap(c.ascension + 1);
            } else if (operation === "liberate") {
              if (c.liberation >= 6 || c.liberationTokens < 1)
                throw new WorldError(
                  409,
                  "전용 해방 재료가 없거나 최대 단계입니다.",
                );
              await tx.userCharacter.update({
                where: {
                  userId_characterId: { userId, characterId: c.characterId },
                },
                data: {
                  liberation: { increment: 1 },
                  liberationTokens: { decrement: 1 },
                  revision: { increment: 1 },
                },
              });
              details.stage = c.liberation + 1;
            } else if (operation === "skill") {
              if (c.skillLevel >= 6)
                throw new WorldError(409, "기술 강화 최대 단계입니다.");
              shellCost = 300 * c.skillLevel;
              await spendItem(tx, userId, "growth-stone", c.skillLevel);
              await tx.userCharacter.update({
                where: {
                  userId_characterId: { userId, characterId: c.characterId },
                },
                data: {
                  skillLevel: { increment: 1 },
                  revision: { increment: 1 },
                },
              });
              details.skillLevel = c.skillLevel + 1;
            }
          }
          if (wallet.shell < shellCost)
            throw new WorldError(409, "조개가 부족합니다.");
          const changed = await tx.wallet.updateMany({
            where: {
              userId,
              revision: body.expectedRevision,
              conch: { gte: conchCost },
              shell: { gte: shellCost },
            },
            data: {
              conch: { decrement: conchCost },
              shell: { decrement: shellCost },
              dust: { increment: dustGain },
              revision: { increment: 1 },
            },
          });
          if (changed.count !== 1)
            throw new WorldError(409, "이미 처리되거나 변경된 재화입니다.");
          details.conchSpent = conchCost;
          details.shellSpent = shellCost;
          await tx.economyMutation.create({
            data: {
              userId,
              requestId: body.requestId,
              operation,
              hash,
              result: json(details),
            },
          });
          return details;
        },
        { timeout: 15000 },
      ),
    );
    res.json({ receipt });
  } catch (error) {
    if (error instanceof WorldError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "수량·대상·요청 정보를 확인하세요." });
      return;
    }
    next(error);
  }
});
