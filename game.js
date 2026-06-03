// ============================================================
//  CROWD RUNNER – Shoot & Multiply
//  Crowd løper fremover, skyter automatisk på fiender.
//  Grønne porter = flere folk, røde = færre folk.
//  Verden ruller mot kamera, crowd er statisk i Z.
// ============================================================

// ── Verdensfart (juster denne for å endre tempo) ───────────
const WORLD_SPEED = 11; // enheter per sekund – øker svakt per bølge

const CFG = {
  startCrowd:     10,
  runSpeed:       WORLD_SPEED,
  speedIncrement: 0.15,
  roadWidth:      14,
  laneWidth:      2.6,
  crowdSpread:    3.2,
  soldierScale:   0.62,
  gateInterval:   35,
  enemyInterval:  45,
  bossEveryN:      5,
  baseEnemyHP:    20,
  enemyHPScale:   1.4,
  bossMultiplier:  3,
  enemySpread:    3.5,
  maxEnemyCount:  20,
  keySpeed:        9,
  minCrowd:        1,
  maxCrowd:       999,
  winAtWave:      20,
  bulletSpeed:    26,
  shootInterval:  0.18,
  bulletDmg:       1,
  enemyShootInterval: 0.5,
  enemyBulletSpeed:   14,
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
let shootTimer      = 0;
let enemyShootTimer = 0;

// ── Våpen-tiers ────────────────────────────────────────────
const WEAPON_TIERS = [
  { damage:1, interval:0.18, color:0xffee58, name:'Pistol'       },
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
  const rnd = () => Math.random() * 0.4 - 0.2; // ±20% variasjon
  return {
    worldSpeed:      Math.min(11 + n * 0.8 + rnd(), 20),
    wavesBeforeBoss: Math.max(1, 1 + Math.floor(n * 0.4)),
    enemyHP:         Math.round((15 + n * 8) * (1 + rnd())),
    enemyCount:      Math.min(5 + Math.floor(n * 1.2), CFG.maxEnemyCount),
    bossHP:          Math.round((60 + n * 30) * (1 + rnd())),
    gateInterval:    Math.max(20, 35 - n * 0.6),
    enemyInterval:   Math.max(30, 45 - n * 1.2),
  };
}

// ── Three.js ───────────────────────────────────────────────
const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd4b896);
scene.fog        = new THREE.Fog(0xc8a97a, 30, 85);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 150);
camera.position.set(0, 14, 22);
camera.lookAt(0, 0, -6);

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

scene.add(new THREE.AmbientLight(0xfff0d0, 0.75));
const sun = new THREE.DirectionalLight(0xffd580, 1.1);
sun.position.set(15, 25, 8);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left:-22, right:22, top:22, bottom:-22, near:0.5, far:80 });
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

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

