'use strict';
// Catches wrong register/data ordering, CS polarity, pixel writes and disconnected clock handling.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.ok(fs.existsSync(path.join(__dirname,'Core/Src/main.c')),'SPI teaching firmware is missing');
const {root,buildModel,createCircuit}=require('./harness.cjs');
const model=buildModel(),saved=JSON.parse(fs.readFileSync(path.join(__dirname,'Learning14_SPIBasics.alice-sch.json'),'utf8'));
const circuit=createCircuit(model,saved),transfers=[];
const runtime=require(path.join(root,'firmware-runtime.js')).create(model,{
 onGpio:e=>circuit.driveMcuPin(e.pin,e.value),onSpiTx:e=>{const result=circuit.handleSpiTransmission(e);transfers.push({event:e,result});return result;}
});
let state;function advance(ms){for(let i=0;i<ms;i+=5){state=runtime.step(5);assert.equal(state.error,null,JSON.stringify(state.error));}}
function matrix(){circuit.compileNetlist();return circuit.getState().components.find(c=>c.id==='matrix').deviceState;}
runtime.start();advance(100);
assert.equal(matrix().ready,true);assert.equal(matrix().visible,true);
assert.deepEqual(Array.from(matrix().rows),[1,2,4,8,16,32,64,128]);
advance(500);assert.deepEqual(Array.from(matrix().rows),[128,64,32,16,8,4,2,1]);
assert.equal(state.gpio.PB0,1,'CS must be deasserted after the frame');
const broken=JSON.parse(JSON.stringify(saved)),beforeDisconnect=transfers.length;
broken.wires=broken.wires.filter(w=>!(w.to.componentId==='matrix'&&w.to.pin==='CLK'));
assert.equal(circuit.importCircuit(broken).ok,true);advance(550);
assert.ok(transfers.slice(beforeDisconnect).every(t=>!t.result.accepted),'an unwired clock cannot update the device');
assert.ok(state.variables.error_count>0);assert.equal(state.variables.initialized,0);
assert.equal(state.gpio.PB0,1,'CS must also be released on error');
assert.equal(circuit.importCircuit(saved).ok,true);advance(1000);
assert.equal(matrix().visible,true);assert.equal(state.variables.initialized,1);assert.ok(state.variables.frame_count>=4);
console.log(JSON.stringify({example:'Learning14_SPIBasics',transfers:transfers.length,frames:state.variables.frame_count,rows:matrix().rows}));
console.log('PASS: mode-0 MAX7219 initialization, exact row registers, CS released, both diagonals and clock disconnect/reconnect.');
