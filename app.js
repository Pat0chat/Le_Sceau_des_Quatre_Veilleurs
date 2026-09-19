'use strict';

const DEFAULT_CONFIG = {
  version: 3,
  gmPin: '4826',
  treasureCode: '3147',
  locations: {
    mairie: { name: 'Mairie de Bissey-la-Côte', lat: 47.9128, lon: 4.71207, radius: 55, calibrated: false },
    eglise: { name: 'Église de la Nativité', lat: 47.91326, lon: 4.70868, radius: 55, calibrated: false },
    fontaine: { name: "Fontaine-abreuvoir, rue de l'Abreuvoir", lat: null, lon: null, radius: 55, calibrated: false },
    chapelle: { name: 'Chapelle Sainte-Madeleine de Layer-sur-Roche', lat: 47.89236, lon: 4.68423, radius: 60, calibrated: false }
  },
  walkThresholds: { shadow1: 2300, memoryShow: 1500, memoryTest: 1200, shadow3: 800, approach: 300 }
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

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
    if(raw.walkThresholds) Object.assign(base.walkThresholds, raw.walkThresholds);
    if(raw.locations){ for(const k of Object.keys(base.locations)){ if(raw.locations[k]) Object.assign(base.locations[k], raw.locations[k]); } }
  }
  return base;
}
let config = mergeConfig(loadConfig());
function saveConfig(){ localStorage.setItem('veilleurs_config', JSON.stringify(config)); }

const DEFAULT_STATE = {
  screen: 'home',
  completed: [],
  fragments: {},
  hints: {},
  walk: { shadow1: false, memoryShown: false, memoryDone: false, shadow3: false },
  memoryPattern: ['🌙','🐦‍⬛','🔥','☠️'],
  finalStep: 0,
  startedAt: null
};
function loadState(){
  try { return Object.assign(clone(DEFAULT_STATE), JSON.parse(localStorage.getItem('veilleurs_state') || '{}')); }
  catch { return clone(DEFAULT_STATE); }
}
let state = loadState();
function saveState(){ localStorage.setItem('veilleurs_state', JSON.stringify(state)); }
function complete(id){ if(!state.completed.includes(id)) state.completed.push(id); saveState(); }
function resetGame(){ state = clone(DEFAULT_STATE); saveState(); renderHome(); }

let currentPosition = null;
let geoWatchId = null;
let lastGeoError = null;
let wakeLock = null;

function haptic(ms = 80){ try { navigator.vibrate?.(ms); } catch {} }
function tone(freq = 130, dur = .18, type = 'sine', vol = .035){
  try {
    const A = new (window.AudioContext || window.webkitAudioContext)();
    const o = A.createOscillator(), g = A.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(A.destination); o.start();
    g.gain.exponentialRampToValueAtTime(.0001, A.currentTime + dur);
    o.stop(A.currentTime + dur);
  } catch {}
}
function footsteps(){ tone(95,.12,'triangle',.025); setTimeout(()=>tone(75,.14,'triangle',.025),280); }
function bell(){ tone(196,.55,'sine',.035); setTimeout(()=>tone(98,.8,'sine',.02),90); }
function successSound(){ tone(293,.12,'sine',.025); setTimeout(()=>tone(440,.18,'sine',.03),130); }
function failSound(){ tone(90,.18,'sawtooth',.025); }

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
  if(geoOk()) return `<div class="status"><span><span class="dot ok"></span> GPS actif</span><span class="small">± ${Math.round(currentPosition.accuracy || 0)} m</span></div>`;
  if(lastGeoError) return `<div class="status"><span><span class="dot bad"></span> GPS indisponible</span><span class="small">${escapeHtml(lastGeoError)}</span></div>`;
  return `<div class="status"><span><span class="dot"></span> Recherche GPS…</span><span class="small">Autorisez la position</span></div>`;
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

