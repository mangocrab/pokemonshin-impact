ALTER TABLE "CharacterEquippedSkill" ADD CONSTRAINT "CharacterEquippedSkill_slot_range" CHECK ("slot" BETWEEN 0 AND 3);
ALTER TABLE "UserCharacter" ADD CONSTRAINT "UserCharacter_progress_range" CHECK ("level" >= 1 AND "experience" >= 0 AND "revision" >= 0);
