(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AlicePeripheralVisuals = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Geometry is built once. Updates only change attributes whose values changed.
  // No timers: stopping the simulation leaves every effect at its last state.
  var TYPES = ["sg90", "tm1637", "max7219", "ws2812", "buzzer", "potentiometer", "rotaryEncoder", "joystick", "relay", "mosfet", "dcDcConverter", "dht11", "sht30", "ds18b20", "bmp280", "bh1750", "hcsr04", "pir", "mq2", "mpu6050", "pcf8574", "pca9685", "ina219", "ds3231"];
  var SEGMENTS = ["3,1 15,1 17,3 15,5 3,5 1,3", "16,4 18,6 18,16 16,18 14,16 14,6", "16,20 18,22 18,32 16,34 14,32 14,22", "3,33 15,33 17,35 15,37 3,37 1,35", "0,20 2,22 2,32 0,34 -2,32 -2,22", "0,4 2,6 2,16 0,18 -2,16 -2,6", "3,17 15,17 17,19 15,21 3,21 1,19"];
  function num(value, fallback) { var n = Number(value); return Number.isFinite(n) ? n : (fallback || 0); }
  function bound(value, min, max) { return Math.max(min, Math.min(max, num(value))); }
  function svg(content) { return '<svg class="catalog-effect" viewBox="0 0 100 64" aria-hidden="true">' + content + '</svg>'; }
  function circle(x, y, r, attrs) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" ' + (attrs || '') + '/>'; }
  function board() { return '<rect class="effect-board" x="3" y="3" width="94" height="58" rx="5"/>' + circle(9, 9, 2, 'class="effect-hole"') + circle(91, 55, 2, 'class="effect-hole"'); }
  function markup(type) {
    if (TYPES.indexOf(type) < 0) return "";
    var content = "";
    if (type === "tm1637") {
      content = '<rect class="effect-display-case" x="0" y="6" width="100" height="52" rx="4"/>';
      for (var digit = 0; digit < 4; digit += 1) {
        content += '<g transform="translate(' + (6 + digit * 23 + (digit > 1 ? 2 : 0)) + ' 13) scale(.95)">';
        SEGMENTS.forEach(function (points, bit) { content += '<polygon class="effect-segment" data-segment="' + digit + ':' + bit + '" points="' + points + '"/>'; });
        content += circle(20, 35, 1.3, 'class="effect-segment" data-segment="' + digit + ':7"') + '</g>';
      }
      content += circle(49, 27, 1.6, 'class="effect-segment" data-colon') + circle(49, 39, 1.6, 'class="effect-segment" data-colon');
    } else if (type === "max7219") {
      content = '<rect class="effect-display-case" x="19" y="1" width="62" height="62" rx="3"/>';
      for (var row = 0; row < 8; row += 1) for (var col = 0; col < 8; col += 1) content += circle(26 + col * 7, 8 + row * 7, 2.5, 'class="effect-pixel" data-pixel="' + (row * 8 + col) + '"');
    } else if (type === "ws2812") {
      content = '<rect class="effect-strip" x="0" y="1" width="100" height="62" rx="4"/><g data-beads></g>';
    } else if (type === "sg90") {
      content = '<rect class="effect-servo-tab" x="12" y="20" width="76" height="32" rx="3"/><rect class="effect-servo-body" x="25" y="10" width="50" height="51" rx="5"/><path class="effect-scale" d="M20 29a30 30 0 0 1 60 0"/>' + circle(50, 29, 12, 'class="effect-metal"') + '<g data-horn><path class="effect-horn" d="M45 29V5Q50-2 55 5V29Z"/>' + circle(50, 6, 2, 'class="effect-hole"') + circle(50, 17, 2, 'class="effect-hole"') + '</g>' + circle(50, 29, 4, 'class="effect-screw"');
    } else if (type === "buzzer") {
      content = circle(50, 33, 23, 'class="effect-knob"') + circle(50, 33, 8, 'class="effect-hole"') + '<g data-sound class="effect-sound"><path d="M20 20q-10 13 0 26M13 13q-17 20 0 40M80 20q10 13 0 26M87 13q17 20 0 40"/></g>';
    } else if (type === "potentiometer" || type === "rotaryEncoder") {
      content = board() + '<path class="effect-scale" d="M29 50a27 27 0 1 1 42 0"/>' + circle(50, 30, 22, 'class="effect-knob"') + '<g data-pointer><path class="effect-pointer" d="M50 29V13"/></g>' + circle(50, 30, 5, 'class="effect-metal" data-press');
    } else if (type === "joystick") {
      content = board() + '<path class="effect-axis" d="M20 32h60M50 8v48"/>' + circle(50, 32, 24, 'class="effect-joystick-base"') + '<g data-stick>' + circle(0, 0, 13, 'class="effect-knob"') + circle(-3, -3, 5, 'class="effect-metal" data-press') + '</g>';
    } else if (type === "relay") {
      content = board() + '<rect class="effect-servo-body" x="13" y="13" width="30" height="39" rx="3"/><path class="effect-coil" d="M20 23q15-10 15 0t-15 0m0 9q15-10 15 0t-15 0m0 9q15-10 15 0t-15 0"/>' + circle(57, 46, 3, 'class="effect-contact"') + circle(82, 17, 3, 'class="effect-contact"') + circle(82, 46, 3, 'class="effect-contact"') + '<path class="effect-contact-arm" data-contact/>' + circle(21, 10, 3, 'class="effect-indicator" data-indicator');
    } else if (type === "hcsr04") {
      content = '<rect class="effect-board" x="2" y="35" width="33" height="26" rx="3"/>' + circle(11, 48, 7, 'class="effect-metal"') + circle(26, 48, 7, 'class="effect-metal"') + '<path class="effect-distance-axis" d="M39 48h56"/><path class="effect-sound" d="M39 38q10 10 0 20"/><g data-target><rect class="effect-target" x="-3" y="13" width="6" height="43" rx="2"/><path class="effect-pointer" d="M-5 6h10"/></g>';
    } else if (type === "pir") {
      content = board() + circle(36, 32, 23, 'class="effect-pir-lens"') + '<path class="effect-axis" d="M13 32h46M36 9v46M19 16l34 32M19 48l34-32"/><g data-motion>' + circle(77, 17, 5, 'class="effect-person"') + '<path class="effect-person-limbs" d="M77 24v18m-10-7 10-10 10 10m-10 7-8 12m8-12 9 12"/></g>';
    } else if (type === "mpu6050") {
      content = board() + '<path class="effect-axis" d="M18 32h64M50 10v44"/><g data-tilt><rect class="effect-chip" x="35" y="20" width="30" height="24" rx="3"/><path class="effect-pointer" d="M50 31V13m-4 5 4-5 4 5"/></g><path class="effect-vector" data-vector/>';
    } else if (type === "pcf8574") {
      content = board();
      for (var pin = 0; pin < 8; pin += 1) content += '<rect class="effect-io" data-io="' + pin + '" x="' + (12 + pin * 10) + '" y="18" width="7" height="29" rx="2"/>';
    } else if (type === "pca9685") {
      content = board() + '<path class="effect-axis" d="M11 48h78"/><path class="effect-pwm" data-wave/>';
    } else if (type === "ds3231") {
      content = board() + circle(50, 32, 26, 'class="effect-clock"');
      for (var hour = 0; hour < 12; hour += 1) content += '<path class="effect-clock-tick" transform="rotate(' + hour * 30 + ' 50 32)" d="M50 8v3"/>';
      content += '<path class="effect-hour" data-hour d="M50 32V19"/><path class="effect-minute" data-minute d="M50 32V12"/><path class="effect-second" data-second d="M50 36V10"/>' + circle(50, 32, 2, 'class="effect-screw"');
    } else if (type === "mosfet") {
      content = '<rect class="effect-metal" x="29" y="3" width="43" height="18" rx="3"/>' + circle(50, 11, 4, 'class="effect-hole"') + '<path class="effect-leads" d="M35 41v21m15-21v21m15-21v21"/><rect class="effect-chip" x="24" y="18" width="52" height="30" rx="4"/><path class="effect-channel" data-channel d="M35 29h30m-30 8h30"/>';
    } else if (type === "dcDcConverter") {
      content = board() + circle(30, 29, 16, 'class="effect-coil-body"') + circle(30, 29, 7, 'class="effect-hole"') + '<rect class="effect-chip" x="55" y="17" width="29" height="20" rx="2"/><rect class="effect-gauge-track" x="15" y="49" width="70" height="5" rx="2"/><rect class="effect-gauge-fill" data-gauge x="15" y="49" width="0" height="5" rx="2"/>';
    } else {
      // These are views of the configured physical input, not fabricated bus readings.
      content = board();
      if (type === "dht11" || type === "sht30" || type === "ds18b20") {
        content += '<rect class="effect-gauge-track" x="22" y="9" width="12" height="38" rx="6"/>' + circle(28, 48, 8, 'class="effect-temperature"') + '<rect class="effect-temperature" data-temperature x="25" y="20" width="6" height="29" rx="3"/>';
        if (type !== "ds18b20") content += '<path class="effect-droplet" d="M68 9Q40 47 68 53Q96 47 68 9Z"/><rect class="effect-humidity" data-humidity x="60" y="34" width="16" height="10" rx="4"/>';
      } else if (type === "bh1750") {
        content += '<g data-light>' + circle(50, 31, 13, 'class="effect-sun"') + '<path class="effect-sun-rays" d="M50 7v7m0 34v8M25 31h8m34 0h8M32 13l6 6m24 24 6 6M32 49l6-6m24-24 6-6"/></g>';
      } else {
        content += '<path class="effect-scale" d="M24 42a26 26 0 0 1 52 0"/><g data-needle><path class="effect-pointer" d="M50 42V20"/></g>' + circle(50, 42, 4, 'class="effect-screw"');
      }
    }
    return svg(content);
  }

  function frame(type, state, component) {
    state = state || {};
    component = component || {};
    var p = state.properties || component.peripheralProperties || {};
    var powered = Boolean(state.power && state.power.powered);
    var f = { powered: powered, ready: Boolean(state.ready) };
    if (type === "sg90") f.angle = bound(state.angle, 0, 180) - 90;
    if (type === "tm1637") {
      f.brightness = .16 + bound(state.brightness, 0, 7) / 7 * .84;
      f.segments = [0, 1, 2, 3].map(function (i) { return powered && state.visible ? num((state.segments || [])[i]) & 255 : 0; });
      f.colon = Boolean(powered && state.visible && state.colon);
    }
    if (type === "max7219") {
      f.brightness = .12 + bound(state.intensity, 0, 15) / 15 * .88;
      f.rows = Array.from({ length: 8 }, function (_, i) { return powered && state.visible && i <= num(state.scanLimit, 7) ? (state.test ? 255 : num((state.rows || [])[i]) & 255) : 0; });
    }
    if (type === "ws2812") {
      f.colors = Array.from({ length: bound(p.count || state.count || 8, 1, 256) }, function (_, i) { return powered ? num((state.colors || [])[i]) & 0xffffff : 0; });
    }
    if (type === "buzzer") f.active = Boolean(powered && state.active);
    if (type === "potentiometer") f.angle = bound(p.percent, 0, 100) * 2.7 - 135;
    if (type === "rotaryEncoder") f.angle = (num(component.encoderPhase ? component.encoderPhase.position : p.position) % 20) * 18;
    f.pressed = Boolean(num(p.pressed));
    if (type === "joystick") { f.x = 25 + bound(p.xPercent, 0, 100) / 2; f.y = 12 + bound(p.yPercent, 0, 100) * .4; }
    if (type === "relay") f.active = Boolean(powered && state.energized);
    if (type === "mosfet") f.active = Boolean(component.mosfetOn);
    if (type === "hcsr04") f.distance = 44 + (bound(state.distanceCm, 2, 400) - 2) / 398 * 49;
    if (type === "pir") f.motion = Boolean(powered && num(p.motion));
    if (type === "mpu6050") { f.tilt = bound(p.accelX, -1, 1) * 45; f.vector = bound(p.gyroZ, -2000, 2000) / 2000 * 26; }
    if (type === "pcf8574") f.mask = powered ? num(state.pinMask == null ? p.inputMask : state.pinMask) & 255 : 0;
    if (type === "pca9685") {
      var channel = Array.isArray(state.channels) ? state.channels[0] : null;
      f.duty = powered ? (channel ? (channel.active ? bound(channel.dutyCycle, 0, 1) : 0) : bound(p.channel0, 0, 4095) / 4096) : 0;
    }
    if (type === "ds3231") { var date = new Date(num(state.unixTime == null ? p.unixTime : state.unixTime) * 1000); f.hour = date.getUTCHours() * 30 + date.getUTCMinutes() / 2; f.minute = date.getUTCMinutes() * 6; f.second = date.getUTCSeconds() * 6; }
    f.temperature = (bound(state.temperatureC == null ? p.temperatureC : state.temperatureC, -55, 125) + 55) / 180;
    f.humidity = bound(state.humidityPercent == null ? p.humidityPercent : state.humidityPercent, 0, 100) / 100;
    f.light = Math.log10(1 + bound(p.lux, 0, 65535)) / Math.log10(65536);
    if (type === "bmp280") f.needle = (bound(p.pressurePa, 30000, 110000) - 30000) / 80000 * 180 - 90;
    if (type === "ina219") f.needle = bound(p.currentA, -3.2, 3.2) / 3.2 * 90;
    if (type === "mq2") { f.needle = bound(p.ppm, 0, 10000) / 10000 * 180 - 90; f.alarm = powered && num(p.ppm) >= num(p.thresholdPpm); }
    if (type === "dcDcConverter") { f.load = component.converterEnabled ? bound(component.powerState && component.powerState.utilizationPercent, 0, 100) / 100 : 0; f.alarm = Boolean(component.powerState && component.powerState.overload); }
    return f;
  }

  function update(root, type, state, component) {
    if (!root) return;
    var f = frame(type, state, component);
    var key = JSON.stringify(f);
    if (root._aliceEffectFrame === key) return;
    root._aliceEffectFrame = key;
    function attr(selector, name, value) { root.querySelectorAll(selector).forEach(function (node) { var text = String(value); if (node.getAttribute(name) !== text) node.setAttribute(name, text); if (name === "fill" || name === "stroke") node.style.setProperty(name, text); }); }
    function rotate(selector, angle, x, y) { attr(selector, "transform", "rotate(" + angle + " " + x + " " + y + ")"); }
    root.classList.toggle("effect-powered", f.powered);
    root.classList.toggle("effect-alarm", Boolean(f.alarm));
    rotate("[data-horn]", f.angle || 0, 50, 29);
    rotate("[data-pointer]", f.angle || 0, 50, 30);
    attr("[data-press]", "fill", f.pressed ? "#f8b544" : "#bcc9cc");
    attr("[data-stick]", "transform", "translate(" + (f.x || 50) + " " + (f.y || 32) + ")");
    attr("[data-sound]", "opacity", f.active ? 1 : 0);
    attr("[data-contact]", "d", f.active ? "M57 46L81 19" : "M57 46H81");
    attr("[data-indicator]", "fill", f.active ? "#51ed9a" : "#183e30");
    attr("[data-channel]", "stroke", f.active ? "#5bf1a5" : "#647473");
    attr("[data-target]", "transform", "translate(" + (f.distance || 44) + " 0)");
    attr("[data-motion]", "opacity", f.motion ? 1 : .16);
    rotate("[data-tilt]", f.tilt || 0, 50, 32);
    attr("[data-vector]", "d", "M50 53h" + (f.vector || 0));
    rotate("[data-hour]", f.hour || 0, 50, 32);
    rotate("[data-minute]", f.minute || 0, 50, 32);
    rotate("[data-second]", f.second || 0, 50, 32);
    rotate("[data-needle]", f.needle || 0, 50, 42);
    attr("[data-gauge]", "width", (f.load || 0) * 70);
    attr("[data-temperature]", "y", 44 - f.temperature * 31);
    attr("[data-temperature]", "height", 5 + f.temperature * 31);
    attr("[data-humidity]", "y", 49 - f.humidity * 24);
    attr("[data-humidity]", "height", 1 + f.humidity * 24);
    attr("[data-light]", "opacity", .12 + .88 * f.light);
    var duty = f.duty || 0;
    attr("[data-wave]", "d", [0, 1, 2].map(function (i) { var x = 11 + i * 26; return "M" + x + " 46v-26h" + duty * 26 + "v26h" + (1 - duty) * 26; }).join(""));
    root.querySelectorAll("[data-segment]").forEach(function (node) { var parts = node.getAttribute("data-segment").split(":").map(Number); var lit = (f.segments[parts[0]] & (1 << parts[1])) !== 0; node.style.fill = lit ? "#ff483b" : "#341b20"; node.setAttribute("opacity", lit ? f.brightness : 1); });
    attr("[data-colon]", "fill", f.colon ? "#ff483b" : "#341b20");
    attr("[data-colon]", "opacity", f.colon ? f.brightness : 1);
    root.querySelectorAll("[data-pixel]").forEach(function (node) { var i = Number(node.getAttribute("data-pixel")); var lit = (f.rows[Math.floor(i / 8)] & (128 >> (i % 8))) !== 0; node.style.fill = lit ? "#ff493d" : "#341b20"; node.setAttribute("opacity", lit ? f.brightness : 1); });
    root.querySelectorAll("[data-io]").forEach(function (node) { node.setAttribute("fill", f.mask & (1 << Number(node.getAttribute("data-io"))) ? "#60eba9" : "#183e30"); });
    var beads = root.querySelector("[data-beads]");
    if (beads && f.colors) {
      var cols = Math.min(16, Math.max(4, Math.ceil(Math.sqrt(f.colors.length * 2))));
      var rows = Math.ceil(f.colors.length / cols);
      var gapX = 92 / cols, gapY = Math.min(26, 54 / rows), size = Math.min(9, gapX * .7, gapY * .7);
      if (beads.childElementCount !== f.colors.length) beads.innerHTML = f.colors.map(function (_, i) { return '<rect data-led="' + i + '" x="' + (4 + (i % cols + .5) * gapX - size / 2) + '" y="' + (32 - rows * gapY / 2 + (Math.floor(i / cols) + .5) * gapY - size / 2) + '" width="' + size + '" height="' + size + '" rx="1" stroke="#98a1a6" stroke-width=".7"/>'; }).join("");
      beads.querySelectorAll("[data-led]").forEach(function (node, i) { var color = f.colors[i] ? "#" + f.colors[i].toString(16).padStart(6, "0") : "#272e36"; node.setAttribute("fill", color); node.style.filter = f.colors[i] ? "drop-shadow(0 0 1.6px " + color + ")" : "none"; });
    }
  }
  return Object.freeze({ types: TYPES.slice(), markup: markup, frame: frame, update: update });
}));
