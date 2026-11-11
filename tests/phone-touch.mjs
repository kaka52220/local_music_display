// Native Chrome touch-event integration checks (optional playwright-core).
import {chromium} from 'playwright-core';import assert from 'node:assert/strict';
const b=await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const p=await ctx.newPage();await p.goto(`${process.env.PLAYER_URL || 'http://localhost:8080'}/?audiodebug`);await p.waitForTimeout(900);await p.locator('.ph-song').nth(1).click();await p.waitForTimeout(450);await p.evaluate(()=>window.__engine.pause());await p.waitForTimeout(300);const cdp=await ctx.newCDPSession(p);
const r=await p.locator('#ph-slider').boundingBox();const y=r.y+22;
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+10,y}]});
for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+10+(r.width*.6-10)*i/12,y}]});
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(500);
const ratio=await p.evaluate(()=>window.__engine.getCurrentTime()/window.__engine.getDuration());console.log('touch slider ratio',ratio);assert(Math.abs(ratio-.6)<.025);
await p.click('#ph-cover-toggle');await p.waitForTimeout(300);await p.evaluate(()=>window.__engine.seek(60));await p.waitForTimeout(400);
const lr=await p.locator('#lyrics-box').boundingBox(),x=lr.x+lr.width*.5,ly=lr.y+lr.height*.65;
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:ly}]});for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:ly-i*10}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(400);
console.log('lyrics drag',await p.evaluate(()=>({lyrics:document.querySelector('.ph-player').classList.contains('ph-show-lyrics'),scrub:document.querySelector('#lyrics-wrap').classList.contains('scrub-on'),open:document.querySelector('.ph-player').classList.contains('is-open')})));
assert(await p.locator('.ph-show-lyrics.is-open').count());assert(await p.locator('.scrub-on').count());
await b.close();
