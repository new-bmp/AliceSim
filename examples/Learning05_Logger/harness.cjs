'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const os = require('node:os');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
function buildModel() {
  const hash=crypto.createHash('sha256');
  function visit(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(directory,entry.name);if(entry.isDirectory())visit(p);else if(/\.(c|h|ioc)$/.test(entry.name)){hash.update(path.relative(__dirname,p));hash.update(fs.readFileSync(p));}}}
  visit(__dirname);hash.update(fs.readFileSync(path.join(root,'hal_model.py')));
  const cache=path.join(os.tmpdir(),'alicesim-learning05-'+hash.digest('hex')+'.json');
  if(fs.existsSync(cache))return JSON.parse(fs.readFileSync(cache,'utf8'));
  const python = process.env.ALICESIM_PYTHON || path.join(root, '.venv/Scripts/python.exe');
  const model=JSON.parse(execFileSync(python, [path.join(__dirname, 'verify.py'), '--model'], {cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}));
  fs.writeFileSync(cache,JSON.stringify(model));return model;
}
function createCircuit(model, document) {
  const window = {
    addEventListener() {},
    AliceOledDevice: require(path.join(root, 'oled-device.js')),
    AliceSpiDisplayDevice: require(path.join(root, 'spi-display-device.js')),
    AliceLightSensorDevice: require(path.join(root, 'light-sensor-device.js')),
    AlicePeripheralCatalog: require(path.join(root, 'peripheral-catalog.js')),
    AlicePeripheralDevices: require(path.join(root, 'peripheral-devices.js'))
  };
  const context = vm.createContext({window, document: {readyState: 'loading', addEventListener() {}, body: null},
    Blob, CustomEvent: function(type, options) {this.type = type; this.detail = options && options.detail;},
    console, queueMicrotask, setTimeout, clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(root, 'schematic.js'), 'utf8'), context);
  const circuit = window.AliceSchematic;
  circuit.applyProjectModel(model);
  if (document) {
    const result = circuit.importCircuit(document);
    if (!result.ok || result.skippedWireCount) throw new Error(JSON.stringify(result));
  }
  return circuit;
}
module.exports = {root, buildModel, createCircuit};
