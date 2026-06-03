// ============================================================
//  CROWD RUNNER – Shoot & Multiply
//  Crowd løper fremover, skyter automatisk på fiender.
//  Grønne porter = flere folk, røde = færre folk.
//  Verden ruller mot kamera, crowd er statisk i Z.
// ============================================================

const CFG = {
  startCrowd:     10,
  runSpeed:        7,
  speedIncrement: 0.2,
  roadWidth:       9,
  laneWidth:      2.6,
  crowdSpread:    1.9,
  gateInterval:   30,
  enemyInterval:  75,
  bossEveryN:      5,
  baseEnemyHP:    50,
  enemyHPScale:   1.6,
  bossMultiplier:  4,
  keySpeed:        7,
  minCrowd:        1,
  maxCrowd:       999,
  winAtWave:      20,
  bulletSpeed:    28,
  shootInterval:  0.18,  // sekunder mellom skudd
  bulletDmg:       1,
  enemyShootInterval: 0.5,
  enemyBulletSpeed:   14,
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
scene.background = new THREE.Color(0x87ceeb);
scene.fog        = new THREE.Fog(0x87ceeb, 38, 90);

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

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(10, 22, 10);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left:-22, right:22, top:22, bottom:-22, near:0.5, far:80 });
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

// ── Geomtrier ──────────────────────────────────────────────
const GEO = {
  body:   new THREE.CylinderGeometry(0.22, 0.22, 0.55, 7),
  head:   new THREE.SphereGeometry(0.2, 8, 8),
  leg:    new THREE.CylinderGeometry(0.08, 0.08, 0.35, 6),
  gun:    new THREE.BoxGeometry(0.08, 0.08, 0.45),
  bullet: new THREE.SphereGeometry(0.1, 6, 6),
  eBullet:new THREE.SphereGeometry(0.13, 6, 6),
  gate:   new THREE.BoxGeometry(2.0, 2.6, 0.22),
  post:   new THREE.BoxGeometry(0.14, 3.1, 0.14),
};

const MAT = {
  bulletPlayer: new THREE.MeshBasicMaterial({ color: 0xffee58 }),
  bulletEnemy:  new THREE.MeshBasicMaterial({ color: 0xff5252 }),
};

// ── Figur-fabrikk ──────────────────────────────────────────
function makeFigure(isEnemy) {
  const root = new THREE.Group();
  const col = isEnemy
    ? { body:0xef5350, head:0xffcc80, leg:0xb71c1c, gun:0x333333 }
    : { body:0x42a5f5, head:0xffcc80, leg:0x1565c0, gun:0x212121 };

  const mk = (geo, color) => {
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    m.castShadow = true;
    return m;
  };

  const body = mk(GEO.body, col.body); body.position.y = 0.55; root.add(body);
  const head = mk(GEO.head, col.head); head.position.y = 1.06; root.add(head);
  const legL = mk(GEO.leg,  col.leg);  legL.position.set(-0.12, 0.18, 0); root.add(legL);
  const legR = mk(GEO.leg,  col.leg);  legR.position.set( 0.12, 0.18, 0); root.add(legR);

  // Gevær
  const gun = mk(GEO.gun, col.gun);
  gun.position.set(isEnemy ? -0.3 : 0.3, 0.68, isEnemy ? 0.22 : -0.22);
  gun.rotation.x = isEnemy ? -Math.PI*0.15 : Math.PI*0.15;
  root.add(gun);

  root.userData.legL = legL;
  root.userData.legR = legR;
  return root;
}

// ── Vei ───────────────────────────────────────────────────
const SEG = 28, NSEGS = 7;
const roadMat  = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
const grassMat = new THREE.MeshLambertMaterial({ color: 0x66bb6a });
const lineMat  = new THREE.MeshLambertMaterial({ color: 0xffffff });

