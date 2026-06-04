// ============================================================
//  CROWD RUNNER – Shoot & Multiply
//  Crowd løper fremover, skyter automatisk på fiender.
//  Grønne porter = flere folk, røde = færre folk.
//  Verden ruller mot kamera, crowd er statisk i Z.
// ============================================================

// ── Verdensfart (juster denne for å endre tempo) ───────────
const WORLD_SPEED = 14; // enheter per sekund – øker svakt per bølge

const CFG = {
  startCrowd:     1,
  runSpeed:       WORLD_SPEED,
  speedIncrement: 0.15,
  roadWidth:      14,
  laneWidth:      2.6,
  crowdSpread:    3.2,
  soldierScale:   0.62,
  gateInterval:   28,
  enemyInterval:  35,
  bossEveryN:      5,
  baseEnemyHP:    30,
  enemyHPScale:   1.6,
  bossMultiplier:  4,
  enemySpread:    3.5,
  maxEnemyCount:  30,
  keySpeed:        9,
  minCrowd:        1,
  maxCrowd:       999,
  winAtWave:      20,
  bulletSpeed:    26,
  shootInterval:  0.18,
  bulletDmg:       1,
  enemyShootInterval: 1.2,
  enemyBulletSpeed:   10,
  enemyWalkSpeed:      3,
  hardThreshold:      60,
};

// ── State ──────────────────────────────────────────────────
let state     = 'start';
let crowdSize = 0;
let level     = 1;       // nåværende level (vises i HUD)
let highScore = 0;       // høyeste level nådd
let speed     = CFG.runSpeed;
let crowdX    = 0;
let targetX   = 0;
let travelZ   = 0;
let lastGateTravel  = 0;
let lastEnemyTravel = 0;
let lastPropTravel  = 0;
let tanksThisLevel  = 0;  // maks 2 tanker per level
let shootTimer      = 0;
let enemyShootTimer = 0;

// ── Penge- og butikk-system ────────────────────────────────
let coins              = 0;
let startSoldiersLevel = 0; // oppgraderingsnivå for soldater
let bombCount          = 0; // antall bomber spilleren har

const SOLDIER_UPGRADES = [
  { soldiers: 1,  cost: 0    }, // nivå 0 – standard
  { soldiers: 3,  cost: 60   },
  { soldiers: 6,  cost: 150  },
  { soldiers: 10, cost: 300  },
  { soldiers: 15, cost: 600  },
  { soldiers: 20, cost: 1200 },
];
const BOMB_COST   = 80;
const BOMB_DAMAGE = 300;

function loadSave() {
  coins              = parseInt(localStorage.getItem('cr_coins')    || '0');
  startSoldiersLevel = parseInt(localStorage.getItem('cr_soldiers') || '0');
  bombCount          = parseInt(localStorage.getItem('cr_bombs')    || '0');
}
function savePersist() {
  localStorage.setItem('cr_coins',    coins);
  localStorage.setItem('cr_soldiers', startSoldiersLevel);
  localStorage.setItem('cr_bombs',    bombCount);
}
loadSave();

// ── Våpen-tiers ────────────────────────────────────────────
const WEAPON_TIERS = [
  { damage:2, interval:0.14, color:0xffee58, name:'Pistol'       },
  { damage:2, interval:0.13, color:0xff9800, name:'Rifle'        },
  { damage:3, interval:0.09, color:0xff5722, name:'Maskingevær'  },
  { damage:5, interval:0.06, color:0xf44336, name:'Hagle'        },
  { damage:8, interval:0.04, color:0xce93d8, name:'Rakett'       },
];
let weaponTier = 0;
function currentWeapon() { return WEAPON_TIERS[Math.min(weaponTier, WEAPON_TIERS.length-1)]; }
function upgradeWeapon() {
  if (weaponTier < WEAPON_TIERS.length-1) weaponTier++;
  const w = currentWeapon();
  // Oppdater bullet-materiale farge
  pbMat.color.setHex(w.color);
  showFloatingText(`⬆ ${w.name}!`, '#ce93d8');
}

// Level-state
let levelParams         = null;  // beregnet for gjeldende level
let wavesSpawnedInLevel = 0;     // vanlige bølger spawnet
let bossSpawnedThisLevel = false;

// ── Level-parametre ────────────────────────────────────────
// Returnerer vanskelighetsparametere for gitt level-nummer.
// Juster disse for å endre kurven.
function getLevelParams(lvl) {
  const n   = lvl - 1;
  const rnd = () => Math.random() * 0.25 - 0.125;
  return {
    worldSpeed:      Math.min(11 + n * 0.7 + rnd(), 24),
    wavesBeforeBoss: Math.max(2, 2 + Math.floor(n * 0.5)),
    enemyHP:         Math.round((4 + n * 5)  * (1 + rnd())), // L1=4, L5=24, L10=49
    enemyCount:      Math.min(1 + Math.floor(n * 0.8), CFG.maxEnemyCount),
    bossHP:          Math.round((15 + n * 16) * (1 + rnd())), // L1=15, L5=79, L10=159
    gateInterval:    Math.max(16, 28 - n * 0.5),
    enemyInterval:   Math.max(22, 35 - n * 1.0),
  };
}

// ── Three.js ───────────────────────────────────────────────
const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog        = new THREE.Fog(0x2a2030, 35, 100);

const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 150);
camera.position.set(0, 11, 18);
camera.lookAt(0, 0, 2);

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ── Krigslys ───────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffd0a0, 0.55));
const sun = new THREE.DirectionalLight(0xff9944, 0.9);
sun.position.set(15, 25, 8);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left:-22, right:22, top:22, bottom:-22, near:0.5, far:80 });
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
// Svakt blålig motlys fra horisonten
const rimLight = new THREE.DirectionalLight(0x4466aa, 0.3);
rimLight.position.set(-10, 5, -30);
scene.add(rimLight);

// ── Krigshimmel ────────────────────────────────────────────
// Sky-dome (halvkule som bakgrunn, mørkgrå-blå gradient-look via farge)
const skyGeo  = new THREE.SphereGeometry(130, 16, 8, 0, Math.PI*2, 0, Math.PI*0.55);
const skyMat  = new THREE.MeshBasicMaterial({ color: 0x1c1828, side: THREE.BackSide });
const skyDome = new THREE.Mesh(skyGeo, skyMat);
skyDome.position.y = -10;
scene.add(skyDome);

// Horisontal glødstribe (varm oransje langt nede – som ild i horisonten)
const horizonGeo = new THREE.SphereGeometry(128, 16, 4, 0, Math.PI*2, Math.PI*0.44, Math.PI*0.08);
const horizonMat = new THREE.MeshBasicMaterial({ color: 0x6b2a00, side: THREE.BackSide, transparent: true, opacity: 0.7 });
scene.add(new THREE.Mesh(horizonGeo, horizonMat));

// ── Skyer (pool av sky-puffer) ────────────────────────────
const CLOUD_COUNT = 22;
const clouds = [];

function makeCloudPuff(x, y, z, scale) {
  const geo = new THREE.SphereGeometry(1, 6, 5);
  const mat = new THREE.MeshLambertMaterial({
    color: 0x2a2535,
    transparent: true,
    opacity: 0.82,
  });
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(scale * (0.8 + Math.random()*0.5), scale * 0.55, scale * (0.7 + Math.random()*0.4));
  m.position.set(x, y, z);
  return m;
}

function makeCloud() {
  const g = new THREE.Group();
  const puffs = 4 + Math.floor(Math.random()*4);
  for (let i = 0; i < puffs; i++) {
    const sc = 3.5 + Math.random()*4;
    g.add(makeCloudPuff(
      (Math.random()-0.5)*sc*1.8,
      (Math.random()-0.5)*sc*0.4,
      (Math.random()-0.5)*sc*0.6,
      sc
    ));
  }
  return g;
}

// Fordel skyer jevnt over himmelen
for (let i = 0; i < CLOUD_COUNT; i++) {
  const c = makeCloud();
  const angle  = (i / CLOUD_COUNT) * Math.PI * 2;
  const dist   = 30 + Math.random() * 70;
  const height = 18 + Math.random() * 30;
  c.position.set(
    Math.cos(angle) * dist,
    height,
    Math.sin(angle) * dist - 40
  );
  c.userData.driftX = (Math.random()-0.5) * 0.8; // drift-fart
  scene.add(c);
  clouds.push(c);
}

// ── Eksplosjons-gløder (pool, additivt blended) ───────────
const GLOW_POOL_SIZE = 8;
const glowPool = [];
const glowGeo  = new THREE.SphereGeometry(1, 7, 5);

for (let i = 0; i < GLOW_POOL_SIZE; i++) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const m = new THREE.Mesh(glowGeo, mat);
  m.visible = false;
  scene.add(m);
  glowPool.push({ mesh: m, timer: 0, duration: 0 });
}

let nextExplosionIn = 0.5 + Math.random() * 2.0;

function triggerSkyExplosion() {
  const g = glowPool.find(g => !g.mesh.visible);
  if (!g) return;
  // Tilfeldig posisjon i himmelen, litt bak/oppe
  const angle = Math.random() * Math.PI * 2;
  const dist  = 25 + Math.random() * 60;
  g.mesh.position.set(
    Math.cos(angle) * dist,
    20 + Math.random() * 28,
    Math.sin(angle) * dist - 50
  );
  const sc = 5 + Math.random() * 10;
  g.mesh.scale.setScalar(sc);
  g.duration = 0.4 + Math.random() * 0.7;
  g.timer = 0;
  g.mesh.visible = true;
  // Veksle mellom gult, oransje og rødt
  const colors = [0xff8800, 0xffcc00, 0xff3300, 0xffaa00];
  g.mesh.material.color.setHex(colors[Math.floor(Math.random()*colors.length)]);
}

