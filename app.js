'use strict';

const DEFAULT_CONFIG = {
  version: 5,
  gmPin: '4826',
  treasureCode: '3147',
  countdownEnabled: true,
  unlockAt: '2026-10-31T15:45',
  locations: {
    mairie: { name: 'Mairie de Bissey-la-Côte', lat: 47.9128, lon: 4.71207, radius: 55, calibrated: false },
    eglise: { name: 'Église de la Nativité', lat: 47.91326, lon: 4.70868, radius: 55, calibrated: false },
    fontaine: { name: "Fontaine-abreuvoir, rue de l'Abreuvoir", lat: null, lon: null, radius: 55, calibrated: false },
    chapelle: { name: 'Chapelle Sainte-Madeleine de Layer-sur-Roche', lat: 47.89236, lon: 4.68423, radius: 60, calibrated: false }
  },
  walkThresholds: { shadow1: 2300, observer: 1900, memoryShow: 1500, memoryTest: 1200, shadow3: 800, approach: 300 }
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');
const LOCAL_TEST = new URLSearchParams(window.location.search).get('test') === '1';
let simulatedPosition = false;
let activeWalkEvent = null;

function clone(v){ return JSON.parse(JSON.stringify(v)); }
function loadConfig(){
  try { return Object.assign(clone(DEFAULT_CONFIG), JSON.parse(localStorage.getItem('veilleurs_config') || '{}')); }
  catch { return clone(DEFAULT_CONFIG); }
}
function mergeConfig(raw){
  const base = clone(DEFAULT_CONFIG);
  if(raw && typeof raw === 'object'){
    if(raw.gmPin) base.gmPin = String(raw.gmPin);
    if(raw.treasureCode) base.treasureCode = String(raw.treasureCode);
    if(typeof raw.countdownEnabled === 'boolean') base.countdownEnabled = raw.countdownEnabled;
    if(raw.unlockAt) base.unlockAt = String(raw.unlockAt);
    if(raw.walkThresholds) Object.assign(base.walkThresholds, raw.walkThresholds);
    if(raw.locations){ for(const k of Object.keys(base.locations)){ if(raw.locations[k]) Object.assign(base.locations[k], raw.locations[k]); } }
  }
  return base;
}
let config = mergeConfig(loadConfig());
function saveConfig(){ localStorage.setItem('veilleurs_config', JSON.stringify(config)); }

let countdownTimer = null;
function unlockDate(){
  const d = new Date(config.unlockAt || '');
  return Number.isNaN(d.getTime()) ? null : d;
}
function adventureLocked(){
  if(LOCAL_TEST || !config.countdownEnabled || state?.startedAt) return false;
  const d=unlockDate();
  return d ? Date.now() < d.getTime() : false;
}
function countdownParts(){
  const d=unlockDate();
  if(!d) return null;
  const ms=Math.max(0,d.getTime()-Date.now());
  const total=Math.floor(ms/1000);
  return {days:Math.floor(total/86400),hours:Math.floor((total%86400)/3600),minutes:Math.floor((total%3600)/60),seconds:total%60};
}
function countdownHtml(){
  const d=unlockDate(), p=countdownParts();
  if(!d || !p) return '';
  return `<div class="countdown-lock"><div class="countdown-seal">✦</div><div class="countdown-kicker">Le Livre est encore scellé</div><div class="countdown-date">Ouverture le ${d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} à ${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div><div class="countdown-grid"><div><strong id="cdDays">${p.days}</strong><span>jours</span></div><div><strong id="cdHours">${String(p.hours).padStart(2,'0')}</strong><span>heures</span></div><div><strong id="cdMinutes">${String(p.minutes).padStart(2,'0')}</strong><span>minutes</span></div><div><strong id="cdSeconds">${String(p.seconds).padStart(2,'0')}</strong><span>secondes</span></div></div><p>Le moment venu, le sceau se déverrouillera de lui-même.</p></div>`;
}
function startCountdownTicker(){
  if(countdownTimer) clearInterval(countdownTimer);
  if(!adventureLocked()) return;
  countdownTimer=setInterval(()=>{
    if(!adventureLocked()){ clearInterval(countdownTimer); countdownTimer=null; renderHome(); return; }
    const p=countdownParts(); if(!p) return;
    const vals=[['#cdDays',p.days],['#cdHours',String(p.hours).padStart(2,'0')],['#cdMinutes',String(p.minutes).padStart(2,'0')],['#cdSeconds',String(p.seconds).padStart(2,'0')]];
    vals.forEach(([s,v])=>{const el=$(s); if(el) el.textContent=v;});
  },1000);
}

const DEFAULT_STATE = {
  screen: 'home',
  completed: [],
  fragments: {},
  hints: {},
  walk: { shadow1: false, observerDone: false, memoryShown: false, memoryDone: false, shadow3: false },
  memoryPattern: ['🌙','🐦‍⬛','🔥','☠️'],
  finalStep: 0,
  fearLevel: 0,
  startedAt: null
};
function loadState(){
  try { return Object.assign(clone(DEFAULT_STATE), JSON.parse(localStorage.getItem('veilleurs_state') || '{}')); }
  catch { return clone(DEFAULT_STATE); }
}
let state = loadState();
function saveState(){ localStorage.setItem('veilleurs_state', JSON.stringify(state)); }
function complete(id){ if(!state.completed.includes(id)) state.completed.push(id); saveState(); }
function resetGame(){ activeWalkEvent=null; state = clone(DEFAULT_STATE); saveState(); renderHome(); }

let currentPosition = null;
let geoWatchId = null;
let lastGeoError = null;
let wakeLock = null;
let audioCtx = null;
let ambientNodes = [];
let ambientTimer = null;
let ambientStep = 0;
let scareCooldown = false;
let soundEnabled = localStorage.getItem('veilleurs_sound') !== 'off';

function haptic(ms = 80){ try { navigator.vibrate?.(ms); } catch {} }
function getAudioCtx(){
  if(!soundEnabled) return null;
  try {
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}
function tone(freq = 130, dur = .18, type = 'sine', vol = .035){
  if(!soundEnabled) return;
  try {
    const A = getAudioCtx(); if(!A) return;
    const o = A.createOscillator(), g = A.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(A.destination); o.start();
    g.gain.exponentialRampToValueAtTime(.0001, A.currentTime + dur);
    o.stop(A.currentTime + dur);
  } catch {}
}
function ambientPadNote(freq, dur=4.8, vol=.018){
  if(!soundEnabled) return;
  try{
    const A=getAudioCtx(); if(!A) return;
    const o=A.createOscillator(), g=A.createGain(), f=A.createBiquadFilter(), d=A.createDelay(), fb=A.createGain(), wet=A.createGain();
    o.type='sine'; o.frequency.value=freq;
    f.type='lowpass'; f.frequency.value=1100;
    g.gain.setValueAtTime(.0001,A.currentTime);
    g.gain.exponentialRampToValueAtTime(vol,A.currentTime+.55);
    g.gain.exponentialRampToValueAtTime(.0001,A.currentTime+dur);
    d.delayTime.value=.34; fb.gain.value=.23; wet.gain.value=.32;
    o.connect(f); f.connect(g); g.connect(A.destination); g.connect(d); d.connect(wet); wet.connect(A.destination); d.connect(fb); fb.connect(d);
    o.start(); o.stop(A.currentTime+dur+.1);
  }catch{}
}
function ambientMusicTick(){
  if(!soundEnabled || !ambientNodes.length) return;
  const chords=[
    [146.83,174.61,220.00],
    [130.81,164.81,196.00],
    [110.00,146.83,174.61],
    [123.47,146.83,185.00]
  ];
  const c=chords[ambientStep%chords.length];
  c.forEach((n,i)=>setTimeout(()=>ambientPadNote(n,5.6,.014-(i*.002)),i*120));
  const melody=[293.66,261.63,220.00,246.94,293.66,329.63,261.63,220.00];
  const note=melody[ambientStep%melody.length];
  setTimeout(()=>ambientPadNote(note,2.8,.009),900);
  if(ambientStep%2===1) setTimeout(()=>ambientPadNote(note*2,2.2,.0045),1550);
  ambientStep++;
}
function startAmbient(){
  if(!soundEnabled || ambientNodes.length) return;
  try {
    const A = getAudioCtx(); if(!A) return;
    const master = A.createGain(); master.gain.value = .045;
    const filter = A.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1250;
    master.connect(filter); filter.connect(A.destination);

    const bass=A.createOscillator(), fifth=A.createOscillator();
    const bassGain=A.createGain(), fifthGain=A.createGain();
    bass.type='sine'; bass.frequency.value=73.42; bassGain.gain.value=.32;
    fifth.type='triangle'; fifth.frequency.value=110; fifthGain.gain.value=.09;
    bass.connect(bassGain); fifth.connect(fifthGain); bassGain.connect(master); fifthGain.connect(master);

    const noise=A.createBufferSource();
    const noiseBuffer=A.createBuffer(1,A.sampleRate*3,A.sampleRate);
    const data=noiseBuffer.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*.24;
    noise.buffer=noiseBuffer; noise.loop=true;
    const noiseFilter=A.createBiquadFilter(); noiseFilter.type='lowpass'; noiseFilter.frequency.value=700;
    const noiseGain=A.createGain(); noiseGain.gain.value=.022;
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(master);

    const pulse=A.createOscillator(), pulseGain=A.createGain();
    pulse.type='sine'; pulse.frequency.value=.16; pulseGain.gain.value=.008;
    pulse.connect(pulseGain); pulseGain.connect(master.gain);

    bass.start(); fifth.start(); noise.start(); pulse.start();
    ambientNodes=[bass,fifth,noise,pulse,bassGain,fifthGain,noiseFilter,noiseGain,pulseGain,master,filter];
    ambientMusicTick();
    ambientTimer=setInterval(ambientMusicTick,4800);
  } catch {}
}
function stopAmbient(){
  ambientNodes.forEach(n=>{ try{ n.stop?.(); }catch{} try{ n.disconnect?.(); }catch{} });
  ambientNodes=[];
  if(ambientTimer){ clearInterval(ambientTimer); ambientTimer=null; }
}
function updateSoundButton(){
  const b=$('#soundButton'); if(!b) return;
  b.textContent=soundEnabled?'🔊':'🔇';
  b.setAttribute('aria-label', soundEnabled?'Désactiver l’ambiance sonore':'Activer l’ambiance sonore');
}
function footsteps(){ tone(95,.12,'triangle',.025); setTimeout(()=>tone(75,.14,'triangle',.025),280); }
function bell(){ tone(196,.55,'sine',.035); setTimeout(()=>tone(98,.8,'sine',.02),90); }
function successSound(){ tone(293,.12,'sine',.025); setTimeout(()=>tone(440,.18,'sine',.03),130); }
function scareStinger(){
  if(!soundEnabled) return;
  try{
    const A=getAudioCtx(); if(!A) return;
    const o=A.createOscillator(), g=A.createGain();
    o.type='sawtooth'; o.frequency.setValueAtTime(92,A.currentTime); o.frequency.exponentialRampToValueAtTime(38,A.currentTime+.75);
    g.gain.setValueAtTime(.055,A.currentTime); g.gain.exponentialRampToValueAtTime(.0001,A.currentTime+.8);
    o.connect(g); g.connect(A.destination); o.start(); o.stop(A.currentTime+.82);
    setTimeout(()=>tone(740,.08,'square',.018),120);
  }catch{}
}
function shadowScare(){
  if(scareCooldown || state.screen==='home') return;
  scareCooldown=true;
  state.fearLevel=Math.min(6,(state.fearLevel||0)+1); saveState();
  const stories=[
    ['UN BRUIT DERRIÈRE VOUS','Un pas résonne dans la brume… mais personne ne devrait marcher derrière le groupe.'],
    ['LA BRUME SE RESSERRE','Pendant un instant, le chemin semble plus étroit. L’Ombre a senti votre hésitation.'],
    ['QUELQUE CHOSE A BOUGÉ','Une silhouette traverse le bord de votre vision. Lorsque vous vous retournez, il n’y a plus rien.'],
    ['LE SCEAU SE FISSURE','Une vibration remonte de la pierre. Chaque erreur donne un peu plus de force à ce qui attend sous Layer.'],
    ['ELLE CONNAÎT VOS NOMS','Un murmure répète quatre prénoms, très bas, comme s’il venait du sol. L’Ombre vous a trouvés.'],
    ['ELLE EST PROCHE','La lumière semble baisser autour de vous. Le prochain choix doit être le bon.']
  ];
  const [title,body]=stories[Math.min(state.fearLevel-1,stories.length-1)];
  const old=document.querySelector('.shadow-scare'); old?.remove();
  const el=document.createElement('div'); el.className=`shadow-scare fear-${state.fearLevel}`;
  el.innerHTML=`<div class="shadow-scare-fog"></div><div class="shadow-figure"><i></i></div><div class="shadow-scare-content"><div class="shadow-scare-kicker">Présence détectée</div><div class="shadow-scare-title">${escapeHtml(title)}</div><p>${escapeHtml(body)}</p></div>`;
  document.body.appendChild(el); requestAnimationFrame(()=>el.classList.add('show'));
  scareStinger(); haptic([80,50,120,50,180]);
  setTimeout(()=>el.classList.add('leave'),1500);
  setTimeout(()=>{el.remove();scareCooldown=false;},2200);
}
function failSound(){ tone(90,.18,'sawtooth',.025); document.body.classList.remove('failure-pulse'); void document.body.offsetWidth; document.body.classList.add('failure-pulse'); shadowScare(); }
function omen(title, subtitle=''){
  const old=document.querySelector('.scene-omen'); if(old) old.remove();
  const el=document.createElement('div'); el.className='scene-omen';
  el.innerHTML=`<div class="omen-rune">✦</div><div class="omen-title">${escapeHtml(title)}</div>${subtitle?`<div class="omen-sub">${escapeHtml(subtitle)}</div>`:''}`;
  document.body.appendChild(el);
  requestAnimationFrame(()=>el.classList.add('show'));
  setTimeout(()=>el.classList.add('leave'),2300);
  setTimeout(()=>el.remove(),3200);
}

let sceneTransitionLock = false;
function transitionSound(){
  if(!soundEnabled) return;
  tone(174,.08,'triangle',.015);
  setTimeout(()=>tone(220,.1,'triangle',.017),90);
  setTimeout(()=>tone(294,.14,'sine',.018),190);
}
function transitionStep(title, subtitle, callback, icon='✦'){
  if(sceneTransitionLock) return;
  sceneTransitionLock = true;
  const old=document.querySelector('.scene-transition'); if(old) old.remove();
  const el=document.createElement('div');
  el.className='scene-transition';
  el.innerHTML=`<div class="scene-transition-inner"><div class="transition-sigil">${icon}</div><div class="transition-kicker">Le Livre tourne une page</div><div class="transition-title">${escapeHtml(title)}</div>${subtitle?`<div class="transition-sub">${escapeHtml(subtitle)}</div>`:''}<div class="transition-trace"></div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(()=>el.classList.add('show'));
  transitionSound();
  setTimeout(()=>el.classList.add('leave'), 3500);
  setTimeout(()=>{ el.remove(); sceneTransitionLock = false; callback?.(); }, 4400);
}

function cinematicIntro(callback){
  if(sceneTransitionLock) return;
  sceneTransitionLock = true;
  const old=document.querySelector('.cinematic-intro'); if(old) old.remove();
  const el=document.createElement('div');
  el.className='cinematic-intro';
  el.innerHTML=`<div class="cinematic-intro-bg"></div><div class="cinematic-intro-vignette"></div><div class="cinematic-intro-content"><div class="cinematic-kicker">Le Livre s’ouvre</div><div class="cinematic-title">Les Quatre Veilleurs</div><p class="cinematic-line">Dans la roche de Layer, un ancien serment vacille.</p><p class="cinematic-line delay-2">Quatre noms sont appelés pour reprendre les fragments du sceau.</p><p class="cinematic-line delay-3">Et avant la tombée du soir… l’Ombre devra être repoussée.</p></div>`;
  document.body.appendChild(el);
  if(soundEnabled){
    tone(110,.35,'sine',.01);
    setTimeout(()=>tone(147,.35,'triangle',.012),280);
    setTimeout(()=>tone(196,.45,'sine',.014),620);
    setTimeout(()=>tone(262,.55,'sine',.017),1060);
  }
  requestAnimationFrame(()=>el.classList.add('show'));
  setTimeout(()=>el.classList.add('leave'), 7300);
  setTimeout(()=>{ el.remove(); sceneTransitionLock = false; callback?.(); }, 8200);
}
function initAtmosphere(){
  const box=$('#ambientRunes'); if(!box || box.children.length) return;
  const runes=['ᚱ','✦','◊','☾','ᛉ','ᚾ','ᛟ','ᚨ','✧','ᛃ','ᛏ','◇'];
  runes.forEach((r,i)=>{
    const s=document.createElement('span'); s.textContent=r;
    s.style.left=`${5+(i*17)%91}%`; s.style.top=`${10+(i*29)%82}%`;
    s.style.animationDelay=`-${(i*2.7)%15}s`; s.style.animationDuration=`${16+(i%5)*3}s`;
    box.appendChild(s);
  });
}

function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function meters(a,b){
  if(!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return Infinity;
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat-a.lat), dLon = toRad(b.lon-a.lon);
  const q = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
}
function targetPoint(key){ const l = config.locations[key]; return (Number.isFinite(l?.lat) && Number.isFinite(l?.lon)) ? { lat:l.lat, lon:l.lon } : null; }
function distanceTo(key){ return meters(currentPosition, targetPoint(key)); }
function fmtDistance(m){ if(!Number.isFinite(m)) return '—'; if(m < 1000) return `${Math.max(0, Math.round(m))} m`; return `${(m/1000).toFixed(2).replace('.', ',')} km`; }
function geoOk(){ return currentPosition && Number.isFinite(currentPosition.lat) && Number.isFinite(currentPosition.lon); }
function geoStatusHtml(){
  if(LOCAL_TEST && !geoOk()) return `<div class="status test-status"><span><span class="dot test"></span> Mode test local</span><span class="small">Position à simuler</span></div>`;
  if(LOCAL_TEST && geoOk()) return `<div class="status test-status"><span><span class="dot test"></span> GPS simulé</span><span class="small">${fmtDistance(distanceToTestTarget())}</span></div>`;
  if(geoOk()) return `<div class="status"><span><span class="dot ok"></span> GPS actif</span><span class="small">± ${Math.round(currentPosition.accuracy || 0)} m</span></div>`;
  if(lastGeoError) return `<div class="status"><span><span class="dot bad"></span> GPS indisponible</span><span class="small">${escapeHtml(lastGeoError)}</span></div>`;
  return `<div class="status"><span><span class="dot"></span> Recherche GPS…</span><span class="small">Autorisez la position</span></div>`;
}
function distanceToTestTarget(){
  if(!LOCAL_TEST || !geoOk()) return Infinity;
  if(state.screen === 'gate-mairie') return distanceTo('mairie');
  if(state.screen === 'gate-eglise') return distanceTo('eglise');
  if(state.screen === 'gate-fontaine') return distanceTo('fontaine');
  if(state.screen === 'walk' || state.screen === 'gate-chapelle') return distanceTo('chapelle');
  return 0;
}
function progressHtml(n){ return `<div class="progress">${[1,2,3,4].map(i=>`<i class="${i<=n?'on':''}"></i>`).join('')}</div>`; }
function card(inner, cls=''){ return `<section class="card ${cls}">${inner}</section>`; }
function btn(label,id,cls=''){ return `<button class="btn ${cls}" id="${id}" type="button">${label}</button>`; }
function hintsHtml(stageId, hints){
  const used = state.hints[stageId] || 0;
  return `<div class="hints"><div class="small">Besoin d'une aide du Livre ?</div>
    ${used>=1 ? `<div class="hint-box">💡 ${escapeHtml(hints[0])}</div>` : ''}
    ${used>=2 ? `<div class="hint-box">🕯️ ${escapeHtml(hints[1])}</div>` : ''}
    ${used<2 ? `<button class="btn secondary hint-btn" data-stage="${stageId}" type="button">${used===0?'Indice 1':'Aide du Veilleur'}</button>` : ''}
  </div>`;
}
function bindHints(rerender){ $$('.hint-btn').forEach(b => b.onclick = ()=>{ const s = b.dataset.stage; state.hints[s] = (state.hints[s] || 0) + 1; saveState(); rerender(); }); }
function chapterBadge(title, subtitle=''){ return `<div class="chapter-badge"><span>${escapeHtml(title)}</span>${subtitle?`<small>${escapeHtml(subtitle)}</small>`:''}</div>`; }
function loreBlock(title, text){ return `<div class="lore-block"><div class="lore-title">${escapeHtml(title)}</div><p>${text}</p></div>`; }
function destinationBlock(title, detail, note=''){ return `<div class="destination-block"><div class="destination-icon">⌖</div><div><div class="destination-title">${escapeHtml(title)}</div><div class="destination-detail">${escapeHtml(detail)}</div>${note?`<div class="destination-note">${escapeHtml(note)}</div>`:''}</div></div>`; }

const ILLUSTRATIONS = {
  book: 'assets/book.png',
  stone: 'assets/church.png',
  water: 'assets/fountain.png',
  walk: 'assets/walk.png',
  chapel: 'assets/chapel.png',
  treasure: 'assets/treasure.png'
};
function illustrationBlock(kind, title='', caption=''){
  const src = ILLUSTRATIONS[kind] || ILLUSTRATIONS.book;
  return `<figure class="illustration-card ${kind}"><div class="illustration-frame"><img src="${src}" alt="${escapeHtml(title || 'Illustration de l’aventure')}" loading="lazy"></div>${title||caption?`<figcaption><strong>${escapeHtml(title)}</strong>${caption?`<span>${escapeHtml(caption)}</span>`:''}</figcaption>`:''}</figure>`;
}
function suspensePanel(title, text, mode='veil'){
  return `<div class="suspense-panel ${mode}"><div class="suspense-fog"></div><div class="suspense-glow"></div><div class="suspense-content"><div class="suspense-kicker">Entre deux étapes</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p><div class="suspense-runes"><span>✦</span><span>☾</span><span>ᚱ</span><span>⌖</span></div></div></div>`;
}
function sealBurstHtml(icon){
  const parts = Array.from({length:18}, (_,i)=>`<i style="--ang:${i*20}deg;--dist:${62 + (i%4)*12}px;--delay:${(i%5)*0.04}s"></i>`).join('');
  return `<div class="seal-recovery-visual"><div class="seal-halo"></div><div class="seal-core">${icon}</div><div class="seal-burst">${parts}</div><div class="seal-rings"><span></span><span></span><span></span></div></div>`;
}
function sealRecoveredSound(){
  if(!soundEnabled) return;
  tone(196,.09,'triangle',.022);
  setTimeout(()=>tone(247,.11,'triangle',.024),90);
  setTimeout(()=>tone(294,.14,'sine',.026),180);
  setTimeout(()=>tone(392,.26,'sine',.028),270);
  setTimeout(()=>tone(523,.34,'sine',.02),390);
}
function revealSound(){
  if(!soundEnabled) return;
  tone(140,.08,'sawtooth',.012);
  setTimeout(()=>tone(220,.1,'triangle',.013),70);
  setTimeout(()=>tone(330,.14,'sine',.015),140);
}

function victoryChime(){
  if(!soundEnabled) return;
  [196,246.94,293.66,392,493.88,587.33].forEach((n,i)=>setTimeout(()=>ambientPadNote(n,3.6,.014),i*180));
  setTimeout(()=>tone(783.99,.75,'sine',.018),1000);
}
function finalSealShow(callback){
  const old=document.querySelector('.seal-cinematic'); if(old) old.remove();
  const el=document.createElement('div');
  el.className='seal-cinematic victory-ritual';
  const motes=Array.from({length:36},(_,i)=>`<i style="--a:${i*10}deg;--d:${(i%9)*.05}s;--r:${80+(i%6)*22}px"></i>`).join('');
  el.innerHTML=`<div class="victory-veil"></div><div class="victory-motes">${motes}</div><div class="seal-cinematic-inner"><div class="guardian-orbit"><span>🔥</span><span>👁</span><span>ᚱ</span><span>🗝</span></div><div class="seal-cinematic-rings"><span></span><span></span><span></span><span></span></div><div class="seal-cinematic-core">✦</div><div class="seal-cinematic-title">Le sceau vous reconnaît</div><div class="seal-cinematic-sub">Les quatre forces se rejoignent. La brume recule, les signes se rallument et l’Ombre perd prise sur Layer.</div><div class="victory-word">VICTOIRE DES VEILLEURS</div></div>`;
  document.body.appendChild(el);
  victoryChime();
  requestAnimationFrame(()=>el.classList.add('show'));
  setTimeout(()=>{el.classList.add('resolved');haptic([80,80,120,80,160]);},1900);
  setTimeout(()=>el.classList.add('leave'),4800);
  setTimeout(()=>{el.remove();callback?.();},5700);
}

async function requestWakeLock(){ try { if('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
function startGeo(){
  if(LOCAL_TEST) return;
  if(!navigator.geolocation){ lastGeoError = 'Géolocalisation non prise en charge'; return; }
  if(geoWatchId !== null) return;
  geoWatchId = navigator.geolocation.watchPosition(pos => {
    currentPosition = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, t: Date.now() };
    lastGeoError = null; liveTick();
  }, err => {
    lastGeoError = err.code===1 ? 'Permission refusée' : err.message;
    liveTick();
  }, { enableHighAccuracy:true, maximumAge:3000, timeout:15000 });
}
function liveTick(){
  const marker = $('#geoStatus'); if(marker) marker.innerHTML = geoStatusHtml();
  const d = $('#liveDistance'); if(d && d.dataset.target){ d.textContent = fmtDistance(distanceTo(d.dataset.target)); }
  const s = state.screen;
  if(s === 'gate-mairie') maybeAutoUnlock('mairie', renderMairie);
  if(s === 'gate-eglise') maybeAutoUnlock('eglise', renderEglise);
  if(s === 'gate-fontaine') maybeAutoUnlock('fontaine', renderFontaine);
  if(s === 'walk') updateWalk();
  if(s === 'gate-chapelle') maybeAutoUnlock('chapelle', renderFinale);
}
function maybeAutoUnlock(key, fn){ const l = config.locations[key]; const d = distanceTo(key); if(sceneTransitionLock) return; if(Number.isFinite(d) && d <= Number(l.radius || 55)){ haptic(); transitionStep('Lieu atteint', l.name, fn, '⌖'); } }

function renderHome(){
  state.screen='home'; saveState();
  app.innerHTML = `
    <div class="hero hero-home">
      <div class="crest">✦</div>
      <div class="kicker">Bissey-la-Côte • Layer-sur-Roche</div>
      <h1>Le Sceau des<br>Quatre Veilleurs</h1>
      <p class="hero-subtitle">Un récit de signes, de brume, d’ombre et de serment.</p>
      ${progressHtml(state.completed.length>=6?4:Math.min(3,Object.keys(state.fragments).length))}
      ${card(`${chapterBadge('Livre des Veilleurs','Préface')}
        ${illustrationBlock('book','Le Livre des Veilleurs','Le récit ancien se rouvre au moment où le sceau vacille.')}
        ${suspensePanel('Un vieux serment se réveille','Le Livre appelle les quatre noms, et la roche de Layer recommence à murmurer.','intro')}
        <p class="story dropcap">Il y a bien longtemps, une présence errante venue des cavités de la roche s’est glissée jusqu’aux hauteurs de Layer. Les anciens l’ont nommée l’Ombre, car elle avançait là où la lumière faiblissait, volait la mémoire des chemins et attirait les voyageurs hors de la route. Pour l’enfermer, quatre Veilleurs ont uni leurs forces et ont partagé le sceau en quatre parts. Cette nuit, le vieux lien se fissure de nouveau.</p>
        ${loreBlock('Le danger', 'Si l’Ombre s’échappe, elle brouillera les repères, éteindra les signes protecteurs du village et ouvrira de nouveau le passage de Layer. Plus la nuit avancera, plus elle gagnera en force.')}
        ${loreBlock('Pourquoi quatre Veilleurs ?', 'Parce qu’aucun gardien ne peut contenir seul l’Ombre. Quatre forces différentes doivent être réunies. Chacun des joueurs recevra un fragment secret : aucune victoire n’est possible sans les autres.')}
        ${loreBlock('Votre mission', 'Suivez les traces des anciens gardiens, résolvez les énigmes et reconstituez le sceau avant que l’Ombre ne franchisse à nouveau la roche de Layer.')}
        ${adventureLocked() ? countdownHtml() : btn(state.startedAt ? 'Reprendre le récit' : 'Ouvrir le Livre des Veilleurs', 'startBtn', 'good')}
        ${state.startedAt ? btn('Recommencer depuis le début', 'resetBtn', 'secondary') : ''}
      `, 'hero-card')}
    </div>`;
  if(adventureLocked()) startCountdownTicker();
  $('#startBtn')?.addEventListener('click', ()=>{ if(!state.startedAt) state.startedAt = Date.now(); saveState(); requestWakeLock(); startGeo(); startAmbient(); cinematicIntro(renderPrologue); });
  $('#resetBtn')?.addEventListener('click', ()=>{ if(confirm('Effacer toute la progression ?')) resetGame(); });
}

function renderPrologue(){
  state.screen='prologue'; saveState(); startGeo();
  app.innerHTML = card(`
    ${chapterBadge('Prologue','Le Pacte des Quatre')}
    <h2>Le Livre s’ouvre</h2>
    <p class="quote">L’Ombre n’est pas née d’un lieu, mais d’un passage. Elle aurait émergé lorsque la roche de Layer s’est ouverte, un soir de brume, pour laisser monter une présence sans visage, capable d’éteindre les repères et de semer la confusion.</p>
    ${illustrationBlock('book','Le serment des anciens','Quatre Veilleurs, un sceau, une promesse à renouveler.')}
    <p class="story">Pour l’empêcher de gagner le village, quatre Veilleurs se sont partagé un sceau ancien : l’un gardait la Flamme, l’autre l’Œil, le troisième la Rune, et le dernier la Clé. Tant que ces quatre forces demeuraient unies, l’Ombre restait enfermée sous la roche de Layer. Aujourd’hui, ce sceau s’est fissuré. Les noms des anciens gardiens ont disparu, mais le Livre a reconnu quatre nouveaux porteurs : Vadim, Louise, Soline et Sacha.</p>
    ${loreBlock('D’où vient l’Ombre ?', 'Des profondeurs de la roche de Layer, là où les anciens craignaient un passage entre le monde des vivants et une obscurité plus ancienne. Elle ne possède ni visage ni voix propre : elle s’attache aux lieux, aux peurs et aux chemins oubliés.')} 
    ${loreBlock('Quel est le danger ?', 'Si le sceau cède entièrement, l’Ombre s’étendra hors de Layer, fera disparaître les signes de protection et perdra les voyageurs en brouillant les chemins et les souvenirs.')} 
    ${loreBlock('Pourquoi faut-il quatre Veilleurs ?', 'Parce qu’aucune force seule ne suffit : il faut l’observation, la mémoire, le déchiffrement et la décision. Les quatre fragments du sceau ont été séparés pour empêcher qu’un seul gardien ne tombe ou ne cède.')} 
    <p class="center"><strong>Vous avez deux heures.</strong></p>
    <div class="symbols role-grid">
      <div class="sigil"><span>🔥</span><small>Sacha<br>Porte-Flamme</small></div>
      <div class="sigil"><span>👁</span><small>Soline<br>Œil du Veilleur</small></div>
      <div class="sigil"><span>ᚱ</span><small>Vadim<br>Cryptographe</small></div>
      <div class="sigil"><span>🗝</span><small>Louise<br>Gardienne</small></div>
    </div>
    <p class="small center">Chacun sera nécessaire. Certains indices n’apparaîtront qu’à un seul Veilleur.</p>
    ${btn('Jurer le pacte', 'oathBtn')}
  `, 'chapter-card');
  $('#oathBtn').onclick = ()=>{ complete('prologue'); transitionStep('Le Premier Appel','Le point d’éveil vous attend au cœur du village', renderGateMairie, '⌖'); };
}

function renderGateMairie(){
  state.screen='gate-mairie'; saveState(); startGeo(); const l = config.locations.mairie;
  app.innerHTML = card(`
    ${chapterBadge('Chapitre I','Le Premier Appel')}
    <h2>Rejoindre le point d’éveil</h2>
    <p class="story">Le Livre ne peut prononcer la suite qu’au lieu où les nouveaux Veilleurs sont appelés. Rejoignez le cœur du village pour entendre la première injonction.</p>
    ${destinationBlock('Repère du Livre', 'Mairie de Bissey-la-Côte — 9 rue Haute', 'Le sceau se déverrouillera automatiquement à proximité.')}
    ${illustrationBlock('book','Le point d’éveil','Le Livre désigne le lieu du départ avant d’ouvrir la première direction.')}
    ${suspensePanel('Le village retient son souffle','Approchez du point d’éveil. Lorsque vous serez assez près, le Livre prononcera la suite.')}
    <div id="geoStatus">${geoStatusHtml()}</div>
    <div class="distance" id="liveDistance" data-target="mairie">${fmtDistance(distanceTo('mairie'))}</div>
    <div class="small center">Rayon de déverrouillage : ${l.radius} m</div>
    ${!targetPoint('mairie') ? `<p class="error">Coordonnée non configurée. Ouvrez le mode maître du jeu.</p>` : ''}
  `, 'chapter-card');
  maybeAutoUnlock('mairie', renderMairie);
}

function renderMairie(){
  state.screen='mairie'; saveState();
  app.innerHTML = card(`
    ${chapterBadge('Chapitre I','Le Premier Veilleur')}
    <h2>La première direction</h2>
    <p class="quote">Cherchez la maison où le temps est gravé dans ses murs.</p>
    ${illustrationBlock('stone','Le clocher et le temps','Une inscription ancienne veille, silencieuse, au cœur du village.')}
    <p class="story">Là où résonnent les cloches, la mémoire du village dort encore dans la matière. Le premier sceau n’est pas caché : il attend d’être reconnu.</p>
    ${loreBlock('Ce que murmure le Livre', 'La première marque dort dans la matière. Elle ne se révèle qu’à ceux qui savent observer avant de déchiffrer.')}
    ${btn('Suivre le premier signe', 'toChurch')}
  `, 'chapter-card');
  $('#toChurch').onclick = ()=>{ complete('mairie'); transitionStep('Vers le premier sceau','Cherchez le clocher qui garde le premier signe', renderGateEglise, '✦'); };
}

function renderGateEglise(){
  state.screen='gate-eglise'; saveState(); startGeo(); const l = config.locations.eglise;
  app.innerHTML = card(`
    ${chapterBadge('Épreuve I','Le Temps Gravé')}
    <h2>Approchez du premier sceau</h2>
    <p class="story">Les cloches ne gardent pas seulement l’heure. Elles veillent sur la date qui ouvrira la première marque.</p>
    ${illustrationBlock('stone','Le clocher veille déjà','Un premier signe attend les Veilleurs au pied du clocher.')}
    ${destinationBlock('Repère du Livre', 'Église de la Nativité — rue Haute', 'Cherchez le clocher dans le village ; l’épreuve s’ouvrira lorsque vous serez assez près.')}
    ${suspensePanel('Le premier sceau attend','Le signe sommeille encore. Le clocher ne parlera qu’à courte distance.')}
    <div id="geoStatus">${geoStatusHtml()}</div>
    <div class="distance" id="liveDistance" data-target="eglise">${fmtDistance(distanceTo('eglise'))}</div>
    <div class="small center">Déverrouillage à ${l.radius} m</div>
  `, 'chapter-card');
  maybeAutoUnlock('eglise', renderEglise);
}

function renderEglise(){
  state.screen='eglise'; saveState(); bell(); omen('LE PREMIER SCEAU S’ÉVEILLE','Épreuve I');
  app.innerHTML = card(`
    ${chapterBadge('Épreuve I','Le Temps Gravé')}
    <h2>Le temps est gravé</h2>
    ${progressHtml(1)}
    ${illustrationBlock('stone','Le temps gravé','Observez les détails, puis laissez les signes parler.')}
    <p class="quote">Les vivants regardent leur montre. Les anciens, eux, gravaient le temps sur leurs murs.</p>
    <p><strong>Soline et Sacha :</strong> trouvez sur place l’année à quatre chiffres.</p>
    <input class="input" id="yearInput" inputmode="numeric" maxlength="4" placeholder="_ _ _ _" aria-label="Année gravée" />
    <button class="btn" id="yearCheck">Valider l’année</button>
    <div id="churchPart2" class="hidden">
      <div class="sep"></div>
      <div class="teen-challenge">
        <div class="teen-label">Épreuve des Cryptographes — Vadim & Louise</div>
        <p>La date a réveillé l’alphabet des Veilleurs. Ici, les lettres ne commencent pas par A.</p>
        <p class="quote">« Les morts comptent depuis la fin. La dernière lettre vaut 1. »</p>
        <div class="cipher-strip">11 · 18 · 22 · 9 · 9 · 22</div>
        <p class="small">Déchiffrez le mot de six lettres. Aucun tableau n’est fourni.</p>
        <input class="input" id="cipherInput" placeholder="Mot de six lettres" autocomplete="off"/>
        <button class="btn" id="cipherCheck">Soumettre le déchiffrement</button>
      </div>
    </div>
    <div id="churchMsg"></div>
    ${hintsHtml('eglise', [
      'Cherchez une date de construction inscrite sur l’édifice.',
      'Pour les grands : si Z vaut 1, alors Y vaut 2, X vaut 3… Continuez à rebours jusqu’à transformer les six nombres.'
    ])}
  `, 'chapter-card');
  $('#yearCheck').onclick = ()=>{
    if($('#yearInput').value.trim() === '1828'){
      successSound();
      revealSound();
      $('#churchPart2').classList.remove('hidden');
      $('#churchPart2').classList.add('ink-reveal');
      $('#churchMsg').innerHTML = '<p class="success">✓ La date est juste. Un second mécanisme s’ouvre pour les plus grands.</p>';
    } else {
      failSound();
      $('#churchMsg').innerHTML = '<p class="error">Ce n’est pas l’année attendue.</p>';
    }
  };
  $('#cipherCheck').onclick = ()=>{
    if($('#cipherInput').value.trim().toUpperCase() === 'PIERRE'){
      state.fragments.sacha = '1';
      complete('eglise');
      successSound();
      omen('PREMIÈRE MARQUE','La pierre vous reconnaît');
      setTimeout(()=>renderFragment('Sacha','1','🪨','Pierre', renderGateFontaine),550);
    } else {
      failSound();
      $('#churchMsg').innerHTML = '<p class="error">Le Livre reste fermé. Relisez la phrase : la dernière lettre de l’alphabet vaut 1.</p>';
    }
  };
  bindHints(renderEglise);
}

function renderFragment(who, digit, icon, name, next){
  state.screen='fragment'; saveState();
  haptic([50,70,140]);
  sealRecoveredSound();
  omen(`MARQUE DE LA ${name.toUpperCase()}`,'Le Livre vous confie un nouveau fragment');
  app.innerHTML = card(`
    ${chapterBadge('Fragment retrouvé', `Marque de la ${name}`)}
    ${sealBurstHtml(icon)}
    <h2 class="center">La Marque de la ${name}</h2>
    <p class="quote">Passez le téléphone à <strong>${who}</strong>. Les autres détournent les yeux.</p>
    <div class="sep"></div>
    <p class="center">Le Livre confie à ${who} un fragment encore caché.</p>
    <button type="button" class="fragment-reveal" id="fragmentReveal" aria-expanded="false" aria-label="Révéler le fragment de sceau">
      <span class="fragment-cover" id="fragmentCover">
        <span class="fragment-cover-kicker">Fragment secret</span>
        <strong>Toucher pour révéler</strong>
        <small>Quand le bon Veilleur tient le téléphone</small>
      </span>
      <span class="distance fragment-digit hidden" id="fragmentDigit">${digit}</span>
    </button>
    <p class="small center">Mémorise-le. Il sera indispensable devant la chapelle.</p>
    ${btn('Je l’ai mémorisé', 'memorized')}
  `, 'chapter-card fragment-card seal-recovered');
  const reveal = $('#fragmentReveal');
  const cover = $('#fragmentCover');
  const digitEl = $('#fragmentDigit');
  reveal?.addEventListener('click', ()=>{
    if(!digitEl.classList.contains('hidden')) return;
    digitEl.classList.remove('hidden');
    cover.classList.add('fade-out');
    reveal.setAttribute('aria-expanded','true');
    haptic([25,50,100]);
    revealSound();
    setTimeout(()=>cover.remove(),280);
  });
  $('#memorized').onclick = ()=> transitionStep('Une nouvelle page s’écrit','Le Livre vous entraîne vers l’étape suivante', next, icon);
}

function renderGateFontaine(){
  state.screen='gate-fontaine'; saveState(); startGeo(); const l = config.locations.fontaine;
  app.innerHTML = card(`
    ${chapterBadge('Épreuve II','Le Gardien du Bassin')}
    <h2>Descendre vers le bassin</h2>
    <p class="quote">Descendez là où la pierre donne à boire. Quelque chose vous y observe, immobile, depuis très longtemps.</p>
    <p class="story">Le second sceau n’est pas gardé par un homme, mais par une présence sculptée qui ne quitte jamais son bassin.</p>
    ${illustrationBlock('water','Le bassin du Gardien','La surface sombre reflète à peine la créature qui veille.')}
    ${destinationBlock('Repère du Livre', 'Fontaine-abreuvoir — rue de l’Abreuvoir', 'Depuis l’église, descendez vers la rue de l’Abreuvoir et cherchez la fontaine de pierre.')}
    ${suspensePanel('Le bassin garde un secret','Sous la surface noire, le Gardien attend que vous vous approchiez assez.')}
    <div id="geoStatus">${geoStatusHtml()}</div>
    <div class="distance" id="liveDistance" data-target="fontaine">${fmtDistance(distanceTo('fontaine'))}</div>
    ${!targetPoint('fontaine')
      ? `<p class="error"><strong>La fontaine n’est pas encore calibrée.</strong><br>Utilisez ⚙ → Coordonnées → Fontaine → « Utiliser ma position actuelle » quand vous serez sur place.</p>`
      : `<div class="small center">Déverrouillage à ${l.radius} m</div>`}
  `, 'chapter-card');
  maybeAutoUnlock('fontaine', renderFontaine);
}

function renderFontaine(){
  state.screen='fontaine'; saveState(); omen('LE GARDIEN DU BASSIN','Épreuve II');
  app.innerHTML = card(`
    ${chapterBadge('Épreuve II','Le Gardien du Bassin')}
    <h2>Le secret du second sceau</h2>
    ${progressHtml(2)}
    ${illustrationBlock('water','Le Gardien du bassin','Une présence sculptée veille, immobile, au-dessus du vieux bassin.')}
    <p class="quote">Ne touchez pas la surface. Le deuxième Veilleur n’était pas humain.</p>
    <p><strong>Sacha :</strong> trouve l’arme portée par la créature.</p>
    <div class="choice-grid" id="weaponChoices">
      <button class="choice" data-v="trident">🔱 Trident</button>
      <button class="choice" data-v="epee">⚔️ Épée</button>
      <button class="choice" data-v="hache">🪓 Hache</button>
      <button class="choice" data-v="arc">🏹 Arc</button>
    </div>
    <div id="fountainDate" class="hidden">
      <p><strong>Soline :</strong> trouve les quatre chiffres gravés au-dessus du Gardien.</p>
      <input class="input" id="fountainYear" inputmode="numeric" maxlength="4" placeholder="_ _ _ _">
      <button class="btn" id="fountainYearBtn">Valider l’année</button>
    </div>
    <div id="fountainFinal" class="hidden">
      <div class="teen-challenge">
        <div class="teen-label">Épreuve des Cryptographes — Vadim & Louise</div>
        <p>Le Livre inscrit quatre lignes. <strong>L’année n’est plus une réponse : elle devient le chemin.</strong></p>
        <div class="rune-lines" aria-label="Quatre lignes de lettres">
          <div><span>I</span><code>ECLATBRUME</code></div>
          <div><span>II</span><code>NOCTURNALE</code></div>
          <div><span>III</span><code>BRUMEUROCHE</code></div>
          <div><span>IV</span><code>XALBRUMES</code></div>
        </div>
        <p class="quote">Utilisez les quatre chiffres trouvés sur place : un chiffre pour chaque ligne. Comptez les lettres depuis la gauche.</p>
        <p class="small">Les quatre lettres obtenues forment un mot.</p>
        <input class="input" id="fountainWord" maxlength="4" placeholder="_ _ _ _" autocomplete="off">
        <button class="btn" id="fountainWordBtn">Prononcer le mot</button>
      </div>
    </div>
    <div id="fountainMsg"></div>
    ${hintsHtml('fontaine', [
      'Commencez par observer le décor sculpté puis la date gravée.',
      'Pour les grands : prenez la 1re lettre de la ligne I, la 8e de la II, la 6e de la III et la 1re de la IV.'
    ])}
  `, 'chapter-card');
  $$('#weaponChoices .choice').forEach(b => b.onclick = ()=>{
    if(b.dataset.v === 'trident'){
      successSound();
      revealSound();
      $('#fountainDate').classList.remove('hidden');
      $('#fountainDate').classList.add('ink-reveal');
      $('#fountainMsg').innerHTML = '<p class="success">✓ Le Gardien réagit. Cherchez maintenant les chiffres gravés au-dessus de lui.</p>';
    } else {
      failSound();
      $('#fountainMsg').innerHTML = '<p class="error">Cette arme n’est pas la sienne.</p>';
    }
  });
  $('#fountainYearBtn').onclick = ()=>{
    if($('#fountainYear').value.trim() === '1861'){
      successSound();
      revealSound();
      $('#fountainFinal').classList.remove('hidden');
      $('#fountainFinal').classList.add('ink-reveal');
      $('#fountainMsg').innerHTML = '<p class="success">✓ Les chiffres sont justes. Ils deviennent maintenant une clé de lecture.</p>';
    } else {
      failSound();
      $('#fountainMsg').innerHTML = '<p class="error">Cherchez encore les quatre chiffres gravés.</p>';
    }
  };
  $('#fountainWordBtn').onclick = ()=>{
    if($('#fountainWord').value.trim().toUpperCase() === 'EAUX'){
      state.fragments.soline = '2';
      complete('fontaine');
      successSound();
      omen('DEUXIÈME MARQUE','Les eaux livrent leur secret');
      setTimeout(()=>renderFragment('Soline','2','💧','Eau', renderWalkIntro),550);
    } else {
      failSound();
      $('#fountainMsg').innerHTML = '<p class="error">Les quatre lettres ne sont pas encore les bonnes. Utilisez les quatre chiffres trouvés, une seule fois chacun, dans l’ordre.</p>';
    }
  };
  bindHints(renderFontaine);
}

function renderWalkIntro(){
  state.screen='walk-intro'; saveState();
  app.innerHTML = card(`
    ${chapterBadge('Chapitre II','La Marche de Layer')}
    <h2>La Porte de Layer</h2>
    <p class="quote">Vous quittez maintenant le domaine des vivants.</p>
    ${illustrationBlock('walk','La route de Layer','La brume se referme, le sentier s’allonge, et l’Ombre se rapproche.')}
    <p class="story">Les deux premières marques ont été retrouvées. Mais le Livre devient plus sombre : au-delà du village, la route vers Layer n’est plus un simple chemin. Quelque chose semble suivre les Veilleurs à distance.</p>
    ${loreBlock('Ce qui vous attend', 'La distance jusqu’à la chapelle sera votre seul repère. À mesure que vous approcherez, l’Ombre vous éprouvera et révélera deux nouveaux fragments.')}
    ${destinationBlock('Destination', 'Hameau de Layer-sur-Roche — vers la chapelle Sainte-Madeleine', 'Suivez l’itinéraire pédestre reconnu à l’avance. Le téléphone indique la distance restante, pas le chemin à emprunter.')}
    <p class="small">À partir d’ici, l’adulte responsable guide le groupe sur l’itinéraire préparé. Le téléphone devient un radar et déclenche les épreuves au fur et à mesure de l’approche.</p>
    ${btn('Entrer dans la Marche de Layer', 'walkBtn')}
  `, 'chapter-card');
  $('#walkBtn').onclick = ()=>{ complete('walk-intro'); transitionStep('La Marche de Layer','Restez groupés et suivez le chemin vers Layer', renderWalk, '☾'); };
}

function walkStatus(){
  const d = distanceTo('chapelle');
  const t = config.walkThresholds;
  let txt = 'Quelque chose marche derrière vous.';
  if(d <= t.approach) txt = 'La pierre de Layer se rapproche.';
  else if(d <= t.shadow3) txt = 'La chapelle vous a vus.';
  else if(d <= t.memoryTest) txt = 'Le souvenir gardé par Sacha devient nécessaire.';
  else if(d <= t.memoryShow) txt = 'Restez ensemble. Le chemin écoute vos pas.';
  else if(d <= t.observer) txt = 'L’Œil du Veilleur est appelé.';
  else if(d <= t.shadow1) txt = 'Quelque chose se rapproche dans la pénombre.';
  return { d, txt };
}

function renderWalk(){
  state.screen='walk'; saveState(); startGeo(); const w = walkStatus();
  app.innerHTML = card(`
    ${chapterBadge('Chapitre II','La Marche de Layer')}
    <h2>Ne vous séparez jamais</h2>
    ${destinationBlock('Cap à tenir', 'Chapelle Sainte-Madeleine — Layer-sur-Roche', 'L’adulte guide le chemin ; le radar mesure seulement votre approche de la chapelle.')}
    ${illustrationBlock('walk','Sous la lune de Layer','Le radar guide l’approche, mais le sentier garde ses propres secrets.')}
    ${suspensePanel('Brume et attente','Entre deux révélations, restez groupés. Le chemin vous observe et l’Ombre patiente.','travel')}
    <div id="geoStatus">${geoStatusHtml()}</div>
    <div class="radar"></div>
    <div class="distance" id="walkDistance">${fmtDistance(w.d)}</div>
    <p class="center" id="walkText">${escapeHtml(w.txt)}</p>
    <div id="walkEvent"></div>
    <p class="tiny center">Le Livre révélera de nouvelles épreuves à mesure que vous approcherez de la chapelle.</p>
  `, 'chapter-card');
  updateWalk();
}

function updateWalk(){
  if(state.screen !== 'walk') return;
  const d = distanceTo('chapelle'), t = config.walkThresholds;
  const dist = $('#walkDistance'); if(dist) dist.textContent = fmtDistance(d);
  const textEl = $('#walkText'); if(textEl) textEl.textContent = walkStatus().txt;
  if(!Number.isFinite(d) || sceneTransitionLock || activeWalkEvent) return;

  // Les épreuves restent dans l'ordre, même si le groupe marche plus vite que prévu.
  if(!state.walk.shadow1 && d <= t.shadow1){ state.walk.shadow1 = true; saveState(); showShadow1(); return; }
  if(state.walk.shadow1 && !state.walk.observerDone && d <= t.observer){ showObserverChallenge(); return; }
  if(state.walk.observerDone && !state.walk.memoryShown && d <= t.memoryShow){ state.walk.memoryShown = true; saveState(); showMemoryPattern(); return; }
  if(state.walk.memoryShown && !state.walk.memoryDone && d <= t.memoryTest){ showMemoryTest(); return; }
  if(state.walk.memoryDone && !state.walk.shadow3 && d <= t.shadow3){ showShadow3(); return; }
  if(state.walk.shadow3 && d <= t.approach){ complete('walk'); transitionStep('Le dernier seuil','La Maison de Pierre est toute proche', renderGateChapelle, '✧'); return; }
}

function showShadow1(){
  activeWalkEvent='first';
  haptic([100,80,100]); footsteps(); omen('UNE PRÉSENCE','Quelque chose marche avec vous');
  const e = $('#walkEvent'); if(!e) return;
  e.innerHTML = `<div class="sep"></div><h3>PREMIÈRE ÉPREUVE</h3><p class="quote">Je vous ressemble sans être vous. Je peux vivre sur une vitre ou à la surface d’un bassin. Dans l’obscurité totale, je disparais. Qui suis-je ?</p><div class="choice-grid"><button class="choice" data-a="reflet">Un reflet</button><button class="choice" data-a="brume">De la brume</button><button class="choice" data-a="corbeau">Un corbeau</button><button class="choice" data-a="murmure">Un murmure</button></div><div id="shadow1msg"></div>`;
  $$('#walkEvent .choice').forEach(b => b.onclick = ()=>{
    if(b.dataset.a === 'reflet'){
      successSound();
      activeWalkEvent=null;
      e.innerHTML = '<div class="hint-box">✓ Le Livre se tait. Sur la route de Layer, méfiez-vous désormais de ce qui vous ressemble.</div>';
      setTimeout(footsteps, 450);
    } else {
      failSound();
      $('#shadow1msg').innerHTML = '<p class="error">Cherchez quelque chose qui reproduit une image sans être vivant.</p>';
    }
  });
}

function showObserverChallenge(){
  activeWalkEvent='observer';
  haptic([60,50,60]); omen('L’ŒIL DU VEILLEUR','Soline doit observer sans parler');
  const e=$('#walkEvent'); if(!e) return;
  const first=['☾','✦','ᚱ','◊','ᛉ','⌖'];
  const second=['☾','✦','ᚱ','◇','ᛉ','⌖'];
  e.innerHTML=`<div class="sep"></div><h3>L’ŒIL DU VEILLEUR</h3><p>Passez le téléphone à <strong>Soline</strong>. Les autres laissent-la observer seule.</p><p class="quote">Six signes apparaissent. Tu as jusqu’à 20 secondes pour retenir leur forme et leur position.</p><div class="observer-sequence">${first.map((s,i)=>`<span><small>${i+1}</small>${s}</span>`).join('')}</div><div class="small center">Temps restant : <span id="observerCountdown">20</span> s</div><button type="button" class="btn secondary" id="observerReady">Je suis prête</button>`;
  let n=20, switched=false;
  const switchToQuestion=()=>{
    if(switched) return; switched=true; clearInterval(id);
    e.innerHTML=`<div class="sep"></div><h3>L’ŒIL DU VEILLEUR</h3><p class="quote">Un seul signe a changé. Quelle position n’est plus exactement la même ?</p><div class="observer-sequence altered">${second.map((s,i)=>`<span><small>${i+1}</small>${s}</span>`).join('')}</div><div class="observer-answers">${[1,2,3,4,5,6].map(i=>`<button type="button" class="choice" data-pos="${i}">Position ${i}</button>`).join('')}</div><div id="observerMsg"></div>`;
    $$('#walkEvent [data-pos]').forEach(b=>b.onclick=()=>{
      if(b.dataset.pos==='4'){
        state.walk.observerDone=true; saveState(); activeWalkEvent=null; successSound(); revealSound();
        e.innerHTML='<div class="hint-box">✓ Soline a repéré la variation. L’Œil du Veilleur reste ouvert.</div>';
      }else{
        failSound(); $('#observerMsg').innerHTML='<p class="error">Ce signe semble identique. Observe les formes plus attentivement.</p>';
      }
    });
  };
  $('#observerReady').onclick=switchToQuestion;
  const id=setInterval(()=>{n--;const c=$('#observerCountdown');if(c)c.textContent=n;if(n<=0)switchToQuestion();},1000);
}

function showMemoryPattern(){
  activeWalkEvent='memoryShow';
  haptic(); omen('LE SOUVENIR','Le Porte-Flamme doit se souvenir');
  const e = $('#walkEvent'); if(!e) return;
  e.innerHTML = `<div class="sep"></div><h3>LE SOUVENIR — PORTE-FLAMME</h3><p>Passez le téléphone à <strong>Sacha</strong>. Les autres détournent les yeux.</p><p>Observe cette suite aussi longtemps que nécessaire. Elle restera visible pendant <strong>15 secondes maximum</strong>.</p><div class="memory-seq memory-glow">${state.memoryPattern.join(' ')}</div><div class="small center">Temps restant : <span id="countdown">15</span> s</div><button type="button" class="btn secondary" id="memoryReady">Je l’ai mémorisée</button>`;
  let n = 15;
  let finished=false;
  const finish=()=>{
    if(finished) return; finished=true; clearInterval(id); activeWalkEvent=null;
    e.innerHTML = '<div class="hint-box">Sacha, garde l’ordre en mémoire. Bientôt, Vadim aura une grille que lui seul ne pourra pas résoudre.</div>';
  };
  $('#memoryReady').onclick=finish;
  const id = setInterval(()=>{
    n--;
    const c = $('#countdown'); if(c) c.textContent = n;
    if(n <= 0) finish();
  }, 1000);
}

function showMemoryTest(){
  activeWalkEvent='memoryTest';
  haptic(); omen('LA GRILLE','Le Cryptographe reçoit le message');
  const e = $('#walkEvent'); if(!e) return;
  e.innerHTML = `<div class="sep"></div><h3>LA GRILLE — CRYPTOGRAPHE</h3>
    <p>Passez le téléphone à <strong>Vadim</strong>. Demande maintenant à Sacha de réciter les quatre symboles dans l’ordre.</p>
    <div class="teen-challenge">
      <div class="teen-label">Grille des quatre signes</div>
      <p class="quote">Le 1er souvenir choisit une colonne sur la ligne I, le 2e sur la ligne II, le 3e sur III, le 4e sur IV.</p>
      <div class="rune-grid-wrap">
        <table class="rune-grid">
          <thead><tr><th></th><th>🔥</th><th>☠️</th><th>🌙</th><th>🐦‍⬛</th></tr></thead>
          <tbody>
            <tr><th>I</th><td>A</td><td>R</td><td>N</td><td>M</td></tr>
            <tr><th>II</th><td>L</td><td>O</td><td>S</td><td>E</td></tr>
            <tr><th>III</th><td>U</td><td>T</td><td>C</td><td>H</td></tr>
            <tr><th>IV</th><td>P</td><td>F</td><td>V</td><td>I</td></tr>
          </tbody>
        </table>
      </div>
      <p class="small">Les quatre lettres obtenues forment un nombre écrit en toutes lettres.</p>
      <input class="input" id="memoryWord" maxlength="4" placeholder="Mot" autocomplete="off">
      <button class="btn" id="memoryWordBtn">Valider le déchiffrement</button>
    </div>
    <div id="memmsg"></div>`;
  $('#memoryWordBtn').onclick = ()=>{
    if($('#memoryWord').value.trim().toUpperCase() === 'NEUF'){
      state.walk.memoryDone = true;
      activeWalkEvent=null;
      state.fragments.vadim = '9';
      saveState();
      successSound();
      omen('TROISIÈME FRAGMENT','La grille cède enfin son secret.');
      setTimeout(()=>renderFragment('Vadim','9','ᚱ','Mémoire', renderWalk),550);
    } else {
      failSound();
      $('#memmsg').innerHTML = '<p class="error">La grille ne donne pas ce mot. Vérifiez surtout l’ordre exact mémorisé par Sacha.</p>';
    }
  };
}

function showShadow3(){
  activeWalkEvent='shadow3';
  haptic([100,70,100]); omen('LE JUGEMENT','La Gardienne doit distinguer le vrai du faux');
  const e = $('#walkEvent'); if(!e) return;
  e.innerHTML = `<div class="sep"></div><h3>LE JUGEMENT — GARDIENNE</h3>
    <p>Passez le téléphone à <strong>Louise</strong>.</p>
    <p class="quote">Quatre pierres parlent. Une seule dit la vérité. Les trois autres mentent.</p>
    <div class="logic-stones">
      <div><b>I</b><span>« Le fragment est un nombre pair. »</span></div>
      <div><b>II</b><span>« Le fragment est supérieur à 2. »</span></div>
      <div><b>III</b><span>« Le fragment n’est pas 2. »</span></div>
      <div><b>IV</b><span>« Le fragment est 1 ou 4. »</span></div>
    </div>
    <p class="small">Le fragment est compris entre 1 et 4. Quel nombre rend <strong>une seule</strong> inscription vraie ?</p>
    <input class="input" id="louiseLogic" inputmode="numeric" maxlength="1" placeholder="?">
    <button class="btn" id="louiseReveal">Sceller mon choix</button>
    <div id="louiseMsg"></div>`;
  $('#louiseReveal').onclick = ()=>{
    if($('#louiseLogic').value.trim() === '2'){
      state.fragments.louise='2'; state.walk.shadow3=true; activeWalkEvent=null; saveState(); successSound();
      omen('QUATRIÈME FRAGMENT','La Gardienne a démasqué les mensonges');
      setTimeout(()=>renderFragment('Louise','2','🗝','Gardienne', renderWalk),550);
    } else {
      failSound();
      $('#louiseMsg').innerHTML='<p class="error">Avec ce nombre, il n’y a pas exactement une seule inscription vraie. Teste les quatre possibilités une par une.</p>';
    }
  };
}

function renderGateChapelle(){
  state.screen='gate-chapelle'; saveState(); startGeo(); const l = config.locations.chapelle;
  app.innerHTML = card(`
    ${chapterBadge('Approche finale','La Maison de Pierre')}
    <h2>Le dernier seuil</h2>
    <p class="quote">Cherchez la maison de pierre qui n’est ni une maison, ni une église de village. Elle porte le nom d’une femme.</p>
    ${illustrationBlock('chapel','La maison de pierre','Au bout du chemin, une pierre ancienne attend le dernier serment.')}
    <p class="story">Le Livre s’approche de sa dernière page. Dès que vous serez devant la bonne pierre, le sceau tentera une dernière résistance.</p>
    ${destinationBlock('Repère du Livre', 'Chapelle Sainte-Madeleine — Layer-sur-Roche', 'Rejoignez la chapelle. La finale se déclenchera automatiquement dans le rayon configuré.')}
    ${suspensePanel('Le seuil résiste encore','La Maison de Pierre sent votre présence. Encore quelques pas avant le dernier rituel.')}
    <div id="geoStatus">${geoStatusHtml()}</div>
    <div class="distance" id="liveDistance" data-target="chapelle">${fmtDistance(distanceTo('chapelle'))}</div>
    <div class="small center">Le sceau réagira à ${l.radius} m.</div>
  `, 'chapter-card');
  maybeAutoUnlock('chapelle', renderFinale);
}

function renderFinale(){
  state.screen='finale'; saveState(); haptic([180,90,180]); omen('LE SCEAU DE LAYER','Dernière épreuve');
  app.innerHTML = `<div class="blackout">${card(`
    ${chapterBadge('Sainte-Madeleine','Le Sceau de Layer')}
    ${illustrationBlock('chapel','Le Sceau de Layer','Le cercle ancien ne répond qu’aux Veilleurs encore unis.')}
    <div class="seal-ring"><span>✦</span></div>
    <h2 id="lateText">TROP TARD.</h2>
    <div id="finalBody" class="hidden">
      <p class="quote">… sauf si vous êtes toujours quatre.</p>
      <p class="story">Vos quatre fragments sont justes, mais le sceau refuse qu’on les récite au hasard. Les Veilleurs doivent d’abord retrouver <strong>l’ordre du rituel</strong>.</p>
      <div class="teen-challenge final-logic">
        <div class="teen-label">Dernière énigme — à résoudre ensemble</div>
        <div class="final-clues">
          <p>① L’Œil n’est ni le premier, ni le dernier.</p>
          <p>② La Clé vient après la Rune.</p>
          <p>③ Un seul emblème sépare la Flamme de la Rune.</p>
          <p>④ L’Œil suit immédiatement la Flamme.</p>
        </div>
        <p class="small">Touchez les quatre emblèmes dans l’ordre que vous déduisez.</p>
        <div class="symbol-picks" id="symbolPicks">
          <button type="button" data-sym="K" data-icon="🗝">🗝</button>
          <button type="button" data-sym="R" data-icon="ᚱ">ᚱ</button>
          <button type="button" data-sym="F" data-icon="🔥">🔥</button>
          <button type="button" data-sym="E" data-icon="👁">👁</button>
        </div>
        <div class="order-slots" id="orderSlots"><span>?</span><span>?</span><span>?</span><span>?</span></div>
        <button type="button" class="btn secondary" id="orderReset">Effacer l’ordre</button>
        <div id="orderMsg"></div>
      </div>
      <div id="sealEntry" class="hidden">
        <div class="sep"></div>
        <p class="story">L’ordre est retrouvé. Appelez maintenant chaque Veilleur dans cet ordre et réunissez leurs fragments.</p>
        <input class="input" id="sealCode" inputmode="numeric" maxlength="4" placeholder="_ _ _ _">
        <button class="btn" id="sealBtn">Refermer le sceau</button>
        <div id="finalMsg"></div>
      </div>
    </div>
  `, 'chapter-card final-card')}</div>`;
  setTimeout(()=>{ const b=$('#finalBody'); if(b) b.classList.remove('hidden'); }, 2500);
  setTimeout(()=>tone(58,.55,'sine',.028),600);
  setTimeout(()=>{
    let order=[];
    const slots=()=>$$('#orderSlots span');
    function drawOrder(){
      slots().forEach((s,i)=>s.textContent=order[i]?.icon || '?');
      $$('#symbolPicks button').forEach(b=>{ b.disabled=order.some(x=>x.sym===b.dataset.sym); });
    }
    $$('#symbolPicks button').forEach(b=>b.onclick=()=>{
      if(order.length>=4 || order.some(x=>x.sym===b.dataset.sym)) return;
      order.push({sym:b.dataset.sym,icon:b.dataset.icon}); drawOrder(); tone(120+order.length*45,.08,'sine',.018);
      if(order.length===4){
        const key=order.map(x=>x.sym).join('');
        if(key==='FERK'){
          successSound();
          revealSound();
          $('#orderMsg').innerHTML='<p class="success">✓ L’ordre du rituel est retrouvé : Flamme → Œil → Rune → Clé.</p>';
          $('#sealEntry').classList.remove('hidden'); $('#sealEntry').classList.add('ink-reveal');
          $('#symbolPicks').classList.add('solved');
        } else {
          failSound();
          $('#orderMsg').innerHTML='<p class="error">Le cercle ne répond pas. Au moins une des quatre règles est violée.</p>';
        }
      }
    });
    $('#orderReset').onclick=()=>{ order=[]; drawOrder(); $('#orderMsg').innerHTML=''; $('#sealEntry').classList.add('hidden'); $('#symbolPicks').classList.remove('solved'); };
    $('#sealBtn').onclick=()=>{
      if($('#sealCode').value.trim()==='1292'){
        sealRecoveredSound(); successSound(); complete('finale'); omen('LE SCEAU SE REFERME','Les quatre Veilleurs ont réussi');
        document.body.classList.add('seal-closed');
        finalSealShow(()=>{document.body.classList.remove('seal-closed');renderTreasure();});
      } else {
        failSound(); $('#finalMsg').innerHTML='<p class="error">Les fragments sont bons, mais pas dans cet ordre. Faites parler les quatre Veilleurs selon le rituel que vous venez de retrouver.</p>';
      }
    };
  },2600);
}

function renderTreasure(){
  state.screen='treasure'; saveState();
  app.innerHTML = card(`
    ${chapterBadge('Le sceau est refermé','Le Livre se souvient')}
    ${illustrationBlock('treasure','Le trésor des Veilleurs','Le cercle s’apaise et laisse place à la récompense des Veilleurs.')}
    <h1 class="year-mark">1292</h1>
    <p class="story"><strong>Pourquoi 1292 ?</strong> Les quatre fragments secrets n’étaient pas un code arbitraire : réunis dans l’ordre du rituel, ils forment 1-2-9-2. Le jeu reprend ici l’année traditionnellement associée à la fondation de la chapelle Sainte-Madeleine de Layer par Raoul de Layer. C’est ce lien avec le lieu réel qui permet, dans notre légende, de refermer le sceau à l’endroit même où son histoire aurait commencé.</p>
    <div class="sep"></div>
    <p class="quote">Vadim. Louise. Soline. Sacha. Quatre nouveaux noms sont désormais inscrits dans le Livre des Veilleurs.</p>
    <div class="sep"></div>
    <p class="center">Mais quelque chose est resté de l’autre côté…</p>
    <p class="small center">CODE DU COFFRE</p>
    <div class="distance">${escapeHtml(config.treasureCode)}</div>
    <p class="center"><strong>Le trésor des Veilleurs vous attend.</strong></p>
    ${btn('Terminer le récit', 'finishBtn', 'good')}
  `, 'chapter-card');
  $('#finishBtn').onclick = ()=>{ complete('treasure'); state.screen='done'; saveState(); transitionStep('Le Livre se referme','Le nom des Veilleurs reste inscrit', renderDone, '✦'); };
}

function renderDone(){
  state.screen='done'; saveState();
  app.innerHTML = `
    <div class="hero hero-home">
      <div class="kicker">Mission accomplie</div>
      <h1>Les Quatre<br>Veilleurs</h1>
      ${card(`
        <p class="story">L’Ombre est de nouveau prisonnière. Le Livre se referme, mais il gardera trace de cette nuit et des quatre noms qui ont répondu à l’appel.</p>
        <p><strong>Vadim · Louise · Soline · Sacha</strong></p>
        ${btn('Voir l’écran du trésor', 'treasureAgain', 'secondary')}
      `, 'hero-card')}
    </div>`;
  $('#treasureAgain').onclick = renderTreasure;
}


// ---------- Mode test local ----------
function setSimulatedDistance(distanceMeters, tick=true){
  const target=targetPoint('chapelle'); if(!target) return;
  currentPosition={lat:target.lat+(Number(distanceMeters)/111320),lon:target.lon,accuracy:3,t:Date.now()};
  simulatedPosition=true;
  if(tick) liveTick();
}
function simulatePositionAt(key){
  const target=targetPoint(key);
  if(!target){ if(key==='fontaine'){ renderFontaine(); } return; }
  currentPosition={lat:target.lat,lon:target.lon,accuracy:3,t:Date.now()};
  simulatedPosition=true; liveTick();
}
function resetWalkTestFlags(){
  state.walk={shadow1:false,observerDone:false,memoryShown:false,memoryDone:false,shadow3:false};
  delete state.fragments.vadim; delete state.fragments.louise; saveState();
}
function prepareWalkTest(){
  activeWalkEvent=null;
  setSimulatedDistance(3000,false);
  state.screen='walk'; saveState();
  renderWalk();
}
function testShowWalkEvent(kind){
  prepareWalkTest();
  const e=$('#walkEvent'); if(e) e.innerHTML='';
  if(kind==='shadow1'){
    state.walk.shadow1=true; saveState(); showShadow1();
  }else if(kind==='observer'){
    state.walk.shadow1=true; state.walk.observerDone=false; saveState(); showObserverChallenge();
  }else if(kind==='memoryShow'){
    state.walk.shadow1=true; state.walk.observerDone=true; state.walk.memoryShown=true; saveState(); showMemoryPattern();
  }else if(kind==='memoryTest'){
    state.walk.shadow1=true; state.walk.observerDone=true; state.walk.memoryShown=true; state.walk.memoryDone=false; saveState(); showMemoryTest();
  }else if(kind==='shadow3'){
    state.walk.shadow1=true; state.walk.observerDone=true; state.walk.memoryShown=true; state.walk.memoryDone=true; state.walk.shadow3=false; saveState(); showShadow3();
  }else if(kind==='approach'){
    state.walk={shadow1:true,observerDone:true,memoryShown:true,memoryDone:true,shadow3:true}; saveState();
    setSimulatedDistance(250,true);
  }
}
function testAdvanceCurrent(){
  switch(state.screen){
    case 'gate-mairie': simulatePositionAt('mairie'); break;
    case 'gate-eglise': simulatePositionAt('eglise'); break;
    case 'gate-fontaine': simulatePositionAt('fontaine'); break;
    case 'walk': {
      if(!state.walk.shadow1) testShowWalkEvent('shadow1');
      else if(!state.walk.observerDone) testShowWalkEvent('observer');
      else if(!state.walk.memoryShown) testShowWalkEvent('memoryShow');
      else if(!state.walk.memoryDone) testShowWalkEvent('memoryTest');
      else if(!state.walk.shadow3) testShowWalkEvent('shadow3');
      else testShowWalkEvent('approach');
      break;
    }
    case 'gate-chapelle': simulatePositionAt('chapelle'); break;
    default: document.querySelector('.local-test-panel')?.classList.add('open'); break;
  }
}
function testGo(route){
  if(route==='walk'){ prepareWalkTest(); return; }
  const routes={home:renderHome,prologue:renderPrologue,'gate-mairie':renderGateMairie,mairie:renderMairie,'gate-eglise':renderGateEglise,eglise:renderEglise,'gate-fontaine':renderGateFontaine,fontaine:renderFontaine,'walk-intro':renderWalkIntro,'gate-chapelle':renderGateChapelle,finale:renderFinale,treasure:renderTreasure,done:renderDone};
  routes[route]?.();
}
function initLocalTestToolbar(){
  if(!LOCAL_TEST || document.querySelector('.local-test-dock')) return;
  const dock=document.createElement('div'); dock.className='local-test-dock';
  dock.innerHTML=`
    <button type="button" class="local-test-toggle" title="Outils de test local">🧪 <span>TEST LOCAL</span></button>
    <div class="local-test-panel">
      <div class="local-test-title">Simulation locale</div>
      <p>Les événements de la Marche peuvent maintenant être ouverts directement, sans dépendre des étapes précédentes.</p>
      <button type="button" class="local-test-main" id="localAdvance">▶ Arrivée / événement suivant</button>
      <label for="localStage">Aller directement à :</label>
      <select id="localStage">
        <option value="home">Accueil</option><option value="prologue">Prologue</option>
        <option value="gate-mairie">GPS — Mairie</option><option value="mairie">Mairie — indice</option>
        <option value="gate-eglise">GPS — Église</option><option value="eglise">Énigme — Église</option>
        <option value="gate-fontaine">GPS — Fontaine</option><option value="fontaine">Énigme — Fontaine</option>
        <option value="walk-intro">Intro — Marche</option><option value="walk">Marche — radar neutre</option>
        <option value="gate-chapelle">GPS — Chapelle</option><option value="finale">Finale</option><option value="treasure">Trésor</option>
      </select>
      <button type="button" id="localGo">Afficher cette étape</button>
      <div class="local-test-walk">
        <span>Événements de la Marche</span>
        <button data-walk-event="shadow1">Épreuve 1</button>
        <button data-walk-event="observer">Soline</button>
        <button data-walk-event="memoryShow">Sacha</button>
        <button data-walk-event="memoryTest">Vadim</button>
        <button data-walk-event="shadow3">Louise</button>
        <button data-walk-event="approach">Approche</button>
        <button id="localWalkReset">↺ Marche</button>
      </div>
      <button type="button" id="localReset">Réinitialiser toute la partie</button>
    </div>`;
  document.body.appendChild(dock);
  const panel=$('.local-test-panel',dock);
  $('.local-test-toggle',dock).onclick=()=>panel.classList.toggle('open');
  $('#localAdvance',dock).onclick=()=>{testAdvanceCurrent();panel.classList.remove('open');};
  $('#localGo',dock).onclick=()=>{testGo($('#localStage',dock).value);panel.classList.remove('open');};
  $('#localReset',dock).onclick=()=>{activeWalkEvent=null;state=clone(DEFAULT_STATE);saveState();currentPosition=null;simulatedPosition=false;renderHome();panel.classList.remove('open');};
  $('#localWalkReset',dock).onclick=()=>{resetWalkTestFlags();prepareWalkTest();panel.classList.remove('open');};
  $$('[data-walk-event]',dock).forEach(b=>b.onclick=()=>{testShowWalkEvent(b.dataset.walkEvent);panel.classList.remove('open');});
}

// ---------- Mode maître du jeu ----------
$('#gmButton').onclick = ()=>openGmLogin();
function modal(inner){
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal">${inner}</div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', e => { if(e.target === wrap) wrap.remove(); });
  return wrap;
}
function openGmLogin(){
  const m = modal(`<h2>Maître du jeu</h2><p class="small">Accès adulte.</p><input class="input" id="gmPinInput" inputmode="numeric" placeholder="Code PIN"><button class="btn" id="gmLogin">Ouvrir</button><button class="btn secondary" id="gmCancel">Annuler</button><div id="gmLoginMsg"></div>`);
  $('#gmCancel', m).onclick = ()=>m.remove();
  $('#gmLogin', m).onclick = ()=>{ if($('#gmPinInput', m).value === config.gmPin){ m.remove(); openGmPanel(); } else $('#gmLoginMsg', m).innerHTML = '<p class="error">Code incorrect.</p>'; };
}
function locRow(key){
  const l = config.locations[key];
  return `<div class="admin-row" data-loc="${key}"><h3>${escapeHtml(l.name)}</h3><div class="coord-grid"><input class="input lat" type="number" step="any" placeholder="Latitude" value="${l.lat??''}"><input class="input lon" type="number" step="any" placeholder="Longitude" value="${l.lon??''}"><input class="input radius" type="number" min="10" max="300" step="5" placeholder="Rayon" value="${l.radius}"></div><div class="small">Statut : ${l.calibrated?'<span class="success">calibré sur place</span>':'<span class="tiny">coordonnée indicative / à vérifier</span>'}</div><button class="btn capture">📍 Utiliser ma position actuelle</button><button class="btn secondary save-loc">Enregistrer cette étape</button></div>`;
}
function openGmPanel(){
  const m = modal(`<div class="kicker">Administration</div><h2>Maître du jeu</h2><p class="small">Le calibrage est stocké uniquement dans ce navigateur.</p><h3>Coordonnées</h3>${Object.keys(config.locations).map(locRow).join('')}
  <div class="sep"></div><h3>Réglages</h3><label>Code PIN adulte</label><input class="input" id="pinCfg" value="${escapeHtml(config.gmPin)}"><label>Code du coffre</label><input class="input" id="treasureCfg" value="${escapeHtml(config.treasureCode)}"><label class="admin-check"><input type="checkbox" id="countdownCfg" ${config.countdownEnabled?'checked':''}> Activer le décompte avant l’aventure</label><label>Date et heure d’ouverture</label><input class="input" id="unlockCfg" type="datetime-local" value="${escapeHtml(config.unlockAt || '')}"><p class="small">En mode test local, ce verrou est ignoré.</p>
  <button class="btn" id="saveSettings">Enregistrer les réglages</button>
  <div class="sep"></div><h3>Test / secours</h3><div class="admin-grid"><button class="btn secondary force" data-go="renderMairie">Forcer Mairie</button><button class="btn secondary force" data-go="renderEglise">Forcer Église</button><button class="btn secondary force" data-go="renderFontaine">Forcer Fontaine</button><button class="btn secondary force" data-go="renderWalk">Forcer Marche</button><button class="btn secondary force" data-go="renderFinale">Forcer Finale</button><button class="btn secondary force" data-go="renderTreasure">Afficher Trésor</button></div>
  <div class="sep"></div><h3>Sauvegarde du calibrage</h3><button class="btn" id="exportCfg">Exporter la configuration JSON</button><label class="btn secondary" style="display:block;text-align:center">Importer une configuration JSON<input id="importCfg" type="file" accept="application/json" class="hidden"></label>
  <button class="btn danger" id="resetGameAdmin">Effacer la progression du jeu</button><button class="btn secondary" id="closeGm">Fermer</button><div id="adminMsg"></div>`);
  startGeo();
  $$('.admin-row', m).forEach(row => {
    const key = row.dataset.loc;
    $('.capture', row).onclick = ()=>{
      if(!navigator.geolocation){ $('#adminMsg', m).innerHTML = '<p class="error">GPS non disponible.</p>'; return; }
      navigator.geolocation.getCurrentPosition(pos => {
        $('.lat', row).value = pos.coords.latitude.toFixed(7);
        $('.lon', row).value = pos.coords.longitude.toFixed(7);
        config.locations[key].lat = pos.coords.latitude;
        config.locations[key].lon = pos.coords.longitude;
        config.locations[key].calibrated = true;
        saveConfig();
        $('#adminMsg', m).innerHTML = `<p class="success">${escapeHtml(config.locations[key].name)} : position capturée (précision ± ${Math.round(pos.coords.accuracy)} m). Faites 2–3 mesures et gardez la plus stable.</p>`;
      }, err => {
        $('#adminMsg', m).innerHTML = `<p class="error">Impossible de lire la position : ${escapeHtml(err.message)}</p>`;
      }, { enableHighAccuracy:true, maximumAge:0, timeout:20000 });
    };
    $('.save-loc', row).onclick = ()=>{
      const lat = parseFloat($('.lat', row).value), lon = parseFloat($('.lon', row).value), radius = parseFloat($('.radius', row).value);
      if(!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180){ $('#adminMsg', m).innerHTML = '<p class="error">Latitude/longitude invalides.</p>'; return; }
      config.locations[key].lat = lat;
      config.locations[key].lon = lon;
      config.locations[key].radius = Math.max(10, Math.min(300, Number.isFinite(radius) ? radius : 55));
      saveConfig();
      $('#adminMsg', m).innerHTML = `<p class="success">Coordonnées enregistrées pour ${escapeHtml(config.locations[key].name)}.</p>`;
    };
  });
  $('#saveSettings', m).onclick = ()=>{
    config.gmPin = $('#pinCfg', m).value.trim() || '4826';
    config.treasureCode = $('#treasureCfg', m).value.trim() || '3147';
    config.countdownEnabled = $('#countdownCfg', m).checked;
    config.unlockAt = $('#unlockCfg', m).value || '2026-10-31T15:45';
    saveConfig();
    $('#adminMsg', m).innerHTML = '<p class="success">Réglages enregistrés.</p>';
  };
  const actions = { renderMairie, renderEglise, renderFontaine, renderWalk, renderFinale, renderTreasure };
  $$('.force', m).forEach(b => b.onclick = ()=>{ m.remove(); actions[b.dataset.go]?.(); });
  $('#exportCfg', m).onclick = ()=>{ const blob = new Blob([JSON.stringify(config, null, 2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'veilleurs-coordonnees.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000); };
  $('#importCfg', m).onchange = async e => { const f = e.target.files?.[0]; if(!f) return; try { const raw = JSON.parse(await f.text()); config = mergeConfig(raw); saveConfig(); m.remove(); openGmPanel(); } catch { $('#adminMsg', m).innerHTML = '<p class="error">Fichier JSON invalide.</p>'; } };
  $('#resetGameAdmin', m).onclick = ()=>{ if(confirm('Effacer toute la progression ?')){ state = clone(DEFAULT_STATE); saveState(); m.remove(); renderHome(); } };
  $('#closeGm', m).onclick = ()=>m.remove();
}

function resume(){
  startGeo();
  const s = state.screen;
  const routes = { home:renderHome, prologue:renderPrologue, 'gate-mairie':renderGateMairie, mairie:renderMairie, 'gate-eglise':renderGateEglise, eglise:renderEglise, 'gate-fontaine':renderGateFontaine, fontaine:renderFontaine, 'walk-intro':renderWalkIntro, walk:renderWalk, 'gate-chapelle':renderGateChapelle, finale:renderFinale, treasure:renderTreasure, done:renderDone };
  (routes[s] || renderHome)();
}

initAtmosphere();
updateSoundButton();
$('#soundButton')?.addEventListener('click', ()=>{
  soundEnabled=!soundEnabled;
  localStorage.setItem('veilleurs_sound', soundEnabled?'on':'off');
  if(soundEnabled){ startAmbient(); tone(329.63,.2,'sine',.035); setTimeout(()=>tone(440,.24,'sine',.025),120); } else stopAmbient();
  updateSoundButton();
});
document.addEventListener('pointerdown', ()=>{ if(soundEnabled) startAmbient(); }, {once:true});

if('serviceWorker' in navigator){
  window.addEventListener('load', async ()=>{
    if(LOCAL_TEST){
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('veilleurs-')).map(k => caches.delete(k)));
      } catch {}
      return;
    }
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}
resume();
initLocalTestToolbar();
