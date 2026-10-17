(function (root, factory) {
  "use strict";
  var api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AlicePeripheralAudio = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function create(options) {
    var config = options || {};
    var hostWindow = config.window || root;
    var hostDocument = config.document || root.document;
    var context = null;
    var enabled = false;
    var running = false;
    var available = true;
    var disposed = false;
    var voices = new Map();

    function silence() {
      voices.forEach(function (voice) {
        voice.gain.gain.value = 0;
        try { voice.oscillator.stop(); } catch (_) { /* Already stopped. */ }
        voice.oscillator.disconnect();
        voice.gain.disconnect();
      });
      voices.clear();
    }

    function hidden() { return Boolean(hostDocument && hostDocument.hidden); }
    function setRunning(value) {
      running = Boolean(value);
      if (!running) silence();
      return running;
    }

    async function setEnabled(value) {
      enabled = Boolean(value) && !disposed;
      if (!enabled) { silence(); return false; }
      try {
        // Called directly by the sound button's user gesture. Simulation and
        // rendering never create or resume an AudioContext themselves.
        if (!context) {
          var AudioContext = root.AudioContext || root.webkitAudioContext;
          context = config.contextFactory ? config.contextFactory() : (AudioContext ? new AudioContext() : null);
        }
        if (!context) throw new Error("Audio unavailable");
        if (context.state !== "running" && typeof context.resume === "function") await context.resume();
        if (context.state !== "running") throw new Error("Audio context suspended");
        available = true;
        return enabled;
      } catch (_) {
        available = false;
        enabled = false;
        silence();
        return false;
      }
    }

    function waveform(voice, duty) {
      if (voice.duty === duty) return;
      voice.duty = duty;
      if (typeof context.createPeriodicWave !== "function" || typeof voice.oscillator.setPeriodicWave !== "function") {
        voice.oscillator.type = "square";
        return;
      }
      // A zero-mean pulse wave, bounded to 32 harmonics. Its duty follows PWM
      // without exposing a DC offset to the speaker.
      var real = new Float32Array(33);
      var imaginary = new Float32Array(33);
      for (var harmonic = 1; harmonic < 33; harmonic += 1) {
        real[harmonic] = Math.sin(2 * Math.PI * harmonic * duty) / (Math.PI * harmonic);
        imaginary[harmonic] = (1 - Math.cos(2 * Math.PI * harmonic * duty)) / (Math.PI * harmonic);
      }
      voice.oscillator.setPeriodicWave(context.createPeriodicWave(real, imaginary));
    }

    function sync(components, options) {
      if (options && Object.prototype.hasOwnProperty.call(options, "running")) setRunning(options.running);
      if (disposed || !enabled || !running || hidden() || !context || context.state !== "running") { silence(); return; }
      var targets = new Map();
      (Array.isArray(components) ? components : []).forEach(function (component) {
        if (!component || component.type !== "buzzer" || targets.size >= 4) return;
        var state = component.deviceState || component.state || {};
        var frequency = Number(state.frequencyHz);
        var duty = Number(state.dutyPermille) / 1000;
        if (!component.id || !state.active || !state.ready || !state.power || !state.power.powered || !Number.isFinite(frequency) || frequency < 20 || frequency > 20000 || !Number.isFinite(duty) || duty <= 0 || duty >= 1) return;
        targets.set(String(component.id), { frequency: frequency, duty: duty });
      });
      voices.forEach(function (voice, id) {
        if (targets.has(id)) return;
        voice.gain.gain.value = 0;
        voice.oscillator.stop();
        voice.oscillator.disconnect();
        voice.gain.disconnect();
        voices.delete(id);
      });
      targets.forEach(function (target, id) {
        var voice = voices.get(id);
        if (!voice) {
          voice = { oscillator: context.createOscillator(), gain: context.createGain(), duty: null };
          voice.oscillator.connect(voice.gain);
          voice.gain.connect(context.destination);
          voices.set(id, voice);
          voice.oscillator.frequency.value = target.frequency;
          waveform(voice, target.duty);
          voice.gain.gain.value = .025;
          voice.oscillator.start();
        } else {
          voice.oscillator.frequency.value = target.frequency;
          waveform(voice, target.duty);
        }
      });
    }

    function visibilityChanged() { if (hidden()) silence(); }
    function pageHidden() { setRunning(false); }
    if (hostDocument && typeof hostDocument.addEventListener === "function") hostDocument.addEventListener("visibilitychange", visibilityChanged);
    if (hostWindow && typeof hostWindow.addEventListener === "function") hostWindow.addEventListener("pagehide", pageHidden);

    return {
      setEnabled: setEnabled,
      setRunning: setRunning,
      sync: sync,
      silence: silence,
      getState: function () { return { enabled: enabled, running: running, available: available, voiceCount: voices.size }; },
      dispose: function () {
        disposed = true;
        enabled = false;
        running = false;
        silence();
        if (hostDocument && typeof hostDocument.removeEventListener === "function") hostDocument.removeEventListener("visibilitychange", visibilityChanged);
        if (hostWindow && typeof hostWindow.removeEventListener === "function") hostWindow.removeEventListener("pagehide", pageHidden);
        if (context && typeof context.close === "function") context.close();
      }
    };
  }

  return Object.assign({ create: create }, create());
}));
