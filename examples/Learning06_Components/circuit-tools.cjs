"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
function loadCircuit(model) {
  const window = {addEventListener() {},
    AliceOledDevice: require(path.join(root, "oled-device.js")),
    AliceSpiDisplayDevice: require(path.join(root, "spi-display-device.js")),
    AliceLightSensorDevice: require(path.join(root, "light-sensor-device.js")),
    AlicePeripheralCatalog: require(path.join(root, "peripheral-catalog.js")),
    AlicePeripheralDevices: require(path.join(root, "peripheral-devices.js"))};
  const context = vm.createContext({window, document: {readyState: "loading", addEventListener() {}, body:null},
    Blob, console, queueMicrotask, setTimeout, clearTimeout,
    CustomEvent: function(type, options) {this.type=type;this.detail=options&&options.detail;}});
  // Test-only geometry inspection; the application source remains unchanged.
  const source=fs.readFileSync(path.join(root,"schematic.js"),"utf8").replace(
    "var publicApi = {", "var publicApi = { getDefinitionsForTest: function(){return componentDefinitions;},");
  vm.runInContext(source,context,{filename:"schematic.js"});
  const api=window.AliceSchematic;
  api.applyProjectModel(model);
  return api;
}
module.exports={loadCircuit,root};
