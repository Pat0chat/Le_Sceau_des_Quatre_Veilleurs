const CACHE='veilleurs-veuxhaulles-v16';
const ASSETS=[
  './','./index.html','./styles.css','./app.js','./manifest.json',
  './assets/book.png','./assets/church.png','./assets/walk.png','./assets/treasure.png',
  './assets/symbol-eye.png','./assets/symbol-water.png','./assets/symbol-passage.png','./assets/symbol-iron.png',
  './assets/ambience.ogg',
  './assets/bg-landing.png','./assets/bg-church.png','./assets/bg-pond.png','./assets/bg-bridge.png','./assets/bg-tower.png','./assets/bg-return.png','./assets/bg-final.png'
];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp;}).catch(()=>caches.match('./index.html'))));
});
