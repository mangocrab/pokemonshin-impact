import { Router } from "express";
import { z } from "zod";
import { authenticate, db } from "./auth.js";
import { AVATAR_IDS } from "../../shared/avatars.js";
import { avatarState } from "./avatar-store.js";
import { serial, refreshAvatar, WorldError } from "./exploration.js";
const schema = z.object({ avatarId: z.enum(AVATAR_IDS), expectedRevision: z.number().int().nonnegative() }).strict();
export const avatarRouter = Router();
avatarRouter.use(async (req, res, next) => { const user = await authenticate(req);
  if (!user) { res.status(401).json({ error: "로그인이 필요합니다." }); return; } res.locals.userId = user.id; next(); });
avatarRouter.get("/", async (_req, res) => { res.json(await serial(() => avatarState(res.locals.userId))); });
avatarRouter.put("/", async (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "탐험 모습을 확인하세요." }); return; }
  try {
    const result = await serial(async () => {
      const state = await avatarState(res.locals.userId), body = parsed.data;
      if (!state.available.includes(body.avatarId)) throw new WorldError(403, "보유하고 편성한 캐릭터만 선택할 수 있습니다.");
      const changed = await db.userSettings.updateMany({ where: { userId: res.locals.userId, avatarRevision: body.expectedRevision },
        data: { avatarId: body.avatarId, avatarRevision: { increment: 1 } } });
      if (!changed.count) throw new WorldError(409, "다른 창에서 탐험 모습이 변경되었습니다. 다시 불러와 주세요.");
      await refreshAvatar(res.locals.userId);
      return { ...state, avatarId: body.avatarId, revision: body.expectedRevision + 1 };
    }); res.json(result);
  } catch (e) { if (e instanceof WorldError) { res.status(e.status).json({ error: e.message }); return; } next(e); }
});