async function requestWakeLock(){ try { if('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
function startGeo(){
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
function maybeAutoUnlock(key, fn){ const l = config.locations[key]; const d = distanceTo(key); if(Number.isFinite(d) && d <= Number(l.radius || 55)){ haptic(); fn(); } }

function renderHome(){
  state.screen='home'; saveState();
  app.innerHTML = `
    <div class="hero hero-home">
      <div class="crest">✦</div>
      <div class="kicker">Bissey-la-Côte • Layer-sur-Roche</div>
      <h1>Le Sceau des<br>Quatre Veilleurs</h1>
      <p class="hero-subtitle">Un récit de pierre, d’eau, d’ombre et de serment.</p>
      ${progressHtml(state.completed.length>=6?4:Math.min(3,Object.keys(state.fragments).length))}
      ${card(`${chapterBadge('Livre des Veilleurs','Préface')}
        <p class="story dropcap">Il y a bien longtemps, quatre Veilleurs se sont réunis pour enfermer une présence sans nom sous la pierre de Layer. Leur serment a traversé les siècles. Cette nuit, le sceau faiblit. Si les quatre marques ne sont pas retrouvées avant la tombée du soir, l’Ombre quittera son sommeil.</p>
        ${loreBlock('Votre mission', 'Suivez les traces des anciens gardiens, résolvez les énigmes et reconstituez le sceau. Chacun des quatre joueurs recevra un fragment secret : aucune victoire n’est possible sans les autres.')}
        <p class="small">Le GPS reste sur ce téléphone. Aucune position n’est envoyée à un serveur.</p>
        ${btn(state.startedAt ? 'Reprendre le récit' : 'Ouvrir le Livre des Veilleurs', 'startBtn', 'good')}
        ${state.startedAt ? btn('Recommencer depuis le début', 'resetBtn', 'secondary') : ''}
      `, 'hero-card')}
    </div>`;
  $('#startBtn').onclick = ()=>{ if(!state.startedAt) state.startedAt = Date.now(); saveState(); requestWakeLock(); startGeo(); renderPrologue(); };
  $('#resetBtn')?.addEventListener('click', ()=>{ if(confirm('Effacer toute la progression ?')) resetGame(); });
}

function renderPrologue(){
  state.screen='prologue'; saveState(); startGeo();
  app.innerHTML = card(`
    ${chapterBadge('Prologue','Le Pacte des Quatre')}
    <h2>Le Livre s’ouvre</h2>
    <p class="quote">1292. Lorsque la chapelle de Layer s’éleva sur la roche, quatre Veilleurs lièrent leurs forces pour y enfermer l’Ombre. Chacun prit un rôle. Chacun garda une part du sceau.</p>
    <p class="story">Aujourd’hui, ce sceau s’est fissuré. Les noms des anciens gardiens ont disparu, mais le Livre a reconnu quatre nouveaux porteurs : Vadim, Louise, Soline et Sacha.</p>
    ${loreBlock('Le danger', 'Si les quatre marques ne sont pas retrouvées, le passage de Layer s’ouvrira de nouveau. Le village tout entier tombera sous la garde de l’Ombre.')}
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
  $('#oathBtn').onclick = ()=>{ complete('prologue'); renderGateMairie(); };
}

function renderGateMairie(){
  state.screen='gate-mairie'; saveState(); startGeo(); const l = config.locations.mairie;
  app.innerHTML = card(`
    ${chapterBadge('Chapitre I','Le Premier Appel')}
    <h2>Rejoindre le point d’éveil</h2>
    <p class="story">Le Livre ne peut prononcer la suite qu’au lieu où les nouveaux Veilleurs sont appelés. Rejoignez le cœur du village pour entendre la première injonction.</p>
    ${destinationBlock('Repère du Livre', 'Mairie de Bissey-la-Côte — 9 rue Haute', 'Le sceau se déverrouillera automatiquement à proximité.')}
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
    <p class="quote">Cherchez la maison où le temps est gravé dans la pierre.</p>
    <p class="story">Là où résonnent les cloches, la mémoire du village dort encore dans la matière. Le premier sceau n’est pas caché : il attend d’être reconnu.</p>
    ${loreBlock('Ce que murmure le Livre', 'La première marque est liée à la pierre. Elle ne se révèle qu’à ceux qui savent observer avant de déchiffrer.')}
    ${btn('Partir vers la Pierre', 'toChurch')}
  `, 'chapter-card');
  $('#toChurch').onclick = ()=>{ complete('mairie'); renderGateEglise(); };
}

function renderGateEglise(){
  state.screen='gate-eglise'; saveState(); startGeo(); const l = config.locations.eglise;
  app.innerHTML = card(`
    ${chapterBadge('Épreuve I','La Pierre du Temps')}
    <h2>Approchez du premier sceau</h2>
    <p class="story">Les cloches ne gardent pas seulement l’heure. Elles veillent sur la date qui ouvrira la première marque.</p>
    ${destinationBlock('Repère du Livre', 'Église de la Nativité — rue Haute', 'Cherchez le clocher dans le village ; l’épreuve s’ouvrira lorsque vous serez assez près.')}
    <div id="geoStatus">${geoStatusHtml()}</div>
    <div class="distance" id="liveDistance" data-target="eglise">${fmtDistance(distanceTo('eglise'))}</div>
    <div class="small center">Déverrouillage à ${l.radius} m</div>
  `, 'chapter-card');
  maybeAutoUnlock('eglise', renderEglise);
}

function renderEglise(){
  state.screen='eglise'; saveState(); bell();
  app.innerHTML = card(`
    ${chapterBadge('Épreuve I','La Pierre du Temps')}
    <h2>Le temps est gravé</h2>
    ${progressHtml(1)}
    <p class="quote">Les vivants regardent leur montre. Les anciens, eux, gravaient le temps dans la pierre.</p>
    <p><strong>Soline et Sacha :</strong> trouvez sur place l’année à quatre chiffres.</p>
    <input class="input" id="yearInput" inputmode="numeric" maxlength="4" placeholder="_ _ _ _" aria-label="Année gravée" />
    <button class="btn" id="yearCheck">Valider l’année</button>
    <div id="churchPart2" class="hidden">
      <div class="sep"></div>
      <p><strong>Vadim :</strong> le Livre vous confie le déchiffrement. 1=A, 2=B, 3=C… Que signifie :</p>
      <div class="center incantation">16 • 9 • 5 • 18 • 18 • 5</div>
      <input class="input" id="cipherInput" placeholder="Mot" autocomplete="off"/>
      <button class="btn" id="cipherCheck">Valider le mot</button>
    </div>
    <div id="churchMsg"></div>
    ${hintsHtml('eglise', ['Cherchez une date de construction inscrite sur l’édifice.', 'Pour le code de Vadim, remplacez chaque nombre par la lettre de même rang dans l’alphabet.'])}
  `, 'chapter-card');
  $('#yearCheck').onclick = ()=>{
    if($('#yearInput').value.trim() === '1828'){
      successSound();
      $('#churchPart2').classList.remove('hidden');
      $('#churchMsg').innerHTML = '<p class="success">✓ La pierre se souvient. Le déchiffrement peut commencer.</p>';
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
      renderFragment('Sacha','1','🪨','Pierre', renderGateFontaine);
    } else {
      failSound();
      $('#churchMsg').innerHTML = '<p class="error">Le mot ne correspond pas au code.</p>';
    }
  };
  bindHints(renderEglise);
}

function renderFragment(who, digit, icon, name, next){
  state.screen='fragment'; saveState();
  app.innerHTML = card(`
    ${chapterBadge('Fragment retrouvé', `Marque de la ${name}`)}
    <div class="fragment-emblem">${icon}</div>
    <h2 class="center">La Marque de la ${name}</h2>
    <p class="quote">Passez le téléphone à <strong>${who}</strong>. Les autres détournent les yeux.</p>
    <div class="sep"></div>
    <p class="center">Le Livre confie à ${who} ce fragment secret :</p>
    <div class="distance">${digit}</div>
    <p class="small center">Mémorise-le. Il sera indispensable devant la chapelle.</p>
    ${btn('Je l’ai mémorisé', 'memorized')}
  `, 'chapter-card fragment-card');
  $('#memorized').onclick = next;
}

function renderGateFontaine(){
  state.screen='gate-fontaine'; saveState(); startGeo(); const l = config.locations.fontaine;
  app.innerHTML = card(`
    ${chapterBadge('Épreuve II','Le Gardien des Eaux')}
    <h2>Descendre vers l’eau</h2>
    <p class="quote">Descendez là où la pierre donne à boire. Quelque chose vous y regarde depuis 1861.</p>
    <p class="story">Le second sceau n’est pas gardé par un homme, mais par une présence sculptée qui ne quitte jamais son bassin.</p>
    ${destinationBlock('Repère du Livre', 'Fontaine-abreuvoir — rue de l’Abreuvoir', 'Depuis l’église, descendez vers la rue de l’Abreuvoir et cherchez la fontaine de pierre.')}
    <div id="geoStatus">${geoStatusHtml()}</div>
    <div class="distance" id="liveDistance" data-target="fontaine">${fmtDistance(distanceTo('fontaine'))}</div>
    ${!targetPoint('fontaine')
      ? `<p class="error"><strong>La fontaine n’est pas encore calibrée.</strong><br>Utilisez ⚙ → Coordonnées → Fontaine → « Utiliser ma position actuelle » quand vous serez sur place.</p>`
      : `<div class="small center">Déverrouillage à ${l.radius} m</div>`}
  `, 'chapter-card');
  maybeAutoUnlock('fontaine', renderFontaine);
}

function renderFontaine(){
  state.screen='fontaine'; saveState();
  app.innerHTML = card(`
    ${chapterBadge('Épreuve II','Le Gardien des Eaux')}
    <h2>Le reflet de la seconde marque</h2>
    ${progressHtml(2)}
    <p class="quote">Ne touchez pas l’eau. Le deuxième Veilleur n’était pas humain.</p>
    <p><strong>Sacha :</strong> trouve l’arme portée par la créature.</p>
    <div class="choice-grid" id="weaponChoices">
      <button class="choice" data-v="trident">🔱 Trident</button>
      <button class="choice" data-v="epee">⚔️ Épée</button>
      <button class="choice" data-v="hache">🪓 Hache</button>
      <button class="choice" data-v="arc">🏹 Arc</button>
    </div>
    <div id="fountainDate" class="hidden">
      <p><strong>Soline :</strong> trouve les quatre chiffres gravés au-dessus de lui.</p>
      <input class="input" id="fountainYear" inputmode="numeric" maxlength="4" placeholder="_ _ _ _">
      <button class="btn" id="fountainYearBtn">Valider</button>
    </div>
    <div id="fountainFinal" class="hidden">
      <p><strong>Louise et Vadim :</strong> quel chiffre commence <em>et</em> termine cette année ?</p>
      <input class="input" id="fountainDigit" inputmode="numeric" maxlength="1">
      <button class="btn" id="fountainDigitBtn">Valider</button>
    </div>
    <div id="fountainMsg"></div>
    ${hintsHtml('fontaine', ['Observez le décor sculpté de la fontaine.', 'L’année attendue est 1861 ; regardez son premier et son dernier chiffre.'])}
  `, 'chapter-card');
  $$('#weaponChoices .choice').forEach(b => b.onclick = ()=>{
    if(b.dataset.v === 'trident'){
      successSound();
      $('#fountainDate').classList.remove('hidden');
      $('#fountainMsg').innerHTML = '<p class="success">✓ Le Gardien vous reconnaît. Cherchez maintenant son année.</p>';
    } else {
      failSound();
      $('#fountainMsg').innerHTML = '<p class="error">Cette arme n’est pas la sienne.</p>';
    }
  });
  $('#fountainYearBtn').onclick = ()=>{
    if($('#fountainYear').value.trim() === '1861'){
      successSound();
      $('#fountainFinal').classList.remove('hidden');
      $('#fountainMsg').innerHTML = '<p class="success">✓ 1861. Les eaux laissent entrevoir un second signe.</p>';
    } else {
      failSound();
      $('#fountainMsg').innerHTML = '<p class="error">Cherchez encore les quatre chiffres gravés.</p>';
    }
  };
  $('#fountainDigitBtn').onclick = ()=>{
    if($('#fountainDigit').value.trim() === '1'){
      state.fragments.soline = '2';
      complete('fontaine');
      successSound();
      renderFragment('Soline','2','💧','Eau', renderWalkIntro);
    } else {
      failSound();
      $('#fountainMsg').innerHTML = '<p class="error">Regardez le début et la fin de 1861.</p>';
    }
  };
  bindHints(renderFontaine);
}

function renderWalkIntro(){
  state.screen='walk-intro'; saveState();
  app.innerHTML = card(`
    ${chapterBadge('Chapitre II','La Marche de Layer')}
    <h2>La Porte des Ombres</h2>
    <p class="quote">Vous quittez maintenant le domaine des vivants.</p>
    <p class="story">Les deux premières marques ont été retrouvées. Mais le Livre devient plus sombre : au-delà du village, la route vers Layer n’est plus un simple chemin. C’est l’épreuve même des Veilleurs.</p>
    ${loreBlock('Ce qui vous attend', 'La distance jusqu’à la chapelle sera votre seul repère. À mesure que vous approcherez, l’Ombre vous éprouvera et révélera deux nouveaux fragments.')}
    ${destinationBlock('Destination', 'Hameau de Layer-sur-Roche — vers la chapelle Sainte-Madeleine', 'Suivez l’itinéraire pédestre reconnu à l’avance. Le téléphone indique la distance restante, pas le chemin à emprunter.')}
    <p class="small">À partir d’ici, l’adulte responsable guide le groupe sur l’itinéraire préparé. Le téléphone devient un radar et déclenche les épreuves au fur et à mesure de l’approche.</p>
    ${btn('Entrer dans la Marche des Ombres', 'walkBtn')}
  `, 'chapter-card');
  $('#walkBtn').onclick = ()=>{ complete('walk-intro'); renderWalk(); };
}

function walkStatus(){
  const d = distanceTo('chapelle');
  const t = config.walkThresholds;
  let txt = 'Quelque chose marche derrière vous.';
  if(d <= t.approach) txt = 'La pierre de Layer se rapproche.';
  else if(d <= t.shadow3) txt = 'La chapelle vous a vus.';
  else if(d <= t.memoryTest) txt = 'Le souvenir gardé par Sacha devient nécessaire.';
  else if(d <= t.memoryShow) txt = 'Restez ensemble. Le chemin écoute vos pas.';
  else if(d <= t.shadow1) txt = 'Une première Ombre s’éveille.';
  return { d, txt };
}

function renderWalk(){
  state.screen='walk'; saveState(); startGeo(); const w = walkStatus();
  app.innerHTML = card(`
    ${chapterBadge('Chapitre II','La Marche des Ombres')}
    <h2>Ne vous séparez jamais</h2>
    ${destinationBlock('Cap à tenir', 'Chapelle Sainte-Madeleine — Layer-sur-Roche', 'L’adulte guide le chemin ; le radar mesure seulement votre approche de la chapelle.')}
    <div id="geoStatus">${geoStatusHtml()}</div>
    <div class="radar"></div>
    <div class="distance" id="walkDistance">${fmtDistance(w.d)}</div>
    <p class="center" id="walkText">${escapeHtml(w.txt)}</p>
    <div id="walkEvent"></div>
    <p class="tiny center">Les événements apparaissent automatiquement à mesure que vous approchez de la chapelle.</p>
  `, 'chapter-card');
  updateWalk();
}

function updateWalk(){
  if(state.screen !== 'walk') return;
  const d = distanceTo('chapelle'), t = config.walkThresholds;
  const dist = $('#walkDistance'); if(dist) dist.textContent = fmtDistance(d);
  const textEl = $('#walkText'); if(textEl) textEl.textContent = walkStatus().txt;
  if(!Number.isFinite(d)) return;
  if(d <= t.approach){ complete('walk'); renderGateChapelle(); return; }
  if(d <= t.shadow3 && !state.walk.shadow3){ state.walk.shadow3 = true; saveState(); showShadow3(); return; }
  if(d <= t.memoryTest && state.walk.memoryShown && !state.walk.memoryDone){ showMemoryTest(); return; }
  if(d <= t.memoryShow && !state.walk.memoryShown){ state.walk.memoryShown = true; saveState(); showMemoryPattern(); return; }
  if(d <= t.shadow1 && !state.walk.shadow1){ state.walk.shadow1 = true; saveState(); showShadow1(); return; }
}

function showShadow1(){
  haptic([100,80,100]); footsteps();
  const e = $('#walkEvent'); if(!e) return;
  e.innerHTML = `<div class="sep"></div><h3>OMBRE I</h3><p class="quote">Je grandis lorsque la lumière meurt. Je disparais dans l’obscurité complète. Qui suis-je ?</p><div class="choice-grid"><button class="choice" data-a="ombre">Une ombre</button><button class="choice" data-a="fantome">Un fantôme</button><button class="choice" data-a="brouillard">Du brouillard</button><button class="choice" data-a="corbeau">Un corbeau</button></div><div id="shadow1msg"></div>`;
  $$('#walkEvent .choice').forEach(b => b.onclick = ()=>{
    if(b.dataset.a === 'ombre'){
      successSound();
      e.innerHTML = '<div class="hint-box">✓ Alors ne la laissez jamais passer devant vous.</div>';
      setTimeout(footsteps, 450);
    } else {
      failSound();
      $('#shadow1msg').innerHTML = '<p class="error">Elle n’a pas de corps et dépend de la lumière.</p>';
    }
  });
}

function showMemoryPattern(){
  haptic();
  const e = $('#walkEvent'); if(!e) return;
  e.innerHTML = `<div class="sep"></div><h3>OMBRE II — LE PORTE-FLAMME</h3><p>Passez le téléphone à <strong>Sacha</strong>. Les autres détournent les yeux.</p><p>Tu as 5 secondes pour mémoriser ce signe :</p><div class="memory-seq">${state.memoryPattern.join(' ')}</div><div class="small center" id="countdown">5</div>`;
  let n = 5;
  const id = setInterval(()=>{
    n--;
    const c = $('#countdown'); if(c) c.textContent = n;
    if(n <= 0){ clearInterval(id); e.innerHTML = '<div class="hint-box">Sacha, garde la séquence en mémoire. Le chemin te la redemandera.</div>'; }
  }, 1000);
}

function showMemoryTest(){
  haptic();
  const e = $('#walkEvent'); if(!e) return;
  e.innerHTML = `<div class="sep"></div><h3>OMBRE II — LE CRYPTOGRAPHE</h3><p>Passez le téléphone à <strong>Vadim</strong>. Demande à Sacha ce qu’il a vu.</p><p>Choisis la bonne séquence :</p><div class="choice-grid"><button class="choice" data-ok="1">🌙 🐦‍⬛ 🔥 ☠️</button><button class="choice">🐦‍⬛ 🌙 ☠️ 🔥</button><button class="choice">🔥 ☠️ 🌙 🐦‍⬛</button><button class="choice">🌙 🔥 🐦‍⬛ ☠️</button></div><div id="memmsg"></div>`;
  $$('#walkEvent .choice').forEach(b => b.onclick = ()=>{
    if(b.dataset.ok){
      state.walk.memoryDone = true;
      state.fragments.vadim = '9';
      saveState();
      successSound();
      renderFragment('Vadim','9','ᚱ','Mémoire', renderWalk);
    } else {
      failSound();
      $('#memmsg').innerHTML = '<p class="error">Demandez à Sacha de se rappeler l’ordre exact.</p>';
    }
  });
}

function showShadow3(){
  haptic([100,70,100]);
  const e = $('#walkEvent'); if(!e) return;
  e.innerHTML = `<div class="sep"></div><h3>OMBRE III — LA GARDIENNE</h3><p>Passez le téléphone à <strong>Louise</strong>.</p><p class="quote">Ce que tu cherches n’est pas enterré. Ce n’est pas dans la chapelle. Lorsque les quatre chiffres seront réunis, c’est toi qui devras les mettre dans l’ordre.</p><button class="btn" id="louiseReveal">Révéler mon fragment</button>`;
  $('#louiseReveal').onclick = ()=>{ state.fragments.louise='2'; saveState(); renderFragment('Louise','2','🗝','Gardienne', renderWalk); };
}

function renderGateChapelle(){
  state.screen='gate-chapelle'; saveState(); startGeo(); const l = config.locations.chapelle;
  app.innerHTML = card(`
    ${chapterBadge('Approche finale','La Maison de Pierre')}
    <h2>Le dernier seuil</h2>
    <p class="quote">Cherchez la maison de pierre qui n’est ni une maison, ni une église de village. Elle porte le nom d’une femme.</p>
    <p class="story">Le Livre s’approche de sa dernière page. Dès que vous serez devant la bonne pierre, le sceau tentera une dernière résistance.</p>
    ${destinationBlock('Repère du Livre', 'Chapelle Sainte-Madeleine — Layer-sur-Roche', 'Rejoignez la chapelle. La finale se déclenchera automatiquement dans le rayon configuré.')}
    <div id="geoStatus">${geoStatusHtml()}</div>
    <div class="distance" id="liveDistance" data-target="chapelle">${fmtDistance(distanceTo('chapelle'))}</div>
    <div class="small center">Le sceau réagira à ${l.radius} m.</div>
  `, 'chapter-card');
  maybeAutoUnlock('chapelle', renderFinale);
}

function renderFinale(){
  state.screen='finale'; saveState(); haptic([180,90,180]);
  app.innerHTML = `<div class="blackout">${card(`
    ${chapterBadge('Sainte-Madeleine','Le Sceau de Layer')}
    <h2 id="lateText">TROP TARD.</h2>
    <div id="finalBody" class="hidden">
      <p class="quote">… sauf si vous êtes toujours quatre.</p>
      <p class="story">Chaque Veilleur possède une part du sceau. Réunissez vos fragments dans l’ordre des emblèmes. Si le nombre est juste, la pierre se refermera.</p>
      <div class="symbols"><div class="sigil"><span>🔥</span></div><div class="sigil"><span>👁</span></div><div class="sigil"><span>ᚱ</span></div><div class="sigil"><span>🗝</span></div></div>
      <input class="input" id="sealCode" inputmode="numeric" maxlength="4" placeholder="_ _ _ _">
      <button class="btn" id="sealBtn">Refermer le sceau</button>
      <div id="finalMsg"></div>
    </div>
  `, 'chapter-card final-card')}</div>`;
  setTimeout(()=>{ const b=$('#finalBody'); if(b) b.classList.remove('hidden'); }, 2500);
  setTimeout(()=>tone(58,.35,'sine',.035),600);
  setTimeout(()=>{
    const btnEl = $('#sealBtn');
    if(btnEl) btnEl.onclick = ()=>{
      if($('#sealCode').value.trim() === '1292'){
        successSound();
        complete('finale');
        renderTreasure();
      } else {
        failSound();
        $('#finalMsg').innerHTML = '<p class="error">Le sceau refuse cet ordre. Faites parler les quatre Veilleurs.</p>';
      }
    };
  }, 2600);
}

function renderTreasure(){
  state.screen='treasure'; saveState();
  app.innerHTML = card(`
    ${chapterBadge('Le sceau est refermé','Le Livre se souvient')}
    <h1 class="year-mark">1292</h1>
    <p class="story">Les quatre fragments ont reformé l’année liée à la fondation de la chapelle dans la légende du jeu. La pierre reconnaît à nouveau le serment des Veilleurs.</p>
    <div class="sep"></div>
    <p class="quote">Vadim. Louise. Soline. Sacha. Quatre nouveaux noms sont désormais inscrits dans le Livre des Veilleurs.</p>
    <div class="sep"></div>
    <p class="center">Mais quelque chose est resté de l’autre côté…</p>
    <p class="small center">CODE DU COFFRE</p>
    <div class="distance">${escapeHtml(config.treasureCode)}</div>
    <p class="center"><strong>Le trésor des Veilleurs vous attend.</strong></p>
    ${btn('Terminer le récit', 'finishBtn', 'good')}
  `, 'chapter-card');
  $('#finishBtn').onclick = ()=>{ complete('treasure'); state.screen='done'; saveState(); renderDone(); };
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
  <div class="sep"></div><h3>Réglages</h3><label>Code PIN adulte</label><input class="input" id="pinCfg" value="${escapeHtml(config.gmPin)}"><label>Code du coffre</label><input class="input" id="treasureCfg" value="${escapeHtml(config.treasureCode)}">
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

if('serviceWorker' in navigator){ window.addEventListener('load', ()=>navigator.serviceWorker.register('./sw.js').catch(()=>{})); }
resume();