// Røyksøyler (statiske, i bakgrunnen)
for (let i = 0; i < 4; i++) {
  const smokeGeo = new THREE.CylinderGeometry(0.5 + i*0.3, 0.2, 12 + i*4, 5);
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0x332222,
    transparent: true,
    opacity: 0.18 + Math.random()*0.12,
  });
  const s = new THREE.Mesh(smokeGeo, smokeMat);
  s.position.set(
    (Math.random()-0.5)*120,
    14 + i*3,
    -60 - Math.random()*40
  );
  s.rotation.x = (Math.random()-0.5)*0.15;
  scene.add(s);
}

function updateSky(dt) {
  // Drift skyer sakte sidelengs
  clouds.forEach(c => {
    c.position.x += c.userData.driftX * dt;
    // Wrap rundt når de drifter for langt
    if (c.position.x > 110)  c.position.x = -110;
    if (c.position.x < -110) c.position.x =  110;
  });

  // Eksplosjons-glød animasjon
  glowPool.forEach(g => {
    if (!g.mesh.visible) return;
    g.timer += dt;
    const t = g.timer / g.duration;
    if (t >= 1) {
      g.mesh.visible = false;
      g.mesh.material.opacity = 0;
      return;
    }
    // Fade opp raskt, fade ut saktere
    const opacity = t < 0.25
      ? (t / 0.25) * 0.55
      : (1 - (t - 0.25) / 0.75) * 0.55;
    g.mesh.material.opacity = opacity;
  });

  // Trigger nye eksplosjoner med tilfeldige intervaller
  nextExplosionIn -= dt;
  if (nextExplosionIn <= 0) {
    triggerSkyExplosion();
    // Av og til cluster (2-3 på rad)
    if (Math.random() < 0.35) {
      setTimeout(() => triggerSkyExplosion(), 180 + Math.random()*200);
      if (Math.random() < 0.4) setTimeout(() => triggerSkyExplosion(), 380 + Math.random()*250);
    }
    nextExplosionIn = 1.0 + Math.random() * 3.5;
  }
}

// ── Geometrier ─────────────────────────────────────────────
// Delte geometrier for alle soldater (lav poly, god ytelse)
const GEO = {
  // Porter
  gate: new THREE.BoxGeometry(2.0, 2.6, 0.22),
  post: new THREE.BoxGeometry(0.14, 3.1, 0.14),
};

// Material-cache: én instans per hex-farge
const _matCache = {};
function gMat(hex) {
  if (!_matCache[hex]) _matCache[hex] = new THREE.MeshLambertMaterial({ color: hex });
  return _matCache[hex];
}
// Faste delte materialer
const MAT_SKIN  = gMat(0xffcc80);
const MAT_DARK  = gMat(0x1a1a1a);   // rifle, støvler
const MAT = {
  bulletPlayer: new THREE.MeshBasicMaterial({ color: 0xffee58 }),
  bulletEnemy:  new THREE.MeshBasicMaterial({ color: 0xff5252 }),
};

// ── Chibi-soldat geometrier (deles av alle soldater) ───────
const CGEO = {
  // Hode + hjelm
  head:       new THREE.SphereGeometry(0.28, 10, 8),
  helmetDome: new THREE.SphereGeometry(0.31, 10, 8, 0, Math.PI*2, 0, Math.PI*0.58),
  helmetBrim: new THREE.CylinderGeometry(0.34, 0.34, 0.045, 10),
  eye:        new THREE.BoxGeometry(0.065, 0.09, 0.04),
  // Torso
  vest:       new THREE.BoxGeometry(0.52, 0.44, 0.30),
  chestPlate: new THREE.BoxGeometry(0.22, 0.12, 0.06),
  pouch:      new THREE.BoxGeometry(0.10, 0.09, 0.07),
  shoulder:   new THREE.SphereGeometry(0.10, 6, 5),
  // Armer
  upperArm:   new THREE.CylinderGeometry(0.085, 0.08, 0.24, 7),
  foreArm:    new THREE.CylinderGeometry(0.07, 0.075, 0.22, 7),
  glove:      new THREE.SphereGeometry(0.085, 6, 5),
  // Ben
  thigh:      new THREE.BoxGeometry(0.19, 0.26, 0.19),
  shin:       new THREE.BoxGeometry(0.16, 0.24, 0.17),
  kneePad:    new THREE.BoxGeometry(0.14, 0.10, 0.07),
  boot:       new THREE.BoxGeometry(0.18, 0.16, 0.22),
  // Ryggsekk
  pack:       new THREE.BoxGeometry(0.20, 0.26, 0.10),
  packFlap:   new THREE.BoxGeometry(0.18, 0.08, 0.04),
  // Gevær (AR-stil)
  rifleBody:  new THREE.BoxGeometry(0.07, 0.07, 0.52),
  rifleStock: new THREE.BoxGeometry(0.06, 0.10, 0.18),
  rifleMag:   new THREE.BoxGeometry(0.05, 0.14, 0.05),
  rifleBarrel:new THREE.BoxGeometry(0.04, 0.04, 0.22),
  rifleScope: new THREE.BoxGeometry(0.05, 0.06, 0.14),
};

// ── Soldat-fabrikk – tydelig chibi cartoon-militær ────────
function createSoldier(teamColor) {
  const isEnemy = (teamColor === 0xc62828);

  // Tydelige fargepaletter – sterk kontrast mot gul sand
  const C = isEnemy ? {
    helmet:  0x1a0a0a,   // nesten svart
    uniform: 0xb71c1c,   // knallrød uniform
    vest:    0x1a1a1a,   // svart taktisk vest
    pants:   0x8b1212,   // mørkerød bukse
    boot:    0x0d0d0d,
    glove:   0x0d0d0d,
    accent:  0xff1744,   // lys-rød aksent
    pouch:   0x2a2a2a,
    kneepad: 0x111111,
    eyeCol:  0xffffff,   // hvite øyne gir uttrykk
    skin:    0xffcc80,
  } : {
    helmet:  0x2e4a1a,   // mørkegrønn hjelm
    uniform: 0x1565c0,   // klar blå uniform
    vest:    0x0d3b6e,   // mørkeblå vest
    pants:   0x1565c0,   // blå bukse
    boot:    0x3e2a14,   // brun støvel
    glove:   0x1a1a1a,
    accent:  0x64b5f6,   // lys-blå aksent
    pouch:   0x0d2a4e,
    kneepad: 0x0d3b6e,
    eyeCol:  0xffffff,
    skin:    0xffcc80,
  };

  const root = new THREE.Group();

  const mk = (geo, col, x=0, y=0, z=0, rx=0, ry=0, rz=0) => {
    const m = new THREE.Mesh(geo, gMat(col));
    m.position.set(x,y,z);
    if (rx||ry||rz) m.rotation.set(rx,ry,rz);
    m.castShadow = true;
    return m;
  };

  // ── BEN ────────────────────────────────────────────────────
  const makeLeg = (side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.14, 0.44, 0);
    g.add(mk(CGEO.thigh,   C.pants,   0, -0.13, 0));
    g.add(mk(CGEO.kneePad, C.kneepad, 0, -0.26, 0.10));
    g.add(mk(CGEO.shin,    C.pants,   0, -0.36, 0));
    g.add(mk(CGEO.boot,    C.boot,    0, -0.52, 0.025));
    root.add(g);
    return g;
  };
  const legL = makeLeg(-1);
  const legR = makeLeg( 1);

  // ── TORSO ──────────────────────────────────────────────────
  root.add(mk(CGEO.vest,       C.vest,   0, 0.68, 0));
  root.add(mk(CGEO.chestPlate, C.accent, 0, 0.74, 0.16));
  [[-0.15,0.60,0.16],[0.15,0.60,0.16],[0,0.50,0.16]].forEach(([x,y,z]) =>
    root.add(mk(CGEO.pouch, C.pouch, x, y, z))
  );
  root.add(mk(CGEO.pack,     C.vest,  0, 0.70, -0.20));
  root.add(mk(CGEO.packFlap, C.pouch, 0, 0.84, -0.25));

  // ── ARMER ──────────────────────────────────────────────────
  [-1,1].forEach(side => {
    const xOff = side * 0.31;
    root.add(mk(CGEO.shoulder, C.uniform, xOff, 0.86, 0));
    root.add(mk(CGEO.upperArm, C.uniform, xOff, 0.70, 0));
    root.add(mk(CGEO.foreArm,  C.uniform, xOff, 0.54, 0));
    root.add(mk(CGEO.glove,    C.glove,   xOff, 0.42, 0));
  });

  // ── GEVÆR ──────────────────────────────────────────────────
  const rifle = new THREE.Group();
  rifle.position.set(0.30, 0.54, -0.08);
  rifle.rotation.set(0.18, 0, 0);
  rifle.add(mk(CGEO.rifleBody,    0x1a1a1a));
  rifle.add(mk(CGEO.rifleStock,   0x2a2018,  0,  0.01,  0.30));
  rifle.add(mk(CGEO.rifleMag,     0x222222,  0, -0.10,  0.05));
  rifle.add(mk(CGEO.rifleBarrel,  0x111111,  0,  0.015,-0.34));
  rifle.add(mk(CGEO.rifleScope,   0x333333,  0,  0.07, -0.08));
  root.add(rifle);

  // ── HODE – litt større for chibi-look ──────────────────────
  const headGrp = new THREE.Group();
  headGrp.position.set(0, 1.14, 0);
  headGrp.scale.setScalar(1.15); // større hode = mer cartoon

  headGrp.add(mk(CGEO.head, C.skin));

  // Øyne – hvite med pupill for tydelig uttrykk
  [-0.095, 0.095].forEach(ex => {
    headGrp.add(mk(CGEO.eye, C.eyeCol, ex, -0.02, 0.265));
    headGrp.add(mk(new THREE.BoxGeometry(0.04, 0.06, 0.03), 0x111111, ex, -0.02, 0.275));
  });

  // Hjelm
  headGrp.add(mk(CGEO.helmetDome, C.helmet, 0, 0.04, 0));
  headGrp.add(mk(CGEO.helmetBrim, C.helmet, 0, -0.09, 0));
  // Distinct front-merke per lag
  if (isEnemy) {
    headGrp.add(mk(new THREE.BoxGeometry(0.14,0.11,0.04), 0x111111, 0,  0.06, 0.30));
    headGrp.add(mk(new THREE.BoxGeometry(0.09,0.07,0.04), 0xff1744, 0,  0.06, 0.33));
    [-1,1].forEach(s =>
      headGrp.add(mk(new THREE.BoxGeometry(0.04,0.09,0.12), 0x111111, s*0.30, 0.04, 0.08))
    );
  } else {
    // Blå spiller: liten gul stjerne på hjelmen
    headGrp.add(mk(new THREE.BoxGeometry(0.10,0.10,0.04), 0xffee58, 0, 0.10, 0.30));
  }

  root.add(headGrp);

  root.userData.legL    = legL;
  root.userData.legR    = legR;
  root.userData.headGrp = headGrp;
  root.scale.setScalar(CFG.soldierScale);
  return root;
}

