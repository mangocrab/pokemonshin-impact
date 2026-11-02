-- AddForeignKey
ALTER TABLE "CoopBattle" ADD CONSTRAINT "CoopBattle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
