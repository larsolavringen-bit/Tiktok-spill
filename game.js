// ============================================================
//  CROWD RUNNER – game.js
//  Three.js r128, ingen bundler. Åpne index.html i nettleseren.
// ============================================================

// ── Konfigurasjon (juster disse for vanskelighetsgrad) ─────
const CFG = {
  startCrowd:      10,      // Antall figurer ved start
  runSpeed:        8,       // Grunnfart fremover (enheter/s)
  speedIncrement:  0.3,     // Økning per bølge
  laneWidth:       2.2,     // Bredde per felt (3 felt)
  crowdSpread:     1.8,     // Radius crowd-formasjon
  figureHeight:    0.9,
  gateSpawnDist:   28,      // Avstand mellom gate-par
  enemySpawnDist:  60,      // Avstand til fiendebølge
  bossEveryN:      5,       // Boss hvert N bølge
  bossMultiplier:  4,       // Boss-helse × dette vs vanlig fiende
  baseEnemyHP:     40,      // Grunnleggende fiende-HP
  enemyHPScale:    1.6,     // Multipliseres per bølge
  swipeSensitivity:0.012,   // Mobil-dra følsomhet
  keyMoveSpeed:    6,       // Tastaturbevegelse (enheter/s)
  minCrowd:        1,
  maxCrowd:        999,
};

// ── State ──────────────────────────────────────────────────
let state = 'start'; // 'start' | 'playing' | 'dead' | 'victory'
let crowd = 0;
let wave = 0;
let highScore = 0;
let speed = CFG.runSpeed;
let totalDist = 0;       // Løpt avstand (Z)
let crowdX = 0;          // Sideveis posisjon på veien
let targetX = 0;         // Smooth target

// ── Three.js grunnoppsett ──────────────────────────────────
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 40, 90);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
// Portrettmodus: kamera bak og over mengden
camera.position.set(0, 14, 16);
camera.lookAt(0, 0, -10);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Lys
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(10, 20, 10);
sun.castShadow = true;
sun.shadow.mapSize.width = 1024;
sun.shadow.mapSize.height = 1024;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 100;
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
scene.add(sun);

// ── Geometrier (gjenbrukbare) ──────────────────────────────
const bodyGeo  = new THREE.CylinderGeometry(0.22, 0.22, 0.55, 7);
const headGeo  = new THREE.SphereGeometry(0.2, 8, 8);
const legGeo   = new THREE.CylinderGeometry(0.08, 0.08, 0.35, 6);
const gateGeo  = new THREE.BoxGeometry(1.8, 2.4, 0.2);
const postGeo  = new THREE.BoxGeometry(0.12, 2.8, 0.12);

// Materialer
const matPlayer  = new THREE.MeshLambertMaterial({ color: 0x4fc3f7 }); // lyseblå
const matHead    = new THREE.MeshLambertMaterial({ color: 0xffcc80 }); // hudfarge
const matLeg     = new THREE.MeshLambertMaterial({ color: 0x1565c0 }); // mørk blå
const matEnemy   = new THREE.MeshLambertMaterial({ color: 0xef5350 }); // rød
const matEHead   = new THREE.MeshLambertMaterial({ color: 0xffcc80 });
const matELeg    = new THREE.MeshLambertMaterial({ color: 0xb71c1c });
const matPost    = new THREE.MeshLambertMaterial({ color: 0xbdbdbd });

// ── Figur-fabrikk ──────────────────────────────────────────
function makeFigure(isEnemy = false) {
  const root = new THREE.Group();
  const bMat = isEnemy ? matEnemy  : matPlayer;
  const hMat = isEnemy ? matEHead  : matHead;
  const lMat = isEnemy ? matELeg   : matLeg;

  const body = new THREE.Mesh(bodyGeo, bMat);
  body.position.y = 0.55;
  body.castShadow = true;
  root.add(body);

  const head = new THREE.Mesh(headGeo, hMat);
  head.position.y = 1.05;
  head.castShadow = true;
  root.add(head);

  const legL = new THREE.Mesh(legGeo, lMat);
  legL.position.set(-0.12, 0.18, 0);
  root.add(legL);

  const legR = new THREE.Mesh(legGeo, lMat);
  legR.position.set(0.12, 0.18, 0);
  root.add(legR);

  root.userData.legL = legL;
  root.userData.legR = legR;
  return root;
}