// ── Vei ───────────────────────────────────────────────────
const SEG = 28, NSEGS = 7;
const roadMat  = new THREE.MeshLambertMaterial({ color: 0x8d7d6a });
const sandMat  = new THREE.MeshLambertMaterial({ color: 0xd4a96a });
const lineMat  = new THREE.MeshLambertMaterial({ color: 0xf5e6c8 });

function makeRoadSeg() {
  const g = new THREE.Group();
  const r = new THREE.Mesh(new THREE.BoxGeometry(CFG.roadWidth, 0.12, SEG), roadMat);
  r.receiveShadow = true;
  g.add(r);
  [-1,1].forEach(s => {
    const sd = new THREE.Mesh(new THREE.BoxGeometry(20, 0.08, SEG), sandMat);
    sd.position.x = s * (CFG.roadWidth/2 + 10);
    g.add(sd);
  });
  for (let z = -SEG/2+2; z < SEG/2; z += 4.5) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.6), lineMat);
    l.position.z = z;
    g.add(l);
  }
  scene.add(g);
  return g;
}

const roadSegs = [];
for (let i = 0; i < NSEGS; i++) {
  const s = makeRoadSeg();
  s.position.z = -i * SEG;
  roadSegs.push(s);
}

function updateRoad(dz) {
  roadSegs.forEach(s => {
    s.position.z += dz;
    if (s.position.z > SEG * 1.5) s.position.z -= NSEGS * SEG;
  });
}

// ── Ørken-rekvisitter ──────────────────────────────────────
const PGEO = {
  sandbag:   new THREE.BoxGeometry(0.6, 0.3, 0.35),
  barrel:    new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8),
  crate:     new THREE.BoxGeometry(0.55, 0.55, 0.55),
  trapBar:   new THREE.BoxGeometry(0.08, 0.08, 1.1),
  bush:      new THREE.SphereGeometry(0.35, 5, 4),
  cactusB:   new THREE.CylinderGeometry(0.13, 0.15, 1.1, 7),
  cactusA:   new THREE.CylinderGeometry(0.08, 0.09, 0.5, 6),
  rubble:    new THREE.BoxGeometry(0.4, 0.22, 0.35),
  wall:      new THREE.BoxGeometry(2.2, 1.1, 0.3),
  wallPost:  new THREE.BoxGeometry(0.28, 1.3, 0.28),
  tent:      new THREE.CylinderGeometry(0.1, 1.8, 1.6, 5),
  rockL:     new THREE.DodecahedronGeometry(0.7, 0),
  rockM:     new THREE.DodecahedronGeometry(0.45, 0),
  rockS:     new THREE.DodecahedronGeometry(0.25, 0),
  sign:      new THREE.BoxGeometry(0.08, 1.2, 0.08),
  signBoard: new THREE.BoxGeometry(0.6, 0.4, 0.06),
  wreck:     new THREE.BoxGeometry(1.8, 0.5, 3.2),
  wheel:     new THREE.CylinderGeometry(0.38, 0.38, 0.22, 10),
};
const PMAT = {
  sandbag: new THREE.MeshLambertMaterial({ color: 0xb8954a }),
  barrel:  new THREE.MeshLambertMaterial({ color: 0x4a5240 }),
  barrelR: new THREE.MeshLambertMaterial({ color: 0x8b2222 }),
  crate:   new THREE.MeshLambertMaterial({ color: 0x8b7355 }),
  trap:    new THREE.MeshLambertMaterial({ color: 0x606060 }),
  bush:    new THREE.MeshLambertMaterial({ color: 0x8b7340 }),
  cactus:  new THREE.MeshLambertMaterial({ color: 0x6b8c42 }),
  rubble:  new THREE.MeshLambertMaterial({ color: 0x9e8c7a }),
  wall:    new THREE.MeshLambertMaterial({ color: 0xc4a96e }),
  tent:    new THREE.MeshLambertMaterial({ color: 0x8b7a5a }),
  rock:    new THREE.MeshLambertMaterial({ color: 0xaa9880 }),
  sign:    new THREE.MeshLambertMaterial({ color: 0x7a6040 }),
  wreck:   new THREE.MeshLambertMaterial({ color: 0x5a4a3a }),
  wheel:   new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
};

function makeSandbags() {
  const g = new THREE.Group();
  const rows = 1 + Math.floor(Math.random()*2);
  for (let row = 0; row < rows; row++) {
    const cols = 2 + Math.floor(Math.random()*3);
    for (let i = 0; i < cols; i++) {
      const b = new THREE.Mesh(PGEO.sandbag, PMAT.sandbag);
      b.position.set(i*0.56 - cols*0.28, 0.15 + row*0.28, (Math.random()-0.5)*0.15);
      b.rotation.y = (Math.random()-0.5)*0.4;
      b.castShadow = true; g.add(b);
    }
  }
  return g;
}

function makeTankTrap() {
  const g = new THREE.Group();
  [[0,0,0],[Math.PI/2,0,0],[0,0,Math.PI/2]].forEach(([rx,ry,rz]) => {
    const b = new THREE.Mesh(PGEO.trapBar, PMAT.trap);
    b.rotation.set(rx,ry,rz); b.castShadow = true; g.add(b);
  });
  return g;
}

function makeCactus() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(PGEO.cactusB, PMAT.cactus);
  trunk.position.y = 0.55; trunk.castShadow = true; g.add(trunk);
  const arms = Math.random() < 0.5 ? [-0.32, 0.32] : [-0.32];
  arms.forEach(dx => {
    const arm = new THREE.Mesh(PGEO.cactusA, PMAT.cactus);
    arm.position.set(dx, 0.6 + Math.random()*0.3, 0);
    arm.rotation.z = dx > 0 ? -0.55 : 0.55;
    g.add(arm);
  });
  return g;
}

function makeDeadBush() {
  const g = new THREE.Group();
  for (let i = 0; i < 1+Math.floor(Math.random()*2); i++) {
    const b = new THREE.Mesh(PGEO.bush, PMAT.bush);
    b.scale.set(0.8+Math.random()*0.6, 0.4+Math.random()*0.4, 0.8+Math.random()*0.6);
    b.position.set((Math.random()-0.5)*0.5, 0.18, (Math.random()-0.5)*0.4);
    g.add(b);
  }
  return g;
}

function makeBarrels() {
  const g = new THREE.Group();
  const count = 1 + Math.floor(Math.random()*4);
  for (let i = 0; i < count; i++) {
    const mat = Math.random() < 0.3 ? PMAT.barrelR : PMAT.barrel;
    const b = new THREE.Mesh(PGEO.barrel, mat);
    const upright = Math.random() < 0.7;
    b.position.set((Math.random()-0.5)*1.0, upright ? 0.25 : 0.22, (Math.random()-0.5)*0.8);
    if (!upright) b.rotation.z = Math.PI/2;
    b.castShadow = true; g.add(b);
  }
  return g;
}

function makeCrates() {
  const g = new THREE.Group();
  const count = 1 + Math.floor(Math.random()*4);
  for (let i = 0; i < count; i++) {
    const c = new THREE.Mesh(PGEO.crate, PMAT.crate);
    c.position.set((Math.random()-0.5)*1.2, 0.28 + Math.floor(i/2)*0.54, (Math.random()-0.5)*0.8);
    c.rotation.y = (Math.random()-0.5)*0.5;
    c.castShadow = true; g.add(c);
  }
  return g;
}

function makeRubble() {
  const g = new THREE.Group();
  for (let i = 0; i < 4+Math.floor(Math.random()*4); i++) {
    const r = new THREE.Mesh(PGEO.rubble, PMAT.rubble);
    r.position.set((Math.random()-0.5)*1.4, 0.11, (Math.random()-0.5)*1.0);
    r.rotation.y = Math.random()*Math.PI;
    r.castShadow = true; g.add(r);
  }
  return g;
}

function makeRockCluster() {
  const g = new THREE.Group();
  const geos = [PGEO.rockL, PGEO.rockM, PGEO.rockS];
  const count = 2 + Math.floor(Math.random()*4);
  for (let i = 0; i < count; i++) {
    const geo = geos[Math.floor(Math.random()*geos.length)];
    const r = new THREE.Mesh(geo, PMAT.rock);
    r.position.set((Math.random()-0.5)*1.8, 0.2+Math.random()*0.3, (Math.random()-0.5)*1.2);
    r.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    r.castShadow = true; g.add(r);
  }
  return g;
}

function makeSandWall() {
  const g = new THREE.Group();
  g.add((() => { const m = new THREE.Mesh(PGEO.wall, PMAT.wall); m.position.y=0.55; m.castShadow=true; return m; })());
  [-0.9,0.9].forEach(dx => {
    const p = new THREE.Mesh(PGEO.wallPost, PMAT.wall);
    p.position.set(dx, 0.65, 0); p.castShadow = true; g.add(p);
  });
  return g;
}

function makeTent() {
  const g = new THREE.Group();
  const t = new THREE.Mesh(PGEO.tent, PMAT.tent);
  t.position.y = 0.8; t.castShadow = true; g.add(t);
  // Tent pegs
  for (let i = 0; i < 4; i++) {
    const a = (i/4)*Math.PI*2;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,0.5,5), PMAT.trap);
    p.position.set(Math.cos(a)*1.4, 0.25, Math.sin(a)*1.4);
    p.rotation.z = Math.cos(a)*0.4; g.add(p);
  }
  return g;
}

