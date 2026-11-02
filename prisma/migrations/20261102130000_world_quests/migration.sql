CREATE TABLE "WorldQuest" (
  "worldId" TEXT NOT NULL,
  "questId" TEXT NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  PRIMARY KEY ("worldId", "questId"),
  CONSTRAINT "WorldQuest_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorldQuest_progress_check" CHECK ("progress" BETWEEN 0 AND 3),
  CONSTRAINT "WorldQuest_claim_check" CHECK ("claimedAt" IS NULL OR ("progress" > 0 AND "claimedAt" >= "acceptedAt"))
);
