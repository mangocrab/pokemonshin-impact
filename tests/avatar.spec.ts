import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";
test("Haerin is selected lazily, walks in four directions, restores and respects quality or load failure", async ({page,context},info)=>{
  test.setTimeout(90000);const db=new PrismaClient(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const u=await db.user.create({data:{username:`webAvatar_${Date.now()}`,nickname:'해린 산책',passwordHash:'unused',world:{create:{positionX:1200,positionY:900}}}});
  const token=randomBytes(32).toString('hex'); await db.session.create({data:{userId:u.id,id:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+600000)}});
  await context.addCookies([{name:'solara',value:token,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Strict'}]);
  let downloads=0;page.on('request',r=>{if(r.url().endsWith('/haerin-avatar.webp'))downloads++;});
  const surface=page.locator('.game'), relief=()=>surface.evaluate(el=>JSON.parse((el as HTMLElement).dataset.objectRelief!));
  async function choose(id:string){await page.getByRole('button',{name:'캐릭터',exact:true}).click();const panel=page.getByRole('dialog',{name:'캐릭터',exact:true});await panel.getByLabel('탐험 모습',{exact:true}).selectOption(id);await panel.getByRole('button',{name:'탐험 모습 저장',exact:true}).click();await expect(panel.getByText('탐험 모습을 저장했습니다.',{exact:true})).toBeVisible();await panel.getByRole('button',{name:'닫기',exact:true}).click();}
  try{
    await page.goto('/');await expect(page.getByRole('status')).toContainText('불러왔습니다',{timeout:15000});expect(downloads).toBe(0);
    await choose('haerin');await expect(surface).toHaveAttribute('data-traveler-avatar','haerin',{timeout:15000});
    expect(downloads).toBe(1);await expect.poll(async()=>(await relief()).normalFrames).toBe(36);
    await surface.screenshot({path:info.outputPath('haerin-world.png')});
    for(const [key,direction] of [['ArrowRight','east'],['ArrowLeft','west'],['ArrowUp','north'],['ArrowDown','south']] as const){
      const poses=surface.evaluate((el,direction)=>new Promise<string[]>(resolve=>{const seen=new Set<string>(),read=()=>{const f=el.getAttribute('data-traveler-frame')!;if(f.startsWith(direction))seen.add(f);if(seen.has(`${direction}-1`)&&seen.has(`${direction}-2`)){observer.disconnect();clearTimeout(timer);resolve([...seen]);}};
        const observer=new MutationObserver(read),timer=setTimeout(()=>{observer.disconnect();resolve([...seen]);},3500);observer.observe(el,{attributes:true,attributeFilter:['data-traveler-frame']});read();}),direction);
      await page.keyboard.down(key);const frames=await poses;await page.keyboard.up(key);expect(frames).toEqual(expect.arrayContaining([`${direction}-1`,`${direction}-2`]));
      await expect(surface).toHaveAttribute('data-traveler-frame',`${direction}-0`);
      await expect(surface).toHaveAttribute('data-traveler-shadow',`cast-haerin-${direction}-0`);
    }
    await choose('traveler');await expect(surface).toHaveAttribute('data-traveler-avatar','traveler');await choose('haerin');await expect(surface).toHaveAttribute('data-traveler-avatar','haerin');expect(downloads).toBe(1);
    await page.reload();await expect(surface).toHaveAttribute('data-traveler-avatar','haerin',{timeout:15000});
    const prefs=await(await page.request.get('/api/settings')).json();const{revision,...values}=prefs;
    expect((await page.request.put('/api/settings',{data:{...values,quality:'low',reducedMotion:true,expectedRevision:revision}})).status()).toBe(200);
    await page.reload();await expect(surface).toHaveAttribute('data-traveler-avatar','haerin',{timeout:15000});await expect.poll(async()=>(await relief()).objects).toBeGreaterThan(0);expect((await relief()).atlases).toBe(0);
    await page.keyboard.down('ArrowRight');await expect(surface).toHaveAttribute('data-traveler-frame','east-0');await page.keyboard.up('ArrowRight');
    await surface.screenshot({path:info.outputPath('haerin-low.png')});
    await page.route('**/haerin-avatar.webp',r=>r.abort());await page.reload();await expect(page.getByRole('status')).toContainText('공통 여행자',{timeout:15000});await expect(surface).toHaveAttribute('data-traveler-avatar','traveler');
    expect(errors).toEqual([]);
  }finally{for(const key of ['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'])await page.keyboard.up(key).catch(()=>{});await page.request.post('/api/logout').catch(()=>{});await page.close();await db.user.delete({where:{id:u.id}});await db.$disconnect();}
});
