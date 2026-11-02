-- One-time grant for already-initialized economies. Future wallets get the same grant in ensureEconomy.
INSERT INTO "Inventory" ("userId", "itemId", "quantity")
SELECT "userId", 'summer-tonic', 4 FROM "Wallet"
ON CONFLICT ("userId", "itemId") DO NOTHING;
INSERT INTO "Inventory" ("userId", "itemId", "quantity")
SELECT "userId", 'cleansing-salt', 2 FROM "Wallet"
ON CONFLICT ("userId", "itemId") DO NOTHING;