// ── Soldat-fabrikk – chibi cartoon-militær stil ────────────
// teamColor: aksentfarge som skiller lagene (blå vs rød).
function createSoldier(teamColor) {
  const isEnemy = (teamColor === 0xc62828);

  // Fargepalett
  const C = isEnemy ? {
    helmet:   0x111111,           // nesten svart hjelm
    uniform:  0x8b1515,           // mørkerød uniform
    vest:     0x0d0d0d,           // svart taktisk vest
    pants:    0x7a1212,           // mørkerød bukse
    boot:     0x0a0a0a,           // svart støvel
    glove:    0x080808,           // svart hanske
    accent:   0xcc1111,           // knallrød aksent (brystplate, knepad)
    pouch:    0x1a1a1a,           // svarte lommer
    kneepad:  0x0d0d0d,           // svart knepad
    eyeCol:   0x050505, skin:     0xffcc80,
  } : {
    helmet:   0x4a5e2a, uniform:  0x556b2f, vest:     0x6b5a3a,
    pants:    0x4a5e2a, boot:     0x7a5c38, glove:    0x1a1a1a,
    accent:   teamColor,          pouch:    0x4a3a22, kneepad:  0x3d3020,
    eyeCol:   0x111111, skin:     0xffcc80,
  };

  const root = new THREE.Group();

  // Hjelpefunksjon
  const mk = (geo, col, x=0, y=0, z=0, rx=0, ry=0, rz=0) => {
    const m = new THREE.Mesh(geo, gMat(col));
    m.position.set(x,y,z);
    if (rx||ry||rz) m.rotation.set(rx,ry,rz);
    m.castShadow = true;
    return m;
  };

  // ── BEN – grupper med hofte-pivot for bensving ─────────────
  const makeLeg = (side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.14, 0.44, 0);

    // Lår
    const thigh = mk(CGEO.thigh, C.pants, 0, -0.13, 0);
    g.add(thigh);
    // Kneskinn
    const kp = mk(CGEO.kneePad, C.kneepad, 0, -0.26, 0.1);
    g.add(kp);
    // Legg
    const shin = mk(CGEO.shin, C.pants, 0, -0.36, 0);
    g.add(shin);
    // Støvel
    const boot = mk(CGEO.boot, C.boot, 0, -0.52, 0.025);
    g.add(boot);

    root.add(g);
    return g;
  };
  const legL = makeLeg(-1);
  const legR = makeLeg( 1);

  // ── TORSO / VEST ───────────────────────────────────────────
  root.add(mk(CGEO.vest, C.vest, 0, 0.68, 0));

  // Brystplate (lagsfarge-aksent)
  root.add(mk(CGEO.chestPlate, C.accent, 0, 0.74, 0.16));

  // Lommer/pouches på vest
  [[-0.16,0.60,0.16],[0.16,0.60,0.16],[0,0.52,0.16]].forEach(([x,y,z]) =>
    root.add(mk(CGEO.pouch, C.pouch, x, y, z))
  );

  // Ryggsekk
  root.add(mk(CGEO.pack,    C.vest,  0, 0.70, -0.20));
  root.add(mk(CGEO.packFlap,C.pouch, 0, 0.84, -0.25));

  // ── ARMER ──────────────────────────────────────────────────
  [-1,1].forEach(side => {
    const xOff = side * 0.31;
    root.add(mk(CGEO.shoulder, C.uniform, xOff, 0.86, 0));
    const ua = mk(CGEO.upperArm, C.uniform, xOff, 0.70, 0);
    root.add(ua);
    root.add(mk(CGEO.foreArm, C.uniform, xOff, 0.54, 0));
    root.add(mk(CGEO.glove,   C.glove,   xOff, 0.42, 0));
  });

  // ── GEVÆR (holdt av høyre arm, peker fremover/-Z) ──────────
  const rifle = new THREE.Group();
  rifle.position.set(0.30, 0.54, -0.08);
  rifle.rotation.set(0.18, 0, 0);
  rifle.add(mk(CGEO.rifleBody,   0x1a1a1a));
  rifle.add(mk(CGEO.rifleStock,  0x2a2018,  0,  0.01,  0.30));
  rifle.add(mk(CGEO.rifleMag,    0x222222,  0, -0.10,  0.05));
  rifle.add(mk(CGEO.rifleBarrel, 0x111111,  0,  0.015,-0.34));
  rifle.add(mk(CGEO.rifleScope,  0x333333,  0,  0.07, -0.08));
  root.add(rifle);

  // ── HODE ───────────────────────────────────────────────────
  const headGrp = new THREE.Group();
  headGrp.position.set(0, 1.12, 0);

  headGrp.add(mk(CGEO.head, C.skin));

  // Øyne (to svarte ovaler på fronten)
  [-0.095, 0.095].forEach(ex => {
    headGrp.add(mk(CGEO.eye, C.eyeCol, ex, -0.02, 0.26));
  });

  // ── HJELM ──────────────────────────────────────────────────
  // Stor kuppel
  const dome = mk(CGEO.helmetDome, C.helmet, 0, 0.04, 0);
  headGrp.add(dome);
  // Hjelmkant (brim)
  headGrp.add(mk(CGEO.helmetBrim, C.helmet, 0, -0.09, 0));
  // NVG-mount / sensor på toppen
  headGrp.add(mk(new THREE.BoxGeometry(0.07,0.06,0.09), 0x333333, 0, 0.30, 0.10));

  // Fiende: rød hodeskalle-plate på fronten av hjelmen
  if (isEnemy) {
    headGrp.add(mk(new THREE.BoxGeometry(0.16,0.13,0.04), 0x1a1a1a,  0,  0.06, 0.29));
    headGrp.add(mk(new THREE.BoxGeometry(0.10,0.08,0.04), 0xcc1111,  0,  0.06, 0.32)); // rød skull-markering
    // Røde sidepaneler på hjelmen
    [-1,1].forEach(s =>
      headGrp.add(mk(new THREE.BoxGeometry(0.04,0.08,0.10), 0x1a1a1a, s*0.30, 0.04, 0.10))
    );
  }

  root.add(headGrp);

  root.userData.legL = legL;
  root.userData.legR = legR;
  root.userData.headGrp = headGrp;
  root.scale.setScalar(CFG.soldierScale); // global skala – juster CFG.soldierScale
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
// Gjenbrukbare geo/mat for militære props
const PGEO = {
  sandbag:  new THREE.BoxGeometry(0.6, 0.3, 0.35),
  barrel:   new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8),
  crate:    new THREE.BoxGeometry(0.55, 0.55, 0.55),
  trapBar:  new THREE.BoxGeometry(0.08, 0.08, 1.1),
  bush:     new THREE.SphereGeometry(0.3, 5, 4),
  cactusB:  new THREE.CylinderGeometry(0.12, 0.14, 0.9, 6),
  cactusA:  new THREE.CylinderGeometry(0.07, 0.08, 0.4, 6),
  rubble:   new THREE.BoxGeometry(0.4, 0.22, 0.35),
};
const PMAT = {
  sand:    new THREE.MeshLambertMaterial({ color: 0xc8a060 }),
  sandbag: new THREE.MeshLambertMaterial({ color: 0xb8954a }),
  barrel:  new THREE.MeshLambertMaterial({ color: 0x4a5240 }),
  crate:   new THREE.MeshLambertMaterial({ color: 0x8b7355 }),
  trap:    new THREE.MeshLambertMaterial({ color: 0x606060 }),
  bush:    new THREE.MeshLambertMaterial({ color: 0x8b7340 }),
  cactus:  new THREE.MeshLambertMaterial({ color: 0x6b8c42 }),
  rubble:  new THREE.MeshLambertMaterial({ color: 0x9e8c7a }),
};

