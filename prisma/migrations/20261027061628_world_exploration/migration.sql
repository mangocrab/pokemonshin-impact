-- AlterTable
ALTER TABLE "World" ADD COLUMN     "positionX" DOUBLE PRECISION NOT NULL DEFAULT 800,
ADD COLUMN     "positionY" DOUBLE PRECISION NOT NULL DEFAULT 560;

-- CreateTable
CREATE TABLE "WorldChest" (
    "worldId" TEXT NOT NULL,
    "chestId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorldChest_pkey" PRIMARY KEY ("worldId","chestId")
);

-- AddForeignKey
ALTER TABLE "WorldChest" ADD CONSTRAINT "WorldChest_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;