function makeWreckedVehicle() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(PGEO.wreck, PMAT.wreck);
  body.position.y = 0.35; body.rotation.y = (Math.random()-0.5)*0.6;
  body.castShadow = true; g.add(body);
  // Burnt wheels
  [[-0.9,0,-1.1],[0.9,0,-1.1],[-0.9,0,1.1],[0.9,0,1.1]].forEach(([x,y,z]) => {
    const w = new THREE.Mesh(PGEO.wheel, PMAT.wheel);
    w.position.set(x,0.22+y,z);
    w.rotation.set(0,0,Math.PI/2 + (Math.random()-0.5)*0.8);
    g.add(w);
  });
  return g;
}

function makeSignPost() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(PGEO.sign, PMAT.sign);
  post.position.y = 0.6; g.add(post);
  const board = new THREE.Mesh(PGEO.signBoard, PMAT.crate);
  board.position.y = 1.1; board.rotation.y = (Math.random()-0.5)*0.3; g.add(board);
  return g;
}

// Prop-liste og spawn
const props = [];
const PROP_SIDE_MIN = CFG.roadWidth/2 + 0.8;
const PROP_SIDE_MAX = CFG.roadWidth/2 + 12;
const PROP_INTERVAL = 5;

const propMakers = [
  makeSandbags, makeSandbags, makeTankTrap, makeCactus, makeCactus,
  makeDeadBush, makeDeadBush, makeBarrels, makeBarrels, makeCrates,
  makeRubble, makeRockCluster, makeRockCluster, makeSandWall,
  makeTent, makeWreckedVehicle, makeSignPost,
];

function spawnPropGroup(atZ) {
  [-1, 1].forEach(side => {
    // Spawn 1-3 props per side per intervall
    const count = 1 + Math.floor(Math.random()*3);
    for (let k = 0; k < count; k++) {
      const maker = propMakers[Math.floor(Math.random()*propMakers.length)];
      const g = maker();
      const xDist = PROP_SIDE_MIN + Math.random()*(PROP_SIDE_MAX - PROP_SIDE_MIN);
      g.position.set(side * xDist, 0, atZ + (Math.random()-0.5)*PROP_INTERVAL*0.8);
      g.rotation.y = Math.random()*Math.PI*2;
      scene.add(g);
      props.push({ group: g });
    }
  });
}

function updateProps(dz) {
  for (let i = props.length-1; i >= 0; i--) {
    props[i].group.position.z += dz;
    if (props[i].group.position.z > 35) {
      scene.remove(props[i].group);
      props.splice(i, 1);
    }
  }
}

// Pre-spawn props tett langs hele banen
for (let z = -8; z > -300; z -= PROP_INTERVAL) spawnPropGroup(z);

// ── Crowd ──────────────────────────────────────────────────
const crowdGroup = new THREE.Group();
crowdGroup.position.z = 8; // crowd plassert lengre bak mot kamera
scene.add(crowdGroup);
const crowdFigs = [];

function rebuildCrowd() {
  while (crowdGroup.children.length) crowdGroup.remove(crowdGroup.children[0]);
  crowdFigs.length = 0;
  const n    = Math.min(crowdSize, 80);
  const cols = Math.min(n, Math.ceil(Math.sqrt(n) * 1.3));
  const spacingX = 0.75, spacingZ = 0.85;
  for (let i = 0; i < n; i++) {
    const fig = createSoldier(0x1565c0);
    const col = i % cols;
    const row = Math.floor(i / cols);
    fig.position.set(
      (col - (cols - 1) / 2) * spacingX,
      0,
      row * spacingZ
    );
    crowdGroup.add(fig);
    crowdFigs.push(fig);
  }
}

// ── Porter ─────────────────────────────────────────────────
const gates = [];

// Sikker avrundet rektangel (ctx.roundRect mangler i eldre nettlesere)
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.arcTo(x+w,y, x+w,y+r, r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w,y+h, x+w-r,y+h, r);
  ctx.lineTo(x+r, y+h); ctx.arcTo(x,y+h, x,y+h-r, r);
  ctx.lineTo(x, y+r); ctx.arcTo(x,y, x+r,y, r);
  ctx.closePath();
}

function textTex(text, bg, fg) {
  const W=256, H=100;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const ctx=c.getContext('2d');
  ctx.fillStyle=bg;
  rrect(ctx,2,2,W-4,H-4,14); ctx.fill();
  ctx.fillStyle=fg; ctx.font=`bold ${H*0.56}px Arial`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text, W/2, H/2);
  return new THREE.CanvasTexture(c);
}

function opResult(n, op, val) {
  if (op==='+') return Math.min(CFG.maxCrowd, n+val);
  if (op==='-') return Math.max(CFG.minCrowd, n-val);
  if (op==='*') return Math.min(CFG.maxCrowd, n*val);
  if (op==='/') return Math.max(CFG.minCrowd, Math.floor(n/val));
  return n;
}

function opStr(op, val) {
  return ({ '+':'+', '-':'−', '*':'×', '/':'÷' }[op]) + val;
}

// ── Porter + Tank – tank på random X, porter ved siden ────
function gateStartVal(isGood) {
  // Grønn port gir nok soldater til å gjøre en forskjell
  const base = Math.max(5, 5 + Math.floor(level * 2.5));
  return isGood ? base : -Math.max(2, Math.floor(base * 0.6));
}

function refreshGateLabel(gate) {
  const val  = gate.currentVal;
  const good = val >= 0;
  const bg   = good ? '#2e7d32' : '#c62828';
  const text = val >= 0 ? `+${val}` : `${val}`;
  const newTex = textTex(text, bg, '#ffffff');
  gate.labelMesh.material.map.dispose();
  gate.labelMesh.material.map = newTex;
  gate.labelMesh.material.needsUpdate = true;
  gate.faceMesh.material.color.setHex(good ? 0x43a047 : 0xe53935);
}

function spawnGates(atZ) {
  // Tank spawner på random posisjon: venstre, midten eller høyre
  const tankPositions = [-2.8, 0, 2.8];
  const tankX = tankPositions[Math.floor(Math.random() * tankPositions.length)];

  // Porter på hver side av tanken (2.6 enheter til siden)
  const gateOffset = 2.6;
  const greenRight = Math.random() < 0.5;
  const sides = [
    { xPos: tankX - gateOffset, isGood: !greenRight },
    { xPos: tankX + gateOffset, isGood:  greenRight },
  ];

  sides.forEach(({ xPos, isGood }) => {
    // Klamp porter innenfor veien (alltid synlig og skytbar)
    const clampedX = Math.max(-(CFG.roadWidth/2 - 1.5), Math.min(CFG.roadWidth/2 - 1.5, xPos));
    const startVal = gateStartVal(isGood);
    const bg       = isGood ? '#2e7d32' : '#c62828';
    const text     = isGood ? `+${startVal}` : `${startVal}`;

    const g = new THREE.Group();

    const faceMat = new THREE.MeshLambertMaterial({
      color: isGood ? 0x43a047 : 0xe53935,
      transparent: true, opacity: 0.85
    });
    const face = new THREE.Mesh(GEO.gate, faceMat);
    face.position.y = 1.3; face.castShadow = true;
    g.add(face);

    const lbl = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 0.7),
      new THREE.MeshBasicMaterial({ map: textTex(text, bg, '#ffffff'), transparent:true, side:THREE.DoubleSide })
    );
    lbl.position.set(0, 1.55, 0.14);
    g.add(lbl);

    [-0.86, 0.86].forEach(dx => {
      const p = new THREE.Mesh(GEO.post, new THREE.MeshLambertMaterial({ color:0x9e9e9e }));
      p.position.set(dx, 1.55, 0);
      g.add(p);
    });

    g.position.set(clampedX, 0, atZ);
    scene.add(g);
    gates.push({
      group: g, faceMesh: face, labelMesh: lbl,
      currentVal: startVal, isGood, xPos: clampedX, passed: false
    });
  });

  // Tank spawner maks 2 ganger per level, og ikke før level 3
  if (level >= 3 && tanksThisLevel < 2) {
    tanksThisLevel++;
    const vhp = Math.round((200 + level * 80) * (0.85 + Math.random()*0.3));
    spawnVehicle(atZ, vhp, tankX);
  }
}

function updateGates(dz) {
  for (let i = gates.length-1; i >= 0; i--) {
    const gate = gates[i];
    gate.group.position.z += dz;

    if (!gate.passed && gate.group.position.z > -1 && gate.group.position.z < 5) {
      if (Math.abs(crowdX - gate.xPos) < 1.6) {
        gate.passed   = true;
        const before  = crowdSize;
        crowdSize     = Math.max(CFG.minCrowd, Math.min(CFG.maxCrowd, crowdSize + gate.currentVal));
        rebuildCrowd();
        updateHUD();
        const txt = gate.currentVal >= 0 ? `+${gate.currentVal}` : `${gate.currentVal}`;
        showFloatingText(txt, crowdSize >= before ? '#69f0ae' : '#ff5252');
        gate.group.scale.setScalar(1.2);
        setTimeout(() => gate.group && gate.group.scale.setScalar(1), 200);
      }
    }

    if (gate.group.position.z > 26) {
      scene.remove(gate.group);
      gates.splice(i, 1);
    }
  }
}

// ── Kjøretøy (fiende-stridsvogn i midten) ─────────────────
const vehicles = [];
const VEHICLE_SPEED = 3.5; // kjører mot spilleren

