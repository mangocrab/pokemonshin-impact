-- AlterTable
ALTER TABLE "UserCharacter" ADD COLUMN     "ascension" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "copies" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "liberation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "liberationGranted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "liberationTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skillLevel" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "slot" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Wallet" (
    "userId" TEXT NOT NULL,
    "conch" INTEGER NOT NULL DEFAULT 3200,
    "shell" INTEGER NOT NULL DEFAULT 10000,
    "dust" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("userId","itemId")
);

-- CreateTable
CREATE TABLE "UserWeapon" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weaponId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "equippedCharacterId" TEXT,

    CONSTRAINT "UserWeapon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GachaPity" (
    "userId" TEXT NOT NULL,
    "bannerId" TEXT NOT NULL,
    "five" INTEGER NOT NULL DEFAULT 0,
    "four" INTEGER NOT NULL DEFAULT 0,
    "guaranteed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GachaPity_pkey" PRIMARY KEY ("userId","bannerId")
);

-- CreateTable
CREATE TABLE "GachaHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bannerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "rarity" INTEGER NOT NULL,
    "featured" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GachaHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EconomyMutation" (
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EconomyMutation_pkey" PRIMARY KEY ("userId","requestId")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserWeapon_userId_equippedCharacterId_key" ON "UserWeapon"("userId", "equippedCharacterId");

-- CreateIndex
CREATE INDEX "GachaHistory_userId_createdAt_idx" ON "GachaHistory"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWeapon" ADD CONSTRAINT "UserWeapon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWeapon" ADD CONSTRAINT "UserWeapon_userId_equippedCharacterId_fkey" FOREIGN KEY ("userId", "equippedCharacterId") REFERENCES "UserCharacter"("userId", "characterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GachaPity" ADD CONSTRAINT "GachaPity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GachaHistory" ADD CONSTRAINT "GachaHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EconomyMutation" ADD CONSTRAINT "EconomyMutation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
