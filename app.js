'use strict';

/*
  Le Sceau des Quatre Passages — Veuxhaulles-sur-Aube
  ----------------------------------------------------
  Les coordonnées du terrain se règlent dans le mode Maître du jeu (⚙).
  Le mode local ?test=1 permet de tester toutes les étapes sans GPS réel.
*/

const DEFAULT_CONFIG = {
  version: 7,
  gmPin: '4826',
  treasureCode: '3147',
  lock: {
    enabled: true,
    at: '2026-10-28T14:30'
  },
  locations: {
    church: {
      name: 'Église Saint-Pierre-ès-Liens',
      detail: 'Veuxhaulles-sur-Aube',
      lat: 47.9455556,
      lon: 4.8027778,
      radius: 55,
      calibrated: false
    },
    pond: {
      name: 'Le seuil des étangs',
      detail: 'Boucle des étangs de Veuxhaulles-sur-Aube',
      lat: null,
      lon: null,
      radius: 65,
      calibrated: false
    },
    bridge: {
      name: 'Le vieux pont de pierre',
      detail: 'Boucle des étangs de Veuxhaulles-sur-Aube',
      lat: null,
      lon: null,
      radius: 65,
      calibrated: false
    },
    tower: {
      name: "Ancienne tour d'eau ferroviaire",
      detail: 'À observer depuis le chemin autorisé, sans aller sur les voies',
      lat: null,
      lon: null,
      radius: 80,
      calibrated: false
    },
    final: {
      name: 'Retour au point du serment',
      detail: 'Église Saint-Pierre-ès-Liens',
      lat: 47.9455556,
      lon: 4.8027778,
      radius: 60,
      calibrated: false
    }
  },
  puzzle: {
    churchWindows: 3,
    pondOpenings: 5,
    bridgeArches: 3
  }
};

const DEFAULT_STATE = {
  screen: 'home',
  startedAt: null,
  completed: [],
  fragments: {},
  hints: {},
  returnStartDistance: null
};

const SYMBOLS = {
  eye: 'assets/symbol-eye.png',
  water: 'assets/symbol-water.png',
  passage: 'assets/symbol-passage.png',
  iron: 'assets/symbol-iron.png'
};

const FRAGMENTS = {
  eye: { owner: 'Soline', role:'Œil du Veilleur', digit: '7', icon: '👁', symbol:SYMBOLS.eye, title: "Marque de l’Œil", theme:'eye', whisper:'Le Verre refermé ne laissera plus l’Ombre regarder le village.' },
  water: { owner: 'Sacha', role:'Porte-Eau', digit: '4', icon: '💧', symbol:SYMBOLS.water, title: "Marque de l’Eau", theme:'water', whisper:'L’Eau garde la mémoire du courant et efface la trace de l’Ombre.' },
  passage: { owner: 'Vadim', role:'Gardien du Passage', digit: '9', icon: '◠', symbol:SYMBOLS.passage, title: 'Marque du Passage', theme:'passage', whisper:'La Pierre rabat ses arches et ferme la route entre les rives.' },
  iron: { owner: 'Louise', role:'Gardienne du Fer', digit: '2', icon: '⚙', symbol:SYMBOLS.iron, title: 'Marque du Fer', theme:'iron', whisper:'Le Fer fixe le dernier verrou et empêche l’appel des lignes mortes.' }
};

const ILLUSTRATIONS = {
  book: 'assets/book.png',
  church: 'assets/church.png',
  walk: 'assets/walk.png',
  treasure: 'assets/treasure.png',
  pondScene: 'assets/bg-pond.png',
  bridgeScene: 'assets/bg-bridge.png',
  towerScene: 'assets/bg-tower.png'
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');
const LOCAL_TEST = new URLSearchParams(location.search).get('test') === '1';

function clone(v){ return JSON.parse(JSON.stringify(v)); }
function mergeConfig(raw){
  const base = clone(DEFAULT_CONFIG);
  if(!raw || typeof raw !== 'object') return base;
  const rawVersion = Number(raw.version) || 0;
  if(raw.gmPin) base.gmPin = String(raw.gmPin);
  if(raw.treasureCode) base.treasureCode = String(raw.treasureCode);
  // Migration v7 : le lancement officiel est fixé au 28 octobre 2026 à 14 h 30.
  // Les anciennes configurations (v6 et antérieures) héritent automatiquement de ce verrou.
  // Une fois la v7 enregistrée, le Maître du jeu peut toujours modifier la date depuis ⚙.
  if(rawVersion >= 7 && raw.lock && typeof raw.lock === 'object') Object.assign(base.lock, raw.lock);
  if(raw.puzzle) Object.assign(base.puzzle, raw.puzzle);
  if(raw.locations){
    Object.keys(base.locations).forEach(k => {
      if(raw.locations[k]) Object.assign(base.locations[k], raw.locations[k]);
    });
  }
  return base;
}
function loadConfig(){
  try { return mergeConfig(JSON.parse(localStorage.getItem('veilleurs_veuxhaulles_config') || 'null')); }
  catch { return clone(DEFAULT_CONFIG); }
}
function saveConfig(){ localStorage.setItem('veilleurs_veuxhaulles_config', JSON.stringify(config)); }
function loadState(){
  try { return Object.assign(clone(DEFAULT_STATE), JSON.parse(localStorage.getItem('veilleurs_veuxhaulles_state') || '{}')); }
  catch { return clone(DEFAULT_STATE); }
}
function saveState(){ localStorage.setItem('veilleurs_veuxhaulles_state', JSON.stringify(state)); }
function complete(id){ if(!state.completed.includes(id)) state.completed.push(id); saveState(); }
function resetGame(){ state = clone(DEFAULT_STATE); saveState(); renderLanding(); }

let config = loadConfig();
let state = loadState();
let currentPosition = null;
let geoWatchId = null;
let geoError = '';
let sceneLock = false;
let audioCtx = null;
let ambientNodes = [];
let ambientTrack = null;
let ambientFadeTimer = null;
let soundEnabled = localStorage.getItem('veilleurs_sound') !== 'off';
let lockTimer = null;

function unlockDate(){
  if(!config.lock?.enabled || !config.lock?.at) return null;
  const d=new Date(config.lock.at);
  return Number.isFinite(d.getTime())?d:null;
}
function adventureLocked(){
  if(LOCAL_TEST) return false;
  const d=unlockDate();
  return !!d && Date.now()<d.getTime();
}
function formatUnlockDate(d){
  try{return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);}
  catch{return d.toLocaleString('fr-FR');}
}
function countdownText(d){
  const ms=Math.max(0,d.getTime()-Date.now());
  const total=Math.floor(ms/1000),days=Math.floor(total/86400),hours=Math.floor((total%86400)/3600),mins=Math.floor((total%3600)/60),secs=total%60;
  return `${days?days+' j · ':''}${String(hours).padStart(2,'0')} h · ${String(mins).padStart(2,'0')} min · ${String(secs).padStart(2,'0')} s`;
}
function startLockCountdown(d){
  clearInterval(lockTimer);
  const tick=()=>{
    const el=$('#lockCountdown');
    if(!el){clearInterval(lockTimer);return;}
    if(Date.now()>=d.getTime()){clearInterval(lockTimer);renderLanding();return;}
    el.textContent=countdownText(d);
  };
  tick();lockTimer=setInterval(tick,1000);
}

