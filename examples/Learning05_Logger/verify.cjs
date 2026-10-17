'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {root, buildModel, createCircuit} = require('./harness.cjs');
const model = buildModel();
const circuit = createCircuit(model, JSON.parse(fs.readFileSync(path.join(__dirname, 'Learning05_Logger.alice-sch.json'), 'utf8')));
const serial = [], i2c = [], pwm = [];
const runtime = require(path.join(root, 'firmware-runtime.js')).create(model, {
  onGpioRead: event => ({value:circuit.sampleMcuPin(event.pin)}),
  onGpio: event => circuit.driveMcuPin(event.pin,event.value),
  onAdcRead: event => circuit.sampleAdc(event.instance || event.adc, event),
  onPwm: event => {pwm.push(event); circuit.driveMcuPwm(event);},
  onUartTx: event => serial.push(event.text),
  onI2cTx: event => {const result=circuit.handleI2cTransmission(event);i2c.push(result);return result;}
});
let time=0,state;
function advance(delta) {
  const end=time+delta;
  do {
    const delta=Math.min(5,end-time);time+=delta;state=runtime.step(delta);
    assert.equal(state.error,null,JSON.stringify(state.error));
  } while(time<end);
  return state;
}
function vars(){return state.variables;}
function device(id){circuit.compileNetlist();return circuit.getState().components.find(c=>c.id===id).deviceState;}
function alarm(expected){
  assert.equal(vars().alarm_active,expected);
  assert.equal(state.gpio.PB12,expected?0:1);
  assert.equal(state.gpio.PB13,expected?1:0);
  assert.equal(device('buzzer').active,Boolean(expected));
  const leds=circuit.compileNetlist().leds;
  assert.equal(leds.find(v=>v.componentId==='green').on,!expected);
  assert.equal(leds.find(v=>v.componentId==='red').on,Boolean(expected));
}
function graphY(top){
  const bytes=device('oled').framebuffer,values=[];
  for(let x=4;x<127;x++)for(let y=top;y<top+20;y++){
    if(y===top+5&&x%8===0)continue;
    if((bytes[Math.floor(y/8)*128+x]>>(y%8))&1)values.push(y);
  }
  return [...new Set(values)];
}
circuit.setButtonClosed('switch',false);
runtime.start();advance(100);
assert.equal(vars().running,0);assert.equal(vars().sample_count,0);
assert.equal(circuit.sampleMcuPin('PB12'),0);assert.equal(circuit.sampleMcuPin('PB13'),1);
assert.equal(device('buzzer').active,false);
assert.equal(device('oled').visible,true);
assert.equal(serial[0],'tick_ms,a_mV,b_mV,alarm,state\r\n');
assert.match(serial.at(-1),/,READY\r\n$/);

circuit.setButtonClosed('switch',true);advance(700);
assert.equal(vars().filter_count,32);assert.equal(vars().mv10_a,11000);assert.equal(vars().mv10_b,22000);alarm(0);
assert.match(serial.at(-1),/,1100\.0,2200\.0,0,RUN\r\n$/);
assert.ok(i2c.length>0&&i2c.every(v=>v.accepted),JSON.stringify(i2c.slice(-2)));
const before=vars().sample_count;
circuit.setAdcSourceVoltage('adc-a',3.1);circuit.setAdcSourceVoltage('adc-b',1.8);
advance(100);assert.ok(vars().mv10_a>11000&&vars().mv10_a<31000,JSON.stringify({a:vars().mv10_a,b:vars().mv10_b,sum:vars().sum_a,index:vars().filter_index,count:vars().sample_count,source:circuit.sampleAdc('hadc1')}));assert.equal(vars().alarm_active,0);
advance(600);assert.ok(vars().mv10_a>=30990&&vars().mv10_a<=31010);alarm(1);
assert.equal(state.pwm['TIM1:CH1'].frequencyHz,2000);
assert.ok(graphY(21).length>=3,'A history must contain the actual smoothed rise');
assert.ok(graphY(43).length>=2,'B history must contain an independent fall');

circuit.setAdcSourceVoltage('adc-a',2.4);advance(700);alarm(1);
assert.ok(vars().mv10_a>23000&&vars().mv10_a<25000,'2.4 V is inside the hysteresis band');
circuit.setAdcSourceVoltage('adc-a',2.2);advance(700);alarm(0);
circuit.setAdcSourceVoltage('adc-b',3.3);advance(700);alarm(1);
assert.equal(vars().mv10_b,33000,'uint64 intermediate must avoid 32-sample full-scale overflow');
assert.equal(vars().history_count,32,'history is bounded rather than growing with ticks');
assert.ok(vars().sample_count>before+100);

circuit.setButtonClosed('switch',false);advance(50);
assert.equal(vars().running,0);assert.equal(vars().alarm_active,0);
assert.equal(state.gpio.PB12,0);assert.equal(state.gpio.PB13,1);assert.equal(device('buzzer').active,false);
assert.match(serial.at(-1),/,0,READY\r\n$/);
const stoppedSamples=vars().sample_count,stoppedFrames=vars().frame_count,stoppedSerial=serial.length;
advance(500);
assert.equal(vars().sample_count,stoppedSamples);assert.equal(vars().frame_count,stoppedFrames);assert.equal(serial.length,stoppedSerial);
circuit.setAdcSourceVoltage('adc-a',0);circuit.setAdcSourceVoltage('adc-b',1.1);circuit.setButtonClosed('switch',true);advance(130);
assert.ok(vars().filter_count<=7,'restart must reset the moving average');
assert.equal(vars().mv10_a,0);assert.equal(vars().mv10_b,11000);assert.equal(vars().history_count,1);alarm(0);
const freshCircuit=createCircuit(model,JSON.parse(fs.readFileSync(path.join(__dirname,'Learning05_Logger.alice-sch.json'),'utf8')));
const freshRuntime=require(path.join(root,'firmware-runtime.js')).create(model,{
  onGpioRead:event=>({value:freshCircuit.sampleMcuPin(event.pin)}),
  onGpio:event=>freshCircuit.driveMcuPin(event.pin,event.value),
  onAdcRead:event=>freshCircuit.sampleAdc(event.instance||event.adc,event),
  onI2cTx:event=>freshCircuit.handleI2cTransmission(event)
});
freshRuntime.start();let freshState;
for(let t=0;t<150;t+=5){freshState=freshRuntime.step(5);assert.equal(freshState.error,null);}
assert.equal(freshState.variables.running,1,'the saved default-ON circuit must start at tick zero');
assert.ok(freshState.variables.sample_count>=7);assert.equal(freshState.variables.mv10_a,11000);assert.equal(freshState.variables.mv10_b,22000);
console.log(JSON.stringify({example:'Learning05_Logger',samples:vars().sample_count,frames:vars().frame_count,i2cTransfers:i2c.length,pwmEvents:pwm.length,csv:serial.slice(-3)}));
console.log('PASS: saved circuit, pointer reads, 32-point smoothing, independent OLED histories, both-channel hysteresis, LED/PWM, full scale, READY and restart.');
