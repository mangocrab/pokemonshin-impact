import { Router } from "express";
import { z } from "zod";
import { authenticate, db } from "./auth.js";
import { DEFAULT_SETTINGS } from "../../shared/settings.js";
const schema = z.object({
  quality: z.enum(["high", "low"]),
  lighting: z.boolean(),
  shadows: z.boolean(),
  ambientEffects: z.boolean(),
  reducedMotion: z.boolean(),
  muted: z.boolean(),
  volume: z.number().int().min(0).max(100),
  expectedRevision: z.number().int().nonnegative(),
}).strict();
export const settingsRouter = Router();
settingsRouter.use(async (req, res, next) => {
  const user = await authenticate(req);
  if (!user) { res.status(401).json({ error: "로그인이 필요합니다." }); return; }
  res.locals.userId = user.id;
  next();
});
function publicSettings(row: Awaited<ReturnType<typeof db.userSettings.findUniqueOrThrow>>) {
  const { userId: _, updatedAt: __, ...settings } = row;
  return settings;
}
async function ensure(userId: string) {
  return db.userSettings.upsert({
    where: { userId }, create: { userId, ...DEFAULT_SETTINGS }, update: {},
  });
}
settingsRouter.get("/", async (_req, res) => {
  res.json(publicSettings(await ensure(res.locals.userId)));
});
settingsRouter.put("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "설정 값을 확인하세요." }); return; }
  const userId = res.locals.userId as string;
  await ensure(userId);
  const { expectedRevision, ...data } = parsed.data;
  const changed = await db.userSettings.updateMany({
    where: { userId, revision: expectedRevision },
    data: { ...data, revision: { increment: 1 } },
  });
  if (!changed.count) {
    res.status(409).json({ error: "다른 창에서 설정이 변경되었습니다. 최신 설정을 다시 불러오세요." });
    return;
  }
  // Return the committed revision of this write, even if a later write already exists.
  res.json({ ...data, revision: expectedRevision + 1 });
});