function makeRoadSeg() {
  const g = new THREE.Group();
  const r = new THREE.Mesh(new THREE.BoxGeometry(CFG.roadWidth, 0.12, SEG), roadMat);
  r.receiveShadow = true;
  g.add(r);
  [-1,1].forEach(s => {
    const gr = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, SEG), grassMat);
    gr.position.x = s * (CFG.roadWidth/2 + 3);
    g.add(gr);
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

// ── Crowd ──────────────────────────────────────────────────
const crowdGroup = new THREE.Group();
scene.add(crowdGroup);
const crowdFigs = [];

function rebuildCrowd() {
  while (crowdGroup.children.length) crowdGroup.remove(crowdGroup.children[0]);
  crowdFigs.length = 0;
  const n = Math.min(crowdSize, 80);
  for (let i = 0; i < n; i++) {
    const fig   = makeFigure(false);
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
    const fig   = makeFigure(true);
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

function updateEnemies(dz) {
  for (let i = enemies.length-1; i >= 0; i--) {
    const en = enemies[i];
    en.group.position.z += dz;
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

// ── Skudd ──────────────────────────────────────────────────
const playerBullets = []; // { mesh, vz }
const enemyBullets  = []; // { mesh, vz, vx }

function shootPlayerBullets() {
  if (!enemies.length) return;
  // Fremste fiende
  const target = enemies.reduce((a,b) => a.group.position.z > b.group.position.z ? a : b);
  if (target.group.position.z < -40) return; // for langt unna

  // Skyt fra noen tilfeldige figurer i crowd
  const shooters = Math.min(crowdSize, Math.min(crowdFigs.length, 5));
  for (let i = 0; i < shooters; i++) {
    const fig = crowdFigs[i];
    const wx  = crowdX + (fig ? fig.position.x : 0);
    const wz  = fig ? fig.position.z : 0;

    const bullet = new THREE.Mesh(GEO.bullet, MAT.bulletPlayer);
    bullet.position.set(wx, 0.85, wz);
    scene.add(bullet);
    playerBullets.push({ mesh: bullet });
  }
}

function shootEnemyBullets(en) {
  const numShooters = Math.min(4, Math.ceil(en.hp / en.maxHp * 4));
  for (let i = 0; i < numShooters; i++) {
    const spread = (Math.random()-0.5) * 3;
    const bullet = new THREE.Mesh(GEO.eBullet, MAT.bulletEnemy);
    bullet.position.set(
      en.group.position.x + spread,
      0.85,
      en.group.position.z
    );
    scene.add(bullet);
    // Skyt mot crowd (positiv Z = mot kamera)
    enemyBullets.push({ mesh: bullet, vx: spread*0.3 });
  }
}

function updateBullets(dt) {
  const dz = speed * dt; // verden beveger seg +dz, skudd beveger seg relativt

  // Spillerskudd – beveger seg i -Z (fremover i verden)
  for (let i = playerBullets.length-1; i >= 0; i--) {
    const b = playerBullets[i];
    b.mesh.position.z -= CFG.bulletSpeed * dt;

    // Treff fiende?
    let hit = false;
    for (const en of enemies) {
      if (!en.alive) continue;
      const dz2 = b.mesh.position.z - en.group.position.z;
      const dx2 = b.mesh.position.x - en.group.position.x;
      if (Math.abs(dz2) < 2.5 && Math.abs(dx2) < 3.0) {
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
          if (wave >= CFG.winAtWave) { setTimeout(triggerVictory, 400); }
        }
        break;
      }
    }

    // Fjern skudd hvis treff eller for langt
    if (hit || b.mesh.position.z < -50) {
      scene.remove(b.mesh);
      playerBullets.splice(i, 1);
    }
  }

  // Fiendeskudd – beveger seg i +Z (mot kamera/crowd)
  for (let i = enemyBullets.length-1; i >= 0; i--) {
    const b = enemyBullets[i];
    b.mesh.position.z += CFG.enemyBulletSpeed * dt;
    b.mesh.position.x += b.vx * dt * 2;

    // Treff crowd?
    const dz2 = b.mesh.position.z;       // crowd er ved z≈0
    const dx2 = b.mesh.position.x - crowdX;
    if (Math.abs(dz2) < 2.5 && Math.abs(dx2) < CFG.crowdSpread + 0.5) {
      crowdSize = Math.max(0, crowdSize - 1);
      rebuildCrowd();
      updateHUD();
      scene.remove(b.mesh);
      enemyBullets.splice(i, 1);

      if (crowdSize <= 0) { setTimeout(triggerGameOver, 500); return; }
      continue;
    }

    if (b.mesh.position.z > 25) {
      scene.remove(b.mesh);
      enemyBullets.splice(i, 1);
    }
  }
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
  playerBullets.forEach(b => scene.remove(b.mesh));  playerBullets.length=0;
  enemyBullets.forEach(b => scene.remove(b.mesh));   enemyBullets.length=0;

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

function loop(ts) {
  requestAnimationFrame(loop);
  const dt = lastTS ? Math.min((ts-lastTS)/1000, 0.05) : 0.016;
  lastTS = ts;

  if (state==='playing') {
    // Tastatur
    if (keys['ArrowLeft'] ||keys['a']||keys['A']) targetX=clampX(targetX-CFG.keySpeed*dt);
    if (keys['ArrowRight']||keys['d']||keys['D']) targetX=clampX(targetX+CFG.keySpeed*dt);

    crowdX += (targetX-crowdX)*Math.min(1, dt*14);
    crowdGroup.position.x = crowdX;

    const dz = speed*dt;
    updateRoad(dz);
    updateGates(dz);
    updateEnemies(dz);
    checkSpawns(dz);

    // Auto-skyting
    shootTimer += dt;
    if (shootTimer >= CFG.shootInterval && enemies.length > 0) {
      shootTimer = 0;
      shootPlayerBullets();
    }

    // Fiende skyter tilbake når den er nær nok
    if (enemies.length > 0) {
      const closestEnemy = enemies.reduce((a,b) =>
        a.group.position.z > b.group.position.z ? a : b);
      if (closestEnemy.group.position.z > -35) {
        enemyShootTimer += dt;
        if (enemyShootTimer >= CFG.enemyShootInterval) {
          enemyShootTimer = 0;
          shootEnemyBullets(closestEnemy);
        }
      }
    }

    updateBullets(dt);
    animateCrowd(dt);

    // Kamera følger crowd X lett
    camera.position.x += (crowdX*0.2 - camera.position.x)*dt*5;
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(loop);
