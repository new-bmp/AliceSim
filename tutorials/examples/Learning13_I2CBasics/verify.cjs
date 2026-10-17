'use strict';
// Catches wrong HAL address/control bytes, missing initialization and ignored bus failures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.ok(fs.existsSync(path.join(__dirname,'Core/Src/main.c')),'I2C teaching firmware is missing');
const {root,buildModel,createCircuit}=require('./harness.cjs');
const model=buildModel(),saved=JSON.parse(fs.readFileSync(path.join(__dirname,'Learning13_I2CBasics.alice-sch.json'),'utf8'));
const circuit=createCircuit(model,saved),transfers=[];
const runtime=require(path.join(root,'firmware-runtime.js')).create(model,{onI2cTx:e=>{const result=circuit.handleI2cTransmission(e);transfers.push({event:e,result});return result;}});
let state;function advance(ms){for(let i=0;i<ms;i+=5){state=runtime.step(5);assert.equal(state.error,null,JSON.stringify(state.error));}}
function oled(){circuit.compileNetlist();return circuit.getState().components.find(c=>c.id==='oled').deviceState;}
runtime.start();advance(100);
assert.equal(state.variables.initialized,1);assert.equal(oled().visible,true);
assert.deepEqual(Array.from(oled().framebuffer).slice(0,8),[1,2,4,8,16,32,64,128]);
assert.ok(Array.from(oled().framebuffer).slice(8).every(v=>v===0));
assert.ok(transfers.every(t=>t.result.accepted),JSON.stringify(transfers.slice(-1)));
advance(500);assert.deepEqual(Array.from(oled().framebuffer).slice(0,8),[128,64,32,16,8,4,2,1]);
const broken=JSON.parse(JSON.stringify(saved));broken.wires=broken.wires.filter(w=>!(w.to.componentId==='oled'&&w.to.pin==='SDA'));
assert.equal(circuit.importCircuit(broken).ok,true);advance(550);
assert.ok(state.variables.error_count>0);assert.equal(state.variables.initialized,0);
assert.equal(transfers.at(-1).result.accepted,false);
assert.equal(circuit.importCircuit(saved).ok,true);advance(1100);assert.equal(state.variables.initialized,1);assert.equal(oled().visible,true);
console.log(JSON.stringify({example:'Learning13_I2CBasics',transfers:transfers.length,frames:state.variables.frame_count,errors:state.variables.error_count}));
console.log('PASS: raw SSD1306 command/data writes, two exact pixel patterns, real disconnected SDA error and recovery.');