function escapeHtml(s=''){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function card(inner, cls=''){ return `<section class="card ${cls}">${inner}</section>`; }
function btn(label,id,cls=''){ return `<button type="button" class="btn ${cls}" id="${id}">${label}</button>`; }
function badge(a,b=''){ return `<div class="chapter-badge"><span>${escapeHtml(a)}</span>${b?`<small>${escapeHtml(b)}</small>`:''}</div>`; }
function lore(title,text){ return `<div class="lore-block"><div class="lore-title">${escapeHtml(title)}</div><p>${text}</p></div>`; }
function destination(title, detail, note=''){
  return `<div class="destination-block"><div class="destination-icon">⌖</div><div><div class="destination-title">${escapeHtml(title)}</div><div class="destination-detail">${escapeHtml(detail)}</div>${note?`<div class="destination-note">${escapeHtml(note)}</div>`:''}</div></div>`;
}
function illustration(srcKey,title='',caption='',extra=''){
  const src = ILLUSTRATIONS[srcKey] || ILLUSTRATIONS.book;
  return `<figure class="illustration-card ${extra}"><div class="illustration-frame"><img src="${src}" alt="${escapeHtml(title || 'Illustration de l’aventure')}" loading="lazy"></div>${title||caption?`<figcaption><strong>${escapeHtml(title)}</strong>${caption?`<span>${escapeHtml(caption)}</span>`:''}</figcaption>`:''}</figure>`;
}
function symbolImg(src,label='',cls=''){
  return `<img class="symbol-asset ${cls}" src="${src}" alt="${escapeHtml(label)}">`;
}
function roleSigil(key){
  const f=FRAGMENTS[key];
  if(!f) return '';
  return `<div class="sigil sigil-asset sigil-${key}">${symbolImg(f.symbol,`${f.owner} — ${f.role}`,'role-symbol')}<small>${escapeHtml(f.owner)}<br>${escapeHtml(f.role)}</small></div>`;
}
function progress(n){ return `<div class="progress">${[1,2,3,4].map(i=>`<i class="${i<=n?'on':''}"></i>`).join('')}</div>`; }
function suspense(title,text){
  return `<div class="suspense-panel travel"><div class="suspense-fog"></div><div class="suspense-glow"></div><div class="suspense-content"><div class="suspense-kicker">Le Livre écoute le chemin</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p><div class="suspense-runes"><span>✦</span><span>☾</span><span>ᚱ</span><span>⌖</span></div></div></div>`;
}
function hints(stage, arr){
  const used = state.hints[stage] || 0;
  return `<div class="hints"><div class="small">Le Livre peut murmurer un indice.</div>
    ${used>=1?`<div class="hint-box">💡 ${escapeHtml(arr[0])}</div>`:''}
    ${used>=2?`<div class="hint-box">🕯️ ${escapeHtml(arr[1])}</div>`:''}
    ${used<2?`<button type="button" class="btn secondary hint-btn" data-stage="${stage}">${used?'Aide du Veilleur':'Indice 1'}</button>`:''}
  </div>`;
}
function bindHints(rerender){
  $$('.hint-btn').forEach(b => b.onclick = ()=>{
    state.hints[b.dataset.stage] = (state.hints[b.dataset.stage] || 0) + 1;
    saveState(); rerender();
  });
}

function setScene(scene='home'){
  document.body.dataset.scene = scene;
}
function currentProgressLabel(){
  const map={
    prologue:'Le nouveau serment','gate-church':'En route vers les Yeux de Verre',church:'Les Yeux de Verre','fragment-eye':'Fragment de l’Œil',
    'gate-pond':'Vers le Seuil de l’Eau',pond:'Le Seuil de l’Eau','fragment-water':'Fragment de l’Eau','gate-bridge':'Vers le Passage de Pierre',
    bridge:'Le Passage de Pierre','fragment-passage':'Fragment du Passage','gate-tower':'Vers le Gardien du Fer',tower:'Le Gardien du Fer',
    'fragment-iron':'Fragment du Fer',return:'La Marche à rebours',final:'Le Rituel des Quatre',treasure:'Le trésor des Veilleurs',done:'Mission accomplie'
  };
  return map[state.screen] || 'Le Livre des Veilleurs';
}
function renderLanding(){
  setScene('landing');
  clearInterval(lockTimer);
  const hasProgress=!!state.startedAt;
  const unlock=unlockDate();
  const locked=adventureLocked();
  app.innerHTML=`<section class="landing-page landing-mystery ${locked?'landing-locked':''}">
    <div class="landing-shadow" aria-hidden="true"><span class="landing-shadow-body"></span><span class="landing-shadow-eyes"></span><span class="landing-shadow-hand"></span></div>
    <div class="landing-mist landing-mist-a"></div><div class="landing-mist landing-mist-b"></div>
    <div class="landing-stage">
      <div class="landing-forewarning"><span>✦</span> Le Livre s’est rouvert à Veuxhaulles <span>✦</span></div>
      <div class="landing-place">Veuxhaulles-sur-Aube</div>
      <h1 class="landing-title">Le Sceau des<br><strong>Quatre Passages</strong></h1>
      <p class="landing-whisper">Quelque chose rôde encore entre le Verre, l’Eau, la Pierre et le Fer.</p>

      <div class="landing-sigil-field">
        <div class="landing-center-seal"><span class="landing-center-rune">${locked?'⌛':'✦'}</span><small>${locked?'LE LIVRE EST SCELLÉ':'LE LIVRE VOUS OBSERVE'}</small></div>
        <div class="landing-role role-eye">${symbolImg(FRAGMENTS.eye.symbol,'Soline — Œil du Veilleur','landing-role-symbol')}<span>Soline</span><small>Œil du Veilleur</small></div>
        <div class="landing-role role-water">${symbolImg(FRAGMENTS.water.symbol,'Sacha — Porte-Eau','landing-role-symbol')}<span>Sacha</span><small>Porte-Eau</small></div>
        <div class="landing-role role-passage">${symbolImg(FRAGMENTS.passage.symbol,'Vadim — Gardien du Passage','landing-role-symbol')}<span>Vadim</span><small>Gardien du Passage</small></div>
        <div class="landing-role role-iron">${symbolImg(FRAGMENTS.iron.symbol,'Louise — Gardienne du Fer','landing-role-symbol')}<span>Louise</span><small>Gardienne du Fer</small></div>
      </div>

      <p class="landing-lead">Quatre Veilleurs. Quatre marques perdues. Une Ombre qui connaît déjà le chemin.</p>
      <div class="landing-warning"><span class="landing-warning-eye">◉</span><div><strong>Ne vous séparez pas.</strong><small>Le Livre n’appelle jamais quatre noms sans raison.</small></div></div>

      ${locked?`<div class="lock-panel"><div class="lock-rune">✦</div><div class="lock-kicker">Le Livre refuse encore de s’ouvrir</div><h2>Le sceau est intact.</h2><p>Les quatre noms sont écrits, mais l’encre demeure noire. Le Livre ne répondra qu’au moment choisi.</p><div class="lock-date">Déverrouillage : <strong>${escapeHtml(formatUnlockDate(unlock))}</strong></div><div class="lock-countdown" id="lockCountdown">${countdownText(unlock)}</div><p class="small">Revenez lorsque le compte sera terminé. Le mode Maître du jeu reste accessible avec ⚙.</p></div>`:`<div class="landing-actions">${btn(hasProgress?'Reprendre là où le Livre vous attend':'Ouvrir le Livre','landingPrimary','good')}${hasProgress?btn('Relire le commencement','landingStory','secondary'):''}</div>`}
      ${!locked?(hasProgress?`<div class="landing-resume"><span>Le Livre se souvient</span><strong>${escapeHtml(currentProgressLabel())}</strong></div>`:'<div class="landing-resume"><span>4 Veilleurs · 4 passages · 1 Ombre</span><strong>Votre serment n’a pas encore été prononcé.</strong></div>'):''}
      <div class="landing-tip">🔊 Son recommandé · Téléphone chargé · Restez toujours groupés</div>
    </div>
  </section>`;
  if(locked){startLockCountdown(unlock);return;}
  $('#landingPrimary').onclick=()=>{
    startAmbient();
    if(hasProgress){ startGeo(); resumeGameFromState(); }
    else transition('Le Livre vous reconnaît','Avant le premier passage, découvrez pourquoi vos quatre noms ont été écrits ensemble',renderHome,'✦');
  };
  $('#landingStory')?.addEventListener('click',()=>{startAmbient();transition('Le Livre se rouvre','Quelque chose tourne déjà les pages dans l’obscurité',renderHome,'✦');});
}

/* ---------- audio / ambiance ---------- */
function getAudio(){
  if(!soundEnabled) return null;
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }catch{return null;}
}
function tone(freq=160,dur=.15,type='sine',vol=.025,delay=0){
  if(!soundEnabled) return;
  const A=getAudio(); if(!A) return;
  try{
    const o=A.createOscillator(),g=A.createGain();
    o.type=type; o.frequency.value=freq; g.gain.value=vol;
    o.connect(g); g.connect(A.destination);
    const start=A.currentTime+delay;
    o.start(start); g.gain.setValueAtTime(vol,start); g.gain.exponentialRampToValueAtTime(.0001,start+dur); o.stop(start+dur+.02);
  }catch{}
}
function startAmbient(){
  if(!soundEnabled) return;
  const A=getAudio();
  try{
    if(!ambientTrack){
      ambientTrack=new Audio('assets/ambience.ogg');
      ambientTrack.loop=true;
      ambientTrack.preload='auto';
      ambientTrack.volume=0;
    }
    clearInterval(ambientFadeTimer);
    ambientTrack.play().then(()=>{
      const target=.42;
      ambientFadeTimer=setInterval(()=>{
        if(!ambientTrack || !soundEnabled){ clearInterval(ambientFadeTimer); return; }
        ambientTrack.volume=Math.min(target,ambientTrack.volume+.025);
        if(ambientTrack.volume>=target-.001) clearInterval(ambientFadeTimer);
      },90);
    }).catch(()=>{});
  }catch{}
  if(!A || ambientNodes.length) return;
  try{
    const master=A.createGain(); master.gain.value=.0045;
    const f=A.createBiquadFilter(); f.type='lowpass'; f.frequency.value=240;
    const lfo=A.createOscillator(),lfoGain=A.createGain(); lfo.frequency.value=.055;lfoGain.gain.value=.0022;
    const a=A.createOscillator(),b=A.createOscillator(); a.frequency.value=36.71;b.frequency.value=55;a.type='sine';b.type='triangle';
    lfo.connect(lfoGain);lfoGain.connect(master.gain);a.connect(master);b.connect(master);master.connect(f);f.connect(A.destination);
    a.start();b.start();lfo.start();ambientNodes=[a,b,lfo,master,f,lfoGain];
  }catch{}
}
function stopAmbient(){
  clearInterval(ambientFadeTimer);
  if(ambientTrack){
    try{ambientTrack.pause();ambientTrack.volume=0;}catch{}
  }
  ambientNodes.forEach(n=>{try{n.stop?.()}catch{} try{n.disconnect?.()}catch{}}); ambientNodes=[];
}
function successSound(){ tone(294,.12,'sine',.02);tone(440,.2,'sine',.022,.12); }
function failSound(){ tone(92,.2,'sawtooth',.018);document.body.classList.remove('failure-pulse');void document.body.offsetWidth;document.body.classList.add('failure-pulse'); }
function failureCue(stage='default'){
  failSound();
  const cues={
    church:[[910,.08,'triangle',.018,0],[650,.14,'sine',.014,.05],[280,.28,'sawtooth',.012,.12]],
    pond:[[170,.2,'sine',.018,0],[130,.26,'triangle',.016,.08],[95,.32,'sawtooth',.013,.16]],
    bridge:[[210,.12,'square',.014,0],[160,.18,'triangle',.014,.08],[118,.26,'sawtooth',.012,.18]],
    tower:[[520,.06,'square',.016,0],[410,.08,'square',.014,.07],[250,.24,'sawtooth',.013,.16],[140,.32,'triangle',.012,.28]],
    final:[[130,.16,'sawtooth',.017,0],[104,.2,'triangle',.015,.08],[92,.25,'triangle',.015,.2],[82,.34,'sine',.013,.36]],
    default:[[78,.22,'sawtooth',.018,0],[62,.35,'triangle',.015,.12],[110,.2,'sine',.012,.36]]
  };
  (cues[stage]||cues.default).forEach(args=>tone(...args));
  fearScreen(stage);
}
function fearScreen(stage='default'){
  const scenes={
    church:{img:'assets/bg-church.png',title:'Le Verre se trouble',sub:'Dans les vitraux, une silhouette semble se retourner vers vous.',mark:'👁',kicker:'Le premier passage refuse encore de se fermer',theme:'church'},
    pond:{img:'assets/bg-pond.png',title:'Le Seuil remue encore',sub:'L’eau blanche charrie un murmure trop ancien pour être humain.',mark:'💧',kicker:'Le courant déforme le compte des fenêtres',theme:'pond'},
    bridge:{img:'assets/bg-bridge.png',title:'La Pierre laisse passer l’ombre',sub:'Sous les arches, quelque chose traverse encore d’une rive à l’autre.',mark:'◠',kicker:'Le pont garde son secret sous la maçonnerie',theme:'bridge'},
    tower:{img:'assets/bg-tower.png',title:'Le Fer répond dans le noir',sub:'Un ancien appel frappe encore la tour, comme si la ligne voulait revivre.',mark:'⚙',kicker:'Le dernier gardien détourne les signaux',theme:'tower'},
    final:{img:'assets/bg-final.png',title:'Le Sceau résiste',sub:'Les quatre passages sentent encore l’Ombre circuler entre eux.',mark:'✦',kicker:'Le rituel n’a pas encore pris',theme:'final'},
    default:{img:'assets/bg-return.png',title:'L’Ombre se rapproche',sub:'Le Livre vacille un instant sous une présence étrangère.',mark:'✦',kicker:'Le chemin refuse votre réponse',theme:'default'}
  };
  const s=scenes[stage]||scenes.default;
  const old=document.querySelector('.fear-screen'); old?.remove();
  const el=document.createElement('div');
  el.className=`fear-screen fear-${s.theme}`;
  el.innerHTML=`<div class="fear-screen-bg" style="background-image:linear-gradient(180deg,rgba(4,4,8,.04),rgba(4,4,8,.92)),url('${s.img}')"></div><div class="fear-screen-vignette"></div><div class="fear-approach"><div class="fear-shadow-haze"></div><div class="fear-shadow-core"></div><div class="fear-shadow-eyes"></div><div class="fear-shadow-mouth"></div><div class="fear-shadow-claw left"></div><div class="fear-shadow-claw right"></div></div><div class="fear-screen-content"><div class="fear-kicker">${escapeHtml(s.kicker)}</div><div class="fear-mark">${escapeHtml(s.mark)}</div><div class="fear-title">${escapeHtml(s.title)}</div><div class="fear-sub">${escapeHtml(s.sub)}</div></div>`;
  document.body.appendChild(el);
  haptic([30,60,100]);
  requestAnimationFrame(()=>el.classList.add('show'));
  setTimeout(()=>el.classList.add('leave'),1850);
  setTimeout(()=>el.remove(),2700);
}
function revealSound(){ tone(145,.08,'triangle',.014);tone(220,.11,'sine',.015,.08);tone(330,.15,'sine',.017,.16); }
function bell(){ tone(196,.65,'sine',.024);tone(98,.8,'sine',.012,.08); }
function haptic(v=80){ try{navigator.vibrate?.(v);}catch{} }
function updateSoundButton(){ const b=$('#soundButton'); if(b) b.textContent=soundEnabled?'🔊':'🔇'; }

