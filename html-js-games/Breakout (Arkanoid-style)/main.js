"use strict";

const CONFIG = Object.freeze({
  width: 960,
  height: 640,
  lives: 3,
  paddle: {
    width: 118,
    height: 18,
    yOffset: 48,
    speed: 720,
    minWidth: 78,
    maxWidth: 190
  },
  ball: {
    radius: 8,
    speed: 360,
    maxSpeed: 690,
    speedGain: 1.018
  },
  brick: {
    rows: 7,
    cols: 12,
    top: 72,
    gap: 7,
    height: 25,
    sidePadding: 44
  },
  powerUp: {
    chance: 0.28,
    size: 26,
    speed: 150,
    duration: 10000
  },
  laser: {
    speed: 680,
    cooldown: 260,
    duration: 10000
  }
});

const POWER_UPS = Object.freeze({
  EXPAND: { label: "W", color: "#35d3ff" },
  MULTI: { label: "M", color: "#ff6bd6" },
  SLOW: { label: "S", color: "#9ef56e" },
  LASER: { label: "L", color: "#ffd166" }
});

class InputManager {
  constructor(canvas) {
    this.left = false;
    this.right = false;
    this.pointerX = null;
    this.pausePressed = false;
    this.laserPressed = false;

    window.addEventListener("keydown", (event) => this.onKey(event, true));
    window.addEventListener("keyup", (event) => this.onKey(event, false));
    canvas.addEventListener("mousemove", (event) => this.setPointer(canvas, event.clientX));
    canvas.addEventListener("mouseleave", () => { this.pointerX = null; });
    canvas.addEventListener("touchstart", (event) => this.onTouch(canvas, event), { passive: false });
    canvas.addEventListener("touchmove", (event) => this.onTouch(canvas, event), { passive: false });
    canvas.addEventListener("touchend", () => { this.pointerX = null; });
  }

  onKey(event, isDown) {
    if (["ArrowLeft", "KeyA"].includes(event.code)) this.left = isDown;
    if (["ArrowRight", "KeyD"].includes(event.code)) this.right = isDown;
    if ((event.code === "Space" || event.code === "KeyP") && isDown && !event.repeat) {
      event.preventDefault();
      this.pausePressed = true;
    }
    if (event.code === "KeyF" && isDown && !event.repeat) {
      this.laserPressed = true;
    }
  }

  onTouch(canvas, event) {
    event.preventDefault();
    this.setPointer(canvas, event.touches[0].clientX);
  }

  setPointer(canvas, clientX) {
    const rect = canvas.getBoundingClientRect();
    this.pointerX = ((clientX - rect.left) / rect.width) * CONFIG.width;
  }

  consumePause() {
    const wasPressed = this.pausePressed;
    this.pausePressed = false;
    return wasPressed;
  }

  consumeLaser() {
    const wasPressed = this.laserPressed;
    this.laserPressed = false;
    return wasPressed;
  }
}

class AudioManager {
  constructor() {
    this.context = null;
  }

  ensureContext() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  play(type) {
    this.ensureContext();
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const profiles = {
      bounce: [220, 0.055, "triangle", 0.035],
      brick: [420, 0.09, "square", 0.045],
      power: [720, 0.16, "sine", 0.06],
      laser: [980, 0.075, "sawtooth", 0.035],
      lose: [110, 0.28, "sine", 0.07]
    };
    const [frequency, duration, wave, volume] = profiles[type] || profiles.bounce;

    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(70, frequency * 0.55), ctx.currentTime + duration);
    oscillator.type = wave;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
  }
}

class Paddle {
  constructor() {
    this.baseWidth = CONFIG.paddle.width;
    this.width = CONFIG.paddle.width;
    this.height = CONFIG.paddle.height;
    this.x = (CONFIG.width - this.width) / 2;
    this.y = CONFIG.height - CONFIG.paddle.yOffset;
    this.speed = CONFIG.paddle.speed;
  }

  reset() {
    this.width = this.baseWidth;
    this.x = (CONFIG.width - this.width) / 2;
  }

