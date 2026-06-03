// ============================================================
//  CROWD RUNNER – Shoot & Multiply
//  Crowd løper fremover, skyter automatisk på fiender.
//  Grønne porter = flere folk, røde = færre folk.
//  Verden ruller mot kamera, crowd er statisk i Z.
// ============================================================

// ── Verdensfart (juster denne for å endre tempo) ───────────
const WORLD_SPEED = 7; // enheter per sekund – øker svakt per bølge

const CFG = {
  startCrowd:     10,
  runSpeed:       WORLD_SPEED,
  speedIncrement: 0.15, // saktere økning per bølge
  roadWidth:       9,
  laneWidth:      2.6,
  crowdSpread:    1.9,
  gateInterval:   22,
  enemyInterval:  50,
  bossEveryN:      5,
  baseEnemyHP:    50,
  enemyHPScale:   1.6,
  bossMultiplier:  4,
  keySpeed:        7,
  minCrowd:        1,
  maxCrowd:       999,
  winAtWave:      20,
  bulletSpeed:    26,
  shootInterval:  0.18,
  bulletDmg:       1,
  enemyShootInterval: 0.45,
  enemyBulletSpeed:   16,
  enemyWalkSpeed:      4,
  hardThreshold:      80,
};

// ── State ──────────────────────────────────────────────────
let state     = 'start';
let crowdSize = 0;
let wave      = 0;
let highScore = 0;
let speed     = CFG.runSpeed;
let crowdX    = 0;
let targetX   = 0;
let travelZ   = 0;
let lastGateTravel  = 0;
let lastEnemyTravel = 0;
let shootTimer      = 0;
let enemyShootTimer = 0;

// ── Three.js ───────────────────────────────────────────────
const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd4b896);
scene.fog        = new THREE.Fog(0xc8a97a, 30, 85);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 150);
camera.position.set(0, 13, 20);
camera.lookAt(0, 0, -4);

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
  // Soldat-deler
  sHead:   new THREE.SphereGeometry(0.17, 7, 6),
  sHelmet: new THREE.CylinderGeometry(0.185, 0.195, 0.13, 8),
  sBrim:   new THREE.CylinderGeometry(0.22,  0.22,  0.04, 8),  // hjelmskygge
  sTorso:  new THREE.BoxGeometry(0.36, 0.38, 0.20),
  sPack:   new THREE.BoxGeometry(0.16, 0.20, 0.09),             // ryggsekk
  sArm:    new THREE.BoxGeometry(0.10, 0.30, 0.10),
  sThigh:  new THREE.BoxGeometry(0.13, 0.22, 0.13),
  sBoot:   new THREE.BoxGeometry(0.13, 0.17, 0.16),
  sRifle:  new THREE.BoxGeometry(0.06, 0.06, 0.40),
  sBarrel: new THREE.BoxGeometry(0.04, 0.04, 0.15),
  // Skudd
  bullet:  new THREE.SphereGeometry(0.10, 6, 6),
  eBullet: new THREE.SphereGeometry(0.13, 6, 6),
  // Porter
  gate:    new THREE.BoxGeometry(2.0, 2.6, 0.22),
  post:    new THREE.BoxGeometry(0.14, 3.1, 0.14),
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

// ── Soldat-fabrikk (erstatter makeFigure) ──────────────────
// teamColor: lagets primærfarge (hjelm + uniform).
// Returnerer THREE.Group med userData.legL / legR for animasjon.
function createSoldier(teamColor) {
  const root   = new THREE.Group();
  const tMat   = gMat(teamColor);
  // Litt mørkere for bukser/ryggsekk
  const darker = new THREE.Color(teamColor).multiplyScalar(0.6).getHex();
  const dkMat  = gMat(darker);

  // Hjelpefunksjon: lag mesh, sett posisjon og legg til root
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    root.add(m);
    return m;
  };

  // ── Ben (to grupper med pivot i hoftehøyde → gir bensving) ─
  const makeleg = (side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.115, 0.42, 0);   // hofte-pivot

    const thigh = new THREE.Mesh(GEO.sThigh, dkMat);
    thigh.position.set(0, -0.11, 0);
    thigh.castShadow = true;
    g.add(thigh);

    const boot = new THREE.Mesh(GEO.sBoot, MAT_DARK);
    boot.position.set(0, -0.30, 0.015);
    boot.castShadow = true;
    g.add(boot);

    root.add(g);
    return g;
  };
  const legL = makeleg(-1);
  const legR = makeleg( 1);

  // ── Torso ──────────────────────────────────────────────────
  add(GEO.sTorso, tMat, 0, 0.65, 0);

  // ── Ryggsekk ───────────────────────────────────────────────
  add(GEO.sPack, dkMat, 0, 0.65, -0.155);

  // ── Armer ──────────────────────────────────────────────────
  add(GEO.sArm, tMat, -0.25, 0.65, 0);
  add(GEO.sArm, tMat,  0.25, 0.65, 0);

  // ── Gevær (holdt foran høyre arm) ──────────────────────────
  const rifle = new THREE.Group();
  rifle.position.set(0.22, 0.60, -0.20);
  rifle.rotation.x = 0.28;
  const rBody = new THREE.Mesh(GEO.sRifle,  MAT_DARK); rBody.castShadow = true;
  const rBar  = new THREE.Mesh(GEO.sBarrel, MAT_DARK);
  rBar.position.set(0, 0, -0.26);
  rifle.add(rBody, rBar);
  root.add(rifle);

  // ── Hode ───────────────────────────────────────────────────
  add(GEO.sHead, MAT_SKIN, 0, 1.02, 0);

  // ── Hjelm (to deler: kuppel + skygge) ──────────────────────
  add(GEO.sHelmet, tMat,  0, 1.155, 0);
  add(GEO.sBrim,   tMat,  0, 1.09,  0.045);  // liten front-skygge

  // Lagre bein-referanser for animasjon
  root.userData.legL = legL;
  root.userData.legR = legR;
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

