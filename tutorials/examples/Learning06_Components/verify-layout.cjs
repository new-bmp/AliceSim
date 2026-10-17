"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{execFileSync}=require("node:child_process");
const {loadCircuit,root}=require("./circuit-tools.cjs");
const model=JSON.parse(execFileSync(require("./_tutorial-environment.cjs").python,[path.join(__dirname,"verify.py"),"--model"],{encoding:"utf8"}));
const api=loadCircuit(model),defs=api.getDefinitionsForTest();
const circuit=JSON.parse(fs.readFileSync(path.join(__dirname,"Learning06_Components.alice-sch.json"),"utf8"));
const byId=Object.fromEntries(circuit.components.map(c=>[c.id,c]));
const messages=[];
function pin(e){const c=byId[e.componentId],p=defs[c.type].pins.find(p=>p.name===e.pin);assert.ok(p,e.componentId+":"+e.pin);return{x:c.x+p.x,y:c.y+p.y};}
for(const w of circuit.wires){
  assert.deepEqual(w.route[0],pin(w.from),w.id+" starts at actual terminal");
  assert.deepEqual(w.route.at(-1),pin(w.to),w.id+" ends at actual terminal");
  for(let i=1;i<w.route.length;i++){
    const a=w.route[i-1],b=w.route[i];assert.ok(a.x===b.x||a.y===b.y,w.id+" must be orthogonal");
    for(const c of circuit.components){
      const d=defs[c.type];
      const x1=c.x+2,x2=c.x+d.width-2,y1=c.y+2,y2=c.y+d.height-2;
      const cross=a.y===b.y?a.y>y1&&a.y<y2&&Math.max(a.x,b.x)>x1&&Math.min(a.x,b.x)<x2:
        a.x>x1&&a.x<x2&&Math.max(a.y,b.y)>y1&&Math.min(a.y,b.y)<y2;
      if(cross)messages.push(w.id+" passes through "+c.id);
    }
  }
}
assert.deepEqual([...new Set(messages)],[]);
console.log("PASS Learning06 layout: all 24 wires are orthogonal, terminate at actual IOC/module pins, and avoid all component bodies.");