// ── Vei ───────────────────────────────────────────────────
const ROAD_W = 8;
const ROAD_SEG_LEN = 30;
const NUM_ROAD_SEGS = 6;
const roadSegs = [];

const roadMat  = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });
const markMat  = new THREE.MeshLambertMaterial({ color: 0xffffff });
const grassMat = new THREE.MeshLambertMaterial({ color: 0x66bb6a });

function makeRoadSegment(z) {
  const g = new THREE.Group();

  // Asfalt
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_W, 0.1, ROAD_SEG_LEN),
    roadMat
  );
  road.receiveShadow = true;
  g.add(road);

  // Gress på sidene
  [-1, 1].forEach(side => {
    const grass = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.08, ROAD_SEG_LEN),
      grassMat
    );
    grass.position.x = side * (ROAD_W / 2 + 3);
    g.add(grass);
  });

  // Stiplet midtlinje
  for (let i = -ROAD_SEG_LEN / 2 + 2; i < ROAD_SEG_LEN / 2; i += 4) {
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.12, 1.5),
      markMat
    );
    mark.position.z = i;
    g.add(mark);
  }

  g.position.set(0, 0, z);
  scene.add(g);
  return g;
}

// Initialiser vei-segmenter
for (let i = 0; i < NUM_ROAD_SEGS; i++) {
  roadSegs.push(makeRoadSegment(-i * ROAD_SEG_LEN));
}

// ── Crowd-system ───────────────────────────────────────────
const crowdFigures = [];   // { mesh, offset }
const crowdGroup = new THREE.Group();
scene.add(crowdGroup);

function rebuildCrowd() {
  // Fjern gamle
  while (crowdGroup.children.length) {
    crowdGroup.remove(crowdGroup.children[0]);
  }
  crowdFigures.length = 0;

  const n = Math.min(crowd, 80); // Maks 80 synlige figurer (ytelse)
  for (let i = 0; i < n; i++) {
    const fig = makeFigure(false);
    // Spiral-formasjon
    const angle = i * 2.399963; // gylden vinkel
    const r = Math.sqrt(i / n) * CFG.crowdSpread;
    const ox = Math.cos(angle) * r;
    const oz = Math.sin(angle) * r * 0.6;
    fig.position.set(ox, 0, oz);
    crowdGroup.add(fig);
    crowdFigures.push({ mesh: fig, ox, oz });
  }
}

// ── Porter ────────────────────────────────────────────────
const gates = []; // { group, op, value, lane (0|1|2), z }

const GATE_GOOD_MAT  = new THREE.MeshLambertMaterial({ color: 0x4caf50, transparent: true, opacity: 0.85 });
const GATE_GREAT_MAT = new THREE.MeshLambertMaterial({ color: 0x2196f3, transparent: true, opacity: 0.85 });
const GATE_BAD_MAT   = new THREE.MeshLambertMaterial({ color: 0xf44336, transparent: true, opacity: 0.85 });

function applyOp(n, op, val) {
  if (op === '+') return n + val;
  if (op === '-') return Math.max(CFG.minCrowd, n - val);
  if (op === '*') return Math.min(CFG.maxCrowd, n * val);
  if (op === '/') return Math.max(CFG.minCrowd, Math.floor(n / val));
  return n;
}

function opLabel(op, val) {
  if (op === '+') return `+${val}`;
  if (op === '-') return `-${val}`;
  if (op === '*') return `×${val}`;
  if (op === '/') return `÷${val}`;
  return `${val}`;
}

function isBeneficial(n, op, val) {
  return applyOp(n, op, val) > n;
}