  update(dt, input) {
    if (input.pointerX !== null) {
      this.x += (input.pointerX - this.width / 2 - this.x) * Math.min(1, dt * 18);
    } else {
      const dir = Number(input.right) - Number(input.left);
      this.x += dir * this.speed * dt;
    }
    this.x = clamp(this.x, 0, CONFIG.width - this.width);
  }

  center() {
    return this.x + this.width / 2;
  }
}

class Ball {
  constructor(x, y, angle = -Math.PI / 2, speed = CONFIG.ball.speed) {
    this.x = x;
    this.y = y;
    this.radius = CONFIG.ball.radius;
    this.speed = speed;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
  }

  update(dt, speedScale) {
    this.x += this.vx * dt * speedScale;
    this.y += this.vy * dt * speedScale;
  }

  normalizeSpeed() {
    const angle = Math.atan2(this.vy, this.vx);
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;
  }
}

class Brick {
  constructor(x, y, width, height, type, hits) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.type = type;
    this.hits = hits;
    this.maxHits = hits;
    this.breakable = type !== "unbreakable";
  }
}

class PowerUp {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.size = CONFIG.powerUp.size;
    this.vy = CONFIG.powerUp.speed;
  }

  update(dt) {
    this.y += this.vy * dt;
  }
}

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = random(-180, 180);
    this.vy = random(-220, 80);
    this.life = random(0.35, 0.75);
    this.maxLife = this.life;
    this.radius = random(2, 5);
    this.color = color;
  }

  update(dt) {
    this.life -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 360 * dt;
  }
}

class LaserBolt {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = 4;
    this.height = 18;
    this.vy = -CONFIG.laser.speed;
  }

  update(dt) {
    this.y += this.vy * dt;
  }
}

class LevelFactory {
  static create(level) {
    if (level > 0 && level % 5 === 0) return LevelFactory.createBoss(level);

    const bricks = [];
    const brickWidth = (CONFIG.width - CONFIG.brick.sidePadding * 2 - CONFIG.brick.gap * (CONFIG.brick.cols - 1)) / CONFIG.brick.cols;
    const palette = ["#35d3ff", "#ff5673", "#ffd166", "#9ef56e", "#b58cff"];

    for (let row = 0; row < CONFIG.brick.rows; row++) {
      for (let col = 0; col < CONFIG.brick.cols; col++) {
        const roll = Math.random();
        if (roll < 0.08 + Math.min(0.06, level * 0.006)) continue;

        const x = CONFIG.brick.sidePadding + col * (brickWidth + CONFIG.brick.gap);
        const y = CONFIG.brick.top + row * (CONFIG.brick.height + CONFIG.brick.gap);
        const hardChance = Math.min(0.36, 0.14 + level * 0.025);
        const unbreakableChance = Math.min(0.16, 0.04 + level * 0.008);
        let type = "normal";
        let hits = 1;

        if (roll > 1 - unbreakableChance && row > 1) {
          type = "unbreakable";
          hits = Infinity;
        } else if (roll > 1 - hardChance) {
          type = "strong";
          hits = Math.random() < 0.45 && level > 2 ? 3 : 2;
        }

        const brick = new Brick(x, y, brickWidth, CONFIG.brick.height, type, hits);
        brick.color = type === "unbreakable" ? "#6f7888" : palette[(row + col + level) % palette.length];
        bricks.push(brick);
      }
    }

    if (!bricks.some((brick) => brick.breakable)) {
      return LevelFactory.create(level);
    }
    return bricks;
  }

