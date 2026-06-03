// ============================================================
//  CROWD RUNNER – game.js
//  Åpne index.html direkte i nettleser, ingen server nødvendig.
//
//  Koordinatsystem: Crowd står ved z≈0. Verden (vei, porter,
//  fiender) beveger seg mot +Z (mot spilleren) med `speed`.
//  Crowd-gruppen flyttes bare sidelengs (X).
// ============================================================

// ── Konfigurasjon ──────────────────────────────────────────
const CFG = {
  startCrowd:       10,    // Antall figurer ved start
  runSpeed:          7,    // Grunnfart (enheter/s)
  speedIncrement:  0.25,   // Fartøkning per bølge
  roadWidth:         8,    // Total bredde av veien
  laneWidth:       2.4,    // Bredde per felt (3 felt)
  crowdSpread:     1.8,    // Radius for crowd-formasjon
  gateInterval:     32,    // Avstand mellom gate-par
  enemyInterval:    70,    // Avstand mellom fiendebølger
  bossEveryN:        5,    // Boss hvert N. bølge (teller fra 1)
  bossMultiplier:    4,    // Boss-HP multipliseres med dette
  baseEnemyHP:      35,    // Fiende-HP bølge 1
  enemyHPScale:    1.55,   // Multiplikator per bølge
  swipeSens:       0.35,   // Mobil-dra følsomhet (enheter/px * 0.1)
  keySpeed:          7,    // Tastaturbevegelse (enheter/s)
  minCrowd:          1,
  maxCrowd:        999,
  winAtWave:        20,    // Seier etter X bølger
};

// ── Spilltilstand ──────────────────────────────────────────
let state     = 'start';  // 'start' | 'playing' | 'battle' | 'dead' | 'victory'
let crowdSize = 0;
let wave      = 0;
let highScore = 0;
let speed     = CFG.runSpeed;
let spawnDist = 0;        // Total distanse spawneren har kjørt
let crowdX    = 0;        // Nåværende X for crowd-gruppen
let targetX   = 0;        // Ønsket X (smooth)

// ── Three.js oppsett ───────────────────────────────────────
const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ec8e3);
scene.fog        = new THREE.Fog(0x7ec8e3, 35, 85);

// Fast kamera – verden løper mot spilleren
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 150);
camera.position.set(0, 13, 18);
camera.lookAt(0, 0, -5);

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// Lys
scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(8, 20, 8);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left:-20, right:20, top:20, bottom:-20, near:0.5, far:80 });
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

// ── Gjenbrukbare geometrier ────────────────────────────────
const GEO = {
  body: new THREE.CylinderGeometry(0.22, 0.22, 0.55, 7),
  head: new THREE.SphereGeometry(0.2, 8, 8),
  leg:  new THREE.CylinderGeometry(0.08, 0.08, 0.35, 6),
  gate: new THREE.BoxGeometry(1.9, 2.5, 0.22),
  post: new THREE.BoxGeometry(0.12, 3.0, 0.12),
};

// ── Figur-fabrikk ──────────────────────────────────────────
function makeFigure(isEnemy) {
  const root = new THREE.Group();
  const colors = isEnemy
    ? { body: 0xef5350, head: 0xffcc80, leg: 0xb71c1c }
    : { body: 0x29b6f6, head: 0xffcc80, leg: 0x0d47a1 };

  const body = new THREE.Mesh(GEO.body, new THREE.MeshLambertMaterial({ color: colors.body }));
  body.position.y = 0.55;
  body.castShadow = true;
  root.add(body);

  const head = new THREE.Mesh(GEO.head, new THREE.MeshLambertMaterial({ color: colors.head }));
  head.position.y = 1.05;
  head.castShadow = true;
  root.add(head);

  const legL = new THREE.Mesh(GEO.leg, new THREE.MeshLambertMaterial({ color: colors.leg }));
  legL.position.set(-0.12, 0.18, 0);
  root.add(legL);

  const legR = new THREE.Mesh(GEO.leg, new THREE.MeshLambertMaterial({ color: colors.leg }));
  legR.position.set(0.12, 0.18, 0);
  root.add(legR);

  root.userData.legL = legL;
  root.userData.legR = legR;
  return root;
}

