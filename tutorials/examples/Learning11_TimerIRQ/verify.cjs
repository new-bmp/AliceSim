"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {execFileSync} = require("node:child_process");
const {root} = require("./_tutorial-environment.cjs");
const runtimeApi = require(path.join(root, "firmware-runtime.js"));
const python = process.env.ALICESIM_PYTHON || require("./_tutorial-environment.cjs").python;
const model = JSON.parse(execFileSync(python,[path.join(__dirname,"verify.py"),"--model"],{encoding:"utf8",cwd:root}));
const window = {addEventListener() {},
  AliceOledDevice:require(path.join(root,"oled-device.js")),
  AliceSpiDisplayDevice:require(path.join(root,"spi-display-device.js")),
  AliceLightSensorDevice:require(path.join(root,"light-sensor-device.js")),
  AlicePeripheralCatalog:require(path.join(root,"peripheral-catalog.js")),
  AlicePeripheralDevices:require(path.join(root,"peripheral-devices.js"))};
const context = vm.createContext({window,document:{readyState:"loading",addEventListener() {},body:null},
  Blob,console,queueMicrotask,setTimeout,clearTimeout,
  CustomEvent:function(type,options) {this.type=type; this.detail=options && options.detail;}});
vm.runInContext(fs.readFileSync(path.join(root,"schematic.js"),"utf8"),context,{filename:"schematic.js"});
const circuit=window.AliceSchematic;
circuit.applyProjectModel(model);
assert.equal(circuit.importCircuit(JSON.parse(fs.readFileSync(path.join(__dirname,"Learning11_TimerIRQ.alice-sch.json"),"utf8"))).ok,true);
assert.equal(model.timers.htim2.clockHz,8000000,"APB1 /2 makes 4MHz PCLK, timer clock is doubled");
assert.equal(model.timers.htim2.prescaler,7999);
assert.equal(model.timers.htim2.period,99);
assert.equal(model.timers.htim2.frequencyHz,10);
const transmissions=[];
const toggles=[];
const runtime=runtimeApi.create(model,{
  onGpio:e=>{circuit.driveMcuPin(e.pin,e.value); toggles.push(e);},
  onUartTx:e=>transmissions.push(e)
});
let state;
function advance(ms) {
  state=runtime.step(ms);
  while(state.pendingAdvanceMs>0) state=runtime.step(0);
  assert.notEqual(state.status,"error",JSON.stringify(state.error));
  return state;
}
runtime.start(); advance(0);
assert.equal(state.gpio.PB12,0);
assert.equal(state.gpio.PB13,0);
advance(99);
assert.equal(state.variables.timer_ticks,0,"no early update");
advance(2);
assert.equal(state.variables.timer_ticks,1);
assert.equal(state.variables.processed_ticks,1);
assert.equal(state.gpio.PB12,1);
assert.equal(circuit.compileNetlist().leds.find(l=>l.componentId==="tick-led").on,true,"actual resistor and LED circuit");
advance(150);
assert.equal(state.variables.timer_ticks,2);
assert.equal(state.variables.work_count,1,"250ms independent main task runs between updates");
assert.equal(state.gpio.PB13,1);
assert.equal(circuit.compileNetlist().leds.find(l=>l.componentId==="work-led").on,true);
advance(750); // total 1001 ms, ten updates and four independent work events
assert.equal(state.variables.timer_ticks,10);
assert.equal(state.variables.processed_ticks,10);
assert.equal(state.variables.work_count,4);
assert.equal(state.gpio.PB12,0);
assert.equal(state.gpio.PB13,0);
advance(1000);
assert.equal(state.variables.timer_ticks,20);
assert.equal(state.variables.processed_ticks,20,"large host step retains every update");
assert.equal(state.variables.work_count,8);
assert.equal(transmissions.length,20);
assert.match(transmissions[19].text,/TICK=20 WORK=/);
assert.ok(state.variables.loop_count>1500,"main does independent work throughout timer operation");
assert.equal(circuit.getState().mcuDrives.PB12,0);
assert.equal(circuit.getState().mcuDrives.PB13,0);
console.log("PASS Learning11_TimerIRQ: 8MHz APB timer clock; 7999/99 -> 10Hz; 0/1/10/20 exact updates; no lost events during large steps; 8 independent work cycles; real LED/UART output.");
