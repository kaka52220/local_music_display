// Optional browser integration test: install playwright-core; start server first.
import { fileURLToPath } from 'node:url';
import {chromium} from 'playwright-core';import assert from 'node:assert/strict';
const b=await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.addInitScript(()=>{if(!sessionStorage.s){sessionStorage.s=1;localStorage.clear();localStorage.setItem('local-player/bg/v1','"fluid"');}});
await p.goto(`${process.env.PLAYER_URL || 'http://localhost:8080'}/?audiodebug`);await p.waitForTimeout(1000);await p.locator('.ph-song').nth(1).click();await p.waitForTimeout(500);
await p.evaluate(()=>window.__engine.pause());await p.waitForTimeout(500);
console.log('paused mini rotation',await p.evaluate(()=>getComputedStyle(document.querySelector('.ph-mini-cover')).animationPlayState));
assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('.ph-mini-cover')).animationPlayState),'paused');
await p.evaluate(()=>window.__engine.resume());await p.waitForTimeout(500);
assert.equal(await p.evaluate(()=>getComputedStyle(document.querySelector('.ph-mini-cover')).animationPlayState),'running');
// Progress drag via native input (real pointer), verify thumb maps 1:1 to range.
await p.evaluate(()=>window.__engine.pause());const r=await p.locator('#ph-slider').boundingBox();
await p.mouse.move(r.x+20,r.y+22);await p.mouse.down();await p.mouse.move(r.x+r.width*.7,r.y+22,{steps:12});await p.mouse.up();await p.waitForTimeout(600);
const ratio=await p.evaluate(()=>window.__engine.getCurrentTime()/window.__engine.getDuration());console.log('seek ratio',ratio);assert(Math.abs(ratio-.7)<.025);
// Fluid canvas actually renders inside the moving phone dialog
assert.equal(await p.evaluate(()=>document.querySelector('#bg-fluid').closest('#ph-player')?.id),'ph-player');
await p.screenshot({path:fileURLToPath(new URL('../screenshots/v10/390x844-fluid.png', import.meta.url))});
// Touch swipe through CDP, not just synthetic mouse
const cdp=await ctx.newCDPSession(p);const cr=await p.locator('#ph-cover-toggle').boundingBox();const x=cr.x+80,y=cr.y+60;
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
for(let i=1;i<=12;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+i*16}]});
console.log('touch drag',await p.evaluate(()=>new DOMMatrix(getComputedStyle(document.querySelector('#ph-player')).transform).m42));
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(400);assert.equal(await p.locator('.ph-player.is-open').count(),0);
// Portrait -> landscape -> tablet -> phone: nodes restored, no sound reset
await p.setViewportSize({width:844,height:390});await p.waitForTimeout(200);assert(await p.evaluate(()=>document.documentElement.classList.contains('phone-ui')));
await p.setViewportSize({width:1280,height:800});await p.waitForTimeout(400);
assert.equal(await p.evaluate(()=>document.documentElement.classList.contains('phone-ui')),false);
assert.equal(await p.evaluate(()=>document.getElementById('lyrics-wrap').parentElement.id),'info-col');
assert.equal(await p.evaluate(()=>document.querySelector('.bg').parentElement.id),'app');
await p.setViewportSize({width:390,height:844});await p.waitForTimeout(300);await p.click('#ph-mini-open');await p.waitForTimeout(400);
assert.equal(await p.evaluate(()=>document.getElementById('lyrics-wrap').parentElement.id),'ph-lyrics-slot');
// Track changes within the same mounted shell
await p.click('#ph-next');await p.waitForTimeout(500);assert.match(await p.textContent('#ph-title'),/回家/);
console.log('extra errors',errors);assert.equal(errors.length,0);await ctx.close();
// Reduced motion
const red=await b.newContext({viewport:{width:360,height:780},hasTouch:true,isMobile:true,reducedMotion:'reduce'});const q=await red.newPage();q.on('pageerror',e=>errors.push(e.message));await q.goto(`${process.env.PLAYER_URL || 'http://localhost:8080'}/?audiodebug`);await q.waitForTimeout(800);await q.locator('.ph-song').first().click();await q.waitForTimeout(100);
assert.equal(await q.evaluate(()=>getComputedStyle(document.querySelector('.ph-mini-cover')).animationName),'none');console.log('reduced motion',await q.evaluate(()=>getComputedStyle(document.querySelector('.ph-player')).transitionDuration));
await red.close();await b.close();