// ── Vei (infinite recycling) ───────────────────────────────
const SEG_LEN = 28;
const NUM_SEGS = 7;
const roadMats = {
  asphalt: new THREE.MeshLambertMaterial({ color: 0x90a4ae }),
  grass:   new THREE.MeshLambertMaterial({ color: 0x66bb6a }),
  line:    new THREE.MeshLambertMaterial({ color: 0xffffff }),
};

function makeRoadSeg() {
  const g = new THREE.Group();

  const road = new THREE.Mesh(new THREE.BoxGeometry(CFG.roadWidth, 0.12, SEG_LEN), roadMats.asphalt);
  road.receiveShadow = true;
  g.add(road);

  [-1,1].forEach(s => {
    const gr = new THREE.Mesh(new THREE.BoxGeometry(7, 0.1, SEG_LEN), roadMats.grass);
    gr.position.x = s * (CFG.roadWidth / 2 + 3.5);
    g.add(gr);
  });

  for (let dz = -SEG_LEN/2 + 2; dz < SEG_LEN/2; dz += 4.5) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.6), roadMats.line);
    m.position.z = dz;
    g.add(m);
  }
  scene.add(g);
  return g;
}

const roadSegs = [];
for (let i = 0; i < NUM_SEGS; i++) {
  const s = makeRoadSeg();
  s.position.z = -i * SEG_LEN;
  roadSegs.push(s);
}

// Flytt alle veisegmenter fremover; recycle de som passerer kamera
function updateRoad(dz) {
  roadSegs.forEach(seg => {
    seg.position.z += dz;
    if (seg.position.z > SEG_LEN * 1.5) {
      seg.position.z -= NUM_SEGS * SEG_LEN;
    }
  });
}

// ── Crowd-gruppe ───────────────────────────────────────────
const crowdGroup  = new THREE.Group();
crowdGroup.position.z = 0;
scene.add(crowdGroup);
const crowdFigs = []; // { mesh }

function rebuildCrowd() {
  while (crowdGroup.children.length) crowdGroup.remove(crowdGroup.children[0]);
  crowdFigs.length = 0;

  const n = Math.min(crowdSize, 80);
  for (let i = 0; i < n; i++) {
    const fig = makeFigure(false);
    const angle = i * 2.39996;
    const r     = (i === 0 ? 0 : Math.sqrt(i / n) * CFG.crowdSpread);
    fig.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r * 0.55);
    crowdGroup.add(fig);
    crowdFigs.push({ mesh: fig });
  }
}