$('#soundButton')?.addEventListener('click',()=>{
  soundEnabled=!soundEnabled; localStorage.setItem('veilleurs_sound',soundEnabled?'on':'off');
  if(soundEnabled) startAmbient(); else stopAmbient(); updateSoundButton();
});

/* ---------- scènes ---------- */
function omen(title,sub=''){
  const old=$('.scene-omen'); old?.remove();
  const el=document.createElement('div'); el.className='scene-omen';
  el.innerHTML=`<div class="scene-omen-panel"><div class="omen-rune">✦</div><div class="omen-title">${escapeHtml(title)}</div>${sub?`<div class="omen-sub">${escapeHtml(sub)}</div>`:''}</div>`;
  document.body.appendChild(el);requestAnimationFrame(()=>el.classList.add('show'));setTimeout(()=>el.classList.add('leave'),1650);setTimeout(()=>el.remove(),2450);
}
function transition(title,sub,cb,icon='✦'){
  if(sceneLock) return; sceneLock=true;
  const el=document.createElement('div');el.className='scene-transition';
  el.innerHTML=`<div class="scene-transition-inner"><div class="transition-sigil">${icon}</div><div class="transition-kicker">Le Livre tourne une page</div><div class="transition-title">${escapeHtml(title)}</div><div class="transition-sub">${escapeHtml(sub||'')}</div><div class="transition-trace"></div></div>`;
  document.body.appendChild(el);requestAnimationFrame(()=>el.classList.add('show'));revealSound();setTimeout(()=>el.classList.add('leave'),2050);setTimeout(()=>{el.remove();sceneLock=false;cb?.();},3150);
}