function textTex(text, bg, fg) {
  const W=256, H=100;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const ctx=c.getContext('2d');
  ctx.fillStyle=bg;
  ctx.beginPath(); ctx.roundRect(2,2,W-4,H-4,14); ctx.fill();
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

function spawnGates(atZ) {
  const l1 = Math.floor(Math.random()*3);
  const l2 = (l1+1+Math.floor(Math.random()*2))%3;

  const randOp = () => {
    const r = Math.random();
    if (r < 0.30) return { op:'+', val: Math.max(3, Math.floor(4+wave*2)) };
    if (r < 0.52) return { op:'-', val: Math.max(2, Math.floor(3+wave*1.5)) };
    if (r < 0.70) return { op:'*', val: Math.random()<0.65 ? 2 : 3 };
    if (r < 0.82) return { op:'/', val: 2 };
    return { op:'+', val: Math.max(6, Math.floor(8+wave*2.5)) };
  };

  [l1, l2].forEach(lane => {
    const {op, val} = randOp();
    const result = opResult(crowdSize, op, val);
    const good   = result >= crowdSize;
    const mult   = op==='*';
    const bg     = mult ? '#1565c0' : good ? '#2e7d32' : '#c62828';
    const fg     = '#ffffff';

    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({
      color: mult ? 0x1e88e5 : good ? 0x43a047 : 0xe53935,
      transparent: true, opacity: 0.85
    });
    const face = new THREE.Mesh(GEO.gate, mat);
    face.position.y = 1.3; face.castShadow = true;
    g.add(face);

    const lbl = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 0.7),
      new THREE.MeshBasicMaterial({ map: textTex(opStr(op,val), bg, fg), transparent:true, side:THREE.DoubleSide })
    );
    lbl.position.set(0, 1.55, 0.14);
    g.add(lbl);

    [-0.86, 0.86].forEach(dx => {
      const p = new THREE.Mesh(GEO.post, new THREE.MeshLambertMaterial({ color:0x9e9e9e }));
      p.position.set(dx, 1.55, 0);
      g.add(p);
    });

    g.position.set((lane-1)*CFG.laneWidth, 0, atZ);
    scene.add(g);
    gates.push({ group:g, op, val, lane, passed:false });
  });
}