// ── Canvas-tekst til Three.js ──────────────────────────────
function textTexture(text, bgColor, textColor) {
  const W = 256, H = 96;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // Bakgrunn med rundet hjørne
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(2, 2, W-4, H-4, 14);
  ctx.fill();

  ctx.fillStyle = textColor;
  ctx.font = `bold ${H * 0.54}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W/2, H/2);
  return new THREE.CanvasTexture(c);
}

// ── Porter ─────────────────────────────────────────────────
const gates = []; // { mesh3d, op, val, lane, passed }

function opResult(n, op, val) {
  if (op==='+') return Math.min(CFG.maxCrowd, n + val);
  if (op==='-') return Math.max(CFG.minCrowd, n - val);
  if (op==='*') return Math.min(CFG.maxCrowd, n * val);
  if (op==='/') return Math.max(CFG.minCrowd, Math.floor(n / val));
  return n;
}

function opStr(op, val) {
  const sym = { '+':'+', '-':'−', '*':'×', '/':'÷' };
  return `${sym[op]}${val}`;
}

function spawnGates(atZ) {
  // Velg to ulike felt av 3
  const l1 = Math.floor(Math.random() * 3);
  const l2 = (l1 + 1 + Math.floor(Math.random() * 2)) % 3;

  const makeOp = () => {
    const r = Math.random();
    if (r < 0.28) return { op:'+', val: Math.max(3, Math.floor(3 + wave*1.8)) };
    if (r < 0.48) return { op:'-', val: Math.max(2, Math.floor(2 + wave*1.3)) };
    if (r < 0.66) return { op:'*', val: Math.random()<0.6 ? 2 : 3 };
    if (r < 0.80) return { op:'/', val: 2 };
    return { op:'+', val: Math.max(5, Math.floor(6 + wave*2.2)) };
  };

  [l1, l2].forEach(lane => {
    const { op, val } = makeOp();
    const result  = opResult(crowdSize, op, val);
    const isGood  = result > crowdSize;
    const isMult  = (op === '*');

    const bg   = isMult ? '#1565c0' : isGood ? '#2e7d32' : '#c62828';
    const fg   = '#ffffff';

    const g = new THREE.Group();

    // Portalflate
    const mat = new THREE.MeshLambertMaterial({
      color: isMult ? 0x1e88e5 : isGood ? 0x43a047 : 0xe53935,
      transparent: true, opacity: 0.82
    });
    const face = new THREE.Mesh(GEO.gate, mat);
    face.position.y = 1.25;
    face.castShadow = true;
    g.add(face);

    // Tekst-billboard
    const tex = textTexture(opStr(op,val), bg, fg);
    const lbl = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 0.64),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
    );
    lbl.position.set(0, 1.5, 0.14);
    g.add(lbl);

    // Stolper
    [-0.82, 0.82].forEach(dx => {
      const p = new THREE.Mesh(GEO.post, new THREE.MeshLambertMaterial({ color: 0x9e9e9e }));
      p.position.set(dx, 1.5, 0);
      g.add(p);
    });

    const xPos = (lane - 1) * CFG.laneWidth;
    g.position.set(xPos, 0, atZ);
    scene.add(g);

    gates.push({ group: g, op, val, lane, passed: false, baseZ: atZ });
  });
}

// Flytt porter og fjern de som passerer kamera
function updateGates(dz) {
  for (let i = gates.length - 1; i >= 0; i--) {
    const gate = gates[i];
    gate.group.position.z += dz;

    // Kollisjonsdeteksjon: gate er ved z≈0–4
    if (!gate.passed && gate.group.position.z > -1 && gate.group.position.z < 5) {
      const gateCX = (gate.lane - 1) * CFG.laneWidth;
      if (Math.abs(crowdX - gateCX) < CFG.laneWidth * 0.52) {
        gate.passed = true;
        crowdSize   = opResult(crowdSize, gate.op, gate.val);
        rebuildCrowd();
        updateHUD();
        // Visuell puls
        gate.group.scale.setScalar(1.18);
        setTimeout(() => gate.group && gate.group.scale.setScalar(1), 180);
      }
    }

    // Fjern gate som er bak kamera
    if (gate.group.position.z > 24) {
      scene.remove(gate.group);
      gates.splice(i, 1);
    }
  }
}

// ── Fiender ────────────────────────────────────────────────
const enemies = []; // { group, hp, maxHp, labelMesh, isBoss }

function hpTexture(hp, maxHp) {
  const W = 320, H = 56;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(0,0,W,H,10); ctx.fill();

  const pct = Math.max(0, hp / maxHp);
  ctx.fillStyle = pct > 0.5 ? '#43a047' : pct > 0.25 ? '#fb8c00' : '#e53935';
  ctx.beginPath(); ctx.roundRect(4,4,(W-8)*pct, H-8, 7); ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = `bold ${H*0.52}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(hp), W/2, H/2);
  return new THREE.CanvasTexture(c);
}

function spawnEnemy(atZ, waveNum) {
  const isBoss = (waveNum % CFG.bossEveryN === 0);
  const baseHP = Math.round(CFG.baseEnemyHP * Math.pow(CFG.enemyHPScale, waveNum - 1));
  const hp     = isBoss ? baseHP * CFG.bossMultiplier : baseHP;

  const count = isBoss ? 22 : Math.min(6 + waveNum * 2, 28);
  const g     = new THREE.Group();

  for (let i = 0; i < count; i++) {
    const fig   = makeFigure(true);
    const scale = isBoss ? 1.45 : 1;
    fig.scale.setScalar(scale);
    const angle = i * 2.39996;
    const r     = (i === 0 ? 0 : Math.sqrt(i / count) * (isBoss ? 3.0 : 2.2));
    fig.position.set(Math.cos(angle)*r, 0, Math.sin(angle)*r*0.5);
    g.add(fig);
  }

  // HP-etikett
  const tex = hpTexture(hp, hp);
  const lbl = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 0.78),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
  );
  lbl.position.y = isBoss ? 4.0 : 2.8;
  g.add(lbl);

  if (isBoss) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.5, 0.18, 8, 32),
      new THREE.MeshLambertMaterial({ color: 0xffd600 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    g.add(ring);
  }

  g.position.set(0, 0, atZ);
  scene.add(g);
  enemies.push({ group: g, hp, maxHp: hp, labelMesh: lbl, isBoss });
}

