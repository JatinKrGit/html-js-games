"use strict";

const CONFIG = {
  complimentIntervalMs: 6200,
  complimentFadeMs: 420,
  attentionScanMs: 650,
  minFaceAreaRatio: 0.015,
  clickFeedbackMs: 180,
  pulseResetMs: 720,
  particleCountDesktop: 70,
  particleCountMobile: 38,
  mobileBreakpointPx: 680,
  screenshotMimeType: "image/png",
  storageKey: "smartMirror.preferences.v1",
  cameraConstraints: {
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 960 }
    },
    audio: false
  },
  music: {
    baseFrequency: 220,
    gain: 0.025,
    fadeSeconds: 0.08
  }
};

const COMPLIMENTS = [
  "Look who's radiant today",
  "That glow is all yours",
  "Hey, you look lovely",
  "That smile suits you",
  "You’re glowing today",  
  "There’s that smile",
  "You look really nice today",
  "Soft and beautiful",
  "You carry yourself well",
  "You look confident today",
  "You’re quietly stunning",
  "You feel calm and strong",
  "You look happy today",
  "Just you—and that’s perfect",
  "You shine in your own way",
  "You look good, don’t overthink it",
  "Your smile changes the room",
  "Keep showing up for yourself"
];

const SELECTORS = {
  ambientCanvas: "#ambientCanvas",
  mirrorFrame: "#mirrorFrame",
  mirrorVideo: "#mirrorVideo",
  mirrorPlaceholder: "#mirrorPlaceholder",
  statusPill: "#statusPill",
  complimentWrap: "#complimentWrap",
  complimentText: "#complimentText",
  activationPulse: "#activationPulse",
  mirrorToggle: "#mirrorToggle",
  ringToggle: "#ringToggle",
  beautyToggle: "#beautyToggle",
  musicToggle: "#musicToggle",
  screenshotButton: "#screenshotButton"
};

class PreferenceStore {
  static load() {
    try {
      const preferences = JSON.parse(localStorage.getItem(CONFIG.storageKey)) || {};
      return { ...preferences, musicOn: false };
    } catch {
      return {};
    }
  }

  static save(state) {
    const preferences = {
      mirrorOn: state.mirrorOn,
      lightOn: state.lightOn,
      beautyOn: state.beautyOn,
      musicOn: state.musicOn
    };
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(preferences));
  }
}

class CameraController {
  constructor(videoElement, onStatusChange) {
    this.videoElement = videoElement;
    this.onStatusChange = onStatusChange;
    this.stream = null;
    this.isStarting = false;
  }

  async start() {
    if (this.stream || this.isStarting) {
      return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.onStatusChange("Camera unavailable in this browser", true);
      return false;
    }

    this.isStarting = true;
    this.onStatusChange("Requesting camera permission...", false);

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(CONFIG.cameraConstraints);
      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();
      this.onStatusChange("Mirror live", false);
      return true;
    } catch (error) {
      this.stream = null;
      this.onStatusChange(this.getReadableError(error), true);
      return false;
    } finally {
      this.isStarting = false;
    }
  }

  stop() {
    if (!this.stream) {
      return;
    }

    this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.videoElement.srcObject = null;
    this.onStatusChange("Mirror paused", false);
  }

  captureFrame() {
    if (!this.stream || this.videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    const canvas = document.createElement("canvas");
    const width = this.videoElement.videoWidth;
    const height = this.videoElement.videoHeight;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(this.videoElement, 0, 0, width, height);

    return canvas.toDataURL(CONFIG.screenshotMimeType);
  }

  getReadableError(error) {
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      return "Camera permission denied";
    }

    if (error?.name === "NotFoundError") {
      return "No camera found";
    }

    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      return "Use HTTPS or localhost for camera access";
    }

    return "Unable to start camera";
  }
}

class AttentionController {
  constructor(videoElement, onAttentionChange, onSupportChange) {
    this.videoElement = videoElement;
    this.onAttentionChange = onAttentionChange;
    this.onSupportChange = onSupportChange;
    this.faceDetector = this.createFaceDetector();
    this.isRunning = false;
    this.scanTimer = null;
    this.isScanning = false;
  }

  createFaceDetector() {
    if (!("FaceDetector" in window)) {
      return null;
    }

    try {
      return new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
    } catch {
      return null;
    }
  }