function createVehicle() {
  const g = new THREE.Group();
  const mk = (geo, col, x=0,y=0,z=0,rx=0,ry=0,rz=0) => {
    const m = new THREE.Mesh(geo, gMat(col));
    m.position.set(x,y,z);
    if(rx||ry||rz) m.rotation.set(rx,ry,rz);
    m.castShadow = true;
    return m;
  };

  // ── Belte-understell (brede belter på sidene) ─────────────
  [-1.4, 1.4].forEach(sx => {
    // Belteramme
    g.add(mk(new THREE.BoxGeometry(0.52, 0.55, 4.2), 0x1a1a1a, sx, 0.42, 0));
    // Belte-mønster (tverrstolper)
    for (let bz = -1.8; bz <= 1.8; bz += 0.36) {
      g.add(mk(new THREE.BoxGeometry(0.56, 0.10, 0.10), 0x2a2a2a, sx, 0.72, bz));
    }
    // Belte-hjul (4 per side)
    [-1.4, -0.47, 0.47, 1.4].forEach(wz => {
      g.add(mk(new THREE.CylinderGeometry(0.28,0.28,0.56,10), 0x1a1a1a, sx, 0.28, wz, 0,0,Math.PI/2));
      g.add(mk(new THREE.CylinderGeometry(0.16,0.16,0.58,8),  0x333333, sx, 0.28, wz, 0,0,Math.PI/2));
    });
    // Drive-sprocket (back)
    g.add(mk(new THREE.CylinderGeometry(0.32,0.32,0.54,8), 0x222222, sx, 0.32, 1.9, 0,0,Math.PI/2));
  });

  // ── Vogn-kropp (hull) ─────────────────────────────────────
  g.add(mk(new THREE.BoxGeometry(2.60, 0.62, 4.0), 0xb71c1c, 0, 0.96, 0));
  // Skråpanser foran
  g.add(mk(new THREE.BoxGeometry(2.62, 0.50, 0.5), 0xb71c1c, 0, 0.78, -2.1, -0.45,0,0));
  // Skråpanser bak
  g.add(mk(new THREE.BoxGeometry(2.62, 0.40, 0.4), 0x9b1818, 0, 0.85,  2.0,  0.35,0,0));
  // Side-panserplater
  [-1.35, 1.35].forEach(sx => {
    g.add(mk(new THREE.BoxGeometry(0.12, 0.34, 3.6), 0x9e1c1c, sx, 1.05, 0));
  });
  // Detalj-riller på hull
  for (let dz = -1.5; dz <= 1.5; dz += 1.0) {
    g.add(mk(new THREE.BoxGeometry(2.64, 0.06, 0.08), 0x8a1515, 0, 1.26, dz));
  }

  // ── Skull-emblem foran ────────────────────────────────────
  g.add(mk(new THREE.BoxGeometry(0.72, 0.60, 0.06), 0x111111,  0, 0.90, -2.05));
  g.add(mk(new THREE.BoxGeometry(0.46, 0.38, 0.06), 0xffffff,  0, 0.92, -2.08)); // hvit skull
  g.add(mk(new THREE.BoxGeometry(0.20, 0.10, 0.06), 0x111111,  0, 0.82, -2.08)); // tenner

  // ── Frontlykter ───────────────────────────────────────────
  [-0.80, 0.80].forEach(x => {
    g.add(mk(new THREE.BoxGeometry(0.38, 0.22, 0.10), 0xffee88, x, 0.85, -2.06));
    g.add(mk(new THREE.BoxGeometry(0.28, 0.14, 0.06), 0xffffff, x, 0.85, -2.09));
  });

  // ── Tårn (turret) ─────────────────────────────────────────
  const turret = new THREE.Group();
  turret.position.set(0, 1.28, 0.3);
  // Tårn-kropp
  turret.add(mk(new THREE.BoxGeometry(2.0, 0.70, 2.2), 0xc62020));
  // Tårn-front (skrå)
  turret.add(mk(new THREE.BoxGeometry(2.02, 0.60, 0.5), 0xc62020, 0, -0.04, -1.2, -0.25,0,0));
  // Tårn-detaljer
  turret.add(mk(new THREE.BoxGeometry(2.04, 0.08, 0.10), 0xa01818, 0, 0.32, 0));
  [-0.80, 0.80].forEach(sx => {
    turret.add(mk(new THREE.BoxGeometry(0.18, 0.30, 0.30), 0x8a1515, sx, 0.22, 0.6));
  });
  // Kommandant-luke
  turret.add(mk(new THREE.CylinderGeometry(0.32,0.34,0.22,10), 0x8a1515, 0, 0.44, 0.3));
  turret.add(mk(new THREE.CylinderGeometry(0.30,0.30,0.08,10), 0x6a1010, 0, 0.56, 0.3));
  // Maskingevær på toppen
  turret.add(mk(new THREE.CylinderGeometry(0.055,0.055,0.80,6), 0x111111, 0.5, 0.50, 0.10, 0,0,Math.PI/2));

  // ── Kanonrør ──────────────────────────────────────────────
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.06, -1.15);
  barrel.add(mk(new THREE.CylinderGeometry(0.14,0.16,2.20,10), 0x222222, 0,0,0, Math.PI/2,0,0));
  barrel.add(mk(new THREE.CylinderGeometry(0.17,0.14,0.30,10), 0x1a1a1a, 0,0,-1.25, Math.PI/2,0,0));
  barrel.add(mk(new THREE.CylinderGeometry(0.10,0.14,0.20,8),  0x111111, 0,0, 0.98, Math.PI/2,0,0));
  turret.add(barrel);
  g.add(turret);
  g.userData.turret = turret;

  return g;
}

function spawnVehicle(atZ, hp, xPos=0) {
  const g  = new THREE.Group();
  const vg = createVehicle();
  g.add(vg);

  const tex = hpTex(hp, hp);
  const lbl = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 0.6),
    new THREE.MeshBasicMaterial({ map:tex, transparent:true, side:THREE.DoubleSide })
  );
  lbl.position.y = 2.6;
  g.add(lbl);

  g.position.set(xPos, 0, atZ);
  scene.add(g);
  vehicles.push({ group:g, hp, maxHp:hp, labelMesh:lbl, alive:true });
}

function updateVehicles(dz, combat) {
  for (let i = vehicles.length-1; i >= 0; i--) {
    const v = vehicles[i];

    if (!combat) {
      // Verden scroller – flytt tanken med
      v.group.position.z += dz;
      // Kjør også fremover mot spilleren
      if (v.group.position.z > -80) {
        v.group.position.z += VEHICLE_SPEED * _dt;
      }
      if (v.group.position.z > -8) v.group.position.z = -8;
    }
    // Under kamp: tanken fryses HELT – ingenting endrer posisjonen

    // Roter turret sakte
    if (v.group.userData.turret) {
      v.group.userData.turret.rotation.y += _dt * 0.5;
    }

    if (v.group.position.z > 30) {
      scene.remove(v.group);
      vehicles.splice(i, 1);
    }
  }
}

function refreshVehicleHP(v) {
  const newTex = hpTex(v.hp, v.maxHp);
  v.labelMesh.material.map.dispose();
  v.labelMesh.material.map = newTex;
  v.labelMesh.material.needsUpdate = true;
}

// ── Fiender ────────────────────────────────────────────────
const enemies = []; // { group, hp, maxHp, labelMesh, alive }

function hpTex(hp, maxHp) {
  const W=320, H=60;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const ctx=c.getContext('2d');
  ctx.fillStyle='rgba(0,0,0,0.6)';
  rrect(ctx,0,0,W,H,10); ctx.fill();
  const pct=Math.max(0,hp/maxHp);
  ctx.fillStyle=pct>0.5?'#43a047':pct>0.25?'#fb8c00':'#e53935';
  rrect(ctx,4,4,(W-8)*pct,H-8,7); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font=`bold ${H*0.5}px Arial`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(String(hp), W/2, H/2);
  return new THREE.CanvasTexture(c);
}

