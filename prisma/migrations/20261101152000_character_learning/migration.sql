-- AlterTable
ALTER TABLE "UserCharacter" ADD COLUMN     "experience" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trainingInitialized" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CharacterSkillUnlock" (
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterSkillUnlock_pkey" PRIMARY KEY ("userId","characterId","skillId")
);

-- CreateTable
CREATE TABLE "CharacterEquippedSkill" (
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "CharacterEquippedSkill_pkey" PRIMARY KEY ("userId","characterId","slot")
);

-- CreateTable
CREATE TABLE "BattleReward" (
    "battleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "experience" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BattleReward_pkey" PRIMARY KEY ("battleId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterEquippedSkill_userId_characterId_skillId_key" ON "CharacterEquippedSkill"("userId", "characterId", "skillId");

-- AddForeignKey
ALTER TABLE "CharacterSkillUnlock" ADD CONSTRAINT "CharacterSkillUnlock_userId_characterId_fkey" FOREIGN KEY ("userId", "characterId") REFERENCES "UserCharacter"("userId", "characterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterEquippedSkill" ADD CONSTRAINT "CharacterEquippedSkill_userId_characterId_fkey" FOREIGN KEY ("userId", "characterId") REFERENCES "UserCharacter"("userId", "characterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterEquippedSkill" ADD CONSTRAINT "CharacterEquippedSkill_userId_characterId_skillId_fkey" FOREIGN KEY ("userId", "characterId", "skillId") REFERENCES "CharacterSkillUnlock"("userId", "characterId", "skillId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleReward" ADD CONSTRAINT "BattleReward_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "Battle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleReward" ADD CONSTRAINT "BattleReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