  start() {
    if (!this.faceDetector) {
      this.onSupportChange(false);
      this.onAttentionChange(false);
      return;
    }

    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.onSupportChange(true);
    this.scan();
  }

  stop() {
    this.isRunning = false;
    window.clearTimeout(this.scanTimer);
    this.onAttentionChange(false);
  }

  async scan() {
    if (!this.isRunning || this.isScanning) {
      return;
    }

    this.isScanning = true;

    try {
      const faces = await this.faceDetector.detect(this.videoElement);
      this.onAttentionChange(this.hasUsableFace(faces));
    } catch {
      this.onSupportChange(false);
      this.onAttentionChange(false);
      this.isRunning = false;
    } finally {
      this.isScanning = false;
    }

    if (this.isRunning) {
      this.scanTimer = window.setTimeout(() => this.scan(), CONFIG.attentionScanMs);
    }
  }

  hasUsableFace(faces) {
    if (!faces?.length || !this.videoElement.videoWidth || !this.videoElement.videoHeight) {
      return false;
    }

    const frameArea = this.videoElement.videoWidth * this.videoElement.videoHeight;
    return faces.some((face) => {
      const box = face.boundingBox;
      const faceAreaRatio = (box.width * box.height) / frameArea;
      return faceAreaRatio >= CONFIG.minFaceAreaRatio;
    });
  }
}

class EffectsManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.particles = [];
    this.animationFrame = null;
    this.lastTime = 0;
    this.resizeObserver = null;
    this.pixelRatio = 1;
    this.isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  init() {
    this.resize();
    this.createParticles();
    window.addEventListener("resize", () => this.handleResize(), { passive: true });

    if (!this.isReducedMotion) {
      this.animationFrame = requestAnimationFrame((time) => this.animate(time));
    } else {
      this.drawStaticParticles();
    }
  }

  handleResize() {
    this.resize();
    this.createParticles();
  }

  resize() {
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * this.pixelRatio);
    this.canvas.height = Math.floor(window.innerHeight * this.pixelRatio);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
  }

  createParticles() {
    const count = window.innerWidth < CONFIG.mobileBreakpointPx
      ? CONFIG.particleCountMobile
      : CONFIG.particleCountDesktop;

    this.particles = Array.from({ length: count }, () => this.createParticle(true));
  }

  createParticle(randomizeY = false) {
    const size = this.random(1.2, 4.4);
    return {
      x: this.random(0, window.innerWidth),
      y: randomizeY ? this.random(0, window.innerHeight) : window.innerHeight + size,
      size,
      speed: this.random(8, 26),
      drift: this.random(-10, 10),
      alpha: this.random(0.24, 0.8),
      hue: Math.random() > 0.55 ? "255, 121, 200" : "102, 232, 255",
      spin: this.random(0, Math.PI * 2),
      spinSpeed: this.random(-0.9, 0.9)
    };
  }

  animate(time) {
    const deltaSeconds = Math.min((time - this.lastTime) / 1000 || 0, 0.033);
    this.lastTime = time;

    this.context.clearRect(0, 0, window.innerWidth, window.innerHeight);

    this.particles.forEach((particle, index) => {
      particle.y -= particle.speed * deltaSeconds;
      particle.x += Math.sin(time * 0.001 + particle.spin) * particle.drift * deltaSeconds;
      particle.spin += particle.spinSpeed * deltaSeconds;

      if (particle.y < -20 || particle.x < -40 || particle.x > window.innerWidth + 40) {
        this.particles[index] = this.createParticle(false);
      } else {
        this.drawParticle(particle);
      }
    });

    this.animationFrame = requestAnimationFrame((nextTime) => this.animate(nextTime));
  }

  drawStaticParticles() {
    this.context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    this.particles.forEach((particle) => this.drawParticle(particle));
  }

  drawParticle(particle) {
    const ctx = this.context;
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.spin);
    ctx.globalAlpha = particle.alpha;
    ctx.fillStyle = `rgba(${particle.hue}, 0.9)`;
    ctx.shadowBlur = 18;
    ctx.shadowColor = `rgba(${particle.hue}, 0.85)`;

    ctx.beginPath();
    ctx.moveTo(0, -particle.size * 1.9);
    ctx.lineTo(particle.size * 0.7, -particle.size * 0.25);
    ctx.lineTo(particle.size * 2.1, 0);
    ctx.lineTo(particle.size * 0.7, particle.size * 0.25);
    ctx.lineTo(0, particle.size * 1.9);
    ctx.lineTo(-particle.size * 0.7, particle.size * 0.25);
    ctx.lineTo(-particle.size * 2.1, 0);
    ctx.lineTo(-particle.size * 0.7, -particle.size * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  random(min, max) {
    return min + Math.random() * (max - min);
  }
}