// ── Boss-modell ─────────────────────────────────────────────
function createBoss() {
  const root = new THREE.Group();
  const mk = (geo, col, x=0,y=0,z=0,rx=0,ry=0,rz=0) => {
    const m = new THREE.Mesh(geo, gMat(col));
    m.position.set(x,y,z);
    if(rx||ry||rz) m.rotation.set(rx,ry,rz);
    m.castShadow = true;
    return m;
  };

  // Ben
  const makeLeg = (side) => {
    const g = new THREE.Group();
    g.position.set(side*0.26, 0.6, 0);
    g.add(mk(new THREE.BoxGeometry(0.34,0.40,0.34), 0x111111, 0,-0.20,0)); // lår
    g.add(mk(new THREE.BoxGeometry(0.30,0.36,0.32), 0x0d0d0d, 0,-0.53,0)); // legg
    g.add(mk(new THREE.BoxGeometry(0.16,0.10,0.10), 0xcc1111, 0,-0.30,0.16)); // rød knepad
    g.add(mk(new THREE.BoxGeometry(0.36,0.22,0.40), 0x0a0a0a, 0,-0.76,0.04)); // støvel
    root.add(g);
    return g;
  };
  const legL = makeLeg(-1);
  const legR = makeLeg( 1);

  // Torso – tung panserplate
  root.add(mk(new THREE.BoxGeometry(0.90,0.66,0.48), 0x111111, 0,0.98,0));
  // Rød dødninghode-plate på brystet
  root.add(mk(new THREE.BoxGeometry(0.44,0.30,0.06), 0x0d0d0d, 0,1.04,0.26));
  root.add(mk(new THREE.BoxGeometry(0.26,0.18,0.06), 0xcc1111, 0,1.04,0.30)); // rød emblem
  // Belte med lommer
  root.add(mk(new THREE.BoxGeometry(0.88,0.14,0.40), 0x1a1a1a, 0,0.68,0));
  [-0.28,0,0.28].forEach(x=>root.add(mk(new THREE.BoxGeometry(0.18,0.12,0.08),0x0d0d0d,x,0.68,0.22)));

  // Skulderplater – store bokser
  [-1,1].forEach(s => {
    root.add(mk(new THREE.BoxGeometry(0.28,0.22,0.42), 0x0d0d0d, s*0.62,1.18,0));
    root.add(mk(new THREE.BoxGeometry(0.22,0.10,0.38), 0x111111, s*0.64,1.04,0));
    // Rød detalj på skulder
    root.add(mk(new THREE.BoxGeometry(0.12,0.08,0.14), 0xcc1111, s*0.62,1.22,0));
  });

  // Armer
  [-1,1].forEach(s => {
    root.add(mk(new THREE.BoxGeometry(0.22,0.36,0.22), 0x111111, s*0.60,0.88,0));
    root.add(mk(new THREE.BoxGeometry(0.20,0.32,0.20), 0x0d0d0d, s*0.60,0.56,0));
    root.add(mk(new THREE.SphereGeometry(0.14,7,6),    0x0a0a0a, s*0.60,0.38,0)); // hanske
  });

  // Tungt maskingevær (venstre arm)
  const gun = new THREE.Group();
  gun.position.set(-0.55, 0.72, -0.26);
  gun.rotation.x = 0.15;
  gun.add(mk(new THREE.BoxGeometry(0.14,0.14,0.80), 0x1a1a1a));
  gun.add(mk(new THREE.BoxGeometry(0.10,0.10,0.34), 0x111111, 0, 0, -0.54)); // løp
  gun.add(mk(new THREE.BoxGeometry(0.08,0.20,0.08), 0x222222, 0,-0.14, 0.10)); // magasin
  gun.add(mk(new THREE.CylinderGeometry(0.04,0.04,0.28,6), 0x0d0d0d, -0.10,0.08,0, 0,0,Math.PI/2)); // hank
  root.add(gun);

  // Ryggsekk / radio
  root.add(mk(new THREE.BoxGeometry(0.34,0.44,0.14), 0x111111, 0,1.00,-0.30));
  root.add(mk(new THREE.BoxGeometry(0.08,0.08,0.04), 0x1a1a1a, 0.10,1.34,-0.30));
  // Antenne
  root.add(mk(new THREE.CylinderGeometry(0.02,0.02,0.52,5), 0x222222, 0.12,1.66,-0.28));

  // Hode
  const head = new THREE.Group();
  head.position.set(0,1.58,0);
  head.add(mk(new THREE.SphereGeometry(0.32,9,7), 0xffcc80)); // ansikt
  // Øyne
  [-0.10,0.10].forEach(ex=>head.add(mk(new THREE.BoxGeometry(0.08,0.11,0.04),0x080808,ex,-0.02,0.30)));
  // Stor hjelm
  head.add(mk(new THREE.SphereGeometry(0.40,10,8,0,Math.PI*2,0,Math.PI*0.62), 0x0d0d0d, 0,0.06,0));
  head.add(mk(new THREE.CylinderGeometry(0.42,0.42,0.06,10), 0x0d0d0d, 0,-0.10,0)); // kant
  // Rødt hode-emblem
  head.add(mk(new THREE.BoxGeometry(0.22,0.18,0.04), 0x0d0d0d, 0, 0.04,0.38));
  head.add(mk(new THREE.BoxGeometry(0.14,0.11,0.04), 0xcc1111, 0, 0.04,0.41)); // rød skull
  // Sidepaneler på hjelm
  [-1,1].forEach(s=>head.add(mk(new THREE.BoxGeometry(0.06,0.14,0.16),0x111111,s*0.39,0.04,0.08)));
  root.add(head);

  root.userData.legL = legL;
  root.userData.legR = legR;
  return root;
}

function spawnEnemy(atZ, hp, count) {
  // Tett rutenett-formasjon
  const cols = Math.min(count, Math.ceil(Math.sqrt(count) * 1.4));
  const rows = Math.ceil(count / cols);
  const spacingX = 1.6, spacingZ = 1.8;

  // Tilfeldig X-offset for hele gruppa
  const offsets = [-3, -1.5, 0, 1.5, 3];
  const groupX  = offsets[Math.floor(Math.random() * offsets.length)];

  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const fig = createSoldier(0xc62828);
    fig.position.set(
      (col - (cols - 1) / 2) * spacingX,
      0,
      (row - (rows - 1) / 2) * spacingZ
    );
    g.add(fig);
  }

  const tex = hpTex(hp, hp);
  const lbl = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 0.82),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
  );
  lbl.position.y = 3.2;
  g.add(lbl);

  g.position.set(groupX, 0, atZ);
  scene.add(g);
  enemies.push({ group: g, hp, maxHp: hp, labelMesh: lbl, isBoss: false, alive: true });
}

// Dobbel bølge: to separate grupper på flankene
function spawnDoubleWave(atZ, hp, count) {
  const half = Math.ceil(count / 2);
  spawnEnemy(atZ,      Math.round(hp * 0.9), half);
  spawnEnemy(atZ - 10, Math.round(hp * 0.9), count - half);
}

// ── Spawn boss for gjeldende level ─────────────────────────
function spawnBoss(atZ, hp) {
  const g = new THREE.Group();
  const bossFig = createBoss();

  // Boss skaleres opp basert på level – blir større og større
  const bossScale = 1.8 + Math.min(level * 0.15, 1.2);
  bossFig.scale.setScalar(bossScale);
  g.add(bossFig);

  const tex = hpTex(hp, hp);
  const lbl = new THREE.Mesh(
    new THREE.PlaneGeometry(7.0, 1.2),
    new THREE.MeshBasicMaterial({ map:tex, transparent:true, side:THREE.DoubleSide })
  );
  lbl.position.y = 5.5 + bossScale * 0.8;
  g.add(lbl);

  // Stor rød puls-ring under bossen
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.8, 0.28, 8, 32),
    new THREE.MeshLambertMaterial({ color:0xcc1111 })
  );
  ring.rotation.x = Math.PI/2; ring.position.y = 0.12;
  g.add(ring);

  // Ekstra ytre ring
  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(4.2, 0.14, 6, 24),
    new THREE.MeshLambertMaterial({ color:0xff3333 })
  );
  ring2.rotation.x = Math.PI/2; ring2.position.y = 0.12;
  g.add(ring2);

  g.position.set(0, 0, atZ);
  g.userData.bossRing = ring;
  g.userData.bossRing2 = ring2;
  scene.add(g);
  enemies.push({ group:g, hp, maxHp:hp, labelMesh:lbl, isBoss:true, alive:true });
}

// Nærmeste fiende (høyest Z = nærmest crowd)
function closestEnemy() {
  if (!enemies.length) return null;
  return enemies.reduce((a,b) => a.group.position.z > b.group.position.z ? a : b);
}

// Er vi i kamp? (fiende innen kampsonen)
function inCombat() {
  return enemies.some(en => en.group.position.z > -10)
      || vehicles.some(v => v.group.position.z > -20);
}

function updateEnemies(dz) {
  for (let i = enemies.length-1; i >= 0; i--) {
    const en = enemies[i];
    en.group.position.z += dz;

    // Fienden marsjerer alltid mot crowd når den er i nærheten
    if (en.group.position.z > -40) {
      en.group.position.z += CFG.enemyWalkSpeed * _dt;
    }

    // Stopp fienden på frontlinjen
    if (en.group.position.z > -6) en.group.position.z = -6;

    if (en.group.position.z > 30) {
      scene.remove(en.group);
      enemies.splice(i, 1);
    }
  }
}

function refreshEnemyHP(en) {
  const newTex = hpTex(en.hp, en.maxHp);
  en.labelMesh.material.map.dispose();
  en.labelMesh.material.map = newTex;
  en.labelMesh.material.needsUpdate = true;
}

// ── Skudd – object pool ────────────────────────────────────
const POOL_SIZE   = 120;
const bulletPool  = [];   // gjenbrukbare meshes
const activePBullets = []; // { mesh, vx, vz, life }
const activeEBullets = [];

// Muzzle flash meshes (én per soldat, maks 10 synlige)
const flashGeo = new THREE.SphereGeometry(0.12, 5, 4);
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffdd00 });
const flashes  = [];
for (let i = 0; i < 10; i++) {
  const f = new THREE.Mesh(flashGeo, flashMat);
  f.visible = false;
  scene.add(f);
  flashes.push({ mesh: f, timer: 0 });
}
let flashIdx = 0;

// Lag bullet pool
const pbGeo = new THREE.BoxGeometry(0.06, 0.06, 0.28); // tracer: avlang
const pbMat = new THREE.MeshBasicMaterial({ color: 0xffe566 });
const ebGeo = new THREE.SphereGeometry(0.10, 5, 4);
const ebMat = new THREE.MeshBasicMaterial({ color: 0xff4422 });
for (let i = 0; i < POOL_SIZE; i++) {
  const m = new THREE.Mesh(pbGeo, pbMat);
  m.visible = false;
  scene.add(m);
  bulletPool.push(m);
}

function getBulletMesh() {
  const m = bulletPool.find(b => !b.visible);
  return m || null; // null hvis pool er full
}

function spawnMuzzleFlash(wx, wy, wz) {
  const f = flashes[flashIdx % flashes.length];
  flashIdx++;
  f.mesh.position.set(wx, wy, wz - 0.1);
  f.mesh.visible  = true;
  f.mesh.scale.setScalar(0.6 + Math.random()*0.8);
  f.timer = 0.06; // sekunder den er synlig
}

function shootPlayerBullets() {
  // Finn nærmeste mål: fiende eller kjøretøy
  const allTargets = [
    ...enemies.map(e => ({ z: e.group.position.z })),
    ...vehicles.map(v => ({ z: v.group.position.z })),
  ];
  if (!allTargets.length) return;
  const nearestZ = allTargets.reduce((a,b) => a.z > b.z ? a : b).z;
  if (nearestZ < -45) return;

  // Skyt fra opptil 8 soldater – fra geværmunningen i world-space
  const shooters = Math.min(crowdFigs.length, Math.min(crowdSize, 8));
  for (let i = 0; i < shooters; i++) {
    const fig = crowdFigs[i];
    if (!fig) continue;
    // Geværmunningen er ca (0.19, 0.35, -0.28) etter soldierScale=0.62
    // crowdGroup.position.z = 8 må legges til for riktig world-Z
    const wx = crowdX + fig.position.x + 0.19;
    const wy = 0.35;
    const wz = crowdGroup.position.z + fig.position.z - 0.28;

    // Hent fra pool
    const m = getBulletMesh();
    if (!m) continue;
    m.position.set(wx, wy, wz);
    m.visible = true;
    // Liten spredning horisontalt
    const spread = (Math.random()-0.5) * 0.04;
    activePBullets.push({ mesh: m, vx: spread, life: 3.0 });

    // Munningsflamme
    spawnMuzzleFlash(wx, wy, wz);
  }
}

