// Optional browser integration test: install playwright-core; start server first.
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const O = fileURLToPath(new URL('../screenshots/v10/', import.meta.url));
mkdirSync(O, {recursive:true});
const b=await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const errors=[];
for(const [w,h] of [[360,780],[390,844],[412,915],[844,390]]){
 const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:1,hasTouch:true,isMobile:true});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.addInitScript(()=>{localStorage.clear();localStorage.setItem('local-player/layout/v1','"split"');});
 await p.goto(`${process.env.PLAYER_URL || 'http://localhost:8080'}/?audiodebug`);await p.waitForTimeout(1100);
 const shot=n=>p.screenshot({path:O+`${w}x${h}-${n}.png`});
 assert(await p.evaluate(()=>document.documentElement.classList.contains('phone-ui')));
 await shot('01-library');
 await p.locator('.ph-song').nth(1).click();await p.waitForTimeout(400);
 await shot('03-cover');
 console.log(w,h,'phone geometry',await p.evaluate(()=>({scroll:[document.documentElement.scrollWidth,innerWidth],art:document.querySelector('#ph-art').getBoundingClientRect().toJSON(),footer:document.querySelector('.ph-bottom').getBoundingClientRect().toJSON()})));
 // Lyrics timing shared with existing desktop view
 await p.evaluate(()=>window.__engine.seek(45));await p.click('#ph-cover-toggle');await p.waitForTimeout(700);
 await shot('04-lyrics');
 assert(await p.locator('.ph-show-lyrics').count());
 const before=await p.evaluate(()=>window.__clock.getUserOffset());
 await p.click('.ph-lyrics-slot .lo-btn[data-dir="1"]');
 assert(Math.abs((await p.evaluate(()=>window.__clock.getUserOffset()))-before-.1)<.001);
 await p.click('#ph-lyric-btn');await p.waitForTimeout(250);
 // Queue remains the actual shared sheet
 await p.click('#ph-queue');await p.waitForTimeout(450);await shot('06-queue');
 await p.evaluate(()=>document.getElementById('sheet-scrim').click());await p.waitForTimeout(350);
 await p.click('.ph-bottom [data-sleep-trigger]');await p.waitForTimeout(450);await shot('07-sleep');
 await p.click('#sl-close');await p.waitForTimeout(350);
 await p.click('#ph-close');await p.waitForTimeout(400);await shot('02-minibar-playing');
 // Freeze only player animation for a true midway sample.
 await p.evaluate(()=>{document.getElementById('ph-mini-open').click();document.getElementById('ph-player').getAnimations().forEach(a=>{a.pause();a.currentTime=110;});});
 await shot('05-mid-slide');await p.evaluate(()=>document.getElementById('ph-player').getAnimations().forEach(a=>a.play()));await p.waitForTimeout(400);
 // Real pointer gesture: drag tracks exactly, short drag springs back, long drag closes.
 await p.evaluate(()=>{document.getElementById('ph-close').blur();});
 const r=await p.locator('#ph-cover-toggle').boundingBox();
 const x=r.x+r.width/2,y=r.y+r.height/2;
 await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x,y+45,{steps:5});
 const dy=await p.evaluate(()=>new DOMMatrix(getComputedStyle(document.getElementById('ph-player')).transform).m42);
 console.log(w,'drag dy',dy);assert(Math.abs(dy-45)<2);
 await p.waitForTimeout(150);await p.mouse.up();await p.waitForTimeout(350);assert(await p.locator('.ph-player.is-open').count());
 await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x,y+190,{steps:10});await p.mouse.up();await p.waitForTimeout(400);
 assert.equal(await p.locator('.ph-player.is-open').count(),0);
 // Search and no result
 await p.click('#ph-search-btn');await p.fill('#ph-search','不存在的歌');assert.equal(await p.locator('.ph-song').count(),0);
 await p.click('#ph-search-btn');assert.equal(await p.locator('.ph-song').count(),3);
 await ctx.close();
}
console.log('errors',errors);assert.equal(errors.length,0);await b.close();
