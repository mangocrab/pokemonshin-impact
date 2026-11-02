import { levelCap } from "../../shared/economy.js";
import { loadoutStats } from "../../shared/loadout.js";
import { grantLoot } from "./economy-store.js";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, authenticate } from "./auth.js";
import { serial, WorldError } from "./exploration.js";
import { CHARACTERS, SKILLS } from "../../shared/combat.js";
import {
  availableSkills,
  gainExperience,
  experienceToNext,
  LEVEL_CAP,
  LEARNSETS,
  VICTORY_EXPERIENCE,
} from "../../shared/progression.js";
type Tx = Prisma.TransactionClient;
let notifyChanged: (userId: string) => void = () => {};
export function setTrainingNotifier(fn: typeof notifyChanged) {
  notifyChanged = fn;
}
export async function ensureRoster(tx: Tx, userId: string) {
  await tx.userCharacter.createMany({
    data: CHARACTERS.slice(0, 4).map((c, slot) => ({
      userId,
      characterId: c.id,
      slot,
    })),
    skipDuplicates: true,
  });
  const rows = await tx.userCharacter.findMany({
    where: { userId },
    orderBy: { slot: "asc" },
  });
  for (const row of rows) {
    const definition = CHARACTERS.find((c) => c.id === row.characterId);
    if (!definition) continue;
    await tx.characterSkillUnlock.createMany({
      data: availableSkills(row.characterId, row.level).map((skillId) => ({
        userId,
        characterId: row.characterId,
        skillId,
        decision: definition.skills.includes(skillId) ? "learned" : "pending",
      })),
      skipDuplicates: true,
    });
    if (!row.trainingInitialized) {
      await tx.characterEquippedSkill.createMany({
        data: definition.skills.slice(0, 4).map((skillId, slot) => ({
          userId,
          characterId: row.characterId,
          slot,
          skillId,
        })),
        skipDuplicates: true,
      });
      await tx.userCharacter.update({
        where: { userId_characterId: { userId, characterId: row.characterId } },
        data: { trainingInitialized: true },
      });
    }
  }
}
export async function roster(userId: string) {
  return db.$transaction(async (tx) => {
    await ensureRoster(tx, userId);
    const rows = await tx.userCharacter.findMany({
      where: { userId },
      orderBy: { slot: "asc" },
      include: {
        unlocks: { orderBy: { unlockedAt: "asc" } },
        equippedSkills: { orderBy: { slot: "asc" } },
        equippedWeapons: true,
      },
    });
    return rows
      .filter((r) => CHARACTERS.some((c) => c.id === r.characterId))
      .map((row) => {
        const equipped = row.equippedWeapons[0];
        return {
          ...loadoutStats(row.characterId, row.level, row.liberation, row.skillLevel, equipped),
          copies: row.copies,
          liberation: row.liberation,
          liberationTokens: row.liberationTokens,
          liberationGranted: row.liberationGranted,
          ascension: row.ascension,
          skillLevel: row.skillLevel,
          weapon: equipped ?? null,
          level: row.level,
          slot: row.slot,
          skills: row.equippedSkills.map((s) => s.skillId),
          equipped: row.equippedSkills.map((s) => ({
            slot: s.slot,
            skillId: s.skillId,
          })),
          experience: row.experience,
          nextExperience: experienceToNext(row.level),
          levelCap: Math.max(levelCap(row.ascension), row.level),
          revision: row.revision,
          unlocks: row.unlocks.map((u) => ({
            skillId: u.skillId,
            decision: u.decision,
          })),
          learnset: LEARNSETS[row.characterId].map((skillId) => ({
            skillId,
            level: SKILLS[skillId].learnLevel,
          })),
        };
      });
  });
}
export async function awardVictory(
  tx: Tx,
  userId: string,
  battleId: string,
  ids: string[],
) {
  await ensureRoster(tx, userId);
  await tx.battleReward.create({
    data: { battleId, userId, experience: VICTORY_EXPERIENCE },
  });
  await grantLoot(tx, userId, ids);
  return grantExperience(tx, userId, ids, VICTORY_EXPERIENCE);
}
export async function grantExperience(
  tx: Tx,
  userId: string,
  ids: string[],
  amount: number,
) {
  await ensureRoster(tx, userId);
  const progress = [];
  for (const characterId of [...new Set(ids)]) {
    const row = await tx.userCharacter.findUniqueOrThrow({
      where: { userId_characterId: { userId, characterId } },
    });
    const next = gainExperience(
      row.level,
      row.experience,
      amount,
      levelCap(row.ascension),
    );
    const prior = await tx.characterSkillUnlock.findMany({
      where: { userId, characterId },
    });
    const newly = availableSkills(characterId, next.level).filter(
      (id) => !prior.some((p) => p.skillId === id),
    );
    await tx.userCharacter.update({
      where: { userId_characterId: { userId, characterId } },
      data: { ...next, revision: { increment: 1 } },
    });
    await tx.characterSkillUnlock.createMany({
      data: newly.map((skillId) => ({
        userId,
        characterId,
        skillId,
        decision: "pending",
      })),
      skipDuplicates: true,
    });
    progress.push({
      characterId,
      oldLevel: row.level,
      level: next.level,
      newSkills: newly,
    });
  }
  return { experience: amount, progress };
}
export const trainingRouter = Router();
trainingRouter.use(async (req, res, next) => {
  const user = await authenticate(req);
  if (!user) {
    res.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  res.locals.user = user;
  next();
});
trainingRouter.get("/", async (_req, res) => {
  res.json({ characters: await roster(res.locals.user.id) });
});
trainingRouter.post("/", async (req, res, next) => {
  try {
    const body = z
      .object({
        characterId: z.string().min(1).max(50),
        skillId: z.string().min(1).max(50),
        expectedRevision: z.number().int().nonnegative(),
        action: z.enum(["learn", "defer"]),
        replaceSlot: z.number().int().min(0).max(3).optional(),
      })
      .parse(req.body);
    await serial(async () =>
      db.$transaction(async (tx) => {
        const userId = res.locals.user.id;
        if (
          (await tx.battle.findUnique({ where: { activeUserId: userId } })) ||
          (await tx.coopMember.findUnique({ where: { activeUserId: userId } }))
        )
          throw new WorldError(409, "전투를 마친 뒤 기술을 변경하세요.");
        await ensureRoster(tx, userId);
        const row = await tx.userCharacter.findUnique({
          where: {
            userId_characterId: { userId, characterId: body.characterId },
          },
          include: { equippedSkills: true },
        });
        if (!row) throw new WorldError(404, "보유하지 않은 캐릭터입니다.");
        if (row.revision !== body.expectedRevision)
          throw new WorldError(
            409,
            "캐릭터 정보가 갱신되었습니다. 다시 선택하세요.",
          );
        const unlock = await tx.characterSkillUnlock.findUnique({
          where: {
            userId_characterId_skillId: {
              userId,
              characterId: body.characterId,
              skillId: body.skillId,
            },
          },
        });
        if (
          !unlock ||
          !LEARNSETS[body.characterId]?.includes(body.skillId) ||
          SKILLS[body.skillId].learnLevel > row.level
        )
          throw new WorldError(403, "아직 해금하지 않은 기술입니다.");
        if (row.equippedSkills.some((s) => s.skillId === body.skillId))
          throw new WorldError(409, "이미 장착한 기술입니다.");
        if (body.action === "learn") {
          const slot =
            body.replaceSlot ??
            [0, 1, 2, 3].find(
              (slot) => !row.equippedSkills.some((s) => s.slot === slot),
            );
          if (slot === undefined)
            throw new WorldError(
              409,
              "4개 기술이 모두 장착되어 있습니다. 교체할 기술을 선택하세요.",
            );
          await tx.characterEquippedSkill.upsert({
            where: {
              userId_characterId_slot: {
                userId,
                characterId: body.characterId,
                slot,
              },
            },
            create: {
              userId,
              characterId: body.characterId,
              slot,
              skillId: body.skillId,
            },
            update: { skillId: body.skillId },
          });
        }
        const changed = await tx.userCharacter.updateMany({
          where: {
            userId,
            characterId: body.characterId,
            revision: body.expectedRevision,
          },
          data: { revision: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new WorldError(409, "이미 처리된 요청입니다.");
        await tx.characterSkillUnlock.update({
          where: {
            userId_characterId_skillId: {
              userId,
              characterId: body.characterId,
              skillId: body.skillId,
            },
          },
          data: { decision: body.action === "learn" ? "learned" : "deferred" },
        });
      }),
    );
    const characters = await roster(res.locals.user.id);
    notifyChanged(res.locals.user.id);
    res.json({ characters });
  } catch (error) {
    if (error instanceof WorldError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "기술 선택과 교체 슬롯을 확인하세요." });
      return;
    }
    next(error);
  }
});