function makeSandbags() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(PGEO.sandbag, PMAT.sandbag);
    b.position.set(i * 0.58 - 0.58, 0.15, (Math.random()-0.5)*0.2);
    b.rotation.y = (Math.random()-0.5)*0.3;
    b.castShadow = true; g.add(b);
  }
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(PGEO.sandbag, PMAT.sandbag);
    b.position.set(i * 0.58 - 0.29, 0.44, (Math.random()-0.5)*0.15);
    b.castShadow = true; g.add(b);
  }
  return g;
}

function makeTankTrap() {
  const g = new THREE.Group();
  const angles = [[0,0,0],[Math.PI/2,0,0],[0,0,Math.PI/2]];
  angles.forEach(([rx,ry,rz]) => {
    const b = new THREE.Mesh(PGEO.trapBar, PMAT.trap);
    b.rotation.set(rx,ry,rz); b.castShadow = true; g.add(b);
  });
  return g;
}

function makeCactus() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(PGEO.cactusB, PMAT.cactus);
  trunk.position.y = 0.45; trunk.castShadow = true; g.add(trunk);
  [-0.28, 0.28].forEach(dx => {
    const arm = new THREE.Mesh(PGEO.cactusA, PMAT.cactus);
    arm.position.set(dx, 0.55, 0);
    arm.rotation.z = dx > 0 ? -0.6 : 0.6;
    g.add(arm);
  });
  return g;
}

function makeDeadBush() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(PGEO.bush, PMAT.bush);
  b.scale.set(1, 0.6, 1); b.position.y = 0.18; g.add(b);
  return g;
}

function makeBarrel() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(PGEO.barrel, PMAT.barrel);
  b.position.y = 0.25; b.castShadow = true; g.add(b);
  return g;
}

function makeCrate() {
  const g = new THREE.Group();
  const c = new THREE.Mesh(PGEO.crate, PMAT.crate);
  c.position.y = 0.28; c.castShadow = true; g.add(c);
  return g;
}

function makeRubble() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(PGEO.rubble, PMAT.rubble);
    r.position.set((Math.random()-0.5)*0.6, 0.11, (Math.random()-0.5)*0.4);
    r.rotation.y = Math.random()*Math.PI;
    r.castShadow = true; g.add(r);
  }
  return g;
}

// Prop-objekt-liste og spawn
const props = []; // { group }
const PROP_SIDE_MIN = CFG.roadWidth/2 + 1.2;
const PROP_SIDE_MAX = CFG.roadWidth/2 + 8;
let propSpawnZ   = -20;
const PROP_INTERVAL = 8; // avstand mellom prop-grupper

