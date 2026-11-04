import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
const base = process.env.TEST_BASE_URL, db = new PrismaClient();
async function fixture() {
  const user = await db.user.create({ data: { username: `avatarApi_${randomBytes(8).toString('hex')}`, nickname: "해안 여행자", passwordHash: "unused", world: { create: {} } } });
  const token = randomBytes(32).toString("hex");
  await db.session.create({ data: { userId: user.id, id: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now()+600000) } });
  const request = (path: string, body?: unknown) => fetch(base+path, { method: body === undefined ? "GET" : path === "/api/avatar" || path === "/api/settings" ? "PUT" : "POST", headers: { cookie: `solara=${token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { user, request, close: () => db.user.delete({ where: { id: user.id } }) };
}
test("avatar API requires authentication, equipped ownership and an account-scoped payload", { skip: !base }, async () => {
  assert.equal((await fetch(base+"/api/avatar")).status, 401);
  const f = await fixture();
  try {
    const initial = await (await f.request('/api/avatar')).json(); assert.deepEqual(initial, { avatarId: 'traveler', revision: 0, available: ['traveler'] });
    assert.equal((await f.request('/api/avatar',{avatarId:'haerin',expectedRevision:0})).status,403);
    assert.equal((await f.request('/api/avatar',{avatarId:'luna',expectedRevision:0})).status,400);
    assert.equal((await f.request('/api/avatar',{avatarId:'traveler',expectedRevision:0,userId:'other'})).status,400);
    await db.userCharacter.create({ data: { userId:f.user.id,characterId:'haerin',slot:null } });
    assert.equal((await f.request('/api/avatar',{avatarId:'haerin',expectedRevision:0})).status,403);
    await assert.rejects(db.userCharacter.update({where:{userId_characterId:{userId:f.user.id,characterId:'haerin'}},data:{slot:9}}));
    assert.equal((await f.request('/api/avatar',{avatarId:'haerin',expectedRevision:0})).status,403);
    await db.userCharacter.update({where:{userId_characterId:{userId:f.user.id,characterId:'haerin'}},data:{slot:0}});
    assert.equal((await f.request('/api/avatar',{avatarId:'haerin',expectedRevision:0})).status,200);
  } finally { await f.close(); }
});
test("avatar CAS and graphic settings revisions stay independent and survive another request", { skip: !base }, async () => {
  const f = await fixture();
  try {
    await f.request('/api/training');
    const settings = await (await f.request('/api/settings')).json(); assert.equal('avatarId' in settings,false);
    const saved = await f.request('/api/avatar',{avatarId:'haerin',expectedRevision:0}); assert.equal(saved.status,200);
    assert.equal((await f.request('/api/avatar',{avatarId:'traveler',expectedRevision:0})).status,409);
    const {revision,...values}=settings;
    assert.equal((await f.request('/api/settings',{...values,volume:27,expectedRevision:revision})).status,200);
    assert.deepEqual(await (await f.request('/api/avatar')).json(),{avatarId:'haerin',revision:1,available:['traveler','haerin']});
    assert.equal((await (await f.request('/api/settings')).json()).volume,27);
  } finally { await f.close(); }
});
test("party swaps retain Haerin but removal resets the avatar once even for duplicate team requests", { skip: !base }, async () => {
  const f=await fixture();
  try {
    await f.request('/api/training'); await f.request('/api/avatar',{avatarId:'haerin',expectedRevision:0});
    const team = async (characterId:string,slot:number) => {
      const state=await (await f.request('/api/economy')).json();
      const body={characterId,slot,expectedRevision:state.wallet.revision,requestId:randomBytes(12).toString('hex')};
      const response=await f.request('/api/economy/team',body); assert.equal(response.status,200); return body;
    };
    await team('luna',0); assert.equal((await (await f.request('/api/avatar')).json()).avatarId,'haerin');
    await db.userCharacter.create({data:{userId:f.user.id,characterId:'mira',slot:null}});
    const body=await team('mira',1);
    const reset=await (await f.request('/api/avatar')).json(); assert.deepEqual(reset,{avatarId:'traveler',revision:2,available:['traveler']});
    assert.equal((await f.request('/api/economy/team',body)).status,200);
    assert.deepEqual(await (await f.request('/api/avatar')).json(),reset);
  } finally { await f.close(); }
});
