/** Phone-only shell. The engine, lyrics DOM/clock, likes and sheets remain shared.
 * <=600px always; short coarse-pointer landscape <=950px also stays in the phone shell.
 * No device sniffing. Desktop DOM is restored on leaving this media query.
 */
import { ICONS } from './icons.mjs';
import { bindTransport } from './transport.mjs';
const QUERY = '(max-width: 600px), (max-width: 950px) and (max-height: 500px) and (pointer: coarse)';
const arrow = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const DOWN = arrow('M5 9l7 7 7-7');
const NOTE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3v10.55A4 4 0 1014 17V7h4V3z"/></svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createPhone(engine, { sheet, mini }) {
  const app = document.getElementById('app');
  const root = document.createElement('div');
  root.className = 'phone-root'; root.inert = true;
  root.innerHTML = `
    <section class="ph-library" aria-label="本地音乐库">
      <header class="ph-lib-top"><span>我的音乐</span><button class="ph-btn" id="ph-search-btn" aria-label="搜索歌曲">${ICONS.search}</button></header>
      <div class="ph-lib-scroll" id="ph-lib-scroll">
        <div class="ph-hero"><div class="ph-montage" aria-hidden="true"></div><div class="ph-heading"><span class="ph-library-mark">${ICONS.library}</span><h1>本地音乐库</h1><p id="ph-count">正在加载音乐…</p></div></div>
        <div class="ph-all"><button class="ph-btn ph-red" id="ph-playall" aria-label="播放全部">${ICONS.play}</button><div><b>播放全部</b><small id="ph-total">0 首歌曲</small></div></div>
        <label class="ph-search" hidden>${ICONS.search}<input type="search" id="ph-search" placeholder="搜索歌名 / 歌手 / 专辑" autocomplete="off" aria-label="搜索音乐"></label>
        <ul class="ph-list" id="ph-list" aria-label="歌曲"></ul><p class="ph-empty" hidden>没有找到匹配的歌曲</p>
      </div>
      <div class="ph-minibar"><button class="ph-mini-open" id="ph-mini-open" aria-label="展开播放页"><span class="ph-mini-cover"></span><span class="ph-mini-text"><b id="ph-mini-title">未在播放</b><small id="ph-mini-artist">选择一首歌曲</small></span></button><button class="ph-btn" id="ph-mini-play" aria-label="播放"></button><button class="ph-btn" id="ph-mini-queue" aria-label="打开播放队列">${ICONS.playlist}</button></div>
    </section>
    <section class="ph-player" id="ph-player" role="dialog" aria-modal="true" aria-label="正在播放" aria-hidden="true" inert>
      <header class="ph-play-top" id="ph-play-top"><button class="ph-btn" id="ph-close" aria-label="收起播放页">${DOWN}</button><div><b id="ph-top-title">本地音乐库</b><small id="ph-top-artist"></small></div><span class="ph-top-spacer"></span></header>
      <div class="ph-main" id="ph-main"><button class="ph-cover-toggle" id="ph-cover-toggle" aria-label="查看歌词"><span class="ph-art" id="ph-art"></span><span class="ph-cover-hint">轻触封面 · 查看歌词</span></button><div class="ph-lyrics-slot" id="ph-lyrics-slot"></div></div>
      <div class="ph-meta"><div><h2 id="ph-title">未在播放</h2><p id="ph-artist">选择一首歌曲</p></div><div id="ph-like-slot"></div></div>
      <div class="ph-progress"><input class="progress" type="range" id="ph-slider" min="0" max="10000" step="1" value="0" aria-label="播放进度"><div><span id="ph-cur">00:00</span><span id="ph-duration">00:00</span></div></div>
      <div class="ph-controls"><button class="ph-btn" id="ph-mode" aria-label="播放模式"></button><button class="ph-btn" id="ph-prev" aria-label="上一首"></button><button class="ph-btn ph-play" id="ph-play" aria-label="播放"></button><button class="ph-btn" id="ph-next" aria-label="下一首"></button><button class="ph-btn" id="ph-queue" aria-label="播放队列">${ICONS.playlist}</button></div>
      <footer class="ph-bottom"><button class="sleep-btn" data-sleep-trigger aria-haspopup="dialog" aria-label="定时关闭"></button><button class="ph-lyric-btn" id="ph-lyric-btn" aria-pressed="false">${ICONS.lyric}<span>歌词</span></button></footer>
    </section>`;
  app.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const player = $('#ph-player');
  const lib = $('.ph-library');
  const lyrics = document.getElementById('lyrics-wrap');
  const bg = document.querySelector('.bg');
  const like = document.getElementById('btn-like');
  // Mark original homes; restoring uses the exact original nodes, not copies.
  const moves = [[lyrics, $('#ph-lyrics-slot')], [bg, player], [like, $('#ph-like-slot')]].map(([el, target]) => {
    const home = document.createComment('phone reparent home'); el.before(home); return { el, target, home };
  });
  bindTransport(engine, { play: $('#ph-play'), prev: $('#ph-prev'), next: $('#ph-next'), mode: $('#ph-mode'), slider: $('#ph-slider'), cur: $('#ph-cur'), total: $('#ph-duration') });
  bindTransport(engine, { play: $('#ph-mini-play') });
  [$('#ph-queue'), $('#ph-mini-queue')].forEach(b => b.addEventListener('click', () => sheet.open()));
  let active = false, opened = false, lyric = false, tracks = [], current = null;
  let savedMini = false;
  const mq = matchMedia(QUERY);
  function syncAccessible() {
    player.inert = !active || !opened;
    player.setAttribute('aria-hidden', String(!opened));
    lib.inert = opened;
  }
  function setOpen(v) {
    if (!active || (v && !current)) return;
    opened = v;
    player.classList.toggle('is-open', v);
    syncAccessible();
    if (v) { player.style.removeProperty('transform'); requestAnimationFrame(() => $('#ph-close').focus({preventScroll:true})); }
    else { player.style.removeProperty('transform'); $('#ph-mini-open').focus({preventScroll:true}); }
  }
  function setLyrics(v) {
    lyric = v; player.classList.toggle('ph-show-lyrics', v);
    $('#ph-lyric-btn').setAttribute('aria-pressed', String(v));
    $('#ph-lyric-btn span').textContent = v ? '封面' : '歌词';
    $('#ph-top-title').textContent = v ? current?.title || '歌词' : '本地音乐库';
    $('#ph-top-artist').textContent = v ? current?.artist || '' : '';
  }
  $('#ph-close').addEventListener('click', () => setOpen(false));
  $('#ph-mini-open').addEventListener('click', () => setOpen(true));
  $('#ph-cover-toggle').addEventListener('click', () => { if (!suppressTap) setLyrics(true); });
  $('#ph-lyric-btn').addEventListener('click', () => setLyrics(!lyric));
  // A tap on lyrics returns to cover; an actual scroll/scrub is left to lyricsView.
  let tap = null;
  $('#ph-lyrics-slot').addEventListener('pointerdown', e => { tap = {x:e.clientX,y:e.clientY,moved:false,scrubbing:lyrics.classList.contains('scrub-on')}; });
  $('#ph-lyrics-slot').addEventListener('pointermove', e => { if(tap && Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>6) tap.moved=true; });
  $('#ph-lyrics-slot').addEventListener('pointercancel', () => {tap=null;});
  $('#ph-lyrics-slot').addEventListener('click', e => { if(tap && !tap.moved && !tap.scrubbing && !e.target.closest('button, .scrub')) setLyrics(false); tap=null; });
  // Reliable swipe dismissal has a dedicated non-scroll surface (header/cover).
  // Never steals lyric dragging, progress seeking, or a control button press.
  let drag = null, suppressTap = false;
  const swipeSurfaces = [$('#ph-play-top'), $('#ph-cover-toggle')];
  swipeSurfaces.forEach(surface => {
    surface.addEventListener('pointerdown', e => {
      if(drag || !active || !opened || e.button!==0 || (e.target.closest('button') && surface.id!=='ph-cover-toggle')) return;
      if(player.getAnimations().some(a=>a.playState==='running')) return;
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,lastY:e.clientY,lastT:e.timeStamp,v:0,dy:0,started:false};
    });
    surface.addEventListener('pointermove', e => {
      if(!drag || drag.id!==e.pointerId) return;
      const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
      if(!drag.started){
        if(Math.abs(dx)<8 && Math.abs(dy)<8) return;
        if(dy<=0 || Math.abs(dx)>dy){drag=null;return;}
        drag.started=true; surface.setPointerCapture(e.pointerId); player.classList.add('is-dragging'); suppressTap=true;
      }
      const dt=e.timeStamp-drag.lastT;
      if(dt>0) drag.v=(e.clientY-drag.lastY)/dt;
      drag.lastY=e.clientY;drag.lastT=e.timeStamp;drag.dy=Math.max(0,dy);
      player.style.transform=`translate3d(0,${drag.dy}px,0)`;
    });
    function finish(e){
      if(!drag || e.pointerId!==drag.id) return;
      const d=drag;drag=null;player.classList.remove('is-dragging');
      if(d.started){
        const fast=e.timeStamp-d.lastT<100 && d.v>0.5 && d.dy>40;
        setOpen(!(d.dy>Math.min(150,player.clientHeight*.2) || fast) || e.type==='pointercancel');
        setTimeout(()=>{suppressTap=false;},0);
      }
    }
    surface.addEventListener('pointerup',finish);surface.addEventListener('pointercancel',finish);
  });
  function renderList(){
    const q=$('#ph-search').value.trim().toLowerCase();
    const rows=tracks.map((t,i)=>({t,i})).filter(({t})=>!q || [t.title,t.artist,t.album].some(v=>(v||'').toLowerCase().includes(q)));
    $('#ph-list').innerHTML=rows.map(({t,i})=>`<li><button class="ph-song${t.id===current?.id?' is-current':''}" data-index="${i}" ${t.id===current?.id?'aria-current="true"':''}><span class="ph-song-cover">${t.coverUrl?`<img src="${esc(t.coverUrl)}" alt="" loading="lazy">`:NOTE}</span><span class="ph-song-text"><b>${esc(t.title)}</b><small>${esc(t.artist)}${t.album?` · ${esc(t.album)}`:''}</small></span>${t.id===current?.id?'<span class="ph-playing-mark" aria-label="当前歌曲"><i></i><i></i><i></i></span>':''}</button></li>`).join('');
    $('.ph-empty').hidden=rows.length>0;
    $('.ph-empty').textContent=tracks.length?'没有找到匹配的歌曲':'音乐目录中还没有歌曲';
    $('#ph-count').textContent=`${tracks.length} 首歌曲 · 随时聆听`;
    $('#ph-total').textContent=`${tracks.length} 首歌曲`;
    $('#ph-playall').disabled=!tracks.length;
  }
  function play(i){
    if(i===engine.getIndex()){if(!engine.isPlaying())engine.toggle();}else engine.playAt(i);
    setOpen(true);
  }
  $('#ph-list').addEventListener('click', e=>{const row=e.target.closest('[data-index]');if(row)play(Number(row.dataset.index));});
  $('#ph-playall').addEventListener('click',()=>{if(tracks.length)play(0);});
  // The shared queue selects the track first; reveal the phone page afterwards.
  document.getElementById('sheet-list').addEventListener('click',e=>{if(active && e.target.closest('.song'))setOpen(true);});
  document.getElementById('sa-playall').addEventListener('click',()=>{if(active && tracks.length)setOpen(true);});
  $('#ph-search-btn').addEventListener('click',()=>{
    const label=$('.ph-search');label.hidden=!label.hidden;
    if(!label.hidden){$('#ph-search').focus();$('#ph-lib-scroll').scrollTop=$('.ph-hero').offsetHeight;}
    else{$('#ph-search').value='';renderList();}
  });
  $('#ph-search').addEventListener('input',renderList);
  function setTracks(ts){
    tracks=ts;renderList();
    const covers=tracks.filter(t=>t.coverUrl).slice(0,6);
    $('.ph-montage').innerHTML=covers.map(t=>`<img src="${esc(t.coverUrl)}" alt="">`).join('');
  }
  engine.on('queuechange',({queue})=>setTracks(queue));
  engine.on('trackchange',({track})=>{
    const same=track.id===current?.id; current=track;
    $('#ph-title').textContent=$('#ph-mini-title').textContent=track.title;
    $('#ph-artist').textContent=$('#ph-mini-artist').textContent=track.artist||'未知歌手';
    const cover=track.coverUrl?`<img src="${esc(track.coverUrl)}" alt="" draggable="false">`:NOTE;
    $('#ph-art').innerHTML=cover;$('.ph-mini-cover').innerHTML=cover;
    if(!same){$('.ph-mini-cover').getAnimations().forEach(a=>a.currentTime=0);}
    setLyrics(lyric);renderList();
  });
  document.addEventListener('keydown',e=>{if(active && opened && e.key==='Escape' && !sheet.isOpen() && !app.classList.contains('sleep-open'))setOpen(false);});
  function updateMode(){
    const wasActive=active;
    active=mq.matches;
    document.documentElement.classList.toggle('phone-ui',active);
    root.inert=!active;
    if(active){
      if(!wasActive) savedMini=mini.isOpen();
      mini.setOpen(false,{animate:false,persist:false});
      moves.forEach(({el,target})=>target.prepend(el));
    }else{
      drag=null;player.classList.remove('is-dragging');player.style.removeProperty('transform');
      moves.forEach(({el,home})=>home.after(el));
      if(wasActive && savedMini) mini.setOpen(true,{animate:false,persist:false});
    }
    syncAccessible();
  }
  mq.addEventListener('change',updateMode);updateMode();
  return {setTracks, setError:(message)=>{ $('#ph-count').textContent='音乐库加载失败'; $('.ph-empty').hidden=false; $('.ph-empty').textContent=message || '请检查网络后刷新重试'; }, isActive:()=>active, toggleLyrics:()=>{setOpen(true);setLyrics(!lyric);}, isLyricsOn:()=>lyric};
}
