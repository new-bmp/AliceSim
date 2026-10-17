"use strict";
// Regenerate the arranged schematic from the actual IOC pin geometry.
const fs=require("node:fs"),path=require("node:path"),{execFileSync}=require("node:child_process");
const {loadCircuit,root}=require("./circuit-tools.cjs");
const model=JSON.parse(execFileSync(require("./_tutorial-environment.cjs").python,[path.join(__dirname,"verify.py"),"--model"],{encoding:"utf8"}));
const api=loadCircuit(model), defs=api.getDefinitionsForTest();
const components=[];
function add(id,type,x,y,value,extra={}){components.push({id,type,ref:id.toUpperCase(),value,x,y,rotation:0,...extra});}
add("mcu","mcu",460,240,"STM32F103C8T6");
add("range","hcsr04",100,160,"150.0 cm",{peripheralProperties:{distanceCm:150}});
add("matrix","max7219",810,150,"8x8 MATRIX",{peripheralProperties:{intensity:8}});
add("buzzer","buzzer",100,450,"PWM ALARM",{peripheralProperties:{frequencyHz:2000,dutyPermille:500}});
add("relay","relay",780,430,"5V ACTIVE LOW",{peripheralProperties:{activeLow:1}});
add("red-r","resistor",970,420,"330 Ohm");
add("red","led",1100,420,"STOP",{ledColor:"red"});
add("green-r","resistor",970,560,"330 Ohm");
add("green","led",1100,560,"SAFE",{ledColor:"green"});
add("cpu-3v3","vcc",510,100,"+3V3");
add("cpu-gnd","ground",510,500,"0V");
add("range-5v","vcc",10,70,"+5V");
add("range-gnd","ground",10,290,"0V");
add("buzz-3v3","vcc",10,360,"+3V3");
add("buzz-gnd","ground",10,580,"0V");
add("matrix-5v","vcc",710,50,"+5V");
add("matrix-gnd","ground",710,280,"0V");
add("relay-5v","vcc",680,340,"+5V");
add("relay-gnd","ground",680,570,"0V");
add("load-3v3","vcc",960,300,"+3V3");
add("load-gnd","ground",1100,660,"0V");
const byId=Object.fromEntries(components.map(c=>[c.id,c]));
function point(id,pin){const c=byId[id],p=defs[c.type].pins.find(p=>p.name===pin);if(!p)throw Error(id+":"+pin);return {x:c.x+p.x,y:c.y+p.y};}
const wires=[];
function wire(a,ap,b,bp,via=[]){wires.push({id:"w"+(wires.length+1),from:{componentId:a,pin:ap},to:{componentId:b,pin:bp},signal:ap,route:[point(a,ap),...via.map(([x,y])=>({x,y})),point(b,bp)]});}
function power(v,g,c){let p=point(v,"VCC"),q=point(c,"VCC");wire(v,"VCC",c,"VCC",[[p.x,q.y]]);p=point(g,"GND");q=point(c,"GND");wire(c,"GND",g,"GND",[[p.x,q.y]]);}
power("range-5v","range-gnd","range");power("buzz-3v3","buzz-gnd","buzzer");
power("matrix-5v","matrix-gnd","matrix");power("relay-5v","relay-gnd","relay");
wire("cpu-3v3","VCC","mcu","VDD",[[542,200],[545,200]]);
wire("mcu","VSS","cpu-gnd","GND",[[545,480],[542,480]]);
// Signal routing lives outside module bodies. Route by the actual configured pins.
wire("mcu","PB1","range","TRIG",[[680,383],[680,90],[260,90],[260,176]]);
wire("mcu","PB10","range","ECHO",[[280,420],[280,232]]);
wire("mcu","PA0","buzzer","SIG",[[660,270],[660,620],[260,620],[260,494]]);
wire("mcu","PA5","matrix","CLK",[[420,320],[420,20],[970,20],[970,194]]);
wire("mcu","PA7","matrix","DIN",[[650,345],[650,120],[990,120],[990,166]]);
wire("mcu","PB0","matrix","CS",[[400,370],[400,40],[1010,40],[1010,222]]);
wire("mcu","PB12","relay","IN",[[940,420],[940,446]]);
let p=point("load-3v3","VCC"),q=point("relay","COM");wire("load-3v3","VCC","relay","COM",[[p.x,390],[920,390],[920,q.y]]);
p=point("relay","NO");q=point("red-r","1");wire("relay","NO","red-r","1",[[930,p.y],[930,q.y]]);
p=point("relay","NC");q=point("green-r","1");wire("relay","NC","green-r","1",[[950,p.y],[950,q.y]]);
for(const color of ["red","green"]){p=point(color+"-r","2");q=point(color,"A");wire(color+"-r","2",color,"A",[[1080,p.y],[1080,q.y]]);p=point(color,"K");wire(color,"K","load-gnd","GND",[[1180,p.y],[1180,640],[1132,640]]);}
// Ground symbols identify the common 0 V reference; voltage rails stay distinct.
const circuit={schemaVersion:1,kind:"AliceSIMCircuit",mcu:"STM32F103C8T6",components,wires,view:{zoom:.85,panX:0,panY:0,userView:false}};
const result=api.importCircuit(circuit);if(!result.ok||result.skippedWireCount)throw Error(JSON.stringify(result));
fs.writeFileSync(path.join(__dirname,"Learning06_Components.alice-sch.json"),JSON.stringify(circuit,null,2)+"\n");
console.log(JSON.stringify({components:components.length,wires:wires.length,pins:defs.mcu.pins}));
