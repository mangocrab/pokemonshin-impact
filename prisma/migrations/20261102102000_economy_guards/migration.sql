ALTER TABLE "Wallet" ADD CONSTRAINT "wallet_nonnegative" CHECK ("conch">=0 AND "shell">=0 AND "dust">=0 AND "revision">=0);
ALTER TABLE "Inventory" ADD CONSTRAINT "inventory_nonnegative" CHECK ("quantity">=0);
ALTER TABLE "UserCharacter" ADD CONSTRAINT "character_collection_bounds" CHECK (("slot" IS NULL OR "slot" BETWEEN 0 AND 3) AND "copies">=1 AND "liberation" BETWEEN 0 AND 6 AND "liberationGranted" BETWEEN 0 AND 6 AND "liberationTokens">=0 AND "liberation"+"liberationTokens"<="liberationGranted" AND "ascension" BETWEEN 0 AND 3 AND "skillLevel" BETWEEN 1 AND 6);
ALTER TABLE "UserWeapon" ADD CONSTRAINT "weapon_level_bounds" CHECK ("level" BETWEEN 1 AND 40);
ALTER TABLE "GachaPity" ADD CONSTRAINT "pity_bounds" CHECK ("five" BETWEEN 0 AND 89 AND "four" BETWEEN 0 AND 9);
ALTER TABLE "GachaHistory" ADD CONSTRAINT "gacha_rarity_bounds" CHECK ("rarity" IN (3,4,5) AND ("rarity"<>3 OR "kind"='weapon'));
