'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root,buildModel,createCircuit}=require('./harness.cjs');
const model=buildModel();
const saved=JSON.parse(fs.readFileSync(path.join(__dirname,'ST7789_SPI_Display.alice-sch.json'),'utf8'));
const snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,'ST7789_SPI_Display.alice.json'),'utf8'));
assert.deepEqual(snapshot.circuit,saved);
assert.equal(snapshot.files['Core/Src/main.c'],fs.readFileSync(path.join(__dirname,'Core/Src/main.c'),'utf8').replace(/\r\n?/g,'\n'));
const circuit=createCircuit(model,saved);
let sentBytes=0,transfers=0,state;
const runtime=require(path.join(root,'firmware-runtime.js')).create(model,{
 onGpio:event=>circuit.driveMcuPin(event.pin,event.value),
 onSpiTx:event=>{sentBytes+=event.bytes.length;transfers++;return circuit.handleSpiTransmission(event);}
});
function advance(ms){for(let elapsed=0;elapsed<ms;elapsed+=5){state=runtime.step(5);assert.equal(state.error,null,JSON.stringify(state.error));}}
function screen(){circuit.compileNetlist();return circuit.getState().components.find(component=>component.id==='display').deviceState;}
function pixel(x,y){return circuit.displayPixelsForTest()[y*240+x];}
runtime.start();
for(let elapsed=0;elapsed<5000&&!(state&&state.variables.frame_count>=1);elapsed+=20)advance(20);
assert.ok(state.variables.frame_count>=1,'dashboard must finish initializing');
assert.equal(screen().visible,true);
assert.equal(screen().width,240);assert.equal(screen().height,240);
assert.equal(pixel(32,90),0xF800,'red bar must come from actual RGB565 transfers');
assert.equal(pixel(100,90),0x07E0,'green bar');
assert.equal(pixel(170,90),0x001F,'blue bar');
assert.equal(pixel(225,220),0x0841,'background');
assert.equal(pixel(30,185),0x0841,'progress begins empty');
const initialBytes=sentBytes,initialFrame=state.variables.frame_count;
advance(600);
assert.ok(state.variables.frame_count>initialFrame,'progress redraws periodically');
assert.equal(pixel(25,185),0x07FF,'progress has cyan pixels');
assert.equal(state.variables.error_count,0);
assert.equal(state.gpio.PA4,1,'CS released between operations');
assert.ok(sentBytes-initialBytes<40000,'periodic update must not retransmit the full 115200-byte frame');
const disconnected=JSON.parse(JSON.stringify(saved));
disconnected.wires=disconnected.wires.filter(wire=>!(wire.to.componentId==='display'&&wire.to.pin==='BL'));
assert.equal(circuit.importCircuit(disconnected).ok,true);
assert.equal(screen().visible,false,'an unpowered backlight hides the display');
console.log(JSON.stringify({example:'ST7789_SPI_Display',transfers,bytes:sentBytes,frames:state.variables.frame_count,errors:state.variables.error_count}));
console.log('PASS: complete project, actual RGB565 bars, periodic partial redraw, CS release and backlight wiring.');