  static createBoss(level) {
    const bricks = [];
    const cols = 10;
    const rows = 6;
    const brickWidth = (CONFIG.width - CONFIG.brick.sidePadding * 2 - CONFIG.brick.gap * (cols - 1)) / cols;
    const pattern = [
      "0011111100",
      "0122222210",
      "1233333321",
      "0122222210",
      "0011111100",
      "0001001000"
    ];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const value = Number(pattern[row][col]);
        if (value === 0) continue;
        const x = CONFIG.brick.sidePadding + col * (brickWidth + CONFIG.brick.gap);
        const y = CONFIG.brick.top + row * (CONFIG.brick.height + CONFIG.brick.gap);
        const brick = new Brick(x, y, brickWidth, CONFIG.brick.height, value === 1 ? "strong" : "normal", value);
        brick.color = value === 3 ? "#ff5673" : value === 2 ? "#ffd166" : "#35d3ff";
        bricks.push(brick);
      }
    }

    const shieldY = CONFIG.brick.top + rows * (CONFIG.brick.height + CONFIG.brick.gap) + 18;
    for (let col = 2; col < 8; col += 2) {
      const brick = new Brick(CONFIG.brick.sidePadding + col * (brickWidth + CONFIG.brick.gap), shieldY, brickWidth, CONFIG.brick.height, "unbreakable", Infinity);
      brick.color = "#6f7888";
      bricks.push(brick);
    }
    return bricks;
  }
}

class Renderer {
  constructor(ctx) {
    this.ctx = ctx;
  }

