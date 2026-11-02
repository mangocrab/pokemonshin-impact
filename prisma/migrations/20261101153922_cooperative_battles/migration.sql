-- CreateTable
CREATE TABLE "CoopBattle" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'lobby',
    "version" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoopBattle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoopMember" (
    "battleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeUserId" TEXT,

    CONSTRAINT "CoopMember_pkey" PRIMARY KEY ("battleId","userId")
);

-- CreateTable
CREATE TABLE "CoopRound" (
    "battleId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "actions" JSONB NOT NULL,
    "log" JSONB NOT NULL,

    CONSTRAINT "CoopRound_pkey" PRIMARY KEY ("battleId","round")
);

-- CreateTable
CREATE TABLE "CoopReward" (
    "battleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "experience" INTEGER NOT NULL,

    CONSTRAINT "CoopReward_pkey" PRIMARY KEY ("battleId","userId")
);

-- CreateIndex
CREATE INDEX "CoopBattle_status_deadline_idx" ON "CoopBattle"("status", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "CoopMember_activeUserId_key" ON "CoopMember"("activeUserId");

-- AddForeignKey
ALTER TABLE "CoopMember" ADD CONSTRAINT "CoopMember_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "CoopBattle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopMember" ADD CONSTRAINT "CoopMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopRound" ADD CONSTRAINT "CoopRound_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "CoopBattle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopReward" ADD CONSTRAINT "CoopReward_battleId_fkey" FOREIGN KEY ("battleId") REFERENCES "CoopBattle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopReward" ADD CONSTRAINT "CoopReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
