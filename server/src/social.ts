import { Router } from "express";
import { z } from "zod";
import { authenticate, db } from "./auth.js";
import {
  serial,
  WorldError,
  getActor,
  onlineActors,
  enterWorld,
  switchWorld,
  blockVisitors,
  notifySocial,
} from "./exploration.js";
export const socialRouter = Router();
const name = z.string().regex(/^[a-zA-Z0-9_]{3,24}$/);
const id = z.string().min(1).max(80);
const decision = z.enum(["accept", "reject"]);
const access = z.enum(["invite", "request", "blocked"]);
const fresh = () => new Date(Date.now() - 5 * 60000);
socialRouter.use(async (req, res, next) => {
  const user = await authenticate(req);
  if (!user?.world) {
    res.status(401).json({ error: "로그인이 필요합니다." });
    return;
  }
  res.locals.user = user;
  next();
});
socialRouter.get("/", async (_req, res) => {
  const user = res.locals.user;
  const [friends, entries, live] = await Promise.all([
    db.friend.findMany({
      where: {
        OR: [{ senderId: user.id }, { receiverId: user.id }],
        status: { in: ["pending", "accepted"] },
      },
      include: {
        sender: { select: { id: true, nickname: true, username: true } },
        receiver: { select: { id: true, nickname: true, username: true } },
      },
    }),
    db.worldEntry.findMany({
      where: {
        OR: [{ senderId: user.id }, { receiverId: user.id }],
        status: "pending",
        createdAt: { gte: fresh() },
      },
      include: {
        sender: { select: { nickname: true } },
        receiver: { select: { nickname: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    onlineActors(),
  ]);
  const actor = live.find((a) => a.userId === user.id);
  const current = actor
    ? await db.world.findUnique({
        where: { id: actor.worldId },
        include: { owner: { select: { nickname: true } } },
      })
    : null;
  res.json({
    userId: user.id,
    access: user.world.access,
    currentWorld: current
      ? {
          id: current.id,
          owner: current.owner.nickname,
          isOwner: current.ownerId === user.id,
        }
      : null,
    players: live
      .filter((a) => a.worldId === actor?.worldId)
      .map((a) => ({
        id: a.userId,
        nickname: a.nickname,
        isOwner: a.homeWorldId === a.worldId,
      })),
    friends: friends.map((f) => {
      const other = f.senderId === user.id ? f.receiver : f.sender;
      return {
        id: f.id,
        status: f.status,
        incoming: f.receiverId === user.id,
        other,
        online: live.some((a) => a.userId === other.id),
      };
    }),
    entries: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      incoming: e.receiverId === user.id,
      sender: e.sender.nickname,
      receiver: e.receiver.nickname,
    })),
  });
});
socialRouter.post("/:action", async (req, res, next) => {
  try {
    const result = await serial(async () => {
      const u = res.locals.user;
      switch (req.params.action) {
        case "friend": {
          const username = name.parse(req.body?.username);
          const other = await db.user.findUnique({ where: { username } });
          if (!other || other.id === u.id)
            throw new WorldError(
              400,
              "다른 플레이어의 정확한 아이디를 입력하세요.",
            );
          const existing = await db.friend.findFirst({
            where: {
              OR: [
                { senderId: u.id, receiverId: other.id },
                { senderId: other.id, receiverId: u.id },
              ],
            },
          });
          if (existing && ["pending", "accepted"].includes(existing.status))
            throw new WorldError(409, "이미 친구이거나 요청이 있습니다.");
          if (
            (await db.friend.count({
              where: { senderId: u.id, status: "pending" },
            })) >= 100
          )
            throw new WorldError(409, "대기 중인 요청이 너무 많습니다.");
          if (existing)
            await db.friend.update({
              where: { id: existing.id },
              data: { senderId: u.id, receiverId: other.id, status: "pending" },
            });
          else
            await db.friend.create({
              data: { senderId: u.id, receiverId: other.id },
            });
          return { message: "친구 요청을 보냈습니다." };
        }
        case "friend-answer": {
          const request = await db.friend.findUnique({
            where: { id: id.parse(req.body?.id) },
          });
          const answer = decision.parse(req.body?.decision);
          if (
            !request ||
            request.receiverId !== u.id ||
            request.status !== "pending"
          )
            throw new WorldError(403, "처리할 수 없는 친구 요청입니다.");
          await db.friend.update({
            where: { id: request.id },
            data: { status: answer === "accept" ? "accepted" : "rejected" },
          });
          return {
            message:
              answer === "accept"
                ? "친구가 되었습니다."
                : "친구 요청을 거절했습니다.",
          };
        }
        case "access": {
          const value = access.parse(req.body?.access);
          if (value === "blocked") {
            await db.$transaction([
              db.world.update({
                where: { ownerId: u.id },
                data: { access: value },
              }),
              db.worldEntry.updateMany({
                where: { hostId: u.id, status: "pending" },
                data: { status: "rejected" },
              }),
            ]);
            await blockVisitors(u.world.id);
          } else
            await db.world.update({
              where: { ownerId: u.id },
              data: { access: value },
            });
          return { message: "월드 접근 설정을 저장했습니다." };
        }
        case "invite":
        case "request": {
          const kind = req.params.action;
          const other = await db.user.findUnique({
            where: { username: name.parse(req.body?.username) },
            include: { world: true },
          });
          if (!other?.world || other.id === u.id)
            throw new WorldError(
              400,
              "다른 플레이어의 정확한 아이디를 입력하세요.",
            );
          const hostId = kind === "invite" ? u.id : other.id,
            visitorId = kind === "invite" ? other.id : u.id;
          const world = await db.world.findUniqueOrThrow({
            where: { ownerId: hostId },
          });
          if (
            world.access === "blocked" ||
            (kind === "request" && world.access !== "request")
          )
            throw new WorldError(
              403,
              "이 월드는 진입 신청 또는 초대를 허용하지 않습니다.",
            );
          const host = await getActor(hostId);
          if (!host?.sockets.size || host.worldId !== host.homeWorldId)
            throw new WorldError(
              409,
              "월드 소유자가 자신의 월드에 접속해 있어야 합니다.",
            );
          if (
            kind === "invite" &&
            !(await db.friend.findFirst({
              where: {
                status: "accepted",
                OR: [
                  { senderId: u.id, receiverId: other.id },
                  { senderId: other.id, receiverId: u.id },
                ],
              },
            }))
          )
            throw new WorldError(403, "수락한 친구에게만 초대할 수 있습니다.");
          const pending = await db.worldEntry.findFirst({
            where: {
              hostId,
              status: "pending",
              createdAt: { gte: fresh() },
              OR: [{ senderId: visitorId }, { receiverId: visitorId }],
            },
          });
          if (pending)
            throw new WorldError(
              409,
              "이미 대기 중인 초대 또는 신청이 있습니다.",
            );
          if (
            (await db.worldEntry.count({
              where: {
                senderId: u.id,
                status: "pending",
                createdAt: { gte: fresh() },
              },
            })) >= 100
          )
            throw new WorldError(409, "대기 중인 신청이 너무 많습니다.");
          await db.worldEntry.create({
            data: { kind, hostId, senderId: u.id, receiverId: other.id },
          });
          return {
            message:
              kind === "invite"
                ? "월드 초대를 보냈습니다."
                : "월드 진입을 신청했습니다.",
          };
        }
        case "entry-answer": {
          const entry = await db.worldEntry.findUnique({
            where: { id: id.parse(req.body?.id) },
          });
          const answer = decision.parse(req.body?.decision);
          if (
            !entry ||
            entry.receiverId !== u.id ||
            entry.status !== "pending" ||
            entry.createdAt < fresh()
          )
            throw new WorldError(403, "처리할 수 없거나 만료된 요청입니다.");
          if (answer === "reject") {
            await db.worldEntry.update({
              where: { id: entry.id },
              data: { status: "rejected" },
            });
            return { message: "요청을 거절했습니다." };
          }
          const world = await db.world.findUniqueOrThrow({
            where: { ownerId: entry.hostId },
          });
          if (
            world.access === "blocked" ||
            (entry.kind === "request" && world.access !== "request")
          )
            throw new WorldError(403, "월드 접근 설정이 변경되었습니다.");
          const visitorId =
            entry.kind === "invite" ? entry.receiverId : entry.senderId;
          await enterWorld(visitorId, entry.hostId);
          await db.worldEntry.update({
            where: { id: entry.id },
            data: { status: "accepted" },
          });
          return { message: "월드에 입장했습니다." };
        }
        case "leave": {
          const actor = await getActor(u.id);
          if (!actor?.sockets.size)
            throw new WorldError(409, "월드에 먼저 접속하세요.");
          await switchWorld(
            actor,
            actor.homeWorldId,
            "개인 월드로 돌아왔습니다.",
          );
          return { message: "개인 월드로 돌아왔습니다." };
        }
        default:
          throw new WorldError(404, "알 수 없는 요청입니다.");
      }
    });
    notifySocial();
    res.json(result);
  } catch (error) {
    if (error instanceof WorldError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "입력 내용을 확인하세요." });
      return;
    }
    next(error);
  }
});