// Enkel 2D-tekst via CanvasTexture
function makeLabel(text, color = '#fff') {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size; c.height = size / 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = `bold ${size * 0.36}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 4);
  return new THREE.CanvasTexture(c);
}

function spawnGatePair(z) {
  // Velg to av tre felt – venstre og høyre gate
  const lane1 = Math.floor(Math.random() * 3);
  let lane2 = (lane1 + 1 + Math.floor(Math.random() * 2)) % 3;

  const ops = [
    { op: '+', val: Math.floor(3 + wave * 1.5) },
    { op: '-', val: Math.floor(2 + wave * 1.2) },
    { op: '*', val: [2, 3][Math.floor(Math.random() * 2)] },
    { op: '/', val: 2 },
    { op: '+', val: Math.floor(5 + wave * 2) },
  ];

  const pick1 = ops[Math.floor(Math.random() * ops.length)];
  const pick2 = ops[Math.floor(Math.random() * ops.length)];

  [
    { lane: lane1, pick: pick1 },
    { lane: lane2, pick: pick2 },
  ].forEach(({ lane, pick }) => {
    const { op, val } = pick;
    const good = isBeneficial(crowd, op, val);
    // Multiplisjon er alltid "great" (blå), god → grønn, dårlig → rød
    const mat = (op === '*') ? GATE_GREAT_MAT : (good ? GATE_GOOD_MAT : GATE_BAD_MAT);
    const labelColor = (op === '*') ? '#e3f2fd' : (good ? '#e8f5e9' : '#ffebee');

    const xPos = (lane - 1) * CFG.laneWidth;

    const g = new THREE.Group();

    const face = new THREE.Mesh(gateGeo, mat);
    face.position.y = 1.2;
    face.castShadow = true;
    g.add(face);

    // Tekst-label
    const tex = makeLabel(opLabel(op, val), labelColor);
    const labelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.8),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false })
    );
    labelMesh.position.y = 1.2;
    labelMesh.position.z = 0.12;
    g.add(labelMesh);

    // Stolper
    [-0.8, 0.8].forEach(dx => {
      const post = new THREE.Mesh(postGeo, matPost);
      post.position.set(dx, 1.4, 0);
      g.add(post);
    });

    g.position.set(xPos, 0, z);
    scene.add(g);
    gates.push({ group: g, op, val, lane, z, passed: false });
  });
}

// ── Fiender ───────────────────────────────────────────────
const enemyWaves = []; // { group, figures, hp, maxHp, z, label }
const hpBarCanvas = {};

function makeHPLabel(hp, maxHp) {
  const w = 256, h = 48;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // Bakgrunn
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, 0, 0, w, h, 8);
  ctx.fill();

  // HP-bar
  const pct = Math.max(0, hp / maxHp);
  const col = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#f44336';
  ctx.fillStyle = col;
  roundRect(ctx, 4, 4, (w - 8) * pct, h - 8, 5);
  ctx.fill();

  // Tekst
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${h * 0.55}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${hp}`, w / 2, h / 2);

  return new THREE.CanvasTexture(c);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function spawnEnemyWave(z, waveNum) {
  const isBoss = (waveNum % CFG.bossEveryN === 0);
  const baseHP = Math.round(CFG.baseEnemyHP * Math.pow(CFG.enemyHPScale, waveNum));
  const hp = isBoss ? baseHP * CFG.bossMultiplier : baseHP;

  const count = isBoss ? 20 : Math.min(8 + waveNum * 2, 30);
  const g = new THREE.Group();

  for (let i = 0; i < count; i++) {
    const fig = makeFigure(true);
    if (isBoss) {
      fig.scale.set(1.4, 1.4, 1.4);
    }
    const angle = i * 2.399963;
    const r = Math.sqrt(i / count) * (isBoss ? 2.8 : 2.0);
    fig.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r * 0.5);
    g.add(fig);
  }

  // HP label (billboard)
  const tex = makeHPLabel(hp, hp);
  const labelMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 0.8),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false })
  );
  labelMesh.position.y = isBoss ? 3.5 : 2.5;
  g.add(labelMesh);

  if (isBoss) {
    // Boss-glow-ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.15, 8, 32),
      new THREE.MeshLambertMaterial({ color: 0xffd700 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.15;
    g.add(ring);
  }

  g.position.set(0, 0, z);
  scene.add(g);

  enemyWaves.push({ group: g, hp, maxHp: hp, z, isBoss, labelMesh, tex, count, figures: g.children.filter(c => c.isGroup) });
}

// ── Neste spawn-avstand ────────────────────────────────────
let nextGateZ    = -CFG.gateSpawnDist;
let nextEnemyZ   = -CFG.enemySpawnDist;
let waveCounter  = 0;

// ── Input ─────────────────────────────────────────────────
let pointerDown  = false;
let pointerLastX = 0;
const keys       = {};

// Tastatur
window.addEventListener('keydown', e => { keys[e.key] = true; });
window.addEventListener('keyup',   e => { keys[e.key] = false; });

// Peker (touch + mus)
canvas.addEventListener('pointerdown', e => {
  pointerDown  = true;
  pointerLastX = e.clientX;
});
window.addEventListener('pointermove', e => {
  if (!pointerDown || state !== 'playing') return;
  const dx = e.clientX - pointerLastX;
  pointerLastX = e.clientX;
  targetX += dx * CFG.swipeSensitivity * (ROAD_W / window.innerWidth) * ROAD_W;
});
window.addEventListener('pointerup',   () => { pointerDown = false; });

// Klampe crowd til veien
function clampCrowdX() {
  const limit = ROAD_W / 2 - 0.8;
  targetX = Math.max(-limit, Math.min(limit, targetX));
}

// ── UI-referanser ──────────────────────────────────────────
const uiCount     = document.getElementById('crowd-count');
const uiScore     = document.getElementById('score-display');
const startScreen = document.getElementById('start-screen');
const gameoverScr = document.getElementById('gameover-screen');
const victoryScr  = document.getElementById('victory-screen');
const finalScore  = document.getElementById('final-score');
const highScoreEl = document.getElementById('high-score-display');
const victoryScoreEl = document.getElementById('victory-score');

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);
document.getElementById('victory-restart-btn').addEventListener('click', startGame);

