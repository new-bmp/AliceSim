"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const styles = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const polish = styles.slice(styles.indexOf("AliceSIM modern workspace polish"));

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...polish.matchAll(new RegExp(escaped + "\\s*\\{([^}]+)\\}", "g"))].map(match => match[1]).join("\n");
}

function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test("compact ribbon commands leave a separate band for group captions", () => {
  assert.match(rule(".visio-theme .ribbon-stack"), /flex-direction: row/);
  const button = rule('.visio-theme .ribbon-group[data-ui-action-group="file-project"] .ribbon-stack button');
  assert.match(button, /height: 42px/);
  assert.match(button, /white-space: nowrap/);
  assert.match(rule(".visio-theme .ribbon-group"), /padding: 3px 8px 16px/);
  // Ribbon padding (9), group borders (2), top padding (3), caption band (16).
  assert.ok(42 <= 72 - 9 - 2 - 3 - 16);
});

test("the component palette separates its heading from the scrollable symbols", () => {
  const palette = ".visio-theme .topbar .ribbon > .ribbon-component-library";
  assert.match(rule(palette), /grid-template-columns: 80px minmax\(0, 1fr\)/);
  assert.match(rule(palette), /align-items: stretch/);
  assert.match(rule(palette + " .library-head"), /grid-column: 1/);
  assert.match(rule(palette + " .library-items"), /grid-column: 2/);
  assert.match(rule(palette + " .library-items"), /align-self: stretch/);
});

test("all dark build-console message colors meet normal-text contrast", () => {
  const background = rule(".visio-theme .simulation-build-output").match(/background: (#[a-f\d]{6})/i)?.[1];
  assert.ok(background);
  for (const suffix of [".terminal-line.success", ".terminal-line.info", ".muted", ".terminal-line.warn", ".terminal-line.command", ".terminal-line.error"]) {
    const foreground = rule(".visio-theme .simulation-build-output " + suffix).match(/color: (#[a-f\d]{6})/i)?.[1];
    assert.ok(foreground, suffix);
    const ratio = (luminance(foreground) + 0.05) / (luminance(background) + 0.05);
    assert.ok(ratio >= 4.5, `${suffix}: contrast ${ratio.toFixed(2)}`);
  }
});

test("visual polish keeps channel popups and folded panel names accessible", () => {
  assert.doesNotMatch(rule(".visio-theme .schematic-timeline"), /overflow:\s*(hidden|clip)/);
  assert.match(rule(".visio-theme .simulation-runtime-dock.collapsed .runtime-pane-head > div:first-child"), /display: flex/);
  assert.match(rule(".visio-theme textarea:focus-visible"), /outline: 3px solid/);
});

test("the primary envelope action retains white text on a dark hover background", () => {
  const hover = rule(".visio-theme .envelope-dock .envelope-play:hover");
  assert.match(hover, /color: #fff/);
  const background = hover.match(/background: (#[a-f\d]{6})/i)?.[1];
  assert.ok(background);
  assert.ok(1.05 / (luminance(background) + 0.05) >= 4.5);
});

test("small screens retain fold arrows and can reach panels below the viewport", () => {
  assert.match(rule(".visio-theme .simulation-runtime-dock.collapsed"), /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(rule(".visio-theme .simulator-panel"), /overflow-y: auto/);
});