class MusicManager {
  constructor() {
    this.audioContext = null;
    this.gainNode = null;
    this.oscillators = [];
  }

  async start() {
    if (this.audioContext) {
      await this.audioContext.resume();
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    this.audioContext = new AudioContextClass();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 0;
    this.gainNode.connect(this.audioContext.destination);

    [1, 1.5, 2].forEach((multiplier, index) => {
      const oscillator = this.audioContext.createOscillator();
      const oscillatorGain = this.audioContext.createGain();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.value = CONFIG.music.baseFrequency * multiplier;
      oscillatorGain.gain.value = index === 0 ? 0.75 : 0.18;
      oscillator.connect(oscillatorGain);
      oscillatorGain.connect(this.gainNode);
      oscillator.start();
      this.oscillators.push(oscillator);
    });

    this.setGain(CONFIG.music.gain);
  }

  stop() {
    if (!this.gainNode || !this.audioContext) {
      return;
    }

    this.setGain(0);
  }

  setGain(value) {
    const now = this.audioContext.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.linearRampToValueAtTime(value, now + CONFIG.music.fadeSeconds);
  }
}

class UIController {
  constructor(elements, cameraController, attentionController, effectsManager, musicManager) {
    this.elements = elements;
    this.cameraController = cameraController;
    this.attentionController = attentionController;
    this.effectsManager = effectsManager;
    this.musicManager = musicManager;
    this.complimentTimer = null;
    this.state = {
      mirrorOn: true,
      lightOn: false,
      beautyOn: false,
      musicOn: false,
      isLooking: false,
      attentionSupported: false,
      currentComplimentIndex: 1
    };
  }

  init() {
    this.state = { ...this.state, ...PreferenceStore.load() };
    this.bindEvents();
    this.applyState();
    this.startComplimentRotation();

    if (this.state.mirrorOn) {
      this.turnMirrorOn();
    } else {
      this.cameraController.stop();
    }
  }

  bindEvents() {
    this.elements.mirrorToggle.addEventListener("click", () => {
      this.addClickFeedback(this.elements.mirrorToggle);
      this.toggleMirror();
    });

    this.elements.ringToggle.addEventListener("click", () => {
      this.addClickFeedback(this.elements.ringToggle);
      this.state.lightOn = !this.state.lightOn;
      this.applyState();
      this.persist();
    });

    this.elements.beautyToggle.addEventListener("click", () => {
      this.addClickFeedback(this.elements.beautyToggle);
      this.state.beautyOn = !this.state.beautyOn;
      this.applyState();
      this.persist();
    });

    this.elements.musicToggle.addEventListener("click", async () => {
      this.addClickFeedback(this.elements.musicToggle);
      this.state.musicOn = !this.state.musicOn;
      if (this.state.musicOn) {
        await this.musicManager.start();
      } else {
        this.musicManager.stop();
      }
      this.applyState();
      this.persist();
    });

    this.elements.screenshotButton.addEventListener("click", () => {
      this.addClickFeedback(this.elements.screenshotButton);
      this.captureScreenshot();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state.musicOn) {
        this.musicManager.stop();
      } else if (!document.hidden && this.state.musicOn) {
        this.musicManager.start();
      }
    });
  }

  async toggleMirror() {
    if (this.state.mirrorOn) {
      this.state.mirrorOn = false;
      this.cameraController.stop();
      this.attentionController.stop();
      this.applyState();
      this.persist();
      return;
    }

    await this.turnMirrorOn();
  }

  async turnMirrorOn() {
    const started = await this.cameraController.start();
    this.state.mirrorOn = started;
    this.applyState();
    this.persist();

    if (started) {
      this.attentionController.start();
      this.playActivationPulse();
    } else {
      this.attentionController.stop();
    }
  }