// ── Starte/restarte spillet ────────────────────────────────
function startGame() {
  // Rens scene
  gates.forEach(g => scene.remove(g.group));
  gates.length = 0;
  enemyWaves.forEach(e => scene.remove(e.group));
  enemyWaves.length = 0;

  crowd   = CFG.startCrowd;
  wave    = 0;
  speed   = CFG.runSpeed;
  totalDist = 0;
  crowdX  = 0;
  targetX = 0;

  nextGateZ  = -CFG.gateSpawnDist;
  nextEnemyZ = -CFG.enemySpawnDist;
  waveCounter = 0;

  rebuildCrowd();

  startScreen.classList.add('hidden');
  gameoverScr.classList.add('hidden');
  victoryScr.classList.add('hidden');

  state = 'playing';
  updateHUD();
}

function gameOver() {
  state = 'dead';
  if (wave > highScore) highScore = wave;
  finalScore.textContent   = `Du klarte bølge ${wave}`;
  highScoreEl.textContent  = `Rekord: ${highScore} bølger`;
  gameoverScr.classList.remove('hidden');
}

function victory() {
  state = 'victory';
  if (wave > highScore) highScore = wave;
  victoryScoreEl.textContent = `${wave} bølger klart! Mengde: ${crowd}`;
  victoryScr.classList.remove('hidden');
}

function updateHUD() {
  uiCount.textContent = crowd;
  uiScore.textContent = `Bølge: ${wave}`;
}

// ── Kamp-logikk ────────────────────────────────────────────
let battleAnim = null; // null | { enemy, timer, done }

function startBattle(enemy) {
  state = 'battle';
  battleAnim = { enemy, timer: 0, done: false };
}

function resolveBattle(dt) {
  if (!battleAnim) return;
  battleAnim.timer += dt;

  const enemy = battleAnim.enemy;

  // Simuler kamp hvert 0.4s
  if (battleAnim.timer > 0.4 && !battleAnim.done) {
    battleAnim.timer = 0;

    const dmg = Math.min(crowd, enemy.hp);
    const edm = Math.min(enemy.hp, crowd);

    crowd      = Math.max(0, crowd - edm);
    enemy.hp   = Math.max(0, enemy.hp - dmg);

    // Oppdater HP-label
    const newTex = makeHPLabel(enemy.hp, enemy.maxHp);
    enemy.labelMesh.material.map.dispose();
    enemy.labelMesh.material.map = newTex;
    enemy.labelMesh.material.needsUpdate = true;

    rebuildCrowd();
    updateHUD();

    if (crowd <= 0) {
      battleAnim.done = true;
      setTimeout(() => gameOver(), 800);
      return;
    }

    if (enemy.hp <= 0) {
      // Fjern fiende
      scene.remove(enemy.group);
      const idx = enemyWaves.indexOf(enemy);
      if (idx !== -1) enemyWaves.splice(idx, 1);

      waveCounter++;
      wave++;
      speed += CFG.speedIncrement;
      updateHUD();

      battleAnim = null;
      state = 'playing';

      if (waveCounter >= 20) {
        victory();
      }
    }
  }
}