function updateGates(dz) {
  for (let i = gates.length-1; i >= 0; i--) {
    const gate = gates[i];
    gate.group.position.z += dz;

    if (!gate.passed && gate.group.position.z > -1 && gate.group.position.z < 5) {
      const cx = (gate.lane-1)*CFG.laneWidth;
      if (Math.abs(crowdX - cx) < CFG.laneWidth*0.52) {
        gate.passed  = true;
        const before = crowdSize;
        crowdSize    = opResult(crowdSize, gate.op, gate.val);
        rebuildCrowd();
        updateHUD();
        showFloatingText(opStr(gate.op, gate.val), crowdSize >= before ? '#69f0ae' : '#ff5252');
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

// ── Fiender ────────────────────────────────────────────────
const enemies = []; // { group, hp, maxHp, labelMesh, alive }

function hpTex(hp, maxHp) {
  const W=320, H=60;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const ctx=c.getContext('2d');
  ctx.fillStyle='rgba(0,0,0,0.6)';
  ctx.beginPath(); ctx.roundRect(0,0,W,H,10); ctx.fill();
  const pct=Math.max(0,hp/maxHp);
  ctx.fillStyle=pct>0.5?'#43a047':pct>0.25?'#fb8c00':'#e53935';
  ctx.beginPath(); ctx.roundRect(4,4,(W-8)*pct,H-8,7); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font=`bold ${H*0.5}px Arial`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(String(hp), W/2, H/2);
  return new THREE.CanvasTexture(c);
}

function spawnEnemy(atZ, waveNum) {
  const isBoss = (waveNum % CFG.bossEveryN === 0);
  const baseHP = Math.round(CFG.baseEnemyHP * Math.pow(CFG.enemyHPScale, waveNum-1));
  const hp     = isBoss ? baseHP * CFG.bossMultiplier : baseHP;
  const count  = isBoss ? 24 : Math.min(6+waveNum*2, 30);

  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const fig   = createSoldier(0xc62828);  // rød fiende-soldater
    if (isBoss) fig.scale.setScalar(1.4);
    const angle = i*2.39996;
    const r     = i===0 ? 0 : Math.sqrt(i/count)*(isBoss?3.2:2.4);
    fig.position.set(Math.cos(angle)*r, 0, Math.sin(angle)*r*0.45);
    g.add(fig);
  }

  const tex = hpTex(hp, hp);
  const lbl = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 0.82),
    new THREE.MeshBasicMaterial({ map:tex, transparent:true, side:THREE.DoubleSide })
  );
  lbl.position.y = isBoss ? 4.2 : 3.0;
  g.add(lbl);

  if (isBoss) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.8, 0.2, 8, 32),
      new THREE.MeshLambertMaterial({ color:0xffd600 })
    );
    ring.rotation.x = Math.PI/2; ring.position.y = 0.2;
    g.add(ring);
  }

  g.position.set(0, 0, atZ);
  scene.add(g);
  enemies.push({ group:g, hp, maxHp:hp, labelMesh:lbl, isBoss, alive:true });
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
  if (!enemies.length) return;
  const target = enemies.reduce((a,b) => a.group.position.z > b.group.position.z ? a : b);
  if (target.group.position.z < -45) return;

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

    // Treff fiende?
    let hit = false;
    for (const en of enemies) {
      if (!en.alive) continue;
      const dz = b.mesh.position.z - en.group.position.z;
      const dx = b.mesh.position.x - en.group.position.x;
      if (Math.abs(dz) < 2.8 && Math.abs(dx) < 3.2) {
        en.hp -= CFG.bulletDmg;
        hit = true;
        refreshEnemyHP(en);
        if (en.hp <= 0) {
          en.alive = false;
          scene.remove(en.group);
          const idx = enemies.indexOf(en);
          if (idx !== -1) enemies.splice(idx, 1);
          wave++;
          speed += CFG.speedIncrement;
          updateHUD();
          if (wave >= CFG.winAtWave) setTimeout(triggerVictory, 400);
        }
        break;
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
  if (travelZ - lastGateTravel >= CFG.gateInterval) {
    lastGateTravel += CFG.gateInterval;
    spawnGates(-CFG.gateInterval);
  }
  if (travelZ - lastEnemyTravel >= CFG.enemyInterval) {
    lastEnemyTravel += CFG.enemyInterval;
    spawnEnemy(-CFG.enemyInterval, wave+1);
  }
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
  document.getElementById('crowd-count').textContent = crowdSize;
  document.getElementById('score-display').textContent = `Bølge: ${wave}`;
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

  crowdSize=CFG.startCrowd; wave=0; speed=CFG.runSpeed;
  crowdX=0; targetX=0; travelZ=0;
  lastGateTravel=0; lastEnemyTravel=0;
  shootTimer=0; enemyShootTimer=0;

  roadSegs.forEach((s,i) => s.position.set(0,0,-i*SEG));
  rebuildCrowd();
  updateHUD();

  // Forhåndsspawn
  spawnGates(-CFG.gateInterval);
  spawnEnemy(-CFG.enemyInterval, 1);

  ['start-screen','gameover-screen','victory-screen'].forEach(id =>
    document.getElementById(id).classList.add('hidden'));

  state='playing';
}

function triggerGameOver() {
  if (state==='dead') return;
  state='dead';
  if (wave>highScore) highScore=wave;
  document.getElementById('final-score').textContent      = `Du klarte bølge ${wave}`;
  document.getElementById('high-score-display').textContent = `Rekord: ${highScore}`;
  document.getElementById('gameover-screen').classList.remove('hidden');
}

function triggerVictory() {
  if (state==='victory') return;
  state='victory';
  if (wave>highScore) highScore=wave;
  document.getElementById('victory-score').textContent = `${wave} bølger klart! Mengde: ${crowdSize}`;
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
    // Sender dz=0 til updateEnemies under kamp slik at fienden ikke drifter med verden –
    // fienden styrer sin egen marsj i updateEnemies via _dt
    updateEnemies(combat ? 0 : dz);
    if (!combat) checkSpawns(dz);

    // Auto-skyting
    shootTimer += dt;
    if (shootTimer >= CFG.shootInterval && enemies.length > 0) {
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
