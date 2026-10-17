"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{execFileSync}=require("node:child_process");
const {loadCircuit,root}=require("./circuit-tools.cjs");
const model=JSON.parse(execFileSync(require("./_tutorial-environment.cjs").python,[path.join(__dirname,"verify.py"),"--model"],{encoding:"utf8"}));
const circuit=loadCircuit(model);
const saved=JSON.parse(fs.readFileSync(path.join(__dirname,"Learning06_Components.alice-sch.json"),"utf8"));
const loaded=circuit.importCircuit(saved);
assert.equal(loaded.ok,true,JSON.stringify(loaded));assert.equal(loaded.skippedWireCount,0);
const serial=[],spi=[];
const runtime=require(path.join(root,"firmware-runtime.js")).create(model,{
  onGpio:event=>circuit.driveMcuPin(event.pin,event.value,{render:false}),
  onPwm:event=>circuit.driveMcuPwm({...event,render:false}),
  onPeripheral:event=>circuit.handlePeripheralOperation(event),
  onSpiTx:event=>{spi.push(event);return circuit.handleSpiTransmission(event);},
  onUartTx:event=>serial.push(event.text)
});
runtime.start();
function device(id){circuit.compileNetlist();return circuit.getState().components.find(c=>c.id===id).deviceState;}
for(const [cm,zone,alarm,hz,rows] of [
  [150,0,false,0,[0x3c,0x42,0xa5,0x81,0xa5,0x99,0x42,0x3c]],
  [25,2,true,2000,[0x81,0x42,0x24,0x18,0x18,0x24,0x42,0x81]],
  [75,1,false,1000,[0x18,0x18,0x18,0x18,0x18,0,0x18,0x18]],
  [100,0,false,0,[0x3c,0x42,0xa5,0x81,0xa5,0x99,0x42,0x3c]],
  [50,1,false,1000,[0x18,0x18,0x18,0x18,0x18,0,0x18,0x18]],
  [49.9,2,true,2000,[0x81,0x42,0x24,0x18,0x18,0x24,0x42,0x81]],
  [150,0,false,0,[0x3c,0x42,0xa5,0x81,0xa5,0x99,0x42,0x3c]]
]){
  circuit.setPeripheralProperties("range",{distanceCm:cm});
  const state=runtime.step(150);
  assert.equal(state.error,null,JSON.stringify(state.error));
  assert.equal(state.variables.distance_mm,Math.round(cm*10));
  assert.equal(state.variables.zone,zone);
  const matrix=device("matrix"),relay=device("relay"),buzzer=device("buzzer");
  assert.equal(matrix.ready,true,JSON.stringify(matrix));assert.equal(matrix.visible,true);
  assert.deepEqual(Array.from(matrix.rows),rows);
  assert.equal(relay.energized,alarm);
  assert.equal(buzzer.active,hz>0,JSON.stringify(buzzer));
  if(hz)assert.equal(buzzer.frequencyHz,hz);
  const lights=circuit.compileNetlist().leds;
  assert.equal(lights.find(l=>l.componentId==="red").on,alarm);
  assert.equal(lights.find(l=>l.componentId==="green").on,!alarm);
  const line=serial.at(-1);
  assert.ok(line.includes("DIST="+cm.toFixed(1)+" cm"),line);
  console.log(JSON.stringify({cm,zone,relay:relay.energized,buzzerHz:hz,rows:matrix.rows,serial:line.trim()}));
}
assert.ok(spi.length>=29,"initialization and all eight rows transmitted over actual HAL SPI");
// Disconnect sensor power in the actual saved circuit: the next read must alarm.
const failed=JSON.parse(circuit.serializeCircuit());
failed.wires=failed.wires.filter(w=>!(w.to.componentId==="range"&&w.to.pin==="VCC"));
assert.equal(circuit.importCircuit(failed).ok,true);
const errorState=runtime.step(150);
assert.equal(errorState.error,null,JSON.stringify(errorState.error));
assert.equal(errorState.variables.zone,3);
assert.equal(device("relay").energized,true);
assert.ok(serial.at(-1).includes("SENSOR ERROR="));
console.log("PASS Learning06_Components: real HC-SR04 wiring -> SPI matrix / PWM / relay contact loads; all zones, exact boundaries, recovery and unplugged sensor verified.");
