const CONFIG = Object.freeze({
  worldWidth: 900,
  worldHeight: 1400,
  lanes: [-260, 0, 260],
  playerBaseY: 1115,
  horizonY: 210,
  startSpeed: 520,
  maxSpeed: 1420,
  speedRamp: 10.5,
  gravity: 2500,
  jumpVelocity: -1030,
  laneMoveSpeed: 13,
  spawnLead: 2450,
  despawnZ: -220,
  minGap: 520,
  coinValue: 75,
  distanceScoreRate: 0.18,
  slideDuration: 0.72,
  magnetDuration: 7,
  multiplierDuration: 8
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => min + Math.random() * (max - min);
const choice = (items) => items[Math.floor(Math.random() * items.length)];

class InputHandler {
  constructor(target) {
    this.actions = new Set();
    this.touchStart = null;
    this.swipeThreshold = 32;
    window.addEventListener("keydown", (event) => this.onKey(event));
    target.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    target.addEventListener("pointerup", (event) => this.onPointerUp(event));
  }

  consume(action) {
    if (!this.actions.has(action)) return false;
    this.actions.delete(action);
    return true;
  }

  queue(action) {
    this.actions.add(action);
  }

  onKey(event) {
    const key = event.key.toLowerCase();
    const map = {
      arrowleft: "left",
      a: "left",
      arrowright: "right",
      d: "right",
      arrowup: "jump",
      w: "jump",
      arrowdown: "slide",
      s: "slide",
      p: "pause",
      " ": "start",
      enter: "start"
    };
    if (map[key]) {
      event.preventDefault();
      this.queue(map[key]);
    }
  }

  onPointerDown(event) {
    this.touchStart = { x: event.clientX, y: event.clientY };
  }

  onPointerUp(event) {
    if (!this.touchStart) return;
    const dx = event.clientX - this.touchStart.x;
    const dy = event.clientY - this.touchStart.y;
    this.touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < this.swipeThreshold) {
      this.queue("start");
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      this.queue(dx < 0 ? "left" : "right");
    } else {
      this.queue(dy < 0 ? "jump" : "slide");
    }
  }
}

class AudioBus {
  constructor() {
    this.context = null;
    this.enabled = true;
  }

  ensure() {
    if (!this.enabled || this.context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) this.context = new AudioContext();
  }

  play(type) {
    this.ensure();
    if (!this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const presets = {
      jump: [420, 700, 0.08, "triangle"],
      coin: [880, 1320, 0.09, "sine"],
      crash: [140, 50, 0.22, "sawtooth"],
      power: [520, 980, 0.18, "square"]
    };
    const [start, end, duration, wave] = presets[type] || presets.coin;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(start, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, end), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}

class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.pixelRatio = 1;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.pixelRatio));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.pixelRatio));
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this.scale = Math.min(this.width / CONFIG.worldWidth, this.height / CONFIG.worldHeight);
    this.offsetX = this.width / 2;
    this.offsetY = (this.height - CONFIG.worldHeight * this.scale) * 0.5;
  }

  worldToScreen(x, z, y = 0) {
    const depth = clamp(z / CONFIG.spawnLead, 0, 1);
    const perspective = 0.34 + (1 - depth) * 0.86;
    const laneSpread = perspective * this.scale;
    const screenX = this.offsetX + x * laneSpread;
    const baseY = this.offsetY + lerp(CONFIG.horizonY, CONFIG.playerBaseY, 1 - depth) * this.scale;
    return { x: screenX, y: baseY - y * perspective * this.scale, p: perspective };
  }
}

class Player {
  constructor() {
    this.reset();
  }

  reset() {
    this.lane = 1;
    this.targetLane = 1;
    this.x = CONFIG.lanes[1];
    this.y = 0;
    this.vy = 0;
    this.width = 86;
    this.height = 172;
    this.slideTimer = 0;
    this.runTime = 0;
    this.invuln = 0;
  }

  get isSliding() {
    return this.slideTimer > 0 && this.y <= 2;
  }

  get isJumping() {
    return this.y > 2;
  }

