CREATE TABLE "UserSettings" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "quality" TEXT NOT NULL DEFAULT 'high',
  "lighting" BOOLEAN NOT NULL DEFAULT true,
  "shadows" BOOLEAN NOT NULL DEFAULT true,
  "ambientEffects" BOOLEAN NOT NULL DEFAULT true,
  "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
  "muted" BOOLEAN NOT NULL DEFAULT true,
  "volume" INTEGER NOT NULL DEFAULT 40,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserSettings_quality_check" CHECK ("quality" IN ('high', 'low')),
  CONSTRAINT "UserSettings_volume_check" CHECK ("volume" BETWEEN 0 AND 100),
  CONSTRAINT "UserSettings_revision_check" CHECK ("revision" >= 0)
);