// ── Animasjons-timer ───────────────────────────────────────
let legPhase = 0;

function animateCrowd(dt) {
  legPhase += dt * 8;
  const swing = Math.sin(legPhase) * 0.4;
  crowdFigures.forEach((f, i) => {
    if (f.mesh.userData.legL) {
      f.mesh.userData.legL.rotation.x =  swing * (i % 2 === 0 ? 1 : -1);
      f.mesh.userData.legR.rotation.x = -swing * (i % 2 === 0 ? 1 : -1);
    }
    // Litt bounce
    f.mesh.position.y = Math.abs(Math.sin(legPhase + i)) * 0.08;
  });
}

// ── Hoved game-loop ────────────────────────────────────────
let lastTime = null;

function gameLoop(ts) {
  requestAnimationFrame(gameLoop);

  const dt = lastTime ? Math.min((ts - lastTime) / 1000, 0.05) : 0.016;
  lastTime = ts;

  if (state === 'playing') {
    // Input
    if (keys['ArrowLeft']  || keys['a'] || keys['A']) targetX -= CFG.keyMoveSpeed * dt;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) targetX += CFG.keyMoveSpeed * dt;
    clampCrowdX();

    // Smooth bevegelse
    crowdX += (targetX - crowdX) * Math.min(1, dt * 12);

    // Flytt fremover
    totalDist += speed * dt;

    // Vei-recycling
    roadSegs.forEach(seg => {
      if (seg.position.z > totalDist + ROAD_SEG_LEN) {
        seg.position.z -= NUM_ROAD_SEGS * ROAD_SEG_LEN;
      }
    });

    // Spawn porter
    if (-totalDist < nextGateZ + 10) {
      spawnGatePair(nextGateZ);
      nextGateZ -= CFG.gateSpawnDist;
    }

    // Spawn fiende
    if (-totalDist < nextEnemyZ + 10) {
      spawnEnemyWave(nextEnemyZ, waveCounter);
      nextEnemyZ -= CFG.enemySpawnDist;
    }

    // Sjekk gate-kollisjon
    const crowdWorldZ = -totalDist;
    gates.forEach(gate => {
      if (gate.passed) return;
      if (crowdWorldZ < gate.z + 2 && crowdWorldZ > gate.z - 3) {
        // Sjekk X-overlap
        const gateCenterX = (gate.lane - 1) * CFG.laneWidth;
        if (Math.abs(crowdX - gateCenterX) < CFG.laneWidth * 0.55) {
          gate.passed = true;
          crowd = Math.max(CFG.minCrowd, Math.min(CFG.maxCrowd,
                  applyOp(crowd, gate.op, gate.val)));
          rebuildCrowd();
          updateHUD();
          // Blink-effekt
          gate.group.scale.set(1.15, 1.15, 1.15);
          setTimeout(() => { if (gate.group) gate.group.scale.set(1, 1, 1); }, 200);
        }
      }
    });

    // Sjekk fiende-kollisjon
    enemyWaves.forEach(enemy => {
      if (crowdWorldZ < enemy.z + 3 && crowdWorldZ > enemy.z - 3) {
        startBattle(enemy);
      }
    });

    // Fjern passerte porter
    for (let i = gates.length - 1; i >= 0; i--) {
      if (gates[i].z > crowdWorldZ + 10) {
        scene.remove(gates[i].group);
        gates.splice(i, 1);
      }
    }

    // Plasser crowd-gruppen
    crowdGroup.position.set(crowdX, 0, crowdWorldZ);

    // Kamera følger crowd
    camera.position.set(crowdX * 0.3, 14, crowdWorldZ + 16);
    camera.lookAt(crowdX * 0.3, 0, crowdWorldZ - 10);

    // Flytt porter og fiender relativt (de er i world-space, vei recycler)
    // (De er allerede i scene-koordinater og beveger seg ikke – crowd-gruppen beveger seg)

    animateCrowd(dt);
  }

  if (state === 'battle') {
    resolveBattle(dt);
    animateCrowd(dt);
  }

  renderer.render(scene, camera);
}

// ── Start animasjonssløyfe ─────────────────────────────────
requestAnimationFrame(gameLoop);