function sealTransition(key,cb){
  if(sceneLock) return; sceneLock=true;
  const map={
    eye:{icon:'👁',kicker:'Le Verre se referme',title:'La première marque rejoint le Livre',sub:'L’Ombre détourne son regard de l’église et s’enfuit vers l’Eau.',theme:'eye'},
    water:{icon:'💧',kicker:'Le courant cède',title:'La seconde marque est sauvée',sub:'Le seuil se tait. L’Ombre glisse maintenant vers la Pierre.',theme:'water'},
    passage:{icon:'◠',kicker:'Les arches se ferment',title:'La troisième marque revient aux Veilleurs',sub:'Privée du pont, l’Ombre cherche un dernier chemin dans le Fer.',theme:'passage'},
    iron:{icon:'⚙',kicker:'Le dernier verrou est repris',title:'Les quatre marques sont réunies',sub:'Il faut rentrer au point du serment avant que l’Ombre ne se retourne.',theme:'iron'}
  };
  const base=FRAGMENTS[key]||null; const s=map[key]||{icon:'✦',kicker:'Le Livre tourne une page',title:'Une marque a été retrouvée',sub:'Le chemin continue.',theme:'default'};
  const el=document.createElement('div');
  el.className=`scene-transition seal-shift seal-shift-${s.theme}`;
  el.innerHTML=`<div class="scene-transition-inner seal-shift-inner"><div class="seal-shift-aura"></div><div class="transition-kicker">${escapeHtml(s.kicker)}</div><div class="transition-sigil">${base?symbolImg(base.symbol,base.role,'transition-symbol'):s.icon}</div><div class="transition-title">${escapeHtml(s.title)}</div><div class="transition-sub">${escapeHtml(s.sub)}</div><div class="seal-shift-runes"><span>${s.icon}</span><span>✦</span><span>${base?escapeHtml(base.owner):'☾'}</span></div><div class="transition-trace"></div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(()=>el.classList.add('show'));
  revealSound();
  haptic([40,60,90]);
  setTimeout(()=>el.classList.add('leave'),2400);
  setTimeout(()=>{el.remove();sceneLock=false;cb?.();},3600);
}
function cinematicIntro(cb){
  if(sceneLock) return; sceneLock=true;
  const el=document.createElement('div');el.className='cinematic-intro';
  el.innerHTML=`<div class="cinematic-intro-bg"></div><div class="cinematic-intro-vignette"></div><div class="cinematic-intro-content"><div class="cinematic-kicker">Veuxhaulles-sur-Aube</div><div class="cinematic-title">Le Sceau des Quatre Passages</div><p class="cinematic-line">Avant que le village ne connaisse les routes et les rails, l’Aube portait déjà des histoires dans ses reflets.</p><p class="cinematic-line delay-2">Une nuit, quelque chose en sortit.</p><p class="cinematic-line delay-3">Quatre Veilleurs furent nécessaires pour l’enfermer.</p></div>`;
  document.body.appendChild(el);
  tone(110,.55,'sine',.01);tone(147,.55,'triangle',.012,.55);tone(196,.7,'sine',.014,1.25);tone(262,.85,'sine',.016,2.1);
  requestAnimationFrame(()=>el.classList.add('show'));setTimeout(()=>el.classList.add('leave'),5900);setTimeout(()=>{el.remove();sceneLock=false;cb?.();},6800);
}
function finalSealShow(cb){
  const el=document.createElement('div');el.className='seal-cinematic';
  el.innerHTML=`<div class="seal-cinematic-inner"><div class="seal-cinematic-rings"><span></span><span></span><span></span><span></span></div><div class="seal-cinematic-core">✦</div><div class="seal-cinematic-title">Le chemin se referme</div><div class="seal-cinematic-sub">Le Fer cède au Passage. Le Passage rend l’Eau. L’Eau rend l’Œil. L’Ombre est repoussée vers la roche.</div><div class="seal-cinematic-cracks"></div></div>`;
  document.body.appendChild(el);requestAnimationFrame(()=>el.classList.add('show'));
  tone(140,.25,'sine',.018);tone(196,.28,'triangle',.02,.18);tone(294,.35,'sine',.022,.42);tone(440,.45,'sine',.025,.72);
  setTimeout(()=>el.classList.add('burst'),1600);setTimeout(()=>el.classList.add('leave'),2800);setTimeout(()=>{el.remove();cb?.();},3450);
}

/* ---------- géolocalisation ---------- */
function target(k){ const l=config.locations[k]; return Number.isFinite(l?.lat)&&Number.isFinite(l?.lon)?{lat:l.lat,lon:l.lon}:null; }
function meters(a,b){
  if(!a||!b) return Infinity;
  const R=6371000,rad=x=>x*Math.PI/180,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const q=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
}
function distanceTo(k){ return meters(currentPosition,target(k)); }
function fmt(m){ if(!Number.isFinite(m))return '—'; return m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(2).replace('.',',')} km`; }
function startGeo(){
  if(LOCAL_TEST || geoWatchId!==null || !navigator.geolocation) return;
  geoWatchId=navigator.geolocation.watchPosition(p=>{
    currentPosition={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy};geoError='';liveTick();
  },e=>{geoError=e.code===1?'Permission GPS refusée':e.message;liveTick();},{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
}
function geoStatus(){
  if(LOCAL_TEST) return `<div class="status test-status"><span><span class="dot test"></span>Mode test local</span><span class="small">${currentPosition?'Position simulée':'Utilisez 🧪'}</span></div>`;
  if(currentPosition) return `<div class="status"><span><span class="dot ok"></span>GPS actif</span><span class="small">± ${Math.round(currentPosition.accuracy||0)} m</span></div>`;
  if(geoError) return `<div class="status"><span><span class="dot bad"></span>GPS indisponible</span><span class="small">${escapeHtml(geoError)}</span></div>`;
  return `<div class="status"><span><span class="dot"></span>Recherche GPS…</span><span class="small">Autorisez la position</span></div>`;
}
function gate(k, renderFn){
  if(sceneLock) return;
  const l=config.locations[k],d=distanceTo(k);
  if(Number.isFinite(d)&&d<=Number(l.radius||60)) transition('Lieu atteint',l.name,renderFn,'⌖');
}
function liveTick(){
  const gs=$('#geoStatus');if(gs)gs.innerHTML=geoStatus();
  const d=$('#liveDistance');if(d?.dataset.target)d.textContent=fmt(distanceTo(d.dataset.target));
  if(state.screen==='gate-church')gate('church',renderChurch);
  if(state.screen==='gate-pond')gate('pond',renderPond);
  if(state.screen==='gate-bridge')gate('bridge',renderBridge);
  if(state.screen==='gate-tower')gate('tower',renderTower);
  if(state.screen==='return') updateReturn();
  if(state.screen==='gate-final')gate('final',renderFinal);
}

function renderGate({screen,chapter,title,story,key,next,icon='⌖',image='walk',suspenseTitle,suspenseText,safety=''}){
  setScene(key); state.screen=screen;saveState();startGeo();const l=config.locations[key];
  app.innerHTML=card(`
    ${badge(chapter,title)}
    <h2>${escapeHtml(title)}</h2>
    <p class="story">${story}</p>
    ${illustration(image,title,suspenseText||'')}
    ${destination('Repère du Livre',`${l.name} — ${l.detail}`,'Le lieu se déverrouillera automatiquement dans le rayon configuré.')}
    ${suspense(suspenseTitle||'Le chemin attend',suspenseText||'Restez groupés jusqu’au prochain signe.')}
    ${safety?`<div class="safety-note"><strong>Consigne de sécurité</strong><span>${escapeHtml(safety)}</span></div>`:''}
    <div id="geoStatus">${geoStatus()}</div>
    <div class="distance" id="liveDistance" data-target="${key}">${fmt(distanceTo(key))}</div>
    ${!target(key)?`<p class="error"><strong>Étape non calibrée.</strong> Ouvrez ⚙ et enregistrez sa position sur place.</p>`:`<p class="small center">Déverrouillage à ${l.radius} m.</p>`}
  `,'chapter-card');
  gate(key,next);
}

/* ---------- cryptages ---------- */
const AZ='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function caesar(s,n){ return [...s].map(c=>{const i=AZ.indexOf(c);return i<0?c:AZ[(i+n+26)%26]}).join(''); }
function churchCipher(){ return [...caesar('OEIL',Number(config.puzzle.churchWindows)||3)].reverse().join(''); }
function everyNCarrier(targetWord,n){
  const filler='BRUMEVITRAILOMBREAUBEROCHEVEILLEUR';let fi=0,out='';
  for(let i=1;i<=targetWord.length*n;i++) out+= i%n===0?targetWord[(i/n)-1]:filler[(fi++)%filler.length];
  return out;
}
function columnarEncode(word,n){
  const rows=[];for(let i=0;i<word.length;i+=n)rows.push(word.slice(i,i+n));
  let out='';for(let c=0;c<n;c++)for(const row of rows)if(c<row.length)out+=row[c];return out;
}

/* ---------- écran d’accueil / histoire ---------- */
function renderHome(){
  setScene('home'); if(!state.startedAt){ state.screen='home';saveState(); }
  app.innerHTML=`<div class="hero hero-home"><div class="crest">✦</div><div class="kicker">Veuxhaulles-sur-Aube</div><h1>Le Sceau des<br>Quatre Passages</h1><p class="hero-subtitle">Une aventure de verre, d’eau, de pierre et de fer.</p>
  ${card(`${badge('Livre des Veilleurs','Préface')}${illustration('book','Le Livre des Veilleurs','Quatre passages furent scellés pour empêcher l’Ombre de suivre l’Aube jusqu’au village.')}
    <p class="story dropcap">Les anciens racontaient qu’une nuit sans vent, l’eau de l’Aube cessa de refléter le ciel. Une forme sombre remonta le courant et chercha quatre chemins pour entrer dans le monde des vivants : le verre de l’église, l’eau des étangs, le vieux passage de pierre et le fer des voies.</p>
    ${lore('Le danger','L’Ombre ne détruit pas les lieux : elle les déforme. Elle change ce que l’on croit voir, brouille les chemins et pousse les voyageurs à suivre le mauvais passage. Si elle atteint de nouveau le village après avoir traversé les quatre domaines, le sceau des anciens disparaîtra.')}
    ${lore('Pourquoi quatre Veilleurs ?','Parce qu’un seul gardien pourrait être trompé. Les anciens ont donc séparé le sceau : l’Œil observe, l’Eau se souvient, le Passage ferme la route et le Fer fixe le dernier verrou. Chacun des quatre nouveaux Veilleurs recevra un fragment secret que les autres ne devront pas voir.')}
    ${lore('Votre mission','Suivre la trace de l’Ombre à travers Veuxhaulles, récupérer les quatre marques, puis revenir au point du serment pour refermer son chemin en sens inverse. Chaque étape vous révélera une part de ce qui s’est réellement passé la nuit où les anciens Veilleurs ont failli perdre le contrôle du sceau.')} ${lore('Ce que le Livre attend de vous','À chaque passage, les plus jeunes verront d’abord ce qui échappe aux adultes ; puis les plus grands devront transformer cette observation en clé. Le Livre ne vous demande pas seulement de répondre juste : il veut vérifier que vous avancez ensemble.')}
    ${btn(state.startedAt?'Reprendre là où vous en étiez':'Lancer l’aventure','startBtn','good')}${state.startedAt?btn('Recommencer depuis le début','resetBtn','secondary'):''}
  `,'hero-card')}</div>`;
  $('#startBtn').onclick=()=>{
    if(state.startedAt){ startAmbient();startGeo();resumeGameFromState();return; }
    state.startedAt=Date.now();saveState();startAmbient();startGeo();cinematicIntro(renderPrologue);
  };
  $('#resetBtn')?.addEventListener('click',()=>{if(confirm('Effacer toute la progression ?')){resetGame();renderLanding();}});
}
function renderPrologue(){
  setScene('home'); state.screen='prologue';saveState();
  app.innerHTML=card(`${badge('Prologue','Le nouveau serment')}<h2>Quatre noms dans le Livre</h2>${illustration('book','Le serment oublié','Les anciens avaient séparé le sceau pour qu’aucun Veilleur ne puisse céder seul.')}
  <p class="story">Le Livre a retrouvé quatre noms : <strong>Vadim, Louise, Soline et Sacha</strong>. Il ne choisit pas quatre personnes par hasard. Chacun devra réussir ce que les autres ne peuvent accomplir à sa place.</p><p class="story">Il raconte aussi qu’autrefois, un premier cercle de Veilleurs avait déjà tenté de barrer la route de l’Ombre. Ils la repoussèrent, mais durent briser le sceau en quatre domaines pour l’empêcher de revenir d’un seul élan. Ce soir, c’est à vous de refaire leur geste — et peut-être de comprendre pourquoi ils n’ont jamais osé sceller cette histoire dans une seule mémoire.</p>
  <div class="symbols role-grid">${roleSigil('eye')}${roleSigil('water')}${roleSigil('passage')}${roleSigil('iron')}</div>
  <p class="quote">« Ne montrez jamais votre fragment aux trois autres. Au dernier seuil, vous devrez vous faire confiance. »</p>
  ${btn('Jurer le pacte','oathBtn')}`,'chapter-card');
  $('#oathBtn').onclick=()=>{complete('prologue');transition('Le Premier Regard','Le verre de l’église fut le premier passage emprunté par l’Ombre',renderGateChurch,'👁');};
}

/* ---------- Épreuve I : église ---------- */
function renderGateChurch(){
  renderGate({screen:'gate-church',chapter:'Épreuve I',title:'Les Yeux de Verre',key:'church',next:renderChurch,image:'church',icon:'👁',story:'Le premier passage se trouve au cœur du village. Avant même que l’on parle d’étangs, de pont ou de rail, les habitants jurèrent avoir vu des lueurs changer dans l’église. Les couleurs s’éteignaient, puis une forme sombre semblait regarder Veuxhaulles depuis le verre. Ce fut le premier signe : l’Ombre n’entrait pas encore dans le village, elle apprenait d’abord à le voir.',suspenseTitle:'Le verre ne montre pas toujours la lumière',suspenseText:'Approchez de la façade sans chercher une inscription : le premier indice est dans ce que la pierre laisse boire au jour.'});
}
function renderChurch(){
  setScene('church'); state.screen='church';saveState();bell();omen('LES YEUX DE VERRE','Premier passage');
  const cipher=churchCipher();
  app.innerHTML=card(`${badge('Épreuve I','Les Yeux de Verre')}<h2>Le premier regard</h2>${illustration('church','Les yeux de l’église','Le premier passage se cache dans le verre qui observe le village.')} ${progress(1)}
  <p class="quote">« L’Ombre n’entrait pas par une porte. Elle préférait les yeux que la pierre garde fermés. Le jour, ils boivent la lumière et prennent des couleurs. La nuit, ils regardent le village. »</p><p class="story">On raconte qu’un soir, alors que le vent ne soufflait plus, trois lueurs changèrent de visage derrière la façade. Les habitants n’osaient plus traverser la place à la tombée du jour. Le premier Veilleur comprit alors que l’Ombre observait d’abord avant d’avancer.</p><p class="story">Pour fermer ce passage, il faut d’abord reconnaître ces yeux sans les nommer trop vite. Le Livre ne veut pas une réponse évidente : il veut que vous voyiez ce que les anciens voyaient.</p><div class="step-context"><div class="step-context-title">Ce que révèle cette étape</div><p>Si vous réussissez ici, le Livre admettra que l’Ombre a d’abord cherché à regarder avant de traverser. Le Verre n’était pas une porte : c’était un poste d’observation.</p></div>
  <div class="child-challenge"><div class="teen-label">Épreuve de Soline et Sacha</div><p>Placez-vous face à la façade. <strong>Combien d’yeux de lumière colorée regardent le village ?</strong></p><input class="input" id="churchCount" inputmode="numeric" maxlength="2" placeholder="Votre réponse"><button class="btn" id="churchCountBtn">Confier le nombre au Livre</button></div>
  <div id="churchTeen" class="hidden"><div class="sep"></div><div class="teen-challenge"><div class="teen-label">Épreuve de Vadim et Louise</div><p>L’Ombre déformait les mots comme elle déformait les vitres : elle faisait avancer chaque lettre du nombre découvert par les plus jeunes, puis retournait ce qu’elle voyait comme dans un miroir.</p><div class="cipher-strip">${cipher.split('').join(' · ')}</div><p class="small">Retrouvez le mot original de quatre lettres.</p><input class="input" id="churchWord" maxlength="4" autocomplete="off" placeholder="_ _ _ _"><button class="btn" id="churchWordBtn">Rompre le reflet</button></div></div><div id="churchMsg"></div>
  ${hints('church',['Les « yeux » ne sont ni les portes ni les ouvertures ordinaires : cherchez ce que la lumière traverse en prenant des couleurs.','Pour les grands : commencez par retourner la suite de lettres. Ensuite, faites reculer chaque lettre du nombre trouvé par Soline et Sacha.'])}`,'chapter-card');
  $('#churchCountBtn').onclick=()=>{
    if(Number($('#churchCount').value)===Number(config.puzzle.churchWindows)){successSound();revealSound();$('#churchTeen').classList.remove('hidden');$('#churchTeen').classList.add('ink-reveal');$('#churchMsg').innerHTML='<p class="success">✓ Les yeux du premier passage sont identifiés. Leur nombre devient maintenant une clé.</p>';}
    else{failureCue('church');$('#churchMsg').innerHTML='<p class="error">Le Livre reste silencieux. Relisez l’énigme et observez uniquement la façade.</p>';}
  };
  $('#churchWordBtn').onclick=()=>{
    if($('#churchWord').value.trim().toUpperCase()==='OEIL'){state.fragments.eye=FRAGMENTS.eye.digit;complete('church');successSound();$('#churchMsg').innerHTML=illustration('church','Le premier passage se ferme','Le Livre transforme le souvenir du lieu en une vision symbolique.');setTimeout(()=>renderFragment('eye',renderGatePond),1100);}
    else{failureCue('church');$('#churchMsg').innerHTML='<p class="error">Le reflet n’est pas encore inversé correctement.</p>';}
  };
  bindHints(renderChurch);
}

/* ---------- fragment secret ---------- */
function renderFragment(key,next){
  setScene(key==='eye'?'church':key==='water'?'pond':key==='passage'?'bridge':'tower'); const f=FRAGMENTS[key];state.screen=`fragment-${key}`;saveState();haptic([50,60,120]);omen(f.title.toUpperCase(),`Fragment confié à ${f.owner}`);
  app.innerHTML=card(`${badge('Fragment retrouvé',f.title)}<div class="seal-recovery-visual seal-theme-${f.theme}"><div class="seal-halo"></div><div class="seal-rings"><span></span><span></span><span></span></div><div class="seal-special"><i></i><i></i><i></i><i></i></div><div class="seal-core">${symbolImg(f.symbol,f.role,'seal-symbol')}</div></div><h2 class="center">${f.title}</h2><p class="center small">${escapeHtml(f.owner)} — ${escapeHtml(f.role)}</p>
  <p class="quote">Passez maintenant le téléphone à <strong>${f.owner}</strong>. Les trois autres détournent les yeux.</p><p class="center">${escapeHtml(f.whisper)}</p><p class="center">Le fragment est caché. Il ne doit être révélé que lorsqu’il tient lui-même le téléphone.</p>
  <button type="button" class="fragment-reveal seal-fragment-${f.theme}" id="fragmentReveal"><span class="fragment-cover" id="fragmentCover"><span class="fragment-cover-kicker">Fragment secret</span><strong>Toucher pour révéler</strong><small>${escapeHtml(f.owner)} seulement</small></span><span class="distance fragment-digit hidden" id="fragmentDigit">${f.digit}</span></button>
  <p class="small center">Mémorisez ce chiffre. Ne le dites pas aux autres avant le dernier rituel.</p><div class="fragment-epilogue">${key==='eye'?'Le Livre sent l’Ombre quitter le Verre et suivre maintenant le cours de l’Aube.':key==='water'?'Le courant s’apaise, mais le Livre perçoit déjà les arches du vieux passage.':key==='passage'?'La pierre se tait ; plus loin, quelque chose de métallique répond dans la nuit.':'Les quatre marques sont revenues. Il faut maintenant rentrer avant que l’Ombre ne se retourne.'}</div>${btn(key==='iron'?'Revenir au point du serment':'Poursuivre la traque','fragmentNext','good')}`,'chapter-card fragment-card seal-recovered');
  $('#fragmentReveal').onclick=()=>{const d=$('#fragmentDigit'),c=$('#fragmentCover');if(!d.classList.contains('hidden'))return;d.classList.remove('hidden');c.classList.add('fade-out');revealSound();haptic([30,40,90]);setTimeout(()=>c.remove(),280);};
  $('#fragmentNext').onclick=()=>sealTransition(key,next);
}

/* ---------- Épreuve II : étang / seuil ---------- */
function renderGatePond(){
  renderGate({screen:'gate-pond',chapter:'Épreuve II',title:"Le Seuil de l’Eau",key:'pond',next:renderPond,image:'walk',story:"L’Ombre ne resta pas derrière le verre. Chassée de l’église, elle suivit l’Aube jusqu’aux étangs. Les pêcheurs disaient qu’à cet endroit précis, l’eau pouvait devenir blanche sans glace ni neige, comme si elle s’énervait devant une présence cachée. Les anciens y voyaient la preuve qu’elle avait trouvé comment quitter les reflets pour chercher un courant.",suspenseTitle:'Écoutez avant de regarder',suspenseText:'Cherchez le lieu où l’eau calme cesse d’être un miroir et franchit un seuil.',safety:'Restez sur les chemins et berges accessibles. Ne descendez jamais sur un ouvrage hydraulique ni au bord d’une chute.'});
}
function renderPond(){
  setScene('pond'); state.screen='pond';saveState();omen('LE SEUIL DE L’EAU','Deuxième passage');
  const n=Number(config.puzzle.pondOpenings)||5; const carrier=everyNCarrier('COURANT',n);
  app.innerHTML=card(`${badge('Épreuve II',"Le Seuil de l’Eau")}<h2>La couronne au-dessus de l’écume</h2>${progress(2)}<p class="quote">« Quand l’eau devient blanche, lève les yeux. Le Veilleur du seuil porte une couronne qui ne touche jamais l’eau. Elle est percée de fenêtres sans verre. »</p><p class="story">Après avoir quitté le verre, l’Ombre a voulu gagner le courant. Les anciens disaient qu’elle cherchait toujours à franchir les lieux où l’eau hésite entre repos et chute. Au seuil, l’Aube cesse d’être miroir et commence à parler.</p><p class="story">Le second Veilleur n’a pas gravé son secret dans la pierre. Il l’a caché dans un rythme. Avant que les grands ne puissent déchiffrer ce rythme, il faut d’abord que les plus jeunes nomment le battement juste.</p><div class="step-context"><div class="step-context-title">Ce que révèle cette étape</div><p>Si le Seuil cède, vous comprendrez que l’Ombre ne supporte pas les eaux immobiles : elle préfère les endroits où tout hésite entre calme et chute, silence et vacarme.</p></div>
  <div class="child-challenge"><div class="teen-label">Épreuve de Sacha et Soline</div><p>Trouvez la chute. Regardez <strong>la barrière au-dessus d’elle</strong>. Combien de fenêtres vides découpe-t-elle dans le paysage ?</p><input class="input" id="pondCount" inputmode="numeric" maxlength="2" placeholder="Votre réponse"><button class="btn" id="pondCountBtn">Confier le rythme au Livre</button></div>
  <div id="pondTeen" class="hidden"><div class="sep"></div><div class="teen-challenge"><div class="teen-label">Épreuve de Vadim et Louise</div><p>Le Veilleur de l’Eau cachait ses mots dans le rythme. Le nombre découvert devient l’intervalle : en partant du début, gardez une lettre chaque fois que vous atteignez ce compte.</p><div class="cipher-carrier">${carrier}</div><p class="small">Les lettres conservées forment un mot de sept lettres.</p><input class="input" id="pondWord" maxlength="7" autocomplete="off" placeholder="_ _ _ _ _ _ _"><button class="btn" id="pondWordBtn">Suivre le rythme</button></div></div><div id="pondMsg"></div>
  ${hints('pond',['La « couronne » se trouve au-dessus de l’endroit où l’eau tombe et devient blanche. Comptez uniquement ses ouvertures rectangulaires.','Pour les grands : si le nombre est N, relevez les lettres aux positions N, 2N, 3N, 4N… jusqu’au bout de la suite.'])}`,'chapter-card');
  $('#pondCountBtn').onclick=()=>{
    if(Number($('#pondCount').value)===n){successSound();$('#pondTeen').classList.remove('hidden');$('#pondTeen').classList.add('ink-reveal');$('#pondMsg').innerHTML='<p class="success">✓ Le rythme de l’Eau est trouvé. Ne perdez pas ce nombre.</p>';}
    else{failureCue('pond');$('#pondMsg').innerHTML='<p class="error">Ce n’est pas le rythme attendu. Observez la structure juste au-dessus de la chute.</p>';}
  };
  $('#pondWordBtn').onclick=()=>{
    if($('#pondWord').value.trim().toUpperCase()==='COURANT'){state.fragments.water=FRAGMENTS.water.digit;complete('pond');successSound();$('#pondMsg').innerHTML=illustration('pondScene','Le Seuil cède','Le Livre ne montre pas le lieu réel : il en révèle désormais la vision hantée.');setTimeout(()=>renderFragment('water',renderGateBridge),1250);}
    else{failureCue('pond');$('#pondMsg').innerHTML='<p class="error">Le rythme est bon, mais les lettres conservées ne forment pas encore le mot attendu.</p>';}
  };
  bindHints(renderPond);
}

/* ---------- Épreuve III : vieux pont ---------- */
function renderGateBridge(){
  renderGate({screen:'gate-bridge',chapter:'Épreuve III',title:'Le Passage de Pierre',key:'bridge',next:renderBridge,image:'walk',story:"Après l’eau, l’Ombre chercha un passage qui reliait deux rives. Les anciens ne craignaient pas le pont pour ce qu’il portait, mais pour ce qu’il laissait filer dessous. Lorsque le brouillard venait, certains assuraient avoir entendu l’eau compter sous les arches, comme si chaque ouverture ajoutait une chance de plus à l’Ombre de traverser le territoire des hommes.",suspenseTitle:'Le vieux dos de pierre',suspenseText:'Cherchez le pont ancien sur la boucle. L’épreuve ne demande jamais de quitter le chemin.',safety:'Observez le pont depuis un endroit stable et autorisé. Ne descendez pas dans l’eau et ne grimpez pas sur les maçonneries.'});
}
function renderBridge(){
  setScene('bridge'); state.screen='bridge';saveState();omen('LE PASSAGE DE PIERRE','Troisième passage');
  const n=Number(config.puzzle.bridgeArches)||3; const cipher=columnarEncode('PASSAGE',n);
  app.innerHTML=card(`${badge('Épreuve III','Le Passage de Pierre')}<h2>Les bouches sous le pont</h2>${progress(3)}<p class="quote">« Le pont n’est pas son dos. Son vrai secret se trouve sous la pierre, là où l’eau peut encore passer. »</p><p class="story">Le troisième Veilleur veillait ici. Il savait qu’un pont relie les rives, mais qu’il peut aussi ouvrir une route à ce que l’on ne voit pas. Quand l’Ombre atteignit ce lieu, elle chercha les ouvertures par lesquelles le courant passe en silence.</p><p class="story">Le Veilleur lui opposa un mot découpé en colonnes, à la manière d’un ouvrage de pierre. Vous devrez d’abord trouver combien de bouches complètes la rivière traverse, puis rendre au mot sa forme d’origine.</p><div class="step-context"><div class="step-context-title">Ce que révèle cette étape</div><p>Le pont vous dira si l’Ombre sait seulement regarder et courir… ou si elle sait aussi franchir. C’est ici qu’elle a presque atteint l’autre rive.</p></div>
  <div class="child-challenge"><div class="teen-label">Épreuve de Soline et Sacha</div><p>Le Livre ne veut pas connaître le pont, mais <strong>le nombre de lunes d’eau</strong> qu’il laisse respirer sous son ventre de pierre. Combien de bouches entières restent ouvertes à la rivière ?</p><input class="input" id="bridgeCount" inputmode="numeric" maxlength="2" placeholder="Votre réponse"><button class="btn" id="bridgeCountBtn">Ouvrir les passages du Livre</button></div>
  <div id="bridgeTeen" class="hidden"><div class="sep"></div><div class="teen-challenge"><div class="teen-label">Épreuve de Vadim et Louise</div><p>Le troisième Veilleur écrivait son mot <strong>comme on dresse un pont</strong> : pierre après pierre, ligne après ligne, sur autant de colonnes qu’il y avait de passages. L’Ombre, elle, n’a pas lu comme un humain. Elle a descendu chaque colonne l’une après l’autre et a laissé ceci :</p><div class="cipher-strip">${cipher.split('').join(' · ')}</div><p class="small">Reconstruisez les colonnes, puis lisez les lignes dans leur ordre d’origine. Le mot contient sept lettres.</p><input class="input" id="bridgeWord" maxlength="7" autocomplete="off" placeholder="_ _ _ _ _ _ _"><button class="btn" id="bridgeWordBtn">Reconstruire le passage</button></div></div><div id="bridgeMsg"></div>
  ${hints('bridge',['Regardez sous le tablier : combien d’ouvertures complètes laissent réellement passer la rivière ?','Pour les grands : avec N colonnes, répartissez la suite reçue colonne par colonne. Les premières colonnes peuvent contenir une lettre de plus si le mot ne remplit pas un rectangle parfait.'])}`,'chapter-card');
  $('#bridgeCountBtn').onclick=()=>{
    if(Number($('#bridgeCount').value)===n){successSound();$('#bridgeTeen').classList.remove('hidden');$('#bridgeTeen').classList.add('ink-reveal');$('#bridgeMsg').innerHTML='<p class="success">✓ Le nombre de passages devient la largeur du message.</p>';}
    else{failureCue('bridge');$('#bridgeMsg').innerHTML='<p class="error">Le Livre refuse ce nombre. Comptez seulement les grandes ouvertures complètes sous le pont.</p>';}
  };
  $('#bridgeWordBtn').onclick=()=>{
    if($('#bridgeWord').value.trim().toUpperCase()==='PASSAGE'){state.fragments.passage=FRAGMENTS.passage.digit;complete('bridge');successSound();$('#bridgeMsg').innerHTML=illustration('bridgeScene','Le Passage reconnu','La pierre a livré sa troisième marque au Livre.');setTimeout(()=>renderFragment('passage',renderGateTower),900);}
    else{failureCue('bridge');$('#bridgeMsg').innerHTML='<p class="error">Les colonnes ne sont pas encore remises dans le bon ordre.</p>';}
  };
  bindHints(renderBridge);
}

/* ---------- Épreuve IV : tour d'eau / fer ---------- */
function renderGateTower(){
  renderGate({screen:'gate-tower',chapter:'Épreuve IV',title:'Le Gardien du Fer',key:'tower',next:renderTower,image:'walk',story:"Le vieux pont n’était pas le dernier passage. Bien plus tard, les hommes posèrent des rails et élevèrent une tour. L’Ombre découvrit alors un chemin plus droit, fait de métal, de signaux et d’appels qui portaient loin. C’est ici qu’elle espéra quitter définitivement les anciens domaines des Veilleurs, en suivant une route si nette qu’aucune eau ni aucune pierre ne pourraient plus la retenir.",suspenseTitle:'Le Fer ne dort jamais tout à fait',suspenseText:'Rejoignez seulement le point d’observation prévu pour la tour. Le jeu n’exige aucun contact avec les rails.',safety:'Ne marchez jamais sur les voies et ne traversez jamais les rails hors d’un passage autorisé. L’énigme doit être résolue depuis le chemin ou le point d’observation calibré.'});
}
function renderTower(){
  setScene('tower'); state.screen='tower';saveState();omen('LE GARDIEN DU FER','Quatrième passage');
  app.innerHTML=card(`${badge('Épreuve IV','Le Gardien du Fer')}<h2>Le signal de l’ancienne ligne</h2>${progress(4)}<p class="quote">« Le Gardien du Fer avait un corps qui ne pouvait rouler et une tête construite pour tourner. Il parlait sans mots : par des frappes courtes et des appels longs. »</p><p class="story">Quand la ligne vivait encore, on disait que certaines nuits la tour appelait toute seule. Aucun train ne répondait, pourtant un écho revenait, comme si quelque chose attendait plus loin sur la voie. Le quatrième Veilleur comprit que l’Ombre aimait les chemins droits et les signes simples.</p><p class="story">Il enferma donc son dernier secret dans une silhouette puis dans un alphabet de sons. Pour le défaire, vous devrez d’abord reconnaître le corps du Gardien, puis comprendre la langue qu’il utilise encore.</p><div class="step-context"><div class="step-context-title">Ce que révèle cette étape</div><p>Si vous refermez le Fer, il ne restera plus à l’Ombre que son souvenir. C’est le passage le plus dangereux, car il est le plus récent — et donc le moins oublié.</p></div>
  <div class="child-challenge"><div class="teen-label">Épreuve de Sacha et Soline</div><p>Observez la tour <strong>de loin</strong>. Le Gardien du Fer n’a pas deux corps semblables : quel signe décrit le mieux <strong>son socle</strong>, puis <strong>sa tête</strong> ?</p><div class="choice-grid tower-shapes"><button class="choice" data-shape="square-round">□ puis ○</button><button class="choice" data-shape="round-square">○ puis □</button><button class="choice" data-shape="triangle-round">△ puis ○</button><button class="choice" data-shape="square-triangle">□ puis △</button></div></div>
  <div id="towerTeen" class="hidden"><div class="sep"></div><div class="teen-challenge"><div class="teen-label">Épreuve de Vadim et Louise</div><p>Le quatrième Veilleur n’a pas laissé un mot : il a laissé <strong>un appel</strong>. La forme du bas donne le <strong>signal bref</strong>. La forme du haut donne le <strong>signal long</strong>. Reconstituez la langue du Gardien et lisez les quatre groupes qu’il transmet encore.</p><div class="signal-box"><button type="button" class="btn secondary" id="playSignal">▶ Écouter le signal</button><div class="signal-visual" id="signalVisual">□ ○ □ ○ &nbsp; / &nbsp; □ ○ □ □ &nbsp; / &nbsp; □ &nbsp; / &nbsp; □ □ ○ □</div></div>
  <div class="signal-key"><span>A : □ ○</span><span>C : ○ □ ○ □</span><span>E : □</span><span>F : □ □ ○ □</span><span>I : □ □</span><span>L : □ ○ □ □</span><span>N : ○ □</span><span>R : □ ○ □</span></div><input class="input" id="towerWord" maxlength="4" autocomplete="off" placeholder="_ _ _ _"><button class="btn" id="towerWordBtn">Répondre au signal</button></div></div><div id="towerMsg"></div>
  ${hints('tower',['Le bas de la tour est anguleux ; sa partie supérieure ne l’est pas. L’ordre demandé est toujours bas puis haut.','Pour les grands : □ est le signal bref et ○ le signal long. Comparez chaque groupe de quatre, trois ou un signe au petit alphabet fourni.'])}`,'chapter-card');
  $$('.tower-shapes .choice').forEach(b=>b.onclick=()=>{
    if(b.dataset.shape==='square-round'){successSound();$('#towerTeen').classList.remove('hidden');$('#towerTeen').classList.add('ink-reveal');$('#towerMsg').innerHTML='<p class="success">✓ Les deux formes fixent maintenant la durée des signaux.</p>';}
    else{failureCue('tower');$('#towerMsg').innerHTML='<p class="error">Regardez surtout la silhouette générale du bas et du réservoir supérieur.</p>';}
  });
  $('#playSignal').onclick=()=>playTowerSignal();
  $('#towerWordBtn').onclick=()=>{
    if($('#towerWord').value.trim().toUpperCase()==='CLEF'){state.fragments.iron=FRAGMENTS.iron.digit;complete('tower');successSound();$('#towerMsg').innerHTML=illustration('towerScene',"Le Gardien du Fer",'Le Fer reconnaît votre réponse. Restez toujours à distance des voies.');setTimeout(()=>renderFragment('iron',renderReturn),1000);}
    else{failureCue('tower');$('#towerMsg').innerHTML='<p class="error">Le signal n’est pas encore compris. Vérifiez la durée de chaque signe.</p>';}
  };
  bindHints(renderTower);
}
function playTowerSignal(){
  const groups=['-.-.','.-..','.','..-.']; let t=0;
  groups.forEach((g,gi)=>{[...g].forEach(s=>{tone(520,s==='-'?.32:.11,'sine',.02,t);t+=s==='-'?.42:.2;});t+=.35;});
  const v=$('#signalVisual');v?.classList.remove('signal-active');void v?.offsetWidth;v?.classList.add('signal-active');
}

/* ---------- retour / finale ---------- */
function renderReturn(){
  setScene('return'); state.screen='return';startGeo();
  if(!state.returnStartDistance){const d=distanceTo('final');state.returnStartDistance=Number.isFinite(d)?d:null;}
  saveState();
  app.innerHTML=card(`${badge('Chapitre final','La Marche à rebours')}<h2>Retournez au point du serment</h2>${illustration('walk','L’Ombre vous suit','Les quatre marques sont revenues. Il reste à fermer le chemin dans le bon sens.')}
  <p class="story">Le Livre révèle enfin le piège des anciens : l’Ombre a ouvert ses passages dans un ordre précis — <strong>du Verre vers l’Eau, de l’Eau vers la Pierre, de la Pierre vers le Fer</strong>. Chaque Veilleur ancien n’a fait que ralentir sa course. Vous, vous devez maintenant refaire tout le trajet en sens inverse.</p><p class="story">Ne dites toujours pas vos chiffres. Le rituel n’accepte que la confiance et l’ordre juste : le dernier verrou doit se fermer là où le premier serment a été prononcé.</p><div class="step-context"><div class="step-context-title">Ce que révèle cette étape</div><p>Le Livre vous prévient d’une dernière chose : les anciens Veilleurs n’ont jamais tout compris. Ils ont arrêté l’Ombre, mais sans savoir si elle dormait encore sous les lieux… ou si elle attendait simplement quatre nouveaux noms pour essayer de revenir.</p></div>
  ${destination('Destination finale',`${config.locations.final.name} — ${config.locations.final.detail}`,'Revenez par l’itinéraire sûr reconnu à l’avance. Le téléphone mesure seulement la distance restante.')}
  ${suspense('Ne prononcez pas vos fragments','Pendant le retour, chacun garde son chiffre secret. Le dernier rituel les demandera dans un ordre que vous devrez déduire.')}
  <div id="geoStatus">${geoStatus()}</div><div class="radar"></div><div class="distance" id="liveDistance" data-target="final">${fmt(distanceTo('final'))}</div>
  <div class="return-ritual"><p class="quote">« Ce qui a été ouvert de l’Œil au Fer doit être fermé du Fer à l’Œil. »</p></div>
  ${!target('final')?'<p class="error">La position finale doit être calibrée dans le mode maître du jeu.</p>':''}`,'chapter-card');
  updateReturn();
}
function updateReturn(){
  if(state.screen!=='return')return;
  const d=distanceTo('final');const el=$('#liveDistance');if(el)el.textContent=fmt(d);
  if(Number.isFinite(d)&&d<=Number(config.locations.final.radius||60)) transition('Le point du serment','Les quatre passages doivent maintenant être fermés en sens inverse',renderFinal,'✦');
}
function renderFinal(){
  setScene('final'); state.screen='final';saveState();omen('LE RITUEL DES QUATRE','Dernière épreuve');
  const expected=FRAGMENTS.iron.digit+FRAGMENTS.passage.digit+FRAGMENTS.water.digit+FRAGMENTS.eye.digit;
  app.innerHTML=`<div class="blackout">${card(`${badge('Finale','Le Sceau des Quatre Passages')}<h2>Fermez le chemin de l’Ombre</h2><div class="seal-ring"><span>✦</span></div>
  <p class="story">Vous avez suivi sa trace dans l’ordre où elle s’est échappée : <strong>Œil → Eau → Passage → Fer</strong>.</p><p class="quote">« Pour refermer un chemin, on ne le ferme jamais dans le sens où il a été ouvert. »</p>
  <div class="final-order"><span>${symbolImg(FRAGMENTS.iron.symbol,'Fer','final-order-symbol')}<em>Fer</em></span><span>${symbolImg(FRAGMENTS.passage.symbol,'Passage','final-order-symbol')}<em>Passage</em></span><span>${symbolImg(FRAGMENTS.water.symbol,'Eau','final-order-symbol')}<em>Eau</em></span><span>${symbolImg(FRAGMENTS.eye.symbol,'Œil','final-order-symbol')}<em>Œil</em></span></div>
  <p>Passez le téléphone d’un Veilleur à l’autre dans cet ordre. Chacun prononce seulement son propre fragment. Entrez les quatre chiffres sans les réordonner ensuite.</p><div class="step-context"><div class="step-context-title">Le sens du rituel</div><p>Le Fer doit céder avant la Pierre, la Pierre avant l’Eau, l’Eau avant l’Œil. Ainsi seulement le chemin entier se replie sur lui-même et l’Ombre ne trouve plus d’espace pour circuler.</p></div><input class="input final-code" id="finalCode" inputmode="numeric" maxlength="4" placeholder="_ _ _ _"><button class="btn" id="finalBtn">Refermer les quatre passages</button><div id="finalMsg"></div>`,'chapter-card final-card')}</div>`;
  $('#finalBtn').onclick=()=>{
    if($('#finalCode').value.trim()===expected){complete('final');successSound();haptic([100,60,100,60,220]);finalSealShow(renderTreasure);}
    else{failureCue('final');$('#finalMsg').innerHTML='<p class="error">Le sceau résiste. Vérifiez d’abord l’ordre inverse des quatre passages, puis demandez son fragment à chaque Veilleur.</p>';}
  };
}
function renderTreasure(){
  setScene('treasure'); state.screen='treasure';saveState();
  app.innerHTML=card(`${badge('Le sceau est fermé','Le Livre se souvient')}${illustration('treasure','Le trésor des Veilleurs','L’Ombre n’a plus de passage. Le Livre peut enfin révéler la récompense.')}
  <h2 class="center">Vadim · Louise · Soline · Sacha</h2><p class="story center">L’Œil voit de nouveau la lumière. L’Eau retrouve son reflet. Le vieux Passage ne laisse plus entrer l’Ombre. Le Fer est redevenu silencieux.</p><div class="symbols role-grid final-role-grid">${roleSigil('eye')}${roleSigil('water')}${roleSigil('passage')}${roleSigil('iron')}</div><p class="story center">Le Livre ajoute pourtant une dernière phrase en marge : <em>‘Ce qui a été refermé devra un jour être surveillé de nouveau.’</em> Le village dort, mais votre serment demeure.</p><div class="sep"></div><p class="small center">CODE DU COFFRE</p><div class="distance">${escapeHtml(config.treasureCode)}</div><p class="center"><strong>Le trésor des Quatre Veilleurs vous attend.</strong></p>${btn('Refermer le Livre','finishBtn','good')}`,'chapter-card');
  $('#finishBtn').onclick=()=>{complete('treasure');state.screen='done';saveState();transition('Le Livre se referme','Veuxhaulles gardera le souvenir des quatre nouveaux Veilleurs',renderDone,'✦');};
}
function renderDone(){
  setScene('treasure'); state.screen='done';saveState();app.innerHTML=`<div class="hero hero-home"><div class="kicker">Mission accomplie</div><h1>Les Quatre<br>Veilleurs</h1>${card(`${illustration('treasure','Le souvenir du sceau','Le Livre garde maintenant la mémoire des quatre passages refermés.')}<p class="story">Le chemin de l’Ombre est fermé. Le Livre garde désormais quatre nouveaux noms dans ses pages.</p><p><strong>Vadim · Louise · Soline · Sacha</strong></p>${btn('Revoir le trésor','again','secondary')}`,'hero-card')}</div>`;$('#again').onclick=renderTreasure;
}

/* ---------- mode maître du jeu ---------- */
$('#gmButton')?.addEventListener('click',openGmLogin);
function modal(html){const w=document.createElement('div');w.className='modal-backdrop';w.innerHTML=`<div class="modal">${html}</div>`;document.body.appendChild(w);w.onclick=e=>{if(e.target===w)w.remove()};return w;}
function openGmLogin(){const m=modal(`<h2>Maître du jeu</h2><p class="small">Accès adulte.</p><input class="input" id="gmPin" inputmode="numeric" placeholder="PIN"><button class="btn" id="gmOpen">Ouvrir</button><button class="btn secondary" id="gmClose">Annuler</button><div id="gmMsg"></div>`);$('#gmClose',m).onclick=()=>m.remove();$('#gmOpen',m).onclick=()=>{if($('#gmPin',m).value===config.gmPin){m.remove();openGmPanel();}else $('#gmMsg',m).innerHTML='<p class="error">Code incorrect.</p>';};}
function locEditor(k){const l=config.locations[k];return `<div class="admin-row" data-k="${k}"><h3>${escapeHtml(l.name)}</h3><div class="coord-grid"><input class="input lat" type="number" step="any" value="${l.lat??''}" placeholder="Latitude"><input class="input lon" type="number" step="any" value="${l.lon??''}" placeholder="Longitude"><input class="input radius" type="number" min="10" max="300" value="${l.radius}" placeholder="Rayon"></div><button class="btn capture">📍 Utiliser ma position actuelle</button><button class="btn secondary save">Enregistrer</button><div class="small">${l.calibrated?'✓ calibré sur place':'coordonnée à vérifier / calibrer'}</div></div>`;}
function openGmPanel(){
  const m=modal(`<div class="kicker">Administration</div><h2>Veuxhaulles — Maître du jeu</h2><p class="small">Calibrez chaque étape depuis le point exact où les enfants doivent rester. Pour la tour, choisissez volontairement un point sûr à distance des voies.</p>${Object.keys(config.locations).map(locEditor).join('')}<div class="sep"></div><h3>Réponses de terrain</h3><label>Vitraux de façade</label><input class="input" id="cfgChurch" type="number" value="${config.puzzle.churchWindows}"><label>Ouvertures au-dessus du seuil d’eau</label><input class="input" id="cfgPond" type="number" value="${config.puzzle.pondOpenings}"><label>Arches du vieux pont</label><input class="input" id="cfgBridge" type="number" value="${config.puzzle.bridgeArches}"><label>Code du coffre</label><input class="input" id="cfgTreasure" value="${escapeHtml(config.treasureCode)}"><div class="sep"></div><h3>Verrouillage de l’aventure</h3><label class="lock-admin-toggle"><input id="cfgLockEnabled" type="checkbox" ${config.lock?.enabled?'checked':''}> <span>Bloquer le Livre jusqu’à une date précise</span></label><label>Date et heure de déverrouillage</label><input class="input" id="cfgUnlockAt" type="datetime-local" value="${escapeHtml(config.lock?.at||'')}"><p class="small">Avant cette date, les joueurs ne voient que l’écran du Livre scellé. Le mode test local ignore ce verrou.</p><label>PIN adulte</label><input class="input" id="cfgPin" value="${escapeHtml(config.gmPin)}"><button class="btn" id="saveCfg">Enregistrer les réglages</button><div class="sep"></div><button class="btn" id="exportCfg">Exporter la configuration JSON</button><label class="btn secondary" style="display:block;text-align:center">Importer une configuration<input class="hidden" id="importCfg" type="file" accept="application/json"></label><button class="btn danger" id="adminReset">Effacer la progression</button><button class="btn secondary" id="adminClose">Fermer</button><div id="adminMsg"></div>`);
  $$('.admin-row',m).forEach(row=>{
    const k=row.dataset.k;
    $('.capture',row).onclick=()=>{
      if(!navigator.geolocation){$('#adminMsg',m).innerHTML='<p class="error">GPS indisponible.</p>';return;}
      navigator.geolocation.getCurrentPosition(p=>{$('.lat',row).value=p.coords.latitude.toFixed(7);$('.lon',row).value=p.coords.longitude.toFixed(7);config.locations[k].lat=p.coords.latitude;config.locations[k].lon=p.coords.longitude;config.locations[k].calibrated=true;saveConfig();$('#adminMsg',m).innerHTML=`<p class="success">Position enregistrée (± ${Math.round(p.coords.accuracy)} m).</p>`;},e=>{$('#adminMsg',m).innerHTML=`<p class="error">${escapeHtml(e.message)}</p>`;},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    };
    $('.save',row).onclick=()=>{const lat=parseFloat($('.lat',row).value),lon=parseFloat($('.lon',row).value),r=parseFloat($('.radius',row).value);if(!Number.isFinite(lat)||!Number.isFinite(lon)){ $('#adminMsg',m).innerHTML='<p class="error">Coordonnées invalides.</p>';return;}Object.assign(config.locations[k],{lat,lon,radius:Number.isFinite(r)?r:60});saveConfig();$('#adminMsg',m).innerHTML='<p class="success">Étape enregistrée.</p>';};
  });
  $('#saveCfg',m).onclick=()=>{const lockEnabled=$('#cfgLockEnabled',m).checked,unlockAt=$('#cfgUnlockAt',m).value.trim();if(lockEnabled&&!unlockAt){$('#adminMsg',m).innerHTML='<p class="error">Choisissez une date et une heure avant d’activer le verrouillage.</p>';return;}config.puzzle.churchWindows=Number($('#cfgChurch',m).value)||3;config.puzzle.pondOpenings=Number($('#cfgPond',m).value)||5;config.puzzle.bridgeArches=Number($('#cfgBridge',m).value)||3;config.treasureCode=$('#cfgTreasure',m).value.trim()||'3147';config.lock.enabled=lockEnabled;config.lock.at=unlockAt;config.gmPin=$('#cfgPin',m).value.trim()||'4826';saveConfig();$('#adminMsg',m).innerHTML='<p class="success">Réglages enregistrés.</p>';};
  $('#exportCfg',m).onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));a.download='veuxhaulles-veilleurs-config.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  $('#importCfg',m).onchange=async e=>{try{config=mergeConfig(JSON.parse(await e.target.files[0].text()));saveConfig();m.remove();openGmPanel();}catch{$('#adminMsg',m).innerHTML='<p class="error">Fichier JSON invalide.</p>';}};
  $('#adminReset',m).onclick=()=>{if(confirm('Effacer toute la progression ?')){state=clone(DEFAULT_STATE);saveState();m.remove();renderLanding();}};
  $('#adminClose',m).onclick=()=>m.remove();
}

/* ---------- test local ---------- */
function simulateAt(k){const t=target(k);if(t){currentPosition={...t,accuracy:3};liveTick();}else{const direct={church:renderChurch,pond:renderPond,bridge:renderBridge,tower:renderTower,final:renderFinal}[k];direct?.();}}
function buildTestPanel(){
  if(!LOCAL_TEST || $('#testToggle'))return;
  const b=document.createElement('button');b.id='testToggle';b.className='test-toggle';b.textContent='🧪';b.title='Test local';document.body.appendChild(b);
  const p=document.createElement('div');p.id='testPanel';p.className='test-panel hidden';p.innerHTML=`<div class="test-title">TEST LOCAL</div><div class="test-grid"><button data-r="landing">Page accueil</button><button data-r="home">Livre</button><button data-r="prologue">Prologue</button><button data-r="church">Église</button><button data-r="pond">Étang</button><button data-r="bridge">Pont</button><button data-r="tower">Tour</button><button data-r="return">Retour</button><button data-r="final">Finale</button><button data-r="treasure">Trésor</button></div><div class="test-grid"><button data-a="church">GPS Église</button><button data-a="pond">GPS Étang</button><button data-a="bridge">GPS Pont</button><button data-a="tower">GPS Tour</button><button data-a="final">GPS Final</button></div><button id="testReset">Réinitialiser</button>`;document.body.appendChild(p);b.onclick=()=>p.classList.toggle('hidden');
  const routes={landing:renderLanding,home:renderHome,prologue:renderPrologue,church:renderChurch,pond:renderPond,bridge:renderBridge,tower:renderTower,return:renderReturn,final:renderFinal,treasure:renderTreasure};
  $$('[data-r]',p).forEach(x=>x.onclick=()=>routes[x.dataset.r]?.());$$('[data-a]',p).forEach(x=>x.onclick=()=>simulateAt(x.dataset.a));$('#testReset',p).onclick=()=>{state=clone(DEFAULT_STATE);saveState();renderLanding();};
}

function resumeGameFromState(){
  startGeo();updateSoundButton();buildTestPanel();
  const routes={home:renderHome,prologue:renderPrologue,'gate-church':renderGateChurch,church:renderChurch,'fragment-eye':()=>renderFragment('eye',renderGatePond),'gate-pond':renderGatePond,pond:renderPond,'fragment-water':()=>renderFragment('water',renderGateBridge),'gate-bridge':renderGateBridge,bridge:renderBridge,'fragment-passage':()=>renderFragment('passage',renderGateTower),'gate-tower':renderGateTower,tower:renderTower,'fragment-iron':()=>renderFragment('iron',renderReturn),return:renderReturn,final:renderFinal,treasure:renderTreasure,done:renderDone};
  (routes[state.screen]||renderHome)();
}
function boot(){
  updateSoundButton();buildTestPanel();renderLanding();
}

if('serviceWorker' in navigator && !LOCAL_TEST){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
if(LOCAL_TEST && 'serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));caches?.keys?.().then(keys=>keys.forEach(k=>caches.delete(k)));}
boot();