  render(game) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
    this.drawBackground(ctx);
    game.bricks.forEach((brick) => this.drawBrick(ctx, brick));
    game.powerUps.forEach((powerUp) => this.drawPowerUp(ctx, powerUp));
    game.lasers.forEach((laser) => this.drawLaser(ctx, laser));
    game.balls.forEach((ball) => this.drawBall(ctx, ball));
    this.drawPaddle(ctx, game.paddle, game.effects.laserUntil > game.time);
    game.particles.forEach((particle) => this.drawParticle(ctx, particle));
    this.drawActiveEffects(ctx, game);
  }

  drawBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, CONFIG.height);
    gradient.addColorStop(0, "#0d1118");
    gradient.addColorStop(1, "#090b0f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);

    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    for (let x = 0; x < CONFIG.width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CONFIG.height);
      ctx.stroke();
    }
    for (let y = 0; y < CONFIG.height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CONFIG.width, y);
      ctx.stroke();
    }
  }

  drawPaddle(ctx, paddle, hasLaser) {
    const gradient = ctx.createLinearGradient(paddle.x, paddle.y, paddle.x, paddle.y + paddle.height);
    gradient.addColorStop(0, hasLaser ? "#ffd166" : "#f4f7fb");
    gradient.addColorStop(1, hasLaser ? "#ff8f3d" : "#35d3ff");
    roundRect(ctx, paddle.x, paddle.y, paddle.width, paddle.height, 9);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.shadowColor = hasLaser ? "#ffd166" : "#35d3ff";
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  drawBall(ctx, ball) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#f9fbff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  drawBrick(ctx, brick) {
    roundRect(ctx, brick.x, brick.y, brick.width, brick.height, 5);
    ctx.fillStyle = brick.color;
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(brick.x + 5, brick.y + 4, brick.width - 10, 4);

    if (!brick.breakable) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (brick.maxHits > 1) {
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.font = "700 13px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(brick.hits), brick.x + brick.width / 2, brick.y + brick.height / 2 + 1);
    }
  }

  drawPowerUp(ctx, powerUp) {
    const def = POWER_UPS[powerUp.type];
    roundRect(ctx, powerUp.x, powerUp.y, powerUp.size, powerUp.size, 6);
    ctx.fillStyle = def.color;
    ctx.fill();
    ctx.fillStyle = "#081016";
    ctx.font = "900 15px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.label, powerUp.x + powerUp.size / 2, powerUp.y + powerUp.size / 2 + 1);
  }

  drawLaser(ctx, laser) {
    ctx.fillStyle = "#ffd166";
    ctx.shadowColor = "#ffd166";
    ctx.shadowBlur = 12;
    ctx.fillRect(laser.x, laser.y, laser.width, laser.height);
    ctx.shadowBlur = 0;
  }

  drawParticle(ctx, particle) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
    ctx.fillStyle = particle.color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawActiveEffects(ctx, game) {
    const effects = [];
    if (game.effects.expandUntil > game.time) effects.push("Wide paddle");
    if (game.effects.slowUntil > game.time) effects.push("Slow motion");
    if (game.effects.laserUntil > game.time) effects.push("Laser armed");
    if (!effects.length) return;

    ctx.font = "700 14px system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(244,247,251,0.86)";
    ctx.fillText(effects.join("  |  "), 18, 18);
  }
}

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.input = new InputManager(canvas);
    this.audio = new AudioManager();
    this.renderer = new Renderer(this.ctx);
    this.scoreEl = document.getElementById("score");
    this.highScoreEl = document.getElementById("highScore");
    this.livesEl = document.getElementById("lives");
    this.levelEl = document.getElementById("level");
    this.overlay = document.getElementById("overlay");
    this.overlayKicker = document.getElementById("overlayKicker");
    this.overlayTitle = document.getElementById("overlayTitle");
    this.overlayText = document.getElementById("overlayText");
    this.primaryButton = document.getElementById("primaryButton");
    this.highScore = Number(localStorage.getItem("neon-breakout-high-score")) || 0;
    this.state = "start";
    this.lastTime = 0;
    this.time = 0;

    this.primaryButton.addEventListener("click", () => {
      this.audio.ensureContext();
      if (this.state === "start" || this.state === "gameover" || this.state === "won") this.newGame();
      else if (this.state === "paused") this.resume();
      else if (this.state === "level") this.startLevel();
    });

    this.resetAll();
    this.showOverlay("Neon Breakout", "Break the Grid", "Move the paddle, catch power-ups, and clear every breakable brick.", "Start Game");
    requestAnimationFrame((now) => this.loop(now));
  }

  resetAll() {
    this.score = 0;
    this.lives = CONFIG.lives;
    this.level = 1;
    this.paddle = new Paddle();
    this.balls = [];
    this.bricks = [];
    this.powerUps = [];
    this.particles = [];
    this.lasers = [];
    this.effects = { expandUntil: 0, slowUntil: 0, laserUntil: 0 };
    this.laserCooldown = 0;
    this.updateHud();
  }

  newGame() {
    this.resetAll();
    this.loadLevel();
    this.startLevel();
  }

  loadLevel() {
    this.bricks = LevelFactory.create(this.level);
    this.powerUps = [];
    this.particles = [];
    this.lasers = [];
    this.effects = { expandUntil: 0, slowUntil: 0, laserUntil: 0 };
    this.paddle.reset();
    this.spawnBall();
    this.updateHud();
  }

  startLevel() {
    this.state = "playing";
    this.hideOverlay();
  }

  resume() {
    this.state = "playing";
    this.hideOverlay();
  }

  pause() {
    this.state = "paused";
    this.showOverlay("Paused", "Game Paused", "Press Space, P, or Resume to continue.", "Resume");
  }

  spawnBall(angle = -Math.PI / 2, speed = CONFIG.ball.speed + (this.level - 1) * 18) {
    this.balls.push(new Ball(this.paddle.center(), this.paddle.y - CONFIG.ball.radius - 2, angle, Math.min(speed, CONFIG.ball.maxSpeed)));
  }

  loop(now) {
    const dt = Math.min(0.033, (now - this.lastTime) / 1000 || 0);
    this.lastTime = now;
    this.time += dt * 1000;

    if (this.input.consumePause()) {
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
    }

    if (this.state === "playing") this.update(dt);
    this.renderer.render(this);
    requestAnimationFrame((next) => this.loop(next));
  }

  update(dt) {
    this.paddle.update(dt, this.input);
    this.updateEffects();
    this.handleLaserInput(dt);

    const speedScale = this.effects.slowUntil > this.time ? 0.62 : 1;
    this.balls.forEach((ball) => {
      ball.update(dt, speedScale);
      this.collideBallWithWalls(ball);
      this.collideBallWithPaddle(ball);
      this.collideBallWithBricks(ball);
    });

    this.updateLasers(dt);
    this.updatePowerUps(dt);
    this.updateParticles(dt);
    this.balls = this.balls.filter((ball) => ball.y - ball.radius <= CONFIG.height + 8);

    if (this.balls.length === 0) this.loseLife();
    if (this.bricks.every((brick) => !brick.breakable)) this.completeLevel();
    this.updateHud();
  }

  updateEffects() {
    if (this.effects.expandUntil <= this.time) {
      this.paddle.width += (this.paddle.baseWidth - this.paddle.width) * 0.12;
      if (Math.abs(this.paddle.width - this.paddle.baseWidth) < 0.5) this.paddle.width = this.paddle.baseWidth;
      this.paddle.x = clamp(this.paddle.x, 0, CONFIG.width - this.paddle.width);
    }
  }

  handleLaserInput(dt) {
    this.laserCooldown -= dt * 1000;
    const firePressed = this.input.consumeLaser();
    if (this.effects.laserUntil <= this.time || !firePressed || this.laserCooldown > 0) return;
    this.laserCooldown = CONFIG.laser.cooldown;
    this.lasers.push(new LaserBolt(this.paddle.x + 18, this.paddle.y - 16));
    this.lasers.push(new LaserBolt(this.paddle.x + this.paddle.width - 22, this.paddle.y - 16));
    this.audio.play("laser");
  }

  collideBallWithWalls(ball) {
    if (ball.x - ball.radius < 0) {
      ball.x = ball.radius;
      ball.vx = Math.abs(ball.vx);
      this.audio.play("bounce");
    } else if (ball.x + ball.radius > CONFIG.width) {
      ball.x = CONFIG.width - ball.radius;
      ball.vx = -Math.abs(ball.vx);
      this.audio.play("bounce");
    }
    if (ball.y - ball.radius < 0) {
      ball.y = ball.radius;
      ball.vy = Math.abs(ball.vy);
      this.audio.play("bounce");
    }
  }

  collideBallWithPaddle(ball) {
    if (ball.vy <= 0) return;
    const withinX = ball.x + ball.radius >= this.paddle.x && ball.x - ball.radius <= this.paddle.x + this.paddle.width;
    const withinY = ball.y + ball.radius >= this.paddle.y && ball.y - ball.radius <= this.paddle.y + this.paddle.height;
    if (!withinX || !withinY) return;

    const relative = clamp((ball.x - this.paddle.center()) / (this.paddle.width / 2), -1, 1);
    const maxAngle = Math.PI * 0.39;
    const angle = -Math.PI / 2 + relative * maxAngle;
    ball.speed = Math.min(CONFIG.ball.maxSpeed, ball.speed * CONFIG.ball.speedGain);
    ball.vx = Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
    ball.y = this.paddle.y - ball.radius - 0.5;
    this.audio.play("bounce");
  }

  collideBallWithBricks(ball) {
    for (const brick of this.bricks) {
      if (!circleRectIntersect(ball, brick)) continue;
      const previousX = ball.x - ball.vx * 0.016;
      const previousY = ball.y - ball.vy * 0.016;
      const wasOutsideX = previousX <= brick.x || previousX >= brick.x + brick.width;
      const wasOutsideY = previousY <= brick.y || previousY >= brick.y + brick.height;

      if (wasOutsideX && !wasOutsideY) ball.vx *= -1;
      else ball.vy *= -1;

      this.damageBrick(brick);
      ball.speed = Math.min(CONFIG.ball.maxSpeed, ball.speed * 1.004);
      ball.normalizeSpeed();
      this.audio.play("brick");
      break;
    }
  }

  damageBrick(brick) {
    if (!brick.breakable) {
      this.emitParticles(brick.x + brick.width / 2, brick.y + brick.height / 2, brick.color, 4);
      return;
    }

    brick.hits -= 1;
    this.score += 15 + (brick.maxHits - brick.hits) * 5;
    this.emitParticles(brick.x + brick.width / 2, brick.y + brick.height / 2, brick.color, brick.hits <= 0 ? 16 : 7);

    if (brick.hits <= 0) {
      this.bricks = this.bricks.filter((item) => item !== brick);
      this.score += 35;
      this.maybeDropPowerUp(brick);
    }
  }

  maybeDropPowerUp(brick) {
    if (Math.random() > CONFIG.powerUp.chance) return;
    const types = Object.keys(POWER_UPS);
    const type = types[Math.floor(Math.random() * types.length)];
    this.powerUps.push(new PowerUp(brick.x + brick.width / 2 - CONFIG.powerUp.size / 2, brick.y, type));
  }

  updatePowerUps(dt) {
    this.powerUps.forEach((powerUp) => powerUp.update(dt));
    this.powerUps = this.powerUps.filter((powerUp) => {
      const caught = rectIntersect(powerUp, this.paddle);
      if (caught) {
        this.applyPowerUp(powerUp.type);
        return false;
      }
      return powerUp.y < CONFIG.height + 40;
    });
  }

  applyPowerUp(type) {
    this.score += 80;
    this.audio.play("power");
    if (type === "EXPAND") {
      this.paddle.width = clamp(this.paddle.width + 44, CONFIG.paddle.minWidth, CONFIG.paddle.maxWidth);
      this.effects.expandUntil = this.time + CONFIG.powerUp.duration;
    }
    if (type === "MULTI") {
      const source = this.balls[0] || new Ball(this.paddle.center(), this.paddle.y - 12);
      const speed = Math.min(CONFIG.ball.maxSpeed, source.speed * 0.98);
      this.spawnBall(-Math.PI * 0.72, speed);
      this.spawnBall(-Math.PI * 0.28, speed);
    }
    if (type === "SLOW") {
      this.effects.slowUntil = this.time + CONFIG.powerUp.duration;
    }
    if (type === "LASER") {
      this.effects.laserUntil = this.time + CONFIG.laser.duration;
    }
  }

  updateLasers(dt) {
    this.lasers.forEach((laser) => {
      laser.update(dt);
      const hit = this.bricks.find((brick) => rectIntersect(laser, brick));
      if (hit) {
        laser.dead = true;
        this.damageBrick(hit);
        this.audio.play("brick");
      }
    });
    this.lasers = this.lasers.filter((laser) => !laser.dead && laser.y + laser.height > 0);
  }

  updateParticles(dt) {
    this.particles.forEach((particle) => particle.update(dt));
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  emitParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(x, y, color));
    }
  }

  loseLife() {
    this.lives -= 1;
    this.audio.play("lose");
    if (this.lives <= 0) {
      this.finish("gameover", "Game Over", "The grid held this round. Restart and push deeper.", "Restart");
      return;
    }
    this.paddle.reset();
    this.powerUps = [];
    this.lasers = [];
    this.effects = { expandUntil: 0, slowUntil: 0, laserUntil: 0 };
    this.spawnBall();
  }

  completeLevel() {
    this.score += 500 + this.level * 100;
    this.level += 1;
    if (this.level > 10) {
      this.finish("won", "System Cleared", "You cleared every sector and set the board quiet.", "Play Again");
      return;
    }
    this.state = "level";
    this.loadLevel();
    this.showOverlay(`Level ${this.level}`, "Next Sector", "The next brick field is ready.", "Launch");
  }

  finish(state, title, text, button) {
    this.state = state;
    this.saveHighScore();
    this.showOverlay(state === "won" ? "Victory" : "Run Ended", title, text, button);
  }

  saveHighScore() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem("neon-breakout-high-score", String(this.highScore));
    }
  }

  updateHud() {
    this.saveHighScore();
    this.scoreEl.textContent = String(this.score);
    this.highScoreEl.textContent = String(this.highScore);
    this.livesEl.textContent = String(this.lives);
    this.levelEl.textContent = String(this.level);
  }

  showOverlay(kicker, title, text, button) {
    this.overlayKicker.textContent = kicker;
    this.overlayTitle.textContent = title;
    this.overlayText.textContent = text;
    this.primaryButton.textContent = button;
    this.overlay.classList.remove("is-hidden");
  }

  hideOverlay() {
    this.overlay.classList.add("is-hidden");
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function random(min, max) {
  return min + Math.random() * (max - min);
}

function rectIntersect(a, b) {
  return a.x < b.x + b.width &&
    a.x + (a.width || a.size) > b.x &&
    a.y < b.y + b.height &&
    a.y + (a.height || a.size) > b.y;
}

function circleRectIntersect(circle, rect) {
  const closestX = clamp(circle.x, rect.x, rect.x + rect.width);
  const closestY = clamp(circle.y, rect.y, rect.y + rect.height);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

window.addEventListener("load", () => {
  const canvas = document.getElementById("gameCanvas");
  new Game(canvas);
});
