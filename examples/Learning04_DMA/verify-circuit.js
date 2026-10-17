'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const window={addEventListener(){},AliceOledDevice:require(path.join(root,'oled-device.js')),AliceSpiDisplayDevice:require(path.join(root,'spi-display-device.js')),AliceLightSensorDevice:require(path.join(root,'light-sensor-device.js')),AlicePeripheralCatalog:require(path.join(root,'peripheral-catalog.js')),AlicePeripheralDevices:require(path.join(root,'peripheral-devices.js'))};
const document={readyState:'loading',addEventListener(){},body:null};
const context=vm.createContext({window,document,Blob,CustomEvent:function(type,options){this.type=type;this.detail=options&&options.detail;},console,queueMicrotask,setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(path.join(root,'schematic.js'),'utf8'),context);
const api=window.AliceSchematic;
const climate=path.basename(__dirname).includes('Climate');
const pins=climate?['PB0','PB6','PB7','PB12','PA2','PA3','PA13','PA14']:['PA0','PC13','PA2','PA3','PA13','PA14'];
api.applyProjectModel({mcu:'STM32F103C8T6',pins:Object.fromEntries(pins.map(pin=>[pin,{physicalPin:pin,iocSignal:pin==='PA0'?'ADC1_IN0':'GPIO_Output',mode:pin==='PA0'?'analog':'output',configured:true}])),adcs:climate?{}:{hadc1:{handle:'hadc1',instance:'ADC1',channels:[{channel:'ADC_CHANNEL_0',channelNumber:0,pin:'PA0',rank:1}]}},outputs:climate?{PB12:{pin:'PB12',initial:0}}:{PC13:{pin:'PC13',initial:0}}});
const file=path.join(__dirname,path.basename(__dirname)+'.alice-sch.json');
const imported=api.importCircuit(fs.readFileSync(file,'utf8'));
assert.equal(imported.ok,true,JSON.stringify(imported));assert.equal(imported.skippedWireCount,0);
if(climate){
 for(const [temperature,humidity] of [[25,50],[31,72]]){
  api.setPeripheralProperties('sensor',{temperatureC:temperature,humidityPercent:humidity});
  const sample=api.handlePeripheralOperation({peripheralType:'dht11',action:'read',dataPin:'PB0'});
  assert.equal(sample.accepted,true,JSON.stringify(sample));assert.equal(sample.result.temperatureX10,temperature*10);assert.equal(sample.result.humidityX10,humidity*10);
  const display=api.handlePeripheralOperation({peripheralType:'tm1637',action:'display-number',clkPin:'PB6',dioPin:'PB7',value:temperature,leadingZero:false,colon:false});
  assert.equal(display.accepted,true,JSON.stringify(display));
  api.driveMcuPin('PB12',temperature>=30?1:0);assert.equal(api.compileNetlist().leds.find(l=>l.componentId==='alarm-led').on,temperature>=30);
  console.log(JSON.stringify({temperature,humidity,sample:sample.result,display:display.result,alarm:temperature>=30}));
 }
}else{
 const adc=api.sampleAdc('hadc1');assert.equal(adc.connected,true);assert.equal(adc.raw,1365);assert.equal(adc.voltage,1.1);
 api.driveMcuPin('PC13',1);assert.equal(api.compileNetlist().leds.find(l=>l.componentId==='led').on,true);
 api.driveMcuPin('PC13',0);assert.equal(api.compileNetlist().leds.find(l=>l.componentId==='led').on,false);
 console.log(JSON.stringify({adc,led:'both states verified'}));
}
console.log('Actual saved circuit imports without skipped wires; device wiring verified.');