function shootEnemyBullets(en) {
  const numShooters = Math.min(3, Math.max(1, Math.ceil(en.hp / en.maxHp * 3)));
  for (let i = 0; i < numShooters; i++) {
    const spread = (Math.random()-0.5) * 5.0; // bred spredning = lettere å unngå
    const m = new THREE.Mesh(ebGeo, ebMat);
    m.position.set(en.group.position.x + spread, 0.8, en.group.position.z);
    scene.add(m);
    activeEBullets.push({ mesh: m, vx: spread * 0.15, life: 3.0 });
  }
}

function updateBullets(dt) {
  const pSpeed = CFG.bulletSpeed;
  const eSpeed = CFG.enemyBulletSpeed;

  // Spillerskudd
  for (let i = activePBullets.length-1; i >= 0; i--) {
    const b = activePBullets[i];
    b.life -= dt;
    b.mesh.position.z -= pSpeed * dt;
    b.mesh.position.x += b.vx;

    // Treff gate?
    let hit = false;
    for (const gate of gates) {
      if (gate.passed) continue;
      const gz = b.mesh.position.z - gate.group.position.z;
      const gx = b.mesh.position.x - gate.xPos;
      if (Math.abs(gz) < 1.8 && Math.abs(gx) < 1.6) {
        gate.currentVal += 1;
        refreshGateLabel(gate);
        hit = true; break;
      }
    }

    if (!hit) {
      // Treff kjøretøy?
      for (const v of vehicles) {
        if (!v.alive) continue;
        const vz = b.mesh.position.z - v.group.position.z;
        const vx = b.mesh.position.x - v.group.position.x;
        if (Math.abs(vz) < 3.0 && Math.abs(vx) < 1.8) {
          v.hp -= currentWeapon().damage;
          hit = true;
          refreshVehicleHP(v);
          if (v.hp <= 0) {
            v.alive = false;
            awardVehicleCoins(v);
            scene.remove(v.group);
            const idx = vehicles.indexOf(v);
            if (idx !== -1) vehicles.splice(idx, 1);
            upgradeWeapon();
          }
          break;
        }
      }
    }

    if (!hit) {
      // Treff fiende?
      for (const en of enemies) {
        if (!en.alive) continue;
        const dz = b.mesh.position.z - en.group.position.z;
        const dx = b.mesh.position.x - en.group.position.x;
        if (Math.abs(dz) < 2.8 && Math.abs(dx) < 3.2) {
          en.hp -= currentWeapon().damage;
          hit = true;
          refreshEnemyHP(en);
          if (en.hp <= 0) {
            en.alive = false;
            awardCoins(en);
            scene.remove(en.group);
            const idx = enemies.indexOf(en);
            if (idx !== -1) enemies.splice(idx, 1);
            if (en.isBoss) {
              setTimeout(nextLevel, 600);
            }
            updateHUD();
          }
          break;
        }
      }
    }

    if (hit || b.life <= 0 || b.mesh.position.z < -100) {
      b.mesh.visible = false;
      activePBullets.splice(i, 1);
    }
  }

  // Fiendeskudd
  for (let i = activeEBullets.length-1; i >= 0; i--) {
    const b = activeEBullets[i];
    b.life -= dt;
    b.mesh.position.z += eSpeed * dt;
    b.mesh.position.x += b.vx * dt * 2;

    const dz = b.mesh.position.z;
    const dx = b.mesh.position.x - crowdX;
    if (Math.abs(dz) < 2.5 && Math.abs(dx) < CFG.crowdSpread + 0.5) {
      crowdSize = Math.max(0, crowdSize - 1);
      rebuildCrowd();
      updateHUD();
      scene.remove(b.mesh);
      activeEBullets.splice(i, 1);
      if (crowdSize <= 0) { setTimeout(triggerGameOver, 500); return; }
      continue;
    }

    if (b.life <= 0 || b.mesh.position.z > 28) {
      scene.remove(b.mesh);
      activeEBullets.splice(i, 1);
    }
  }

  // Oppdater munningsflamme-timere
  flashes.forEach(f => {
    if (!f.mesh.visible) return;
    f.timer -= dt;
    if (f.timer <= 0) f.mesh.visible = false;
  });
}

// ── Flytende tekst (port-feedback) ────────────────────────
const floaters = [];
function showFloatingText(text, color) {
  const div = document.createElement('div');
  div.style.cssText = `
    position:fixed; left:50%; top:35%; transform:translateX(-50%);
    font:bold 42px Arial; color:${color}; text-shadow:0 2px 8px rgba(0,0,0,0.5);
    pointer-events:none; z-index:50; transition:opacity 0.8s,transform 0.8s;
  `;
  div.textContent = text;
  document.body.appendChild(div);
  requestAnimationFrame(() => {
    div.style.opacity = '0';
    div.style.transform = 'translateX(-50%) translateY(-40px)';
  });
  setTimeout(() => div.remove(), 900);
}

// ── Penge-animasjon ───────────────────────────────────────
function spawnCoinAnim(worldX, worldZ, amount) {
  // Konverter 3D-posisjon til skjerm-koordinater
  const vec = new THREE.Vector3(worldX, 2.0, worldZ);
  vec.project(camera);
  const sx = (vec.x *  0.5 + 0.5) * window.innerWidth;
  const sy = (vec.y * -0.5 + 0.5) * window.innerHeight;

  const el = document.createElement('div');
  el.className   = 'coin-anim';
  el.textContent = `+${amount}🪙`;
  el.style.left  = sx + 'px';
  el.style.top   = sy + 'px';
  document.body.appendChild(el);

  // Hent posisjon til mynt-telleren
  const coinEl = document.getElementById('coin-display');
  const rect   = coinEl ? coinEl.getBoundingClientRect() : { left: window.innerWidth/2, top: 20, width: 60, height: 24 };
  const tx = rect.left + rect.width / 2;
  const ty = rect.top  + rect.height / 2;

  requestAnimationFrame(() => {
    el.style.left      = tx + 'px';
    el.style.top       = ty + 'px';
    el.style.opacity   = '0';
    el.style.transform = 'translate(-50%,-50%) scale(0.4)';
  });

  setTimeout(() => {
    el.remove();
    coins += amount;
    savePersist();
    updateCoinDisplay(true);
  }, 680);
}

function awardCoins(en) {
  const base   = en.isBoss ? Math.max(30, Math.round(en.maxHp * 0.6))
                           : Math.max(8,  Math.round(en.maxHp * 0.4));
  spawnCoinAnim(en.group.position.x, en.group.position.z, base);
}

function awardVehicleCoins(v) {
  const reward = Math.max(25, Math.round(v.maxHp * 0.2));
  spawnCoinAnim(v.group.position.x, v.group.position.z, reward);
}

function updateCoinDisplay(animate) {
  const el = document.getElementById('coin-count');
  const el2 = document.getElementById('shop-coin-count');
  if (el)  el.textContent  = coins;
  if (el2) el2.textContent = coins;
  if (animate && el) {
    el.style.transform = 'scale(1.4)';
    setTimeout(() => { el.style.transform = ''; }, 200);
  }
}

// ── Bombe ─────────────────────────────────────────────────
function useBomb() {
  if (bombCount <= 0 || state !== 'playing') return;
  bombCount--;
  savePersist();
  updateBombBtn();

  // Skade alle fiender på skjermen
  for (let i = enemies.length - 1; i >= 0; i--) {
    const en = enemies[i];
    en.hp -= BOMB_DAMAGE;
    if (en.hp <= 0) {
      en.alive = false;
      awardCoins(en);
      scene.remove(en.group);
      enemies.splice(i, 1);
      if (en.isBoss) setTimeout(nextLevel, 600);
    } else {
      refreshEnemyHP(en);
    }
  }
  updateHUD();
  triggerSkyExplosion();
  triggerSkyExplosion();
  showFloatingText('💥 BOMBE!', '#ff6600');
}

function updateBombBtn() {
  const btn = document.getElementById('bomb-btn');
  const cnt = document.getElementById('bomb-count');
  if (!btn) return;
  if (bombCount > 0 && state === 'playing') {
    btn.classList.remove('hidden');
    cnt.textContent = bombCount;
  } else {
    btn.classList.add('hidden');
  }
}

// ── Spawn-system ───────────────────────────────────────────
function checkSpawns(dz) {
  travelZ += dz;
  const lp = levelParams;

  if (travelZ - lastGateTravel >= lp.gateInterval) {
    lastGateTravel += lp.gateInterval;
    spawnGates(-80);
  }

  if (travelZ - lastEnemyTravel >= lp.enemyInterval) {
    lastEnemyTravel += lp.enemyInterval;

    if (!bossSpawnedThisLevel && wavesSpawnedInLevel >= lp.wavesBeforeBoss) {
      bossSpawnedThisLevel = true;
      spawnBoss(-90, lp.bossHP);
    } else if (!bossSpawnedThisLevel) {
      wavesSpawnedInLevel++;
      // Varier bølge-type: dobbel-bølge hvert 3. wave, ellers tilfeldig formasjon
      if (wavesSpawnedInLevel % 3 === 0) {
        spawnDoubleWave(-90, lp.enemyHP, lp.enemyCount);
      } else {
        spawnEnemy(-90, lp.enemyHP, lp.enemyCount);
      }
    }
  }

  // Kontinuerlig spawn av miljø-objekter på alle levels
  if (travelZ - lastPropTravel >= PROP_INTERVAL) {
    lastPropTravel += PROP_INTERVAL;
    spawnPropGroup(-90);
  }
}