function spawnPropGroup(atZ) {
  const makers = [makeSandbags, makeTankTrap, makeCactus, makeDeadBush,
                  makeBarrel, makeCrate, makeRubble, makeDeadBush, makeCactus];
  // Plasser 1-2 props per side
  [-1, 1].forEach(side => {
    if (Math.random() < 0.35) return; // hopp over av og til for variasjon
    const maker = makers[Math.floor(Math.random()*makers.length)];
    const g     = maker();
    const xDist = PROP_SIDE_MIN + Math.random()*(PROP_SIDE_MAX - PROP_SIDE_MIN);
    g.position.set(side * xDist, 0, atZ);
    g.rotation.y = Math.random()*Math.PI*2;
    scene.add(g);
    props.push({ group: g });
  });
}

function updateProps(dz) {
  // Spawn nye props
  if (propSpawnZ + props.reduce((mn,p)=>Math.min(mn,p.group.position.z),0) > -PROP_INTERVAL) {
    // enkelt: bare sjekk om vi trenger nytt
  }
  for (let i = props.length-1; i >= 0; i--) {
    props[i].group.position.z += dz;
    if (props[i].group.position.z > 30) {
      scene.remove(props[i].group);
      props.splice(i, 1);
    }
  }
}

// Pre-spawn props
for (let z = -10; z > -200; z -= PROP_INTERVAL) spawnPropGroup(z);

// ── Crowd ──────────────────────────────────────────────────
const crowdGroup = new THREE.Group();
scene.add(crowdGroup);
const crowdFigs = [];

function rebuildCrowd() {
  while (crowdGroup.children.length) crowdGroup.remove(crowdGroup.children[0]);
  crowdFigs.length = 0;
  const n = Math.min(crowdSize, 80);
  for (let i = 0; i < n; i++) {
    const fig   = createSoldier(0x1565c0);  // blå spiller-soldater
    const angle = i * 2.39996;
    const r     = i === 0 ? 0 : Math.sqrt(i / n) * CFG.crowdSpread;
    fig.position.set(Math.cos(angle)*r, 0, Math.sin(angle)*r*0.5);
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
  const base = Math.max(3, 3 + Math.floor(level * 1.5));
  return isGood ? base : -base;
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

  // Tank spawner lengre unna og er hardere
  const vhp = Math.round((60 + level * 25) * (0.85 + Math.random()*0.3));
  spawnVehicle(atZ, vhp, tankX);
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

function updateVehicles(dz) {
  for (let i = vehicles.length-1; i >= 0; i--) {
    const v = vehicles[i];
    v.group.position.z += dz;

    // Vognen kjører mot spilleren når den er i nærheten
    if (v.group.position.z > -50) {
      v.group.position.z += VEHICLE_SPEED * _dt;
    }
    // Stopp rett foran crowd
    if (v.group.position.z > -4) v.group.position.z = -4;

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

// ── Spawn vanlige fiender (tar HP og antall direkte) ────────
function spawnEnemy(atZ, hp, count) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const fig   = createSoldier(0xc62828);
    const angle = i * 2.39996;
    const r     = i === 0 ? 0 : Math.sqrt(i / count) * CFG.enemySpread;
    fig.position.set(Math.cos(angle)*r, 0, Math.sin(angle)*r*0.5);
    g.add(fig);
  }

  const tex = hpTex(hp, hp);
  const lbl = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 0.82),
    new THREE.MeshBasicMaterial({ map:tex, transparent:true, side:THREE.DoubleSide })
  );
  lbl.position.y = 3.0;
  g.add(lbl);

  g.position.set(0, 0, atZ);
  scene.add(g);
  enemies.push({ group:g, hp, maxHp:hp, labelMesh:lbl, isBoss:false, alive:true });
}

// ── Spawn boss for gjeldende level ─────────────────────────
function spawnBoss(atZ, hp) {
  const g = new THREE.Group();
  const bossFig = createBoss();
  g.add(bossFig);

  const tex = hpTex(hp, hp);
  const lbl = new THREE.Mesh(
    new THREE.PlaneGeometry(6.0, 1.0),
    new THREE.MeshBasicMaterial({ map:tex, transparent:true, side:THREE.DoubleSide })
  );
  lbl.position.y = 5.2;
  g.add(lbl);

  // Gyllen ring under bossen
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.8, 0.18, 8, 32),
    new THREE.MeshLambertMaterial({ color:0xcc1111 })
  );
  ring.rotation.x = Math.PI/2; ring.position.y = 0.12;
  g.add(ring);

  g.position.set(0, 0, atZ);
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
  return enemies.some(en => en.group.position.z > -10);
}

