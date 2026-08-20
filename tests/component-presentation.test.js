"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const catalog = fs.readFileSync(path.join(root, "peripheral-catalog.js"), "utf8");
const schematic = fs.readFileSync(path.join(root, "schematic.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const voltageProbe = fs.readFileSync(path.join(root, "assets", "components", "voltage-probe.svg"), "utf8");
const currentProbe = fs.readFileSync(path.join(root, "assets", "components", "current-probe.svg"), "utf8");

test("flat peripheral artwork does not duplicate names or bus labels", () => {
  const symbolMarkup = catalog.match(/function symbolMarkup[\s\S]*?\n  }/)?.[0] || "";
  assert.match(symbolMarkup, /component-flat-image/);
  assert.doesNotMatch(symbolMarkup, /catalog-module-label/);
  assert.doesNotMatch(symbolMarkup, /catalog-module-bus/);
  assert.match(catalog, /Math\.max\(88, 28 \+ pinCount \* 18\)/);
});

test("peripheral name, value and status use separate presentation bands", () => {
  assert.match(schematic, /classList\.add\("catalog-peripheral"\)/);
  assert.match(schematic, /catalog-primary[\s\S]*catalog-secondary[\s\S]*catalog-status/);
  assert.match(styles, /catalog-peripheral \.component-caption/);
  assert.match(styles, /catalog-peripheral \.catalog-live/);
  assert.match(styles, /catalog-peripheral \.catalog-status/);
});

test("schematic labels have a final readable non-overlapping typography layer", () => {
  assert.match(schematic, /componentName\.title = definition\.title/);
  assert.match(schematic, /value\.title = model\.value/);
  assert.match(styles, /Final schematic typography pass/);
  assert.match(styles, /catalog-peripheral \.catalog-primary[^}]*font-size: 11px/);
  assert.match(styles, /catalog-peripheral \.catalog-status[\s\S]*font-size: 7\.5px/);
  assert.match(styles, /\.schematic-component \.pin-name[\s\S]*font-size: 8px/);
});

test("all schematic component labels have a persistent visibility switch", () => {
  assert.match(index, /id="showComponentLabels"/);
  assert.match(index, /<span>标签<\/span>/);
  assert.match(schematic, /COMPONENT_LABELS_STORAGE_KEY/);
  assert.match(schematic, /setComponentLabelsVisible/);
  assert.match(schematic, /hide-component-labels/);
  assert.match(styles, /schematic-world\.hide-component-labels \.component-caption/);
  assert.match(styles, /schematic-world\.hide-component-labels \.pin-name/);
  assert.match(styles, /schematic-world\.hide-component-labels \.component-body svg text/);
});

test("MCU artwork is a compact package symbol instead of a board mockup", () => {
  assert.match(schematic, /mcu-simple-outline/);
  assert.match(schematic, /mcu-simple-core/);
  assert.doesNotMatch(schematic, /blue-pill\.svg/);
  assert.doesNotMatch(styles, /mcu-brand|mcu-part/);
});

test("measurement probe artwork leaves the screen clear for live numeric values", () => {
  assert.doesNotMatch(voltageProbe, /M34 20l9 18 9-18/);
  assert.doesNotMatch(currentProbe, /M36 38l8-18 8 18/);
  assert.match(schematic, /status: "直流支路实算", code: "measured"/);
  assert.doesNotMatch(schematic, /电阻支路估算/);
  assert.match(schematic, /fetch\("\/api\/spice-solve"/);
  assert.match(schematic, /PySpice · 直流工作点/);
});

test("screen components keep status and address metadata off the framebuffer", () => {
  const oledMarkup = schematic.match(/function createOledLiveMarkup[\s\S]*?\n  }/)?.[0] || "";
  const spiMarkup = schematic.match(/function createSpiDisplayLiveMarkup[\s\S]*?\n  }/)?.[0] || "";
  assert.match(oledMarkup, /oled-pixel-canvas/);
  assert.doesNotMatch(oledMarkup, /oled-status|oled-address/);
  assert.match(spiMarkup, /spi-display-canvas/);
  assert.doesNotMatch(spiMarkup, /spi-display-status/);
  assert.doesNotMatch(styles, /\.oled-status|\.oled-address|\.spi-display-status/);
  assert.match(schematic, /screenNode\.setAttribute\("aria-label", "OLED 128×64/);
  assert.match(schematic, /screenNode\.setAttribute\("aria-label", "ST7735 160×128 SPI/);
});

test("power overloads are visible on both the component and the schematic canvas", () => {
  assert.match(schematic, /alice:power-alert/);
  assert.match(schematic, /component-power-badge/);
  assert.match(schematic, /功率超限/);
  assert.match(styles, /\.power-alert/);
  assert.match(styles, /\.power-overload/);
});
