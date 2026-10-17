'use strict';
// Catches broken framing, truncated-command execution, missing ISR rearm and lost bursts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.ok(fs.existsSync(path.join(__dirname,'Core/Src/main.c')),'UART receive teaching firmware is missing');
const {root,buildModel,createCircuit}=require('./harness.cjs');
const model=buildModel(),saved=JSON.parse(fs.readFileSync(path.join(__dirname,'Learning12_UARTCommand.alice-sch.json'),'utf8'));
const circuit=createCircuit(model,saved),serial=[];
const runtime=require(path.join(root,'firmware-runtime.js')).create(model,{
 onGpio:e=>circuit.driveMcuPin(e.pin,e.value),onUartTx:e=>serial.push(e.text)
});
let state;
function advance(ms=10){for(let i=0;i<ms;i++){state=runtime.step(1);assert.equal(state.error,null,JSON.stringify(state.error));}return state;}
function send(bytes){runtime.enqueueUart('USART2',bytes);advance();}
function led(on){assert.equal(state.variables.led_on,on?1:0);assert.equal(circuit.compileNetlist().leds.find(l=>l.componentId==='led').on,on);}
runtime.start();advance();led(false);
assert.match(serial.join(''),/READY/);
send('LED ');led(false);send('ON');led(false);send('\n');led(true);assert.equal(serial.at(-1),'OK LED=ON\r\n');
send('STATUS\r\nLED OFF\nSTATUS\n');led(false);assert.deepEqual(serial.slice(-3),['LED=ON\r\n','OK LED=OFF\r\n','LED=OFF\r\n']);
send('led on\n');led(false);assert.equal(serial.at(-1),'ERR UNKNOWN\r\n');
send('LED ON'+ 'X'.repeat(70)+'\nSTATUS\n');led(false);assert.deepEqual(serial.slice(-2),['ERR TOO_LONG\r\n','LED=OFF\r\n']);
send('X'.repeat(31)+'\n');assert.equal(serial.at(-1),'ERR UNKNOWN\r\n');
send('X'.repeat(32)+'\n');assert.equal(serial.at(-1),'ERR TOO_LONG\r\n');led(false);
send([76,69,68,32,79,78,0,88,10]);led(false);assert.equal(serial.at(-1),'ERR UNKNOWN\r\n');
const empty=serial.length;send('\r\n\n');assert.equal(serial.length,empty);
send('LED ON\nLED OFF\nLED ON\nSTATUS\n');led(true);assert.equal(serial.at(-1),'LED=ON\r\n');
send('X'.repeat(400)+'\n');assert.equal(serial.at(-1),'ERR RX_OVERFLOW\r\n');led(true);
send('LED OFF'+'X'.repeat(160));assert.equal(serial.at(-1),'ERR RX_OVERFLOW\r\n');led(true);
send('\nSTATUS\n');led(true);assert.equal(serial.at(-1),'LED=ON\r\n');
send('LED OFF\n');led(false);assert.equal(serial.at(-1),'OK LED=OFF\r\n');
send('STATUS');assert.equal(serial.at(-1),'OK LED=OFF\r\n');send('\n');assert.equal(serial.at(-1),'LED=OFF\r\n');
assert.ok(state.variables.command_count>=10);
assert.equal(model.uarts.huart2.baudRate,115200);
console.log(JSON.stringify({example:'Learning12_UARTCommand',commands:state.variables.command_count,errors:state.variables.error_count,tail:serial.slice(-4)}));
console.log('PASS: actual UART RX callbacks, fragments, CRLF, burst commands, unknown/NUL/oversized lines, overflow recovery and circuit LED.');