function updateEnemies(dz) {
  for (let i = enemies.length-1; i >= 0; i--) {
    const en = enemies[i];
    en.group.position.z += dz;

    // Fienden marsjerer alltid mot crowd når den er i nærheten
    if (en.group.position.z > -40) {
      en.group.position.z += CFG.enemyWalkSpeed * _dt;
    }

    // Ikke la fienden overskride crowd-posisjonen
    if (en.group.position.z > -2) en.group.position.z = -2;

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
  f.mesh.position.set(wx, wy, wz - 0.25);
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

  // Skyt fra opptil 8 soldater
  const shooters = Math.min(crowdFigs.length, Math.min(crowdSize, 8));
  for (let i = 0; i < shooters; i++) {
    const fig = crowdFigs[i];
    if (!fig) continue;
    const wx = crowdX + fig.position.x + 0.22;
    const wy = 0.72;
    const wz = fig.position.z - 0.20;

    // Hent fra pool
    const m = getBulletMesh();
    if (!m) continue;
    m.position.set(wx, wy, wz);
    m.visible = true;
    // Liten spredning horisontalt
    const spread = (Math.random()-0.5) * 0.04;
    activePBullets.push({ mesh: m, vx: spread, life: 2.0 });

    // Munningsflamme
    spawnMuzzleFlash(wx, wy, wz);
  }
}

function shootEnemyBullets(en) {
  const numShooters = Math.min(5, Math.max(1, Math.ceil(en.hp / en.maxHp * 5)));
  for (let i = 0; i < numShooters; i++) {
    const spread = (Math.random()-0.5) * 2.5;
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

    if (hit || b.life <= 0 || b.mesh.position.z < -55) {
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
      spawnEnemy(-90, lp.enemyHP, lp.enemyCount);
    }
  }
}

// Går opp ett level og starter det neste
function nextLevel() {
  level++;
  levelParams           = getLevelParams(level);
  speed                 = levelParams.worldSpeed;
  wavesSpawnedInLevel   = 0;
  bossSpawnedThisLevel  = false;
  lastEnemyTravel       = travelZ; // reset fiende-timer
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
}

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
  crowdSize=CFG.startCrowd;
  level=1; levelParams=getLevelParams(1);
  speed=levelParams.worldSpeed;
  wavesSpawnedInLevel=0; bossSpawnedThisLevel=false;
  crowdX=0; targetX=0; travelZ=0;
  lastGateTravel=0; lastEnemyTravel=0;
  shootTimer=0; enemyShootTimer=0;

  roadSegs.forEach((s,i) => s.position.set(0,0,-i*SEG));
  rebuildCrowd();
  updateHUD();

  // Forhåndsspawn første gate og første fiendebølge
  spawnGates(-80);
  spawnEnemy(-90, levelParams.enemyHP, levelParams.enemyCount);
  wavesSpawnedInLevel = 1;

  ['start-screen','gameover-screen','victory-screen'].forEach(id =>
    document.getElementById(id).classList.add('hidden'));

  state='playing';
}

function triggerGameOver() {
  if (state==='dead') return;
  state='dead';
  if (level > highScore) highScore = level;
  document.getElementById('final-score').textContent        = `Du kom til Level ${level}`;
  document.getElementById('high-score-display').textContent = `Rekord: Level ${highScore}`;
  document.getElementById('gameover-screen').classList.remove('hidden');
}

function triggerVictory() {
  if (state==='victory') return;
  state='victory';
  if (level > highScore) highScore = level;
  document.getElementById('victory-score').textContent = `Level ${level} klart! Mengde: ${crowdSize}`;
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
    // Vanskelig fiende: HP over terskel → spilleren stopper, fienden marsjerer mot dem
    const hardEnemy = front && front.hp > CFG.hardThreshold;

    const crowdStopped = combat && hardEnemy;
    const dz = crowdStopped ? 0 : speed * dt;

    updateRoad(dz);
    updateProps(dz);
    updateGates(dz);
    updateVehicles(dz);
    // Sender dz=0 til updateEnemies under kamp slik at fienden ikke drifter med verden –
    // fienden styrer sin egen marsj i updateEnemies via _dt
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
    // Kamera er helt statisk – verden beveger seg mot spilleren
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(loop);
