import { registerStory } from "./story.js";
import { settingsRouter } from "./settings.js";
import { economyRouter } from "./economy.js";
import { registerCoop, recoverCoop } from "./combat/coop.js";
import express from "express";
import { trainingRouter } from "./training.js";
import { registerCombat } from "./combat/service.js";
import { socialRouter } from "./social.js";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import {
  db,
  hashPassword,
  verifyPassword,
  authenticate,
  login,
  userFromCookie,
  readCookie,
  sessionId,
} from "./auth.js";
import {
  openChest,
  openedChests,
  registerExploration,
  WorldError,
  serial,
} from "./exploration.js";

let serverReady = false;
const app = express();
app.use((_req, res, next) => {
  if (!serverReady) {
    res.status(503).json({ error: "서버 시작 중입니다." });
    return;
  }
  next();
});
const http = createServer(app);
const io = new Server(http, { maxHttpBufferSize: 4096 });
app.use(express.json({ limit: "8kb" }));
app.use("/api", (req, res, next) => {
  if (
    req.method !== "GET" &&
    req.headers.origin &&
    ![
      `${req.protocol}://${req.get("host")}`,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ].includes(req.headers.origin)
  ) {
    res.status(403).json({ error: "허용되지 않은 출처입니다." });
    return;
  }
  next();
});
const credentials = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_]{3,24}$/),
  password: z.string().min(10).max(128),
  nickname: z.string().trim().min(1).max(20).optional(),
});
const attempts = new Map<string, { count: number; until: number }>();
app.use(["/api/register", "/api/login"], (req, res, next) => {
  const key = req.ip ?? "unknown",
    now = Date.now();
  let a = attempts.get(key);
  if (!a || a.until < now) {
    a = { count: 0, until: now + 60000 };
    attempts.set(key, a);
  }
  if (++a.count > 15) {
    res.status(429).json({ error: "잠시 후 다시 시도하세요." });
    return;
  }
  next();
});
app.post("/api/register", async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error:
        "아이디 3~24자(영문·숫자·_), 비밀번호 10~128자, 닉네임 1~20자를 입력하세요.",
    });
    return;
  }
  const { username, password, nickname } = parsed.data;
  try {
    const user = await db.user.create({
      data: {
        username,
        passwordHash: hashPassword(password),
        nickname: nickname ?? username,
        world: { create: {} },
      },
    });
    await login(res, user.id);
    res.json({ ok: true });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      res.status(409).json({ error: "이미 사용 중인 아이디입니다." });
      return;
    }
    throw e;
  }
});
app.post("/api/login", async (req, res) => {
  const p = credentials.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "로그인 정보를 확인하세요." });
    return;
  }
  const u = await db.user.findUnique({ where: { username: p.data.username } });
  if (
    !verifyPassword(
      p.data.password,
      u?.passwordHash ?? hashPassword("dummy-password"),
    ) ||
    !u
  ) {
    res.status(401).json({ error: "아이디 또는 비밀번호가 다릅니다." });
    return;
  }
  await login(res, u.id);
  res.json({ ok: true });
});
app.get("/api/me", async (req, res) => {
  const u = await authenticate(req);
  if (!u) {
    res.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  const chests = u.world ? await openedChests(u.world.id) : [];
  res.json({
    id: u.id,
    nickname: u.nickname,
    world: u.world
      ? {
          ...u.world,
          progress: {
            ...(u.world.progress as object),
            ...(chests.length ? { chests } : {}),
          },
        }
      : null,
  });
});
app.post("/api/logout", async (req, res) => {
  const raw = readCookie(req.headers.cookie);
  if (raw) {
    await db.session.deleteMany({ where: { id: sessionId(raw) } });
    for (const socket of io.sockets.sockets.values()) {
      if (readCookie(socket.request.headers.cookie) === raw)
        socket.disconnect(true);
    }
  }
  res.clearCookie("solara", { path: "/" });
  res.json({ ok: true });
});
app.post("/api/world/chest", async (req, res) => {
  const u = await authenticate(req);
  if (!u?.world) {
    res.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  try {
    const opened = await serial(() =>
      openChest(u.id, req.body?.worldId, req.body?.chestId, u.world!.id),
    );
    const chests = await openedChests(u.world.id);
    io.to(`world:${u.world.id}`).emit("world:chests", chests);
    res.json({ opened, chests });
  } catch (error) {
    if (error instanceof WorldError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});
app.get("/api/health", async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected", phase: 10 });
  } catch {
    res.status(503).json({ status: "unavailable", database: "disconnected" });
  }
});
io.use(async (socket, next) => {
  if (!serverReady) {
    next(new Error("서버 시작 중입니다."));
    return;
  }
  try {
    const user = await userFromCookie(socket.request.headers.cookie);
    if (!user) {
      next(new Error("로그인이 필요합니다."));
      return;
    }
    socket.data.userId = user.id;
    socket.data.worldId = user.world?.id;
    next();
  } catch {
    next(new Error("인증 서버에 연결할 수 없습니다."));
  }
});
const flushExploration = registerExploration(io);
app.use("/api/social", socialRouter);
app.use("/api/training", trainingRouter);
app.use("/api/economy", economyRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/battle", registerCombat(io));
app.use("/api/coop", registerCoop(io));
app.use("/api/story", registerStory(io));

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error instanceof Error ? error.message : "Server error");
    res.status(500).json({ error: "서버 요청에 실패했습니다." });
  },
);
const port = Number(process.env.PORT ?? 3001);
http.listen(port, "0.0.0.0", () => {
  void recoverCoop()
    .then(() => {
      serverReady = true;
      console.log(`Game server listening on ${port}`);
    })
    .catch((error) => {
      console.error(
        "Startup recovery failed:",
        error instanceof Error ? error.message : "unknown",
      );
      http.close();
      process.exit(1);
    });
});
async function stop() {
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await flushExploration();
  http.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
