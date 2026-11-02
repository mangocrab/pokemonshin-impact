-- CreateTable
CREATE TABLE "UserCharacter" (
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "UserCharacter_pkey" PRIMARY KEY ("userId","characterId")
);

-- CreateTable
CREATE TABLE "Battle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "activeUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Battle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BattleRound" (
    "battleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "action" JSONB NOT NULL,
    "log" JSONB NOT NULL,

    CONSTRAINT "BattleRound_pkey" PRIMARY KEY ("battleId","version")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCharacter_userId_slot_key" ON "UserCharacter"("userId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "Battle_activeUserId_key" ON "Battle"("activeUserId");

-- CreateIndex
CREATE INDEX "Battle_userId_createdAt_idx" ON "Battle"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserCharacter" ADD CONSTRAINT "UserCharacter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleRound" ADD CONSTRAINT "BattleRound_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "Battle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