  applyState() {
    this.elements.mirrorFrame.classList.toggle("is-active", this.state.mirrorOn);
    this.elements.mirrorFrame.classList.toggle("is-ring-lit", this.state.lightOn);
    this.elements.mirrorFrame.classList.toggle("is-beauty", this.state.beautyOn);

    this.elements.mirrorToggle.classList.toggle("is-active", this.state.mirrorOn);
    this.elements.mirrorToggle.querySelector("span:last-child").textContent = this.state.mirrorOn
      ? "Mirror ON"
      : "Mirror OFF";

    this.elements.ringToggle.classList.toggle("is-active", this.state.lightOn);
    this.elements.ringToggle.classList.toggle("is-warm", this.state.lightOn);

    this.elements.beautyToggle.classList.toggle("is-active", this.state.beautyOn);
    this.elements.musicToggle.classList.toggle("is-active", this.state.musicOn);
    this.elements.musicToggle.querySelector("span:last-child").textContent = this.state.musicOn
      ? "Music ON"
      : "Music OFF";

    const shouldShowCompliment = this.state.mirrorOn && (this.state.isLooking || !this.state.attentionSupported);
    this.elements.complimentWrap.classList.toggle("is-hidden", !shouldShowCompliment);
  }

  updateStatus(message, isError = false) {
    this.elements.statusPill.textContent = message;
    this.elements.statusPill.classList.toggle("is-error", isError);
  }

  updateAttention(isLooking) {
    if (this.state.isLooking === isLooking) {
      return;
    }

    this.state.isLooking = isLooking;
    this.applyState();

    if (!this.state.mirrorOn || !this.state.attentionSupported) {
      return;
    }

    this.updateStatus(isLooking ? "Mirror live - face detected" : "Mirror live - look toward mirror", false);
  }

  updateAttentionSupport(isSupported) {
    this.state.attentionSupported = isSupported;
    this.applyState();

    if (!isSupported && this.state.mirrorOn) {
      this.updateStatus("Mirror live", false);
    }
  }

  startComplimentRotation() {
    this.elements.complimentText.textContent = COMPLIMENTS[this.state.currentComplimentIndex];
    window.clearInterval(this.complimentTimer);
    this.complimentTimer = window.setInterval(() => {
      this.nextCompliment();
    }, CONFIG.complimentIntervalMs);
  }

  nextCompliment() {
    if (!this.state.isLooking && this.state.attentionSupported) {
      return;
    }

    this.elements.complimentText.classList.add("is-changing");

    window.setTimeout(() => {
      this.state.currentComplimentIndex = (this.state.currentComplimentIndex + 1) % COMPLIMENTS.length;
      this.elements.complimentText.textContent = COMPLIMENTS[this.state.currentComplimentIndex];
      this.elements.complimentText.classList.remove("is-changing");
    }, CONFIG.complimentFadeMs);
  }

  captureScreenshot() {
    const imageUrl = this.cameraController.captureFrame();

    if (!imageUrl) {
      this.updateStatus("Turn mirror on before capturing", true);
      return;
    }

    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `smart-mirror-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    this.updateStatus("Glow shot saved", false);
  }

  playActivationPulse() {
    this.elements.activationPulse.classList.remove("play");
    window.requestAnimationFrame(() => {
      this.elements.activationPulse.classList.add("play");
      window.setTimeout(() => {
        this.elements.activationPulse.classList.remove("play");
      }, CONFIG.pulseResetMs);
    });
  }

  addClickFeedback(button) {
    button.classList.add("is-clicking");
    window.setTimeout(() => button.classList.remove("is-clicking"), CONFIG.clickFeedbackMs);
  }

  persist() {
    PreferenceStore.save(this.state);
  }
}

class SmartMirrorApp {
  constructor() {
    this.elements = this.getElements();
    this.effectsManager = new EffectsManager(this.elements.ambientCanvas);
    this.cameraController = new CameraController(this.elements.mirrorVideo, (message, isError) => {
      this.uiController.updateStatus(message, isError);
    });
    this.attentionController = new AttentionController(
      this.elements.mirrorVideo,
      (isLooking) => this.uiController.updateAttention(isLooking),
      (isSupported) => this.uiController.updateAttentionSupport(isSupported)
    );
    this.musicManager = new MusicManager();
    this.uiController = new UIController(
      this.elements,
      this.cameraController,
      this.attentionController,
      this.effectsManager,
      this.musicManager
    );
  }

  init() {
    this.effectsManager.init();
    this.uiController.init();
  }

  getElements() {
    return Object.fromEntries(
      Object.entries(SELECTORS).map(([key, selector]) => [key, document.querySelector(selector)])
    );
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new SmartMirrorApp();
  app.init();
});