// Går opp ett level og starter det neste
function nextLevel() {
  level++;
  levelParams           = getLevelParams(level);
  speed                 = levelParams.worldSpeed;
  wavesSpawnedInLevel   = 0;
  bossSpawnedThisLevel  = false;
  tanksThisLevel        = 0;
  lastEnemyTravel       = travelZ;
  showFloatingText(`LEVEL ${level}`, '#ffee58');
  updateHUD();
}

// ── Input ──────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => { keys[e.key]=true; });
window.addEventListener('keyup',   e => { keys[e.key]=false; });

let ptrDown=false, ptrPrevX=0;
canvas.addEventListener('pointerdown', e => { ptrDown=true; ptrPrevX=e.clientX; });
window.addEventListener('pointermove', e => {
  if (!ptrDown || state!=='playing') return;
  const dx = e.clientX - ptrPrevX;
  ptrPrevX = e.clientX;
  targetX  = clampX(targetX + dx / (window.innerWidth/CFG.roadWidth) * 2.2);
});
window.addEventListener('pointerup', () => { ptrDown=false; });

function clampX(x) {
  return Math.max(-(CFG.roadWidth/2-1.1), Math.min(CFG.roadWidth/2-1.1, x));
}

// ── HUD ────────────────────────────────────────────────────
function updateHUD() {
  document.getElementById('level-label').textContent = `Level ${level}`;

  // Progress: bølger ferdig / totalt (bølger + boss)
  const lp = levelParams;
  const total = (lp ? lp.wavesBeforeBoss : 2) + 1; // +1 for boss
  const done  = bossSpawnedThisLevel ? total : wavesSpawnedInLevel;
  const pct   = Math.round(Math.min(done / total, 1) * 100);
  document.getElementById('progress-bar-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';

  updateCoinDisplay(false);
  updateBombBtn();
}

// ── Butikk-logikk ─────────────────────────────────────────
function openShop(fromScreen) {
  document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
  document.getElementById('shop-screen').classList.remove('hidden');
  refreshShopUI();
}

function closeShop() {
  document.getElementById('shop-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
}

function refreshShopUI() {
  updateCoinDisplay(false);

  // Soldat-oppgradering
  const nextLevel = startSoldiersLevel + 1;
  const buySolBtn = document.getElementById('buy-soldiers-btn');
  const solDesc   = document.getElementById('soldiers-desc');
  const solCost   = document.getElementById('soldiers-cost');

  if (nextLevel >= SOLDIER_UPGRADES.length) {
    // Maks nivå
    solDesc.textContent = `Maks! Starter med ${SOLDIER_UPGRADES[startSoldiersLevel].soldiers} soldater`;
    buySolBtn.disabled  = true;
    buySolBtn.innerHTML = 'MAKS';
  } else {
    const up = SOLDIER_UPGRADES[nextLevel];
    solDesc.textContent = `Starter med ${SOLDIER_UPGRADES[startSoldiersLevel].soldiers} → ${up.soldiers} soldater`;
    solCost.textContent = up.cost;
    buySolBtn.disabled  = coins < up.cost;
  }

  // Bombe
  const buyBombBtn = document.getElementById('buy-bomb-btn');
  document.getElementById('bomb-desc').textContent = `Du har ${bombCount} bombe${bombCount !== 1 ? 'r' : ''}`;
  buyBombBtn.disabled = coins < BOMB_COST;
}

document.getElementById('shop-open-btn').addEventListener('click', openShop);
document.getElementById('shop-close-btn').addEventListener('click', closeShop);
document.getElementById('gameover-shop-btn').addEventListener('click', openShop);
document.getElementById('victory-shop-btn').addEventListener('click', openShop);

document.getElementById('buy-soldiers-btn').addEventListener('click', () => {
  const nextLvl = startSoldiersLevel + 1;
  if (nextLvl >= SOLDIER_UPGRADES.length) return;
  const cost = SOLDIER_UPGRADES[nextLvl].cost;
  if (coins < cost) return;
  coins -= cost;
  startSoldiersLevel = nextLvl;
  savePersist();
  refreshShopUI();
});

document.getElementById('buy-bomb-btn').addEventListener('click', () => {
  if (coins < BOMB_COST) return;
  coins -= BOMB_COST;
  bombCount++;
  savePersist();
  refreshShopUI();
});

document.getElementById('bomb-btn').addEventListener('click', useBomb);

// ── Start / restart ────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);
document.getElementById('victory-restart-btn').addEventListener('click', startGame);

function startGame() {
  gates.forEach(g => scene.remove(g.group));         gates.length=0;
  enemies.forEach(e => scene.remove(e.group));       enemies.length=0;
  activePBullets.forEach(b => { b.mesh.visible=false; }); activePBullets.length=0;
  activeEBullets.forEach(b => scene.remove(b.mesh));      activeEBullets.length=0;
  flashes.forEach(f => { f.mesh.visible=false; f.timer=0; });
  bulletPool.forEach(m => { m.visible=false; });

  weaponTier = 0;
  vehicles.forEach(v => scene.remove(v.group)); vehicles.length=0;
  crowdSize = SOLDIER_UPGRADES[startSoldiersLevel].soldiers;
  level=1; levelParams=getLevelParams(1);
  speed=levelParams.worldSpeed;
  wavesSpawnedInLevel=0; bossSpawnedThisLevel=false; tanksThisLevel=0;
  crowdX=0; targetX=0; travelZ=0;
  lastGateTravel=0; lastEnemyTravel=0; lastPropTravel=0;
  shootTimer=0; enemyShootTimer=0;

  roadSegs.forEach((s,i) => s.position.set(0,0,-i*SEG));
  rebuildCrowd();
  updateHUD();

  // Forhåndsspawn første gate og første fiendebølge
  spawnGates(-80);
  spawnEnemy(-90, levelParams.enemyHP, levelParams.enemyCount);
  wavesSpawnedInLevel = 1;

  ['start-screen','gameover-screen','victory-screen','shop-screen'].forEach(id =>
    document.getElementById(id).classList.add('hidden'));

  state='playing';
  updateBombBtn();
  updateCoinDisplay(false);
}

function triggerGameOver() {
  if (state==='dead') return;
  state='dead';
  updateBombBtn();
  if (level > highScore) highScore = level;
  document.getElementById('final-score').textContent        = `Du kom til Level ${level}`;
  document.getElementById('high-score-display').textContent = `Rekord: Level ${highScore}`;
  document.getElementById('gameover-coins').textContent     = `🪙 ${coins} mynter totalt`;
  updateCoinDisplay(false);
  document.getElementById('gameover-screen').classList.remove('hidden');
}

function triggerVictory() {
  if (state==='victory') return;
  state='victory';
  updateBombBtn();
  if (level > highScore) highScore = level;
  document.getElementById('victory-score').textContent  = `Level ${level} klart! Mengde: ${crowdSize}`;
  document.getElementById('victory-coins').textContent  = `🪙 ${coins} mynter totalt`;
  updateCoinDisplay(false);
  document.getElementById('victory-screen').classList.remove('hidden');
}

// ── Bein-animasjon ─────────────────────────────────────────
let legPhase = 0;
function animateCrowd(dt) {
  legPhase += dt*9;
  crowdFigs.forEach((fig,i) => {
    const { legL, legR } = fig.userData;
    if (!legL) return;
    const sw = Math.sin(legPhase + i*0.5) * 0.4;
    legL.rotation.x =  sw;
    legR.rotation.x = -sw;
    fig.position.y = Math.abs(Math.sin(legPhase+i)) * 0.07;
  });
  // Fiender vaier litt
  enemies.forEach((en,i) => {
    en.group.rotation.y = Math.sin(legPhase*0.4+i)*0.06;
  });
}

// ── Game loop ──────────────────────────────────────────────
let lastTS = null;
let _dt    = 0.016; // global dt for bruk i updateEnemies

function loop(ts) {
  requestAnimationFrame(loop);
  _dt = lastTS ? Math.min((ts-lastTS)/1000, 0.05) : 0.016;
  lastTS = ts;
  const dt = _dt;

  if (state==='playing') {
    // Tastatur
    if (keys['ArrowLeft'] ||keys['a']||keys['A']) targetX=clampX(targetX-CFG.keySpeed*dt);
    if (keys['ArrowRight']||keys['d']||keys['D']) targetX=clampX(targetX+CFG.keySpeed*dt);

    crowdX += (targetX-crowdX)*Math.min(1, dt*14);
    crowdGroup.position.x = crowdX;

    // Sjekk om vi er i kamp
    const combat = inCombat();
    const front  = closestEnemy();

    // Verden stopper HELT under kamp – fienden går selv, ikke presset bakover
    const dz = combat ? 0 : speed * dt;

    updateRoad(dz);
    updateProps(dz);
    updateGates(dz);
    updateVehicles(dz, combat);
    updateEnemies(combat ? 0 : dz);
    if (!combat) checkSpawns(dz);

    // Auto-skyting – bruk currentWeapon().interval, skyt på fiender OG kjøretøy
    shootTimer += dt;
    const wInterval = currentWeapon().interval;
    if (shootTimer >= wInterval && (enemies.length > 0 || vehicles.length > 0)) {
      shootTimer = 0;
      shootPlayerBullets();
    }

    // Fiende skyter tilbake
    if (front && front.group.position.z > -35) {
      enemyShootTimer += dt;
      if (enemyShootTimer >= CFG.enemyShootInterval) {
        enemyShootTimer = 0;
        shootEnemyBullets(front);
      }
    }

    updateBullets(dt);
    animateCrowd(dt);
    updateSky(dt);

    // Animer boss-ringer (pulserer og roterer)
    enemies.forEach(en => {
      if (!en.isBoss) return;
      const r1 = en.group.userData.bossRing;
      const r2 = en.group.userData.bossRing2;
      if (r1) { r1.rotation.z += dt * 1.2; r1.scale.setScalar(1 + Math.sin(Date.now()*0.004)*0.08); }
      if (r2) { r2.rotation.z -= dt * 0.7; }
    });
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(loop);