  update(dt, input, audio) {
    if (input.consume("left")) this.targetLane = Math.max(0, this.targetLane - 1);
    if (input.consume("right")) this.targetLane = Math.min(2, this.targetLane + 1);
    if (input.consume("jump") && this.y <= 1) {
      this.vy = CONFIG.jumpVelocity;
      this.slideTimer = 0;
      audio.play("jump");
    }
    if (input.consume("slide") && this.y <= 1) {
      this.slideTimer = CONFIG.slideDuration;
    }

    this.runTime += dt;
    this.slideTimer = Math.max(0, this.slideTimer - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.x = lerp(this.x, CONFIG.lanes[this.targetLane], 1 - Math.exp(-CONFIG.laneMoveSpeed * dt));

    this.vy += CONFIG.gravity * dt;
    this.y -= this.vy * dt;
    if (this.y <= 0) {
      this.y = 0;
      this.vy = 0;
    }
  }

  bounds() {
    const height = this.isSliding ? 94 : 172;
    const width = this.isSliding ? 108 : 82;
    const bottom = this.y;
    return {
      x: this.x - width / 2,
      y: bottom,
      width,
      height
    };
  }

  render(ctx, camera, theme) {
    const pos = camera.worldToScreen(this.x, 0, this.y);
    const scale = camera.scale * pos.p;
    const bob = this.isJumping || this.isSliding ? 0 : Math.sin(this.runTime * 15) * 6 * scale;
    const x = pos.x;
    const feet = pos.y + bob;
    const run = Math.sin(this.runTime * 16);
    const lift = Math.abs(Math.cos(this.runTime * 16));
    const bodyColor = theme.player;

    ctx.save();
    ctx.translate(x, feet);

    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(0, 20 * scale, (this.isSliding ? 72 : 58) * scale, 12 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    if (this.isSliding) this.renderSlidingRunner(ctx, scale, bodyColor, run);
    else this.renderUprightRunner(ctx, scale, bodyColor, run, lift);

    ctx.restore();
  }

  renderUprightRunner(ctx, scale, bodyColor, run, lift) {
    const stride = run * 25 * scale;
    const shoulderRoll = run * 7 * scale;
    const hipY = -72 * scale;
    const shoulderY = -128 * scale;

    drawLimb(ctx, -18 * scale, hipY, -34 * scale - stride, 7 * scale - lift * 9 * scale, 12 * scale, "#101820", "#2a3540");
    drawLimb(ctx, 18 * scale, hipY, 34 * scale + stride, 7 * scale - (1 - lift) * 9 * scale, 12 * scale, "#101820", "#2a3540");
    drawShoe(ctx, -40 * scale - stride, 13 * scale - lift * 9 * scale, scale, run < 0 ? 1 : 0.72);
    drawShoe(ctx, 40 * scale + stride, 13 * scale - (1 - lift) * 9 * scale, scale, run > 0 ? 1 : 0.72);

    drawLimb(ctx, -30 * scale, -113 * scale, -51 * scale + stride * 0.45, -67 * scale, 10 * scale, "#f6fbff", "#9fb8c8");
    drawLimb(ctx, 30 * scale, -113 * scale, 52 * scale - stride * 0.45, -70 * scale, 10 * scale, "#f6fbff", "#9fb8c8");

    drawBody3D(ctx, -38 * scale + shoulderRoll * 0.14, -146 * scale, 76 * scale, 82 * scale, 17 * scale, bodyColor);
    drawChestPanel(ctx, scale);
    drawHead3D(ctx, 0, -175 * scale, 31 * scale, scale, bodyColor);

    drawJoint(ctx, -31 * scale, -115 * scale, 7 * scale, "#f6fbff");
    drawJoint(ctx, 31 * scale, -115 * scale, 7 * scale, "#f6fbff");
  }

  renderSlidingRunner(ctx, scale, bodyColor, run) {
    ctx.rotate(-0.07);
    drawLimb(ctx, -18 * scale, -44 * scale, -64 * scale, -12 * scale, 13 * scale, "#101820", "#2a3540");
    drawLimb(ctx, 18 * scale, -44 * scale, 65 * scale, -13 * scale, 13 * scale, "#101820", "#2a3540");
    drawShoe(ctx, -72 * scale, -8 * scale, scale, 0.82);
    drawShoe(ctx, 72 * scale, -9 * scale, scale, 0.82);

    drawLimb(ctx, -33 * scale, -84 * scale, -68 * scale, -54 * scale + run * 5 * scale, 10 * scale, "#f6fbff", "#9fb8c8");
    drawLimb(ctx, 29 * scale, -83 * scale, 65 * scale, -55 * scale - run * 5 * scale, 10 * scale, "#f6fbff", "#9fb8c8");

    drawBody3D(ctx, -60 * scale, -106 * scale, 120 * scale, 58 * scale, 18 * scale, bodyColor);
    drawHead3D(ctx, 43 * scale, -112 * scale, 28 * scale, scale, bodyColor);
    drawJoint(ctx, -38 * scale, -85 * scale, 7 * scale, "#f6fbff");
    drawJoint(ctx, 35 * scale, -84 * scale, 7 * scale, "#f6fbff");
  }
}

class Entity {
  constructor(lane, z) {
    this.lane = lane;
    this.x = CONFIG.lanes[lane];
    this.z = z;
    this.collected = false;
  }

  update(dt, speed) {
    this.z -= speed * dt;
  }
}

class Obstacle extends Entity {
  constructor(lane, z, type) {
    super(lane, z);
    this.type = type;
    const data = {
      barrier: { w: 120, h: 92, y: 0, color: "#ffcc4a" },
      low: { w: 138, h: 112, y: 96, color: "#39d5ff" },
      block: { w: 150, h: 202, y: 0, color: "#ff5b6e" }
    }[type];
    Object.assign(this, data);
  }

  bounds() {
    return {
      x: this.x - this.w / 2,
      y: this.y,
      width: this.w,
      height: this.h
    };
  }

  render(ctx, camera) {
    const pos = camera.worldToScreen(this.x, this.z, this.y);
    const scale = camera.scale * pos.p;
    const w = this.w * scale;
    const h = this.h * scale;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, (this.h + 12) * scale, w * 0.46, 9 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this.color;
    roundRect(ctx, -w / 2, -h, w, h, 8 * scale);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    for (let i = -1; i <= 1; i += 1) {
      ctx.fillRect(-w / 2 + 12 * scale, -h * (0.28 + i * 0.2), w - 24 * scale, 8 * scale);
    }
    ctx.restore();
  }
}

class Coin extends Entity {
  constructor(lane, z, y = 95) {
    super(lane, z);
    this.y = y;
    this.radius = 28;
    this.spin = Math.random() * Math.PI * 2;
  }

  bounds() {
    return {
      x: this.x - 42,
      y: this.y - 42,
      width: 84,
      height: 84
    };
  }

  update(dt, speed) {
    super.update(dt, speed);
    this.spin += dt * 8;
  }

  render(ctx, camera) {
    const pos = camera.worldToScreen(this.x, this.z, this.y);
    const scale = camera.scale * pos.p;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.scale(Math.max(0.28, Math.abs(Math.cos(this.spin))), 1);
    ctx.fillStyle = "#ffd84a";
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff3a4";
    ctx.lineWidth = 5 * scale;
    ctx.stroke();
    ctx.restore();
  }
}

class PowerUp extends Entity {
  constructor(lane, z, kind) {
    super(lane, z);
    this.kind = kind;
    this.y = 115;
    this.radius = 34;
  }

  bounds() {
    return { x: this.x - 48, y: this.y - 48, width: 96, height: 96 };
  }

  render(ctx, camera) {
    const pos = camera.worldToScreen(this.x, this.z, this.y);
    const scale = camera.scale * pos.p;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.fillStyle = this.kind === "magnet" ? "#ff5bc8" : "#26e6a4";
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#071018";
    ctx.font = `${Math.floor(34 * scale)}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.kind === "magnet" ? "M" : "x2", 0, 1 * scale);
    ctx.restore();
  }
}

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = rand(-150, 150);
    this.vy = rand(-310, -80);
    this.life = rand(0.35, 0.7);
    this.maxLife = this.life;
    this.color = color;
  }

  update(dt) {
    this.life -= dt;
    this.vy += 700 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  render(ctx, camera) {
    const alpha = clamp(this.life / this.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(camera.offsetX + this.x * camera.scale, camera.offsetY + this.y * camera.scale, 5 * camera.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class ObstacleManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.obstacles = [];
    this.coins = [];
    this.powerUps = [];
    this.nextSpawnZ = 760;
    this.patternIndex = 0;
  }

  update(dt, speed, difficulty) {
    for (const list of [this.obstacles, this.coins, this.powerUps]) {
      list.forEach((item) => item.update(dt, speed));
    }
    this.obstacles = this.obstacles.filter((item) => item.z > CONFIG.despawnZ);
    this.coins = this.coins.filter((item) => item.z > CONFIG.despawnZ && !item.collected);
    this.powerUps = this.powerUps.filter((item) => item.z > CONFIG.despawnZ && !item.collected);

    this.nextSpawnZ -= speed * dt;
    while (this.nextSpawnZ < CONFIG.spawnLead) {
      this.spawnPattern(difficulty, this.nextSpawnZ + rand(0, 90));
    }
  }

  spawnPattern(difficulty, z) {
    const density = clamp(difficulty, 0, 1);
    const gap = CONFIG.minGap - density * 160 + rand(0, 180);
    const pattern = choice(["single", "pair", "coins", "arc", "mixed"]);
    const safeLane = Math.floor(Math.random() * 3);

    if (pattern === "coins" || Math.random() < 0.22) {
      this.spawnCoinLine(choice([0, 1, 2]), z, 6, 95);
    } else if (pattern === "arc") {
      this.spawnCoinArc(choice([0, 1, 2]), z);
    } else if (pattern === "pair" && density > 0.24) {
      [0, 1, 2].forEach((lane) => {
        if (lane !== safeLane) this.obstacles.push(new Obstacle(lane, z + rand(-50, 70), choice(["barrier", "low", "block"])));
      });
      this.spawnCoinLine(safeLane, z + 90, 4, 110);
    } else if (pattern === "mixed" && density > 0.45) {
      const lanes = [0, 1, 2].filter((lane) => lane !== safeLane);
      this.obstacles.push(new Obstacle(lanes[0], z, choice(["barrier", "low"])));
      this.obstacles.push(new Obstacle(lanes[1], z + 260, "block"));
      this.spawnCoinLine(safeLane, z + 80, 5, 100);
    } else {
      const lane = choice([0, 1, 2]);
      this.obstacles.push(new Obstacle(lane, z, choice(["barrier", "low", "block"])));
      this.spawnCoinLine((lane + choice([1, 2])) % 3, z + 110, 5, 95);
    }

    if (Math.random() < 0.035) {
      this.powerUps.push(new PowerUp(choice([0, 1, 2]), z + 340, Math.random() < 0.5 ? "magnet" : "multiplier"));
    }

    this.patternIndex += 1;
    this.nextSpawnZ += gap;
  }

  spawnCoinLine(lane, z, count, y) {
    for (let i = 0; i < count; i += 1) {
      this.coins.push(new Coin(lane, z + i * 86, y));
    }
  }

  spawnCoinArc(lane, z) {
    for (let i = 0; i < 7; i += 1) {
      const t = i / 6;
      this.coins.push(new Coin(lane, z + i * 82, 85 + Math.sin(t * Math.PI) * 150));
    }
  }

  render(ctx, camera) {
    const entities = [...this.coins, ...this.powerUps, ...this.obstacles].sort((a, b) => b.z - a.z);
    entities.forEach((item) => item.render(ctx, camera));
  }
}

class Game {
  constructor() {
    this.canvas = document.querySelector("#gameCanvas");
    this.camera = new Camera(this.canvas);
    this.input = new InputHandler(this.canvas);
    this.audio = new AudioBus();
    this.player = new Player();
    this.manager = new ObstacleManager();
    this.overlay = document.querySelector("#overlay");
    this.overlayTitle = document.querySelector("#overlayTitle");
    this.overlayText = document.querySelector("#overlayText");
    this.primaryButton = document.querySelector("#primaryButton");
    this.ui = {
      score: document.querySelector("#score"),
      distance: document.querySelector("#distance"),
      coins: document.querySelector("#coins"),
      best: document.querySelector("#best")
    };
    this.state = "start";
    this.lastTime = 0;
    this.distance = 0;
    this.score = 0;
    this.coins = 0;
    this.speed = CONFIG.startSpeed;
    this.multiplierTimer = 0;
    this.magnetTimer = 0;
    this.particles = [];
    this.best = Number(localStorage.getItem("neonRunBest") || 0);
    this.primaryButton.addEventListener("click", () => this.handlePrimary());
    this.ui.best.textContent = this.best.toString();
    requestAnimationFrame((time) => this.loop(time));
  }

  handlePrimary() {
    if (this.state === "running") return;
    this.start();
  }

  start() {
    this.state = "running";
    this.distance = 0;
    this.score = 0;
    this.coins = 0;
    this.speed = CONFIG.startSpeed;
    this.multiplierTimer = 0;
    this.magnetTimer = 0;
    this.particles = [];
    this.player.reset();
    this.manager.reset();
    this.overlay.classList.add("hidden");
    this.audio.ensure();
  }

  pause() {
    if (this.state === "running") {
      this.state = "paused";
      this.showOverlay("Paused", "Take a breath. Resume when ready.", "Resume");
    } else if (this.state === "paused") {
      this.state = "running";
      this.overlay.classList.add("hidden");
    }
  }

  gameOver() {
    this.state = "gameover";
    this.audio.play("crash");
    this.best = Math.max(this.best, Math.floor(this.score));
    localStorage.setItem("neonRunBest", this.best.toString());
    this.ui.best.textContent = this.best.toString();
    this.showOverlay("Run Over", `Score ${Math.floor(this.score)}. Coins ${this.coins}. Distance ${Math.floor(this.distance)}m.`, "Restart");
  }

  showOverlay(title, text, button) {
    this.overlayTitle.textContent = title;
    this.overlayText.textContent = text;
    this.primaryButton.textContent = button;
    this.overlay.classList.remove("hidden");
  }

  loop(time) {
    const dt = Math.min(0.033, (time - this.lastTime) / 1000 || 0);
    this.lastTime = time;
    this.handleSystemInput();
    if (this.state === "running") this.update(dt);
    this.render();
    requestAnimationFrame((next) => this.loop(next));
  }

  handleSystemInput() {
    if (this.input.consume("pause")) this.pause();
    if (this.input.consume("start")) {
      if (this.state === "start" || this.state === "gameover") this.start();
      else if (this.state === "paused") this.pause();
    }
  }

  update(dt) {
    const difficulty = clamp(this.distance / 2400, 0, 1);
    this.speed = Math.min(CONFIG.maxSpeed, this.speed + CONFIG.speedRamp * dt + difficulty * 2.2);
    this.distance += (this.speed * dt) / 48;
    this.score += this.speed * dt * CONFIG.distanceScoreRate * this.multiplier();
    this.multiplierTimer = Math.max(0, this.multiplierTimer - dt);
    this.magnetTimer = Math.max(0, this.magnetTimer - dt);

    this.player.update(dt, this.input, this.audio);
    this.manager.update(dt, this.speed, difficulty);
    this.collectItems();
    this.checkObstacleCollisions();

    this.particles.forEach((p) => p.update(dt));
    this.particles = this.particles.filter((p) => p.life > 0);
    this.updateUi();
  }

  multiplier() {
    return this.multiplierTimer > 0 ? 2 : 1;
  }

  collectItems() {
    const playerBounds = this.player.bounds();
    for (const coin of this.manager.coins) {
      if (coin.collected) continue;
      if (this.magnetTimer > 0 && Math.abs(coin.z) < 520 && Math.abs(coin.lane - this.player.targetLane) <= 1) {
        coin.x = lerp(coin.x, this.player.x, 0.22);
        coin.y = lerp(coin.y, 95 + this.player.y, 0.18);
      }
      if (Math.abs(coin.z) < 72 && intersects(playerBounds, coin.bounds())) {
        coin.collected = true;
        this.coins += 1;
        this.score += CONFIG.coinValue * this.multiplier();
        this.audio.play("coin");
        this.spawnParticles(coin.x, 760, "#ffd84a", 7);
      }
    }

    for (const power of this.manager.powerUps) {
      if (!power.collected && Math.abs(power.z) < 80 && intersects(playerBounds, power.bounds())) {
        power.collected = true;
        if (power.kind === "magnet") this.magnetTimer = CONFIG.magnetDuration;
        if (power.kind === "multiplier") this.multiplierTimer = CONFIG.multiplierDuration;
        this.audio.play("power");
        this.spawnParticles(power.x, 730, power.kind === "magnet" ? "#ff5bc8" : "#26e6a4", 12);
      }
    }
  }

  checkObstacleCollisions() {
    const playerBounds = this.player.bounds();
    for (const obstacle of this.manager.obstacles) {
      if (Math.abs(obstacle.z) > 78) continue;
      if (intersects(playerBounds, obstacle.bounds())) {
        this.gameOver();
        break;
      }
    }
  }

  spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      this.particles.push(new Particle(x, y, color));
    }
  }

  updateUi() {
    this.ui.score.textContent = Math.floor(this.score).toString();
    this.ui.distance.textContent = Math.floor(this.distance).toString();
    this.ui.coins.textContent = this.coins.toString();
  }

  render() {
    const { ctx } = this.camera;
    const theme = this.theme();
    ctx.clearRect(0, 0, this.camera.width, this.camera.height);
    this.renderWorld(ctx, theme);
    this.manager.render(ctx, this.camera);
    this.player.render(ctx, this.camera, theme);
    this.particles.forEach((particle) => particle.render(ctx, this.camera));
    this.renderPowerTimers(ctx);
  }

  theme() {
    const cycle = (Math.sin(this.distance / 560) + 1) / 2;
    return {
      skyTop: mixColor([6, 12, 23], [20, 18, 40], cycle),
      skyBottom: mixColor([14, 35, 43], [37, 43, 58], cycle),
      lane: mixColor([38, 48, 57], [46, 40, 62], cycle),
      line: mixColor([38, 230, 164], [255, 204, 74], cycle),
      player: mixColor([38, 230, 164], [57, 213, 255], cycle)
    };
  }

  renderWorld(ctx, theme) {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.camera.height);
    gradient.addColorStop(0, theme.skyTop);
    gradient.addColorStop(1, theme.skyBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.camera.width, this.camera.height);

    const horizon = this.camera.offsetY + CONFIG.horizonY * this.camera.scale;
    const ground = this.camera.offsetY + CONFIG.playerBaseY * this.camera.scale + 60 * this.camera.scale;
    ctx.fillStyle = "#0b1119";
    ctx.beginPath();
    ctx.moveTo(0, this.camera.height);
    ctx.lineTo(0, ground);
    ctx.lineTo(this.camera.width, ground);
    ctx.lineTo(this.camera.width, this.camera.height);
    ctx.fill();

    const laneEdges = [-390, -130, 130, 390];
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 3 * this.camera.scale;
    laneEdges.forEach((edge) => {
      const near = this.camera.worldToScreen(edge, 0);
      const far = this.camera.worldToScreen(edge * 0.25, CONFIG.spawnLead);
      ctx.beginPath();
      ctx.moveTo(far.x, far.y);
      ctx.lineTo(near.x, near.y);
      ctx.stroke();
    });

    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 4 * this.camera.scale;
    for (let z = ((this.distance * 48) % 250); z < CONFIG.spawnLead; z += 250) {
      [-130, 130].forEach((x) => {
        const a = this.camera.worldToScreen(x, z);
        const b = this.camera.worldToScreen(x, z + 110);
        ctx.globalAlpha = clamp(1 - z / CONFIG.spawnLead, 0.1, 0.9);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;

    this.renderCity(ctx, horizon);
  }

  renderCity(ctx, horizon) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i < 24; i += 1) {
      const width = 34 + (i % 4) * 14;
      const height = 80 + ((i * 37) % 150);
      const x = ((i * 83 + Math.floor(this.distance * 2)) % (this.camera.width + 160)) - 80;
      ctx.fillRect(x, horizon - height * this.camera.scale, width * this.camera.scale, height * this.camera.scale);
    }
  }

  renderPowerTimers(ctx) {
    const active = [];
    if (this.magnetTimer > 0) active.push(["MAG", this.magnetTimer / CONFIG.magnetDuration, "#ff5bc8"]);
    if (this.multiplierTimer > 0) active.push(["x2", this.multiplierTimer / CONFIG.multiplierDuration, "#26e6a4"]);
    active.forEach(([label, pct, color], i) => {
      const x = this.camera.width - 126;
      const y = 120 + i * 32;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      roundRect(ctx, x, y, 104, 20, 6);
      ctx.fill();
      ctx.fillStyle = color;
      roundRect(ctx, x, y, 104 * pct, 20, 6);
      ctx.fill();
      ctx.fillStyle = "#071018";
      ctx.font = "700 12px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + 52, y + 10);
    });
  }
}

function drawBody3D(ctx, x, y, w, h, r, color) {
  const depth = Math.max(7, w * 0.16);
  const bodyGradient = ctx.createLinearGradient(x, y, x + w, y + h);
  bodyGradient.addColorStop(0, lightenColor(color, 0.18));
  bodyGradient.addColorStop(0.52, color);
  bodyGradient.addColorStop(1, darkenColor(color, 0.34));

  ctx.fillStyle = darkenColor(color, 0.45);
  roundRect(ctx, x + depth * 0.42, y + depth * 0.55, w, h, r);
  ctx.fill();

  ctx.fillStyle = bodyGradient;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.2)";
  roundRect(ctx, x + w * 0.13, y + h * 0.12, w * 0.2, h * 0.67, r * 0.45);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = Math.max(1, w * 0.035);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, y + h * 0.1);
  ctx.lineTo(x + w * 0.8, y + h * 0.1);
  ctx.stroke();
}

function drawChestPanel(ctx, scale) {
  const panelGradient = ctx.createLinearGradient(-20 * scale, -128 * scale, 24 * scale, -78 * scale);
  panelGradient.addColorStop(0, "#17242d");
  panelGradient.addColorStop(1, "#071018");
  ctx.fillStyle = panelGradient;
  roundRect(ctx, -23 * scale, -126 * scale, 46 * scale, 44 * scale, 9 * scale);
  ctx.fill();

  ctx.fillStyle = "#ffcc4a";
  ctx.beginPath();
  ctx.moveTo(0, -119 * scale);
  ctx.lineTo(12 * scale, -102 * scale);
  ctx.lineTo(0, -85 * scale);
  ctx.lineTo(-12 * scale, -102 * scale);
  ctx.closePath();
  ctx.fill();
}

function drawHead3D(ctx, x, y, radius, scale, color) {
  const helmet = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.45, radius * 0.2, x, y, radius * 1.2);
  helmet.addColorStop(0, lightenColor(color, 0.42));
  helmet.addColorStop(0.58, color);
  helmet.addColorStop(1, darkenColor(color, 0.42));

  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.beginPath();
  ctx.ellipse(x + radius * 0.18, y + radius * 0.22, radius * 0.92, radius * 1.04, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = helmet;
  ctx.beginPath();
  ctx.ellipse(x, y, radius * 0.88, radius, 0, 0, Math.PI * 2);
  ctx.fill();

  const visor = ctx.createLinearGradient(x - radius * 0.65, y - radius * 0.08, x + radius * 0.6, y + radius * 0.22);
  visor.addColorStop(0, "#101820");
  visor.addColorStop(0.55, "#223441");
  visor.addColorStop(1, "#071018");
  ctx.fillStyle = visor;
  roundRect(ctx, x - radius * 0.62, y - radius * 0.1, radius * 1.15, radius * 0.46, 8 * scale);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.38)";
  roundRect(ctx, x - radius * 0.45, y - radius * 0.02, radius * 0.38, radius * 0.09, 3 * scale);
  ctx.fill();
}

function drawLimb(ctx, x1, y1, x2, y2, width, colorA, colorB) {
  const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
  gradient.addColorStop(0, colorA);
  gradient.addColorStop(1, colorB);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  const midX = (x1 + x2) * 0.5;
  const midY = (y1 + y2) * 0.5 - width * 0.5;
  ctx.quadraticCurveTo(midX, midY, x2, y2);
  ctx.stroke();
}

function drawJoint(ctx, x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawShoe(ctx, x, y, scale, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const w = 42 * scale;
  const h = 17 * scale;
  const gradient = ctx.createLinearGradient(x - w * 0.5, y - h, x + w * 0.5, y);
  gradient.addColorStop(0, "#2d3943");
  gradient.addColorStop(1, "#071018");
  ctx.fillStyle = gradient;
  roundRect(ctx, x - w * 0.5, y - h, w, h, 6 * scale);
  ctx.fill();
  ctx.fillStyle = "#ffcc4a";
  ctx.fillRect(x - w * 0.28, y - h * 0.32, w * 0.55, 3 * scale);
  ctx.restore();
}

function lightenColor(color, amount) {
  const [r, g, b] = colorToRgb(color);
  return `rgb(${Math.round(lerp(r, 255, amount))}, ${Math.round(lerp(g, 255, amount))}, ${Math.round(lerp(b, 255, amount))})`;
}

function darkenColor(color, amount) {
  const [r, g, b] = colorToRgb(color);
  return `rgb(${Math.round(r * (1 - amount))}, ${Math.round(g * (1 - amount))}, ${Math.round(b * (1 - amount))})`;
}

function colorToRgb(color) {
  const rgb = color.match(/\d+/g);
  if (rgb && rgb.length >= 3) return rgb.slice(0, 3).map(Number);
  if (color.startsWith("#") && color.length === 7) {
    return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  }
  return [38, 230, 164];
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function mixColor(a, b, t) {
  const values = a.map((value, index) => Math.round(lerp(value, b[index], t)));
  return `rgb(${values[0]}, ${values[1]}, ${values[2]})`;
}

new Game();
