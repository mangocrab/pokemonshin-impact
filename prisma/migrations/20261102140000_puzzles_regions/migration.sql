CREATE TABLE "WorldPuzzle" (
 "worldId" TEXT NOT NULL,
 "puzzleId" TEXT NOT NULL,
 "progress" INTEGER NOT NULL DEFAULT 0,
 "revision" INTEGER NOT NULL DEFAULT 0,
 "solvedAt" TIMESTAMP(3),
 PRIMARY KEY ("worldId", "puzzleId"),
 CONSTRAINT "WorldPuzzle_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "WorldPuzzle_progress_check" CHECK ("progress" BETWEEN 0 AND 3),
 CONSTRAINT "WorldPuzzle_revision_check" CHECK ("revision" >= 0),
 CONSTRAINT "WorldPuzzle_solved_check" CHECK (("progress" = 3) = ("solvedAt" IS NOT NULL))
);
CREATE TABLE "WorldRegion" (
 "worldId" TEXT NOT NULL,
 "regionId" TEXT NOT NULL,
 "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("worldId", "regionId"),
 CONSTRAINT "WorldRegion_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
