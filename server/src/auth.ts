import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
export const db = new PrismaClient();
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function sessionId(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}
export function readCookie(raw: string = "") {
  return raw
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("solara="))
    ?.slice(7);
}
export async function userFromCookie(cookie?: string) {
  const raw = readCookie(cookie);
  if (!raw) return null;
  const session = await db.session.findUnique({
    where: { id: sessionId(raw) },
    include: { user: { include: { world: true } } },
  });
  return session && session.expiresAt > new Date() ? session.user : null;
}
export async function authenticate(req: Request) {
  return userFromCookie(req.headers.cookie);
}
export async function login(res: Response, userId: string) {
  const raw = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      id: sessionId(raw),
      userId,
      expiresAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  res.cookie("solara", raw, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 86400000,
    path: "/",
  });
}