function updateEnemies(dz) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const en = enemies[i];
    en.group.position.z += dz;

    // Trigger kamp når fienden når crowd-sonen
    if (state === 'playing' && en.group.position.z > -2 && en.group.position.z < 6) {
      triggerBattle(en);
    }

    if (en.group.position.z > 30) {
      scene.remove(en.group);
      enemies.splice(i, 1);
    }
  }
}

// ── Kamp ───────────────────────────────────────────────────
let battleEnemy  = null;
let battleTimer  = 0;

function triggerBattle(en) {
  state       = 'battle';
  battleEnemy = en;
  battleTimer = 0;
}

function resolveBattle(dt) {
  if (!battleEnemy) return;
  battleTimer += dt;

  // Hvert 0.35s: begge sider mister 1 HP (tempo-kamp visuelt)
  if (battleTimer >= 0.35) {
    battleTimer = 0;

    crowdSize         = Math.max(0, crowdSize - 1);
    battleEnemy.hp    = Math.max(0, battleEnemy.hp - 1);

    // Oppdater HP-label
    const newTex = hpTexture(battleEnemy.hp, battleEnemy.maxHp);
    battleEnemy.labelMesh.material.map.dispose();
    battleEnemy.labelMesh.material.map = newTex;
    battleEnemy.labelMesh.material.needsUpdate = true;

    rebuildCrowd();
    updateHUD();

    if (crowdSize <= 0) {
      // Spilleren tapte
      battleEnemy = null;
      setTimeout(triggerGameOver, 500);
      return;
    }

    if (battleEnemy.hp <= 0) {
      // Spilleren vant
      scene.remove(battleEnemy.group);
      const idx = enemies.indexOf(battleEnemy);
      if (idx !== -1) enemies.splice(idx, 1);
      battleEnemy = null;

      wave++;
      speed += CFG.speedIncrement;
      updateHUD();
      state = 'playing';

      if (wave >= CFG.winAtWave) triggerVictory();
    }
  }
}

// ── Spawn-system ───────────────────────────────────────────
// Vi tracker "spawn cursor" – neste Z-posisjon i verden-koordinater
// (dvs. avstand foran crowd, i negativ Z-retning fra start).
// Siden verden beveger seg mot kamera fikser vi det ved å stable
// nye objekter langt foran (negativt Z) og la dem rulle inn.

// Sporing av tilreist distanse for spawn-triggere
let travelZ         = 0;
let lastGateTravel  = 0;
let lastEnemyTravel = 0;

function checkSpawns(dz) {
  travelZ += dz;

  // Spawn gate: sett det alltid langt foran (z = -CFG.gateInterval)
  if (travelZ - lastGateTravel >= CFG.gateInterval) {
    lastGateTravel += CFG.gateInterval;
    spawnGates(-CFG.gateInterval);
  }

  // Spawn fiende
  if (travelZ - lastEnemyTravel >= CFG.enemyInterval) {
    lastEnemyTravel += CFG.enemyInterval;
    spawnEnemy(-CFG.enemyInterval, wave + 1);
  }
}

// ── Input ──────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => { keys[e.key] = true; });
window.addEventListener('keyup',   e => { keys[e.key] = false; });

let ptrDown = false, ptrPrevX = 0;
canvas.addEventListener('pointerdown', e => { ptrDown = true; ptrPrevX = e.clientX; });
window.addEventListener('pointermove', e => {
  if (!ptrDown || state !== 'playing') return;
  const dx = e.clientX - ptrPrevX;
  ptrPrevX = e.clientX;
  // Skaler slik at swipe over halve skjermen = bevegelse tvers over veien
  const pxPerUnit = window.innerWidth / CFG.roadWidth;
  targetX  = clampX(targetX + dx / pxPerUnit * 2.5);
});
window.addEventListener('pointerup', () => { ptrDown = false; });

function clampX(x) {
  return Math.max(-(CFG.roadWidth/2 - 1.0), Math.min(CFG.roadWidth/2 - 1.0, x));
}

// ── HUD og UI ──────────────────────────────────────────────
const elCount  = document.getElementById('crowd-count');
const elScore  = document.getElementById('score-display');
const elStart  = document.getElementById('start-screen');
const elDead   = document.getElementById('gameover-screen');
const elWin    = document.getElementById('victory-screen');

function updateHUD() {
  elCount.textContent = crowdSize;
  elScore.textContent = `Bølge: ${wave}`;
}

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);
document.getElementById('victory-restart-btn').addEventListener('click', startGame);

function triggerGameOver() {
  state = 'dead';
  if (wave > highScore) highScore = wave;
  document.getElementById('final-score').textContent      = `Du klarte bølge ${wave}`;
  document.getElementById('high-score-display').textContent = `Rekord: ${highScore} bølger`;
  elDead.classList.remove('hidden');
}

function triggerVictory() {
  state = 'victory';
  if (wave > highScore) highScore = wave;
  document.getElementById('victory-score').textContent = `${wave} bølger klart! Mengde igjen: ${crowdSize}`;
  elWin.classList.remove('hidden');
}

// ── Starte / restarte ──────────────────────────────────────
function startGame() {
  // Fjern gamle objekter fra scenen
  gates.forEach(g => scene.remove(g.group));   gates.length = 0;
  enemies.forEach(e => scene.remove(e.group)); enemies.length = 0;

  crowdSize  = CFG.startCrowd;
  wave       = 0;
  speed      = CFG.runSpeed;
  crowdX     = 0;
  targetX    = 0;
  travelZ         = 0;
  lastGateTravel  = 0;
  lastEnemyTravel = 0;

  // Reset vei-segmenter
  roadSegs.forEach((s, i) => { s.position.set(0, 0, -i * SEG_LEN); });

  // Forhåndsspawn første gate og fiende
  spawnGates(-CFG.gateInterval);
  spawnEnemy(-CFG.enemyInterval, 1);

  battleEnemy = null;
  battleTimer = 0;

  rebuildCrowd();
  updateHUD();

  elStart.classList.add('hidden');
  elDead.classList.add('hidden');
  elWin.classList.add('hidden');

  state = 'playing';
}

// ── Bein-animasjon ─────────────────────────────────────────
let legPhase = 0;
function animateCrowd(dt) {
  legPhase += dt * 9;
  crowdFigs.forEach((f, i) => {
    const { legL, legR } = f.mesh.userData;
    if (!legL) return;
    const sw = Math.sin(legPhase + i * 0.4) * 0.38;
    legL.rotation.x =  sw;
    legR.rotation.x = -sw;
    f.mesh.position.y = Math.abs(Math.sin(legPhase + i)) * 0.07;
  });
}

// ── Game loop ──────────────────────────────────────────────
let lastTS = null;

function loop(ts) {
  requestAnimationFrame(loop);

  const dt = lastTS ? Math.min((ts - lastTS) / 1000, 0.05) : 0.016;
  lastTS   = ts;

  if (state === 'playing') {
    // Tastatur-input
    if (keys['ArrowLeft']  || keys['a'] || keys['A']) targetX = clampX(targetX - CFG.keySpeed * dt);
    if (keys['ArrowRight'] || keys['d'] || keys['D']) targetX = clampX(targetX + CFG.keySpeed * dt);

    // Smooth sideveis bevegelse
    crowdX += (targetX - crowdX) * Math.min(1, dt * 14);
    crowdGroup.position.x = crowdX;

    // Beregn hvor mye verden ruller denne framen
    const dz = speed * dt;

    updateRoad(dz);
    updateGates(dz);
    updateEnemies(dz);
    checkSpawns(dz);
    animateCrowd(dt);
  }

  if (state === 'battle') {
    resolveBattle(dt);
    animateCrowd(dt);
    // Sakte ned verden litt under kamp
    const dz = speed * dt * 0.3;
    updateRoad(dz);
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(loop);
