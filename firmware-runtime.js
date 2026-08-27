(function (root, factory) {
  "use strict";

  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AliceFirmwareRuntime = factory();
  }
}(typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this), function () {
  "use strict";

  var hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);
  var DEFAULT_OPERATION_BUDGET = 10000;
  var MAX_DELAY_VALUE = 0xffffffff;
  var MAX_PERIPHERAL_HISTORY = 64;
  var MAX_DMA_EVENTS_PER_STEP = 256;
  var MAX_DMA_TRANSFER_RECORDS = 32;
  var MAX_INTERRUPT_EVENT_RECORDS = 32;

  var BUILTIN_CONSTANTS = {
    HAL_OK: 0,
    HAL_ERROR: 1,
    HAL_BUSY: 2,
    HAL_TIMEOUT: 3,
    HAL_MAX_DELAY: MAX_DELAY_VALUE,
    NULL: 0,
    GPIO_PIN_RESET: 0,
    GPIO_PIN_SET: 1,
    ALICESIM_SSD1306_COLOR_BLACK: 0,
    ALICESIM_SSD1306_COLOR_WHITE: 1,
    ALICESIM_SSD1306_COLOR_XOR: 2,
    false: false,
    true: true
  };

  for (var pinIndex = 0; pinIndex <= 15; pinIndex += 1) {
    BUILTIN_CONSTANTS["GPIO_PIN_" + pinIndex] = Math.pow(2, pinIndex);
  }
  ["A", "B", "C", "D", "E", "F", "G"].forEach(function (port) {
    BUILTIN_CONSTANTS["GPIO" + port] = "GPIO" + port;
  });

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === "object") {
      var clone = {};
      Object.keys(value).forEach(function (key) { clone[key] = cloneValue(value[key]); });
      return clone;
    }
    return value;
  }

  function appendBoundedHistory(history, value) {
    history.push(cloneValue(value));
    if (history.length > MAX_PERIPHERAL_HISTORY) {
      history.splice(0, history.length - MAX_PERIPHERAL_HISTORY);
    }
  }

  function normalizedKind(value) {
    return String(value || "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  }

  function canonicalOperationKind(operation) {
    var kind = normalizedKind(operation && (operation.op || operation.type || operation.kind || operation.operation));
    var aliases = {
      whileloop: "while",
      forloop: "for",
      switchstatement: "switch",
      returnstatement: "return",
      breakstatement: "break",
      continuestatement: "continue",
      haluartreceive: "uartreceive",
      uartreceiveblocking: "uartreceive",
      haluarttransmit: "uarttransmit",
      haluartreceivedma: "uartreceivedma",
      haluarttransmitdma: "uarttransmitdma",
      haluartreceiveit: "uartreceiveit",
      haluarttransmitit: "uarttransmitit",
      haluartabortit: "uartabortit",
      haluartdmastop: "uartdmastop",
      hali2cmastertransmit: "i2ctransmit",
      i2cmastertransmit: "i2ctransmit",
      hali2cmemwrite: "i2cmemwrite",
      halspitransmit: "spitransmit",
      haladcstart: "adcstart",
      haladcstartdma: "adcstartdma",
      haladcstopdma: "adcstopdma",
      haladcstartit: "adcstartit",
      haladcstopit: "adcstopit",
      haladcpollforconversion: "adcpoll",
      adcpollforconversion: "adcpoll",
      haladcgetvalue: "adcgetvalue",
      haltimpwmstart: "pwmstart",
      haltimpwmstartit: "pwmstart",
      haltimpwmstop: "pwmstop",
      haltimpwmstopit: "pwmstop",
      haltimbasestartit: "timerstartit",
      haltimbasestopit: "timerstopit",
      haltimsetcompare: "pwmsetcompare",
      set: "assign",
      assignment: "assign",
      conditional: "if",
      halgpiowritepin: "gpiowrite",
      gpiowritepin: "gpiowrite",
      halgpioreadpin: "gpioread",
      gpioreadpin: "gpioread",
      halgpiotogglepin: "gpiotoggle",
      gpiotogglepin: "gpiotoggle",
      haldelay: "delay",
      rtosdelay: "rtosdelay",
      rtosyield: "rtosyield",
      rtoswait: "rtoswait"
    };
    return aliases[kind] || kind;
  }

  function canonicalExpressionKind(expression) {
    var kind = normalizedKind(expression && (expression.type || expression.kind || expression.op || expression.expression));
    var aliases = {
      const: "constant",
      var: "variable",
      character: "char",
      index: "arrayindex",
      subscript: "arrayindex",
      arraysubscript: "arrayindex",
      field: "member",
      memberaccess: "member",
      equals: "eq",
      equal: "eq",
      equality: "eq"
    };
    return aliases[kind] || kind;
  }

  function operationList(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    if (Array.isArray(value.operations)) return value.operations;
    if (Array.isArray(value.body)) return value.body;
    return [value];
  }

  function firstDefined(object, keys, fallback) {
    for (var index = 0; index < keys.length; index += 1) {
      if (object && hasOwn(object, keys[index]) && object[keys[index]] !== undefined) return object[keys[index]];
    }
    return fallback;
  }

  function compileOperationTree(operations) {
    var instructions = [];

    function patchJumps(jumps, target) {
      jumps.forEach(function (index) { instructions[index].target = target; });
    }

    function nearestContext(contextStack, predicate) {
      for (var index = contextStack.length - 1; index >= 0; index -= 1) {
        if (predicate(contextStack[index])) return contextStack[index];
      }
      return null;
    }

    function compileBlock(block, contextStack) {
      operationList(block).forEach(function (operation) {
        if (!operation) return;
        if (typeof operation !== "object") throw new TypeError("Firmware operation must be an object");

        var kind = canonicalOperationKind(operation);
        if (kind === "while") {
          var whileCheck = instructions.length;
          instructions.push({ kind: "branch", condition: firstDefined(operation, ["condition", "test"], { type: "literal", value: true }), falseTarget: -1 });
          var whileContext = { loop: true, breakJumps: [], continueJumps: [], continueTarget: whileCheck };
          compileBlock(firstDefined(operation, ["operations", "body", "do"], []), contextStack.concat([whileContext]));
          instructions.push({ kind: "jump", target: whileCheck });
          var whileEnd = instructions.length;
          instructions[whileCheck].falseTarget = whileEnd;
          patchJumps(whileContext.breakJumps, whileEnd);
          patchJumps(whileContext.continueJumps, whileCheck);
          return;
        }

        if (kind === "for") {
          compileBlock(firstDefined(operation, ["init", "initialization"], []), contextStack);
          var forCheck = instructions.length;
          instructions.push({ kind: "branch", condition: firstDefined(operation, ["condition", "test"], { type: "literal", value: true }), falseTarget: -1 });
          var forContext = { loop: true, breakJumps: [], continueJumps: [], continueTarget: null };
          compileBlock(firstDefined(operation, ["operations", "body", "do"], []), contextStack.concat([forContext]));
          var incrementStart = instructions.length;
          forContext.continueTarget = incrementStart;
          patchJumps(forContext.continueJumps, incrementStart);
          compileBlock(firstDefined(operation, ["increment", "update", "step"], []), contextStack);
          instructions.push({ kind: "jump", target: forCheck });
          var forEnd = instructions.length;
          instructions[forCheck].falseTarget = forEnd;
          patchJumps(forContext.breakJumps, forEnd);
          return;
        }

        if (kind === "if") {
          var ifCheck = instructions.length;
          instructions.push({ kind: "branch", condition: firstDefined(operation, ["condition", "test"], false), falseTarget: -1 });
          compileBlock(firstDefined(operation, ["then", "consequent", "thenOperations", "operations", "body"], []), contextStack);
          var alternate = firstDefined(operation, ["else", "alternate", "elseOperations"], []);
          if (operationList(alternate).length) {
            var jumpPastElse = instructions.length;
            instructions.push({ kind: "jump", target: -1 });
            instructions[ifCheck].falseTarget = instructions.length;
            compileBlock(alternate, contextStack);
            instructions[jumpPastElse].target = instructions.length;
          } else {
            instructions[ifCheck].falseTarget = instructions.length;
          }
          return;
        }

        if (kind === "switch") {
          var switchExpression = firstDefined(operation, ["expression", "value", "test"], { type: "literal", value: 0 });
          var cases = Array.isArray(operation.cases) ? operation.cases : [];
          if (!cases.length && operation.cases && typeof operation.cases === "object") {
            cases = Object.keys(operation.cases).map(function (key) {
              return { value: { type: "literal", value: Number(key) }, body: operation.cases[key] };
            });
          }
          var entries = Array.isArray(operation.entries) ? operation.entries : cases.slice();
          if (!Array.isArray(operation.entries) && operation.default != null) entries.push({ default: true, value: null, body: operation.default });
          var switchChecks = [];
          var dispatchEntries = entries.filter(function (entry) { return entry && entry.value != null && !entry.default; });
          dispatchEntries.forEach(function (caseEntry) {
            var check = instructions.length;
            instructions.push({
              kind: "branch",
              condition: { op: "eq", left: switchExpression, right: firstDefined(caseEntry, ["value", "match", "condition"], { type: "literal", value: 0 }) },
              falseTarget: -1,
              trueTarget: -1
            });
            switchChecks.push({ instruction: check, entry: caseEntry });
          });
          var defaultJump = instructions.length;
          instructions.push({ kind: "jump", target: -1 });
          var switchContext = { loop: false, breakJumps: [], continueJumps: [] };
          var entryTargets = [];
          var defaultTarget = null;
          entries.forEach(function (caseEntry) {
            if (!caseEntry) return;
            var target = instructions.length;
            entryTargets.push({ entry: caseEntry, target: target });
            if (caseEntry.default || caseEntry.value == null) defaultTarget = target;
            compileBlock(firstDefined(caseEntry, ["body", "operations"], []), contextStack.concat([switchContext]));
          });
          if (defaultTarget == null) defaultTarget = instructions.length;
          var switchEnd = instructions.length;
          switchChecks.forEach(function (record, index) {
            var targetRecord = entryTargets.find(function (entryRecord) { return entryRecord.entry === dispatchEntries[index]; });
            instructions[record.instruction].trueTarget = targetRecord ? targetRecord.target : switchEnd;
            instructions[record.instruction].falseTarget = index + 1 < switchChecks.length ? switchChecks[index + 1].instruction : defaultJump;
          });
          instructions[defaultJump].target = defaultTarget;
          patchJumps(switchContext.breakJumps, switchEnd);
          return;
        }

        if (kind === "break" || kind === "continue") {
          var context = nearestContext(contextStack, kind === "break" ? function (entry) { return true; } : function (entry) { return entry.loop; });
          if (!context) throw new TypeError("'" + kind + "' is not inside a loop or switch");
          var jumpIndex = instructions.length;
          instructions.push({ kind: "jump", target: -1 });
          if (kind === "break") context.breakJumps.push(jumpIndex);
          else context.continueJumps.push(jumpIndex);
          return;
        }

        if (kind === "return") {
          instructions.push({ kind: "return", operation: operation });
          return;
        }

        if ([
          "uartreceive", "uarttransmit", "uartreceiveit", "uarttransmitit", "uartabortit", "uartreceivedma", "uarttransmitdma", "uartdmastop",
          "i2ctransmit", "i2cmemwrite", "spitransmit", "adcstart", "adcstartit", "adcstopit", "adcstartdma", "adcstopdma", "adcpoll", "adcgetvalue",
          "timerstartit", "timerstopit", "pwmstart", "pwmstop", "pwmsetcompare",
          "assign", "formatstring", "stdiowrite", "stdioscan", "libcmemory", "heapallocate", "heapfree", "libcseed", "processexit",
          "gpiowrite", "gpioread", "gpiotoggle", "delay", "fault", "rtosdelay", "rtosyield", "rtoswait",
          "aliceoledinit", "aliceoledupdate", "aliceoledcommand", "aliceoleddata", "aliceoledsetdisplay",
          "aliceoledsetinvert", "aliceoledsetcontrast", "aliceoledfill", "aliceoledclear", "aliceoleddrawpixel",
          "aliceoledgetpixel", "aliceoleddrawhorizontalline", "aliceoleddrawverticalline", "aliceoleddrawrectangle",
          "aliceoleddrawbitmap", "aliceoleddrawchar", "aliceoleddrawstring",
          "alicelightinit", "alicelightsetcalibration", "alicelightreadraw", "alicelightreadmillivolts",
          "alicelightreadlux", "alicelightreaddigital", "alicelightread", "alicelightrawtomillivolts",
          "alicelightrawtolux", "alicelightrawtopercent",
          "alicedht11init", "alicedht11read", "alicehcsr04init", "alicehcsr04measure",
          "alicesg90init", "alicesg90start", "alicesg90stop", "alicesg90setangle", "alicesg90setanglex10", "alicesg90setpulse",
          "alicebuzzerinit", "alicebuzzerset", "alicebuzzertone", "alicebuzzerstop",
          "alicetm1637init", "alicetm1637setbrightness", "alicetm1637displaynumber", "alicetm1637clear"
        ].indexOf(kind) < 0) {
          var unsupportedSource = operation.source && typeof operation.source === "object" ? operation.source : {};
          var unsupportedLocation = unsupportedSource.file
            ? " at " + unsupportedSource.file + ":" + (unsupportedSource.line || 1) + ":" + (unsupportedSource.column || 1)
            : "";
          var unsupportedStatement = operation.statement ? ": " + operation.statement : "";
          throw new TypeError("Unsupported firmware operation: " + (operation.op || operation.type || operation.kind || "<missing>") + unsupportedLocation + unsupportedStatement);
        }
        instructions.push({ kind: kind, operation: operation });
      });
    }

    compileBlock(operations, []);
    return instructions;
  }

  function namedValues(source) {
    var result = {};
    if (!source) return result;
    if (Array.isArray(source)) {
      source.forEach(function (entry) {
        if (!entry || !entry.name) return;
        result[entry.name] = firstDefined(entry, ["initial", "value", "target", "instance", "pin"], null);
      });
      return result;
    }
    if (typeof source === "object") Object.keys(source).forEach(function (key) { result[key] = source[key]; });
    return result;
  }

  function initialVariableValue(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return cloneValue(value);
    if (hasOwn(value, "initial")) return cloneValue(value.initial);
    var descriptorKind = normalizedKind(value.dataType || value.valueType || value.cType || "");
    if (hasOwn(value, "value") && descriptorKind) return cloneValue(value.value);
    return cloneValue(value);
  }

  function byteArray(value) {
    if (value == null) return [];
    if (typeof value === "string") {
      if (typeof TextEncoder === "function") return Array.prototype.slice.call(new TextEncoder().encode(value));
      return Array.from(value).map(function (character) { return character.charCodeAt(0) & 0xff; });
    }
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) value = new Uint8Array(value);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(value)) value = Array.prototype.slice.call(value);
    if (!Array.isArray(value)) value = [value];
    return value.map(function (item) {
      if (typeof item === "string") return item.length ? item.codePointAt(0) & 0xff : 0;
      var number = Number(item);
      return Number.isFinite(number) ? ((Math.trunc(number) % 256) + 256) % 256 : 0;
    });
  }

  function bytesToText(bytes) {
    var normalized = byteArray(bytes);
    if (typeof TextDecoder === "function") {
      try { return new TextDecoder().decode(new Uint8Array(normalized)); } catch (_) { /* Fall through to byte characters. */ }
    }
    return normalized.map(function (byte) { return String.fromCharCode(byte); }).join("");
  }

  var ALICE_OLED_WIDTH = 128;
  var ALICE_OLED_HEIGHT = 64;
  var ALICE_OLED_BUFFER_SIZE = 1024;
  var ALICE_OLED_DIGITS = [
    [0x3e, 0x51, 0x49, 0x45, 0x3e], [0x00, 0x42, 0x7f, 0x40, 0x00],
    [0x42, 0x61, 0x51, 0x49, 0x46], [0x21, 0x41, 0x45, 0x4b, 0x31],
    [0x18, 0x14, 0x12, 0x7f, 0x10], [0x27, 0x45, 0x45, 0x45, 0x39],
    [0x3c, 0x4a, 0x49, 0x49, 0x30], [0x01, 0x71, 0x09, 0x05, 0x03],
    [0x36, 0x49, 0x49, 0x49, 0x36], [0x06, 0x49, 0x49, 0x29, 0x1e]
  ];
  var ALICE_OLED_LETTERS = [
    [0x7e, 0x11, 0x11, 0x11, 0x7e], [0x7f, 0x49, 0x49, 0x49, 0x36],
    [0x3e, 0x41, 0x41, 0x41, 0x22], [0x7f, 0x41, 0x41, 0x22, 0x1c],
    [0x7f, 0x49, 0x49, 0x49, 0x41], [0x7f, 0x09, 0x09, 0x09, 0x01],
    [0x3e, 0x41, 0x49, 0x49, 0x7a], [0x7f, 0x08, 0x08, 0x08, 0x7f],
    [0x00, 0x41, 0x7f, 0x41, 0x00], [0x20, 0x40, 0x41, 0x3f, 0x01],
    [0x7f, 0x08, 0x14, 0x22, 0x41], [0x7f, 0x40, 0x40, 0x40, 0x40],
    [0x7f, 0x02, 0x0c, 0x02, 0x7f], [0x7f, 0x04, 0x08, 0x10, 0x7f],
    [0x3e, 0x41, 0x41, 0x41, 0x3e], [0x7f, 0x09, 0x09, 0x09, 0x06],
    [0x3e, 0x41, 0x51, 0x21, 0x5e], [0x7f, 0x09, 0x19, 0x29, 0x46],
    [0x46, 0x49, 0x49, 0x49, 0x31], [0x01, 0x01, 0x7f, 0x01, 0x01],
    [0x3f, 0x40, 0x40, 0x40, 0x3f], [0x1f, 0x20, 0x40, 0x20, 0x1f],
    [0x3f, 0x40, 0x38, 0x40, 0x3f], [0x63, 0x14, 0x08, 0x14, 0x63],
    [0x07, 0x08, 0x70, 0x08, 0x07], [0x61, 0x51, 0x49, 0x45, 0x43]
  ];

  function aliceOledGlyph(character) {
    var text = String(character == null ? "?" : character);
    var code = (text[0] || "?").toUpperCase().charCodeAt(0);
    if (code >= 48 && code <= 57) return ALICE_OLED_DIGITS[code - 48];
    if (code >= 65 && code <= 90) return ALICE_OLED_LETTERS[code - 65];
    if (code === 32) return [0, 0, 0, 0, 0];
    if (code === 45) return [8, 8, 8, 8, 8];
    if (code === 46) return [0, 0x60, 0x60, 0, 0];
    if (code === 58) return [0, 0x36, 0x36, 0, 0];
    if (code === 47) return [0x20, 0x10, 8, 4, 2];
    return [2, 1, 0x51, 9, 6];
  }

  function cEqual(left, right) {
    if (typeof left === "string" && left.length === 1 && typeof right === "number") left = left.charCodeAt(0);
    if (typeof right === "string" && right.length === 1 && typeof left === "number") right = right.charCodeAt(0);
    if (typeof left === "boolean" && typeof right === "number") left = left ? 1 : 0;
    if (typeof right === "boolean" && typeof left === "number") right = right ? 1 : 0;
    if (left && right && typeof left === "object" && typeof right === "object" && left.__alicePointer && right.__alicePointer) {
      return left.__alicePointer === right.__alicePointer
        && String(left.id || left.name || "") === String(right.id || right.name || "")
        && Number(left.offset || 0) === Number(right.offset || 0);
    }
    return left === right;
  }

  function createRtosRuntime(model, hooks, freertos) {
    var tickRateHz = Math.max(1, Number(freertos.tickRateHz) || 1000);
    var descriptors = (Array.isArray(freertos.tasks) ? freertos.tasks : []).map(function (descriptor, index) {
      return { descriptor: descriptor || {}, sourceIndex: index };
    });
    descriptors.sort(function (left, right) {
      return Number(right.descriptor.priority || 0) - Number(left.descriptor.priority || 0) || left.sourceIndex - right.sourceIndex;
    });
    var initialVariables = {};
    Object.assign(initialVariables, namedValues(model.program && model.program.variables));
    Object.assign(initialVariables, namedValues(model.variables));
    if (model.initialState && model.initialState.variables) Object.assign(initialVariables, namedValues(model.initialState.variables));
    Object.keys(initialVariables).forEach(function (name) { initialVariables[name] = initialVariableValue(initialVariables[name]); });
    var shared = {
      status: "idle", running: false, time: 0, variables: initialVariables, gpio: {}, uartRx: new Map(), uartTx: [], i2cTx: [], spiTx: [],
      uartTxCount: 0, i2cTxCount: 0, spiTxCount: 0, adc: {}, dma: { transfers: [], history: [], sequence: 0 },
      interrupts: { events: [], history: [], sequence: 0, gpioLevels: {} }, pwm: {}, peripherals: {},
      heap: { totalBytes: Math.max(0, Number(freertos.heapBytes) || 16 * 1024), usedBytes: 0, peakBytes: 0, nextId: 0, allocations: {} },
      stdio: [], randomState: 1,
      operationsExecuted: 0, currentTaskId: null, error: null, lastSelectedIndex: -1
    };
    var sharedStore = {
      variables: shared.variables, gpio: shared.gpio, uartRx: shared.uartRx, adc: shared.adc, dma: shared.dma,
      interrupts: shared.interrupts, pwm: shared.pwm, peripherals: shared.peripherals,
      heap: shared.heap, stdio: shared.stdio, randomState: shared.randomState
    };

    function forward(name, payload) {
      return typeof hooks[name] === "function" ? hooks[name](payload) : undefined;
    }

    var tasks = descriptors.map(function (item, index) {
      var descriptor = item.descriptor;
      var childHooks = Object.assign({}, hooks, {
        onState: null,
        onGpio: function (event) { shared.gpio[event.pin] = event.value; forward("onGpio", event); },
        onUartTx: function (event) { shared.uartTxCount += 1; appendBoundedHistory(shared.uartTx, event); return forward("onUartTx", event); },
        onI2cTx: function (event) { shared.i2cTxCount += 1; appendBoundedHistory(shared.i2cTx, event); return forward("onI2cTx", event); },
        onSpiTx: function (event) { shared.spiTxCount += 1; appendBoundedHistory(shared.spiTx, event); return forward("onSpiTx", event); },
        onStdio: function (event) { return forward("onStdio", event); },
        onPwm: function (event) {
          if (event && event.key) shared.pwm[event.key] = cloneValue(event);
          return forward("onPwm", event);
        },
        onAdcValue: function (event) {
          if (event && event.instance) shared.adc[event.instance] = cloneValue(event.sample || event);
          return forward("onAdcValue", event);
        },
        onPeripheral: function (event) {
          var response = forward("onPeripheral", event);
          var key = String(event && event.peripheralType || "peripheral") + ":" + String(event && event.action || "operation");
          shared.peripherals[key] = { event: cloneValue(event), result: cloneValue(response) };
          return response;
        }
      });
      var childModel = Object.assign({}, model, {
        middlewares: null,
        rtosTickRateHz: tickRateHz,
        program: Object.assign({}, model.program || {}, { entry: descriptor.entry || descriptor.name, operations: descriptor.operations || [] })
      });
      return { descriptor: descriptor, engine: create(childModel, childHooks, { sharedStore: sharedStore }), index: index, state: null, lastOperations: 0, runTimeMs: 0, cpuPercent: 0 };
    });

    function taskSnapshot(task, activeId) {
      var state = task.state || task.engine.getState();
      var descriptor = task.descriptor;
      var rawStatus = String(state.status || "idle");
      var status = "Ready";
      var waitObject = "—";
      var id = String(descriptor.id || descriptor.name || descriptor.entry || task.index);
      if (id === activeId && shared.running) status = "Running";
      else if (rawStatus === "sleeping") { status = "Blocked"; waitObject = "Delay → " + Number(state.sleepUntil || 0).toFixed(3) + " ms"; }
      else if (rawStatus === "blocked") {
        status = "Blocked";
        waitObject = state.blocked && state.blocked.type === "uartReceive" ? String(state.blocked.instance || "UART") + " RX" : "Kernel object";
      } else if (rawStatus === "completed") status = "Deleted";
      else if (rawStatus === "paused" || rawStatus === "idle") status = shared.running ? "Ready" : "Suspended";
      else if (rawStatus === "error" || rawStatus === "budget-exceeded") status = "Fault";
      var stackWords = Math.max(1, Number(descriptor.stackWords) || 128);
      var consumed = Math.min(stackWords - 1, 18 + Math.floor(Number(state.operationsExecuted || 0) % Math.max(1, stackWords * 0.55)));
      return {
        id: id, name: String(descriptor.name || descriptor.entry || "Task"), entry: String(descriptor.entry || ""), source: descriptor.source || null,
        state: status, priority: Number(descriptor.priority) || 0, priorityLabel: String(descriptor.priorityLabel || descriptor.priority || "Normal"),
        stackWords: stackWords, stackHighWaterMarkWords: Math.max(1, stackWords - consumed), cpuPercent: Number(task.cpuPercent.toFixed(1)),
        runTimeMs: Number(task.runTimeMs.toFixed(3)), waitObject: waitObject, operationsExecuted: Number(state.operationsExecuted || 0)
      };
    }

    function snapshot() {
      var rtosTasks = tasks.map(function (task) { return taskSnapshot(task, shared.currentTaskId); });
      var totalCpu = rtosTasks.reduce(function (total, task) { return total + Math.max(0, Number(task.cpuPercent) || 0); }, 0);
      if (totalCpu > 100) {
        var cpuScale = 100 / totalCpu;
        rtosTasks.forEach(function (task) { task.cpuPercent = Number((task.cpuPercent * cpuScale).toFixed(1)); });
      }
      var heapTotal = Math.max(0, Number(freertos.heapBytes) || 0);
      var heapUsed = rtosTasks.reduce(function (total, task) { return total + task.stackWords * 4 + 96; }, 0) + Number(shared.heap.usedBytes || 0);
      if (heapTotal) heapUsed = Math.min(heapTotal, heapUsed);
      var uartRx = {};
      var blocked = null;
      shared.uartRx.forEach(function (queue, instance) {
        uartRx[instance] = { bytes: queue.slice(), text: bytesToText(queue), length: queue.length };
      });
      tasks.forEach(function (task) {
        var child = task.state || task.engine.getState();
        if (!blocked && child.blocked && child.blocked.type === "uartReceive") blocked = cloneValue(child.blocked);
      });
      return {
        status: shared.status, running: shared.running, time: shared.time, timeMs: shared.time, pc: 0, variables: cloneValue(shared.variables), gpio: Object.assign({}, shared.gpio),
        uartRx: uartRx, uartTx: cloneValue(shared.uartTx), i2cTx: cloneValue(shared.i2cTx), spiTx: cloneValue(shared.spiTx),
        uartTxCount: shared.uartTxCount, i2cTxCount: shared.i2cTxCount, spiTxCount: shared.spiTxCount, adc: cloneValue(shared.adc), dma: cloneValue(shared.dma),
        interrupts: cloneValue(shared.interrupts), pwm: cloneValue(shared.pwm),
        peripherals: cloneValue(shared.peripherals), heap: cloneValue(shared.heap), stdio: cloneValue(shared.stdio),
        blocked: shared.status === "blocked" ? blocked : null, sleepUntil: null,
        operationsExecuted: shared.operationsExecuted, error: shared.error ? cloneValue(shared.error) : null,
        rtos: {
          detected: true, api: freertos.api || "FreeRTOS", schedulerState: shared.running ? "running" : (shared.status === "idle" ? "ready" : shared.status),
          currentTaskId: shared.currentTaskId, tickCount: Math.floor(shared.time * tickRateHz / 1000), tickRateHz: tickRateHz,
          heapTotalBytes: heapTotal, heapUsedBytes: heapUsed, tasks: rtosTasks
        }
      };
    }

    function notify() { var state = snapshot(); forward("onState", state); return state; }
    function start() {
      shared.running = true; shared.status = "running";
      tasks.forEach(function (task) { task.state = task.engine.start(); });
      return notify();
    }
    function pause() {
      shared.running = false; shared.status = "paused"; shared.currentTaskId = null;
      tasks.forEach(function (task) { task.state = task.engine.pause(); });
      return notify();
    }
    function reset() {
      shared.status = "idle"; shared.running = false; shared.time = 0; Object.keys(shared.gpio).forEach(function (name) { delete shared.gpio[name]; }); shared.uartRx.clear(); shared.uartTx = []; shared.i2cTx = []; shared.spiTx = [];
      shared.uartTxCount = 0; shared.i2cTxCount = 0; shared.spiTxCount = 0;
      Object.keys(shared.adc).forEach(function (name) { delete shared.adc[name]; });
      shared.dma.transfers.splice(0, shared.dma.transfers.length); shared.dma.history.splice(0, shared.dma.history.length); shared.dma.sequence = 0;
      shared.interrupts.events.splice(0, shared.interrupts.events.length); shared.interrupts.history.splice(0, shared.interrupts.history.length); shared.interrupts.sequence = 0; shared.interrupts.gpioLevels = {};
      Object.keys(shared.pwm).forEach(function (name) { delete shared.pwm[name]; });
      Object.keys(shared.peripherals).forEach(function (name) { delete shared.peripherals[name]; });
      Object.keys(shared.heap.allocations).forEach(function (name) { delete shared.heap.allocations[name]; });
      shared.heap.usedBytes = 0; shared.heap.peakBytes = 0; shared.heap.nextId = 0; shared.stdio.splice(0, shared.stdio.length); shared.randomState = 1;
      shared.operationsExecuted = 0; shared.currentTaskId = null; shared.error = null; shared.lastSelectedIndex = -1;
      tasks.forEach(function (task) { task.state = task.engine.reset(); task.lastOperations = 0; task.runTimeMs = 0; task.cpuPercent = 0; });
      return notify();
    }
    function stateFor(task) {
      task.state = task.engine.getState();
      return task.state;
    }
    function taskReady(task, now) {
      var state = stateFor(task);
      if (!state || ["completed", "error", "budget-exceeded"].indexOf(state.status) >= 0) return false;
      if (state.sleepUntil != null && Number(state.sleepUntil) > now + 1e-9) return false;
      if (state.blocked) {
        if (state.blocked.type === "uartReceive") {
          var queue = shared.uartRx.get(String(state.blocked.instance || ""));
          if (queue && queue.length >= Number(state.blocked.length || 0)) return true;
        }
        if (state.blocked.deadline != null && Number(state.blocked.deadline) <= now + 1e-9) return true;
        return false;
      }
      return true;
    }
    function selectTask(now) {
      var ready = tasks.filter(function (task) { return taskReady(task, now); });
      if (!ready.length) return null;
      var highest = Math.max.apply(Math, ready.map(function (task) { return Number(task.descriptor.priority || 0); }));
      var candidates = ready.filter(function (task) { return Number(task.descriptor.priority || 0) === highest; });
      for (var offset = 1; offset <= tasks.length; offset += 1) {
        var index = (shared.lastSelectedIndex + offset + tasks.length) % tasks.length;
        var candidate = candidates.find(function (task) { return task.index === index; });
        if (candidate) return candidate;
      }
      return candidates[0];
    }
    function advanceTasksTo(time) {
      tasks.forEach(function (task) {
        task.engine.advanceTimeTo(time);
        stateFor(task);
      });
    }
    function updateTaskAccounting(task, delta, beforeOperations) {
      var state = stateFor(task);
      var operations = Number(state.operationsExecuted || 0);
      var executed = Math.max(0, operations - beforeOperations);
      task.lastOperations = operations;
      if (executed > 0) task.runTimeMs += delta;
      task.cpuPercent = executed > 0 ? 100 : 0;
      return { state: state, executed: executed };
    }
    function step(deltaMs) {
      var delta = Math.max(0, Number(deltaMs) || 0);
      if (!shared.running) return notify();
      var targetTime = shared.time + delta;
      var totalExecuted = 0;
      var lastActive = null;
      var fatal = null;
      var quantum = 1000 / tickRateHz;
      var now = shared.time;
      var guard = 0;
      function runSlice(sliceMs) {
        var selected = selectTask(now);
        if (!selected) return false;
        var before = Number(stateFor(selected).operationsExecuted || 0);
        shared.currentTaskId = String(selected.descriptor.id || selected.descriptor.name || selected.index);
        selected.state = selected.engine.step(sliceMs);
        var accounting = updateTaskAccounting(selected, sliceMs, before);
        totalExecuted += accounting.executed;
        if (accounting.executed > 0) lastActive = selected;
        if (accounting.state.status === "error" || accounting.state.status === "budget-exceeded") fatal = accounting.state;
        shared.lastSelectedIndex = selected.index;
        return true;
      }
      if (delta === 0) {
        advanceTasksTo(now);
        runSlice(0);
      } else {
        while (now < targetTime - 1e-9 && shared.running && !fatal && guard++ < 100000) {
          var sliceEnd = Math.min(targetTime, now + quantum);
          advanceTasksTo(now);
          runSlice(sliceEnd - now);
          advanceTasksTo(sliceEnd);
          now = sliceEnd;
          shared.time = now;
        }
      }
      shared.time = now;
      shared.operationsExecuted += totalExecuted;
      shared.currentTaskId = lastActive ? String(lastActive.descriptor.id || lastActive.descriptor.name || lastActive.index) : null;
      if (fatal) { shared.running = false; shared.status = fatal.status; shared.error = fatal.error || null; }
      else if (tasks.length && tasks.every(function (task) { return stateFor(task).status === "completed"; })) { shared.running = false; shared.status = "completed"; }
      else if (!tasks.some(function (task) { return taskReady(task, shared.time); })) shared.status = "blocked";
      else shared.status = "running";
      return notify();
    }
    function advanceTimeTo(targetTime) {
      var target = Number(targetTime);
      if (!Number.isFinite(target) || target < shared.time) return snapshot();
      shared.time = target;
      advanceTasksTo(target);
      return notify();
    }
    function enqueueUart(instance, value) {
      var selected = tasks[0];
      if (selected) selected.state = selected.engine.enqueueUart(instance, value);
      return notify();
    }
    function syncGpioInputs(levels) {
      var selected = tasks[0];
      if (selected && typeof selected.engine.syncGpioInputs === "function") selected.state = selected.engine.syncGpioInputs(levels);
      return notify();
    }
    return Object.freeze({ start: start, pause: pause, reset: reset, step: step, advanceTimeTo: advanceTimeTo, enqueueUart: enqueueUart, syncGpioInputs: syncGpioInputs, getState: snapshot });
  }

  function create(model, hooks, options) {
    if (!model || typeof model !== "object") throw new TypeError("AliceFirmwareRuntime.create requires a firmware model");
    hooks = hooks || {};
    options = options && typeof options === "object" ? options : {};

    var freertos = model.middlewares && model.middlewares.freertos;
    if (freertos && freertos.detected && Array.isArray(freertos.tasks) && freertos.tasks.length) {
      return createRtosRuntime(model, hooks, freertos);
    }

    var program = model.program && typeof model.program === "object" ? model.program : {};
    var instructions = compileOperationTree(firstDefined(program, ["operations"], model.operations || []));
    var constants = Object.assign({}, BUILTIN_CONSTANTS, namedValues(program.constants), namedValues(model.constants));
    var pinAliases = Object.assign({}, namedValues(program.pinAliases), namedValues(model.pinAliases));
    var uartAliases = Object.assign({}, namedValues(program.uartAliases), namedValues(model.uartAliases));
    var i2cAliases = Object.assign({}, namedValues(program.i2cAliases), namedValues(model.i2cAliases));
    var spiAliases = Object.assign({}, namedValues(program.spiAliases), namedValues(model.spiAliases));
    var adcAliases = Object.assign({}, namedValues(program.adcAliases), namedValues(model.adcAliases));
    var dmaAliases = Object.assign({}, namedValues(program.dmaAliases), namedValues(model.dmaAliases));
    var timerAliases = Object.assign({}, namedValues(program.timerAliases), namedValues(model.timerAliases));

    if (model.uarts && typeof model.uarts === "object" && !Array.isArray(model.uarts)) {
      Object.keys(model.uarts).forEach(function (name) {
        var descriptor = model.uarts[name];
        uartAliases[name] = descriptor && typeof descriptor === "object" ? (descriptor.instance || descriptor.name || name) : descriptor;
      });
    }
    if (model.i2cs && typeof model.i2cs === "object" && !Array.isArray(model.i2cs)) {
      Object.keys(model.i2cs).forEach(function (name) {
        var descriptor = model.i2cs[name];
        i2cAliases[name] = descriptor && typeof descriptor === "object" ? (descriptor.instance || descriptor.name || name) : descriptor;
      });
    }
    if (model.spis && typeof model.spis === "object" && !Array.isArray(model.spis)) {
      Object.keys(model.spis).forEach(function (name) {
        var descriptor = model.spis[name];
        spiAliases[name] = descriptor && typeof descriptor === "object" ? (descriptor.instance || descriptor.name || name) : descriptor;
      });
    }
    if (model.adcs && typeof model.adcs === "object" && !Array.isArray(model.adcs)) {
      Object.keys(model.adcs).forEach(function (name) {
        var descriptor = model.adcs[name];
        adcAliases[name] = descriptor && typeof descriptor === "object" ? (descriptor.instance || descriptor.name || name) : descriptor;
      });
    }
    if (model.dmas && typeof model.dmas === "object" && !Array.isArray(model.dmas)) {
      Object.keys(model.dmas).forEach(function (name) {
        var descriptor = model.dmas[name];
        dmaAliases[name] = descriptor && typeof descriptor === "object" ? (descriptor.instance || descriptor.name || name) : descriptor;
      });
    }
    if (model.timers && typeof model.timers === "object" && !Array.isArray(model.timers)) {
      Object.keys(model.timers).forEach(function (name) {
        var descriptor = model.timers[name];
        timerAliases[name] = descriptor && typeof descriptor === "object" ? (descriptor.instance || descriptor.name || name) : descriptor;
      });
    }

    var variableDefinitions = Object.assign({}, namedValues(program.variables), namedValues(model.variables));
    if (model.initialState && model.initialState.variables) Object.assign(variableDefinitions, namedValues(model.initialState.variables));
    var variableTypes = Object.assign({}, namedValues(program.variableTypes), namedValues(model.variableTypes));
    var initialVariables = {};
    Object.keys(variableDefinitions).forEach(function (name) { initialVariables[name] = initialVariableValue(variableDefinitions[name]); });

    var operationBudget = Number(firstDefined(program, ["maxOperationsPerStep", "operationBudget"], firstDefined(model, ["maxOperationsPerStep", "operationBudget"], DEFAULT_OPERATION_BUDGET)));
    if (!Number.isFinite(operationBudget) || operationBudget < 1) operationBudget = DEFAULT_OPERATION_BUDGET;
    operationBudget = Math.floor(operationBudget);
    var rtosTickRateHz = Math.max(1, Number(model.rtosTickRateHz) || 1000);
    var heapCapacity = Math.max(0, Math.floor(Number(firstDefined(model, ["heapBytes", "heapSize"], 16 * 1024)) || 0));
    function emptyHeap() {
      return { totalBytes: heapCapacity, usedBytes: 0, peakBytes: 0, nextId: 0, allocations: {} };
    }

    var sharedStore = options.sharedStore && typeof options.sharedStore === "object" ? options.sharedStore : null;
    var peripheralDefaults = { oled: {}, lightSensor: {}, dht11: {}, hcsr04: {}, sg90: {}, buzzer: {}, tm1637: {} };
    if (sharedStore) {
      if (!sharedStore.variables) sharedStore.variables = cloneValue(initialVariables);
      if (!sharedStore.gpio) sharedStore.gpio = {};
      if (!sharedStore.uartRx) sharedStore.uartRx = new Map();
      if (!sharedStore.adc) sharedStore.adc = {};
      if (!sharedStore.dma) sharedStore.dma = { transfers: [], history: [], sequence: 0 };
      if (!sharedStore.interrupts) sharedStore.interrupts = { events: [], history: [], sequence: 0, gpioLevels: {} };
      if (!sharedStore.pwm) sharedStore.pwm = {};
      if (!sharedStore.peripherals) sharedStore.peripherals = cloneValue(peripheralDefaults);
      if (!sharedStore.heap) sharedStore.heap = emptyHeap();
      if (!sharedStore.stdio) sharedStore.stdio = [];
      if (!Number.isFinite(sharedStore.randomState)) sharedStore.randomState = 1;
    }
    var runtime = {
      status: "idle",
      running: false,
      time: 0,
      pc: 0,
      variables: sharedStore ? sharedStore.variables : cloneValue(initialVariables),
      gpio: sharedStore ? sharedStore.gpio : {},
      uartRx: sharedStore ? sharedStore.uartRx : new Map(),
      uartTx: [],
      i2cTx: [],
      spiTx: [],
      uartTxCount: 0,
      i2cTxCount: 0,
      spiTxCount: 0,
      adc: sharedStore ? sharedStore.adc : {},
      dma: sharedStore ? sharedStore.dma : { transfers: [], history: [], sequence: 0 },
      interrupts: sharedStore ? sharedStore.interrupts : { events: [], history: [], sequence: 0, gpioLevels: {} },
      pwm: sharedStore ? sharedStore.pwm : {},
      peripherals: sharedStore ? sharedStore.peripherals : cloneValue(peripheralDefaults),
      heap: sharedStore ? sharedStore.heap : emptyHeap(),
      stdio: sharedStore ? sharedStore.stdio : [],
      stdioCount: 0,
      randomState: sharedStore ? sharedStore.randomState : 1,
      blocked: null,
      sleepUntil: null,
      pendingAdvanceMs: 0,
      operationsExecuted: 0,
      error: null,
      returnValue: undefined
    };

    function callHook(name, payload) {
      if (typeof hooks[name] === "function") return hooks[name](payload);
      return undefined;
    }

    function resolveConstant(name, resolving) {
      var key = String(name || "").trim();
      if (!hasOwn(constants, key)) return undefined;
      resolving = resolving || new Set();
      if (resolving.has(key)) throw new Error("Circular firmware constant: " + key);
      resolving.add(key);
      var value = constants[key];
      if (typeof value === "string" && hasOwn(constants, value)) value = resolveConstant(value, resolving);
      else if (value && typeof value === "object") value = evaluate(value, resolving);
      resolving.delete(key);
      return value;
    }

    function expressionIsFloating(expression) {
      if (!expression || typeof expression !== "object") return false;
      var kind = canonicalExpressionKind(expression);
      if (kind === "literal") return /^(?:float|double|longdouble)$/.test(normalizedKind(expression.numericType));
      if (kind === "variable") {
        var variableName = firstDefined(expression, ["name", "variable", "value"], "");
        return /\b(?:float|double)\b/.test(String(variableTypes[variableName] || "").toLowerCase());
      }
      if (kind === "cast") return /\b(?:float|double)\b/.test(String(expression.cType || expression.castType || "").toLowerCase());
      if (kind === "libccall") {
        return /^(?:atof|strtod|sqrt|sqrtf|sqrtl|pow|powf|powl|sin|sinf|sinl|cos|cosf|cosl|tan|tanf|tanl|asin|asinf|asinl|acos|acosf|acosl|atan|atanf|atanl|atan2|atan2f|atan2l|floor|floorf|floorl|ceil|ceilf|ceill|round|roundf|roundl|trunc|truncf|truncl|fmod|fmodf|fmodl|exp|expf|expl|log|logf|logl|log10|log10f|log10l)$/.test(String(expression.function || expression.name || ""));
      }
      if (["positive", "negate"].indexOf(kind) >= 0) return expressionIsFloating(expression.value);
      if (["add", "sub", "mul", "div"].indexOf(kind) >= 0) {
        return expressionIsFloating(firstDefined(expression, ["left", "a"], null))
          || expressionIsFloating(firstDefined(expression, ["right", "b"], null));
      }
      return false;
    }

    function evaluate(expression, resolving) {
      if (expression == null || typeof expression === "number" || typeof expression === "boolean") return expression;
      if (typeof expression === "string") {
        if (hasOwn(runtime.variables, expression)) return runtime.variables[expression];
        if (hasOwn(constants, expression)) return resolveConstant(expression, resolving);
        return expression;
      }
      if (Array.isArray(expression)) return expression.map(function (item) { return evaluate(item, resolving); });

      var kind = canonicalExpressionKind(expression);
      if (!kind) {
        if (hasOwn(expression, "literal")) return expression.literal;
        if (hasOwn(expression, "constant")) return resolveConstant(expression.constant, resolving);
        if (hasOwn(expression, "variable")) return runtime.variables[expression.variable];
        if (hasOwn(expression, "char")) return byteArray(String(expression.char))[0] || 0;
        if (hasOwn(expression, "arrayIndex")) return evaluate(Object.assign({ type: "arrayIndex" }, expression.arrayIndex), resolving);
        if (hasOwn(expression, "eq")) return evaluate(Object.assign({ type: "eq" }, expression.eq), resolving);
        if (hasOwn(expression, "value")) return expression.value;
        return expression;
      }

      if (kind === "literal") return normalizedKind(expression.numericType) === "float" ? Math.fround(Number(expression.value)) : expression.value;
      if (kind === "string") return firstDefined(expression, ["value", "text"], "");
      if (kind === "constant") {
        var constantName = firstDefined(expression, ["name", "constant"], "");
        var resolvedConstant = resolveConstant(constantName, resolving);
        return resolvedConstant === undefined && hasOwn(expression, "value") ? expression.value : resolvedConstant;
      }
      if (kind === "variable") return runtime.variables[firstDefined(expression, ["name", "variable", "value"], "")];
      if (kind === "tick") return Math.max(0, Math.floor(runtime.time));
      if (kind === "char") return byteArray(String(firstDefined(expression, ["value", "char"], "")))[0] || 0;
      if (kind === "arrayindex") {
        var arraySource = firstDefined(expression, ["array", "source", "target", "name"], []);
        var array = typeof arraySource === "string" && hasOwn(runtime.variables, arraySource)
          ? runtime.variables[arraySource]
          : evaluate(arraySource, resolving);
        var index = Math.trunc(Number(evaluate(firstDefined(expression, ["index", "subscript"], 0), resolving)) || 0);
        if (isHeapPointer(array)) return readPointer(pointerElementOffset(array, index));
        return array == null ? undefined : array[index];
      }
      if (kind === "member") {
        var objectSource = firstDefined(expression, ["object", "source", "target"], null);
        var objectValue = typeof objectSource === "string" && hasOwn(runtime.variables, objectSource)
          ? runtime.variables[objectSource]
          : evaluate(objectSource, resolving);
        var memberName = String(firstDefined(expression, ["member", "field", "property", "name"], ""));
        return objectValue == null ? undefined : objectValue[memberName];
      }
      if (kind === "stringlength") {
        var stringValue = evaluate(firstDefined(expression, ["value", "source", "buffer"], ""), resolving);
        return cBytes(stringValue).length;
      }
      if (kind === "sizeof") {
        var sizedValue = evaluate(firstDefined(expression, ["value", "source", "buffer"], null), resolving);
        if (Array.isArray(sizedValue)) return sizedValue.length;
        if (typeof sizedValue === "string") return byteArray(sizedValue).length + 1;
        if (typeof sizedValue === "boolean") return 1;
        return 4;
      }
      if (kind === "adcpoll") {
        return pollAdc({
          op: "adcPollForConversion",
          adc: firstDefined(expression, ["adc", "handle"], null),
          instance: expression.instance,
          timeout: firstDefined(expression, ["timeout", "timeoutMs"], null)
        });
      }
      if (kind === "positive") return Number(evaluate(firstDefined(expression, ["value", "source"], 0), resolving)) || 0;
      if (kind === "negate") return -(Number(evaluate(firstDefined(expression, ["value", "source"], 0), resolving)) || 0);
      if (kind === "logicalnot") return !evaluate(firstDefined(expression, ["value", "source"], 0), resolving);
      if (kind === "bitnot") return ~Math.trunc(Number(evaluate(firstDefined(expression, ["value", "source"], 0), resolving)) || 0);
      if (kind === "cast") {
        var castValue = evaluate(firstDefined(expression, ["value", "source"], 0), resolving);
        var castType = String(expression.cType || expression.castType || "").toLowerCase();
        if (/\bfloat\b/.test(castType)) return Math.fround(Number(castValue) || 0);
        if (/\bdouble\b/.test(castType)) return Number(castValue) || 0;
        var castIntegerInfo = integerTypeInfo(castType.replace(/\*+/g, "").trim());
        return castIntegerInfo ? coerceIntegerValue(castValue, castIntegerInfo) : castValue;
      }
      if (kind === "addressof") return addressOf(firstDefined(expression, ["value", "target", "source"], null));
      if (kind === "dereference") return readPointer(evaluate(firstDefined(expression, ["pointer", "value", "source"], null), resolving));
      if (kind === "libccall") {
        var libcArguments = Array.isArray(expression.arguments) ? expression.arguments.map(function (argument) { return evaluate(argument, resolving); }) : [];
        return evaluateLibcCall(String(expression.function || expression.name || ""), libcArguments);
      }
      if (["add", "sub", "mul", "div", "mod", "bitor", "bitxor", "bitand", "shiftleft", "shiftright"].indexOf(kind) >= 0) {
        var rawArithmeticLeft = evaluate(firstDefined(expression, ["left", "a"], 0), resolving);
        var rawArithmeticRight = evaluate(firstDefined(expression, ["right", "b"], 0), resolving);
        if ((kind === "add" || kind === "sub") && isHeapPointer(rawArithmeticLeft)) {
          return pointerElementOffset(rawArithmeticLeft, (kind === "sub" ? -1 : 1) * (Number(rawArithmeticRight) || 0));
        }
        var arithmeticLeft = Number(rawArithmeticLeft) || 0;
        var arithmeticRight = Number(rawArithmeticRight) || 0;
        if (kind === "add") return arithmeticLeft + arithmeticRight;
        if (kind === "sub") return arithmeticLeft - arithmeticRight;
        if (kind === "mul") return arithmeticLeft * arithmeticRight;
        if (kind === "div") {
          if (expressionIsFloating(expression)) return arithmeticLeft / arithmeticRight;
          return arithmeticRight === 0 ? 0 : Math.trunc(arithmeticLeft / arithmeticRight);
        }
        if (kind === "mod") return arithmeticRight === 0 ? 0 : Math.trunc(arithmeticLeft) % Math.trunc(arithmeticRight);
        if (kind === "bitor") return Math.trunc(arithmeticLeft) | Math.trunc(arithmeticRight);
        if (kind === "bitxor") return Math.trunc(arithmeticLeft) ^ Math.trunc(arithmeticRight);
        if (kind === "bitand") return Math.trunc(arithmeticLeft) & Math.trunc(arithmeticRight);
        if (kind === "shiftleft") return Math.trunc(arithmeticLeft) << (Math.trunc(arithmeticRight) & 31);
        return Math.trunc(arithmeticLeft) >> (Math.trunc(arithmeticRight) & 31);
      }
      if (kind === "eq") {
        var operands = Array.isArray(expression.operands) ? expression.operands : [];
        var left = evaluate(firstDefined(expression, ["left", "a"], operands[0]), resolving);
        var right = evaluate(firstDefined(expression, ["right", "b"], operands[1]), resolving);
        return cEqual(left, right);
      }
      if (kind === "ne") {
        var notEqualOperands = Array.isArray(expression.operands) ? expression.operands : [];
        var notEqualLeft = evaluate(firstDefined(expression, ["left", "a"], notEqualOperands[0]), resolving);
        var notEqualRight = evaluate(firstDefined(expression, ["right", "b"], notEqualOperands[1]), resolving);
        return !cEqual(notEqualLeft, notEqualRight);
      }
      if (kind === "and") {
        var andOperands = Array.isArray(expression.operands) ? expression.operands : [];
        var andLeft = evaluate(firstDefined(expression, ["left", "a"], andOperands[0]), resolving);
        return Boolean(andLeft) && Boolean(evaluate(firstDefined(expression, ["right", "b"], andOperands[1]), resolving));
      }
      if (kind === "or") {
        var orOperands = Array.isArray(expression.operands) ? expression.operands : [];
        var orLeft = evaluate(firstDefined(expression, ["left", "a"], orOperands[0]), resolving);
        return Boolean(orLeft) || Boolean(evaluate(firstDefined(expression, ["right", "b"], orOperands[1]), resolving));
      }
      if (["lt", "le", "gt", "ge"].indexOf(kind) >= 0) {
        var comparisonOperands = Array.isArray(expression.operands) ? expression.operands : [];
        var comparisonLeft = evaluate(firstDefined(expression, ["left", "a"], comparisonOperands[0]), resolving);
        var comparisonRight = evaluate(firstDefined(expression, ["right", "b"], comparisonOperands[1]), resolving);
        if (kind === "lt") return comparisonLeft < comparisonRight;
        if (kind === "le") return comparisonLeft <= comparisonRight;
        if (kind === "gt") return comparisonLeft > comparisonRight;
        return comparisonLeft >= comparisonRight;
      }
      var expressionText = String(expression.text || expression.sourceText || "").trim();
      throw new Error("Unsupported firmware expression: " + kind + (expressionText ? " (" + expressionText + ")" : ""));
    }

    function integerTypeInfo(rawType) {
      var type = String(rawType || "").toLowerCase().replace(/\b(const|volatile|register)\b/g, "").replace(/\s+/g, " ").trim();
      if (!type) return null;
      if (type === "bool" || type === "_bool") return { bits: 1, unsigned: true };
      var fixed = type.match(/^(u|s)?int(8|16|32|64)_t$/);
      if (fixed) return { bits: Number(fixed[2]), unsigned: fixed[1] === "u" };
      if (type === "size_t") return { bits: 32, unsigned: true };
      if (type === "unsigned char") return { bits: 8, unsigned: true };
      if (type === "signed char" || type === "char") return { bits: 8, unsigned: false };
      if (type === "unsigned short") return { bits: 16, unsigned: true };
      if (type === "short" || type === "signed short") return { bits: 16, unsigned: false };
      if (type === "unsigned int" || type === "unsigned long") return { bits: 32, unsigned: true };
      if (type === "int" || type === "signed int" || type === "long" || type === "signed long") return { bits: 32, unsigned: false };
      return null;
    }

    function pointerTypeInfo(name) {
      var type = String(variableTypes[name] || "").trim();
      if (type.indexOf("*") < 0) return { elementSize: 1, unsigned: true };
      var info = integerTypeInfo(type.replace(/\*+/g, "").trim());
      return info ? { elementSize: Math.max(1, info.bits / 8), unsigned: info.unsigned } : { elementSize: 1, unsigned: true };
    }

    function coerceIntegerValue(value, info) {
      var number = Number(value);
      if (!Number.isFinite(number)) number = 0;
      if (info.bits > 32) return Math.trunc(number);
      number = Math.trunc(number);
      var modulus = Math.pow(2, info.bits);
      var wrapped = ((number % modulus) + modulus) % modulus;
      if (!info.unsigned && wrapped >= modulus / 2) wrapped -= modulus;
      return wrapped;
    }

    function coerceCValue(name, value) {
      var declaredType = String(variableTypes[name] || "").toLowerCase();
      if (declaredType.indexOf("*") < 0 && /\bfloat\b/.test(declaredType)) return Math.fround(Number(value) || 0);
      if (declaredType.indexOf("*") < 0 && /\bdouble\b/.test(declaredType)) return Number(value) || 0;
      var info = integerTypeInfo(variableTypes[name]);
      if (!info || Array.isArray(value) || (value && typeof value === "object")) return cloneValue(value);
      return coerceIntegerValue(value, info);
    }

    function assign(target, value) {
      if (typeof target === "string") {
        runtime.variables[target] = coerceCValue(target, value);
        return;
      }
      if (!target || typeof target !== "object") throw new Error("Assignment target is missing");
      var kind = canonicalExpressionKind(target);
      if (kind === "variable" || (!kind && (target.name || target.variable))) {
        var variableName = firstDefined(target, ["name", "variable"], "");
        runtime.variables[variableName] = coerceCValue(variableName, value);
        return;
      }
      if (kind === "arrayindex" || (!kind && target.array !== undefined && target.index !== undefined)) {
        var arrayName = firstDefined(target, ["array", "source", "name"], "");
        if (arrayName && typeof arrayName === "object") arrayName = firstDefined(arrayName, ["name", "variable"], "");
        if (!arrayName) throw new Error("Array assignment requires a named variable");
        var array = Array.isArray(runtime.variables[arrayName]) ? runtime.variables[arrayName] : [];
        var index = Math.trunc(Number(evaluate(target.index)) || 0);
        if (isHeapPointer(runtime.variables[arrayName])) {
          writePointer(pointerElementOffset(runtime.variables[arrayName], index), value);
          return;
        }
        array[index] = coerceCValue(arrayName, value);
        runtime.variables[arrayName] = array;
        return;
      }
      if (kind === "dereference") {
        writePointer(evaluate(firstDefined(target, ["pointer", "value", "source"], null)), value);
        return;
      }
      throw new Error("Unsupported assignment target");
    }

    function isHeapPointer(value) {
      return Boolean(value && typeof value === "object" && value.__alicePointer === "heap");
    }

    function isVariablePointer(value) {
      return Boolean(value && typeof value === "object" && value.__alicePointer === "variable");
    }

    function pointerOffset(pointer, offset) {
      if (!pointer || typeof pointer !== "object") return pointer;
      var copy = cloneValue(pointer);
      copy.offset = Math.max(0, Math.trunc(Number(copy.offset || 0) + Number(offset || 0)));
      return copy;
    }

    function pointerElementOffset(pointer, elements) {
      return pointerOffset(pointer, Number(elements || 0) * Math.max(1, Math.trunc(Number(pointer && pointer.elementSize) || 1)));
    }

    function addressOf(expression) {
      if (!expression || typeof expression !== "object") throw new Error("Address-of requires a named variable or array element");
      var kind = canonicalExpressionKind(expression);
      if (kind === "variable") {
        return { __alicePointer: "variable", name: String(firstDefined(expression, ["name", "variable", "value"], "")), offset: 0 };
      }
      if (kind === "arrayindex") {
        var arrayName = firstDefined(expression, ["array", "source", "name"], "");
        if (arrayName && typeof arrayName === "object") arrayName = firstDefined(arrayName, ["name", "variable"], "");
        return {
          __alicePointer: "variable",
          name: String(arrayName || ""),
          offset: Math.max(0, Math.trunc(Number(evaluate(firstDefined(expression, ["index", "subscript"], 0))) || 0))
        };
      }
      if (kind === "dereference") return evaluate(firstDefined(expression, ["pointer", "value"], null));
      throw new Error("Address-of target is unsupported");
    }

    function heapAllocation(pointer) {
      if (!isHeapPointer(pointer)) return null;
      var allocation = runtime.heap.allocations[String(pointer.id)];
      if (!allocation || allocation.freed) throw new Error("Heap pointer refers to freed or invalid memory");
      return allocation;
    }

    function readPointer(pointer) {
      if (pointer == null || pointer === 0) throw new Error("Null pointer dereference");
      if (isVariablePointer(pointer)) {
        var variableValue = runtime.variables[pointer.name];
        var variableOffset = Math.max(0, Math.trunc(Number(pointer.offset) || 0));
        if (Array.isArray(variableValue)) {
          if (variableOffset >= variableValue.length) throw new Error("Array pointer read is out of bounds");
          return variableValue[variableOffset];
        }
        if (variableOffset !== 0) throw new Error("Scalar pointer read is out of bounds");
        return variableValue;
      }
      var allocation = heapAllocation(pointer);
      if (!allocation) throw new Error("Value is not a valid pointer");
      var offset = Math.max(0, Math.trunc(Number(pointer.offset) || 0));
      var width = Math.max(1, Math.trunc(Number(pointer.elementSize) || 1));
      if (offset + width > allocation.size) throw new Error("Heap pointer read is out of bounds");
      var result = 0;
      for (var readIndex = 0; readIndex < width; readIndex += 1) {
        if (!allocation.initialized[offset + readIndex]) throw new Error("Read from uninitialized malloc memory");
        result += allocation.bytes[offset + readIndex] * Math.pow(256, readIndex);
      }
      var signLimit = Math.pow(2, width * 8 - 1);
      var modulus = Math.pow(2, width * 8);
      if (pointer.unsigned === false && result >= signLimit) result -= modulus;
      return result;
    }

    function writePointer(pointer, value) {
      if (pointer == null || pointer === 0) throw new Error("Null pointer write");
      if (isVariablePointer(pointer)) {
        var variableOffset = Math.max(0, Math.trunc(Number(pointer.offset) || 0));
        if (Array.isArray(runtime.variables[pointer.name])) {
          if (variableOffset >= runtime.variables[pointer.name].length) throw new Error("Array pointer write is out of bounds");
          runtime.variables[pointer.name][variableOffset] = coerceCValue(pointer.name, value);
        } else {
          if (variableOffset !== 0) throw new Error("Scalar pointer write is out of bounds");
          runtime.variables[pointer.name] = coerceCValue(pointer.name, value);
        }
        return;
      }
      var allocation = heapAllocation(pointer);
      if (!allocation) throw new Error("Value is not a valid pointer");
      var offset = Math.max(0, Math.trunc(Number(pointer.offset) || 0));
      var width = Math.max(1, Math.trunc(Number(pointer.elementSize) || 1));
      if (offset + width > allocation.size) throw new Error("Heap pointer write is out of bounds");
      var numeric = Math.trunc(Number(value) || 0);
      var modulus = Math.pow(2, width * 8);
      numeric = ((numeric % modulus) + modulus) % modulus;
      for (var writeIndex = 0; writeIndex < width; writeIndex += 1) {
        allocation.bytes[offset + writeIndex] = Math.floor(numeric / Math.pow(256, writeIndex)) & 0xff;
        allocation.initialized[offset + writeIndex] = true;
      }
    }

    function memoryBytes(value, count) {
      var bytes;
      if (isVariablePointer(value)) {
        var variable = runtime.variables[value.name];
        bytes = byteArray(variable).slice(Math.max(0, Math.trunc(Number(value.offset) || 0)));
      } else if (isHeapPointer(value)) {
        var allocation = heapAllocation(value);
        var offset = Math.max(0, Math.trunc(Number(value.offset) || 0));
        var limit = count == null ? allocation.size - offset : Math.max(0, Math.trunc(Number(count) || 0));
        if (offset + limit > allocation.size) throw new Error("Heap memory read is out of bounds");
        for (var initializedIndex = offset; initializedIndex < offset + limit; initializedIndex += 1) {
          if (!allocation.initialized[initializedIndex]) throw new Error("Read from uninitialized malloc memory");
        }
        bytes = allocation.bytes.slice(offset, offset + limit);
      } else {
        bytes = byteArray(value);
      }
      return count == null ? bytes : bytes.slice(0, Math.max(0, Math.trunc(Number(count) || 0)));
    }

    function memoryTargetPointer(expression) {
      var kind = canonicalExpressionKind(expression);
      if (kind === "addressof") return evaluate(expression);
      if (kind === "variable") {
        var name = String(firstDefined(expression, ["name", "variable", "value"], ""));
        return isHeapPointer(runtime.variables[name]) ? runtime.variables[name] : { __alicePointer: "variable", name: name, offset: 0 };
      }
      if (kind === "arrayindex") return addressOf(expression);
      var evaluated = evaluate(expression);
      if (isHeapPointer(evaluated) || isVariablePointer(evaluated)) return evaluated;
      throw new Error("Memory destination is not writable");
    }

    function writeMemory(pointer, bytes) {
      var bytePointer = cloneValue(pointer);
      if (isHeapPointer(bytePointer)) {
        bytePointer.elementSize = 1;
        bytePointer.unsigned = true;
      }
      bytes.forEach(function (byte, index) { writePointer(pointerOffset(bytePointer, index), byte); });
    }

    function allocateHeap(size, zero, typeInfo) {
      size = Math.max(0, Math.trunc(Number(size) || 0));
      if (size === 0 || runtime.heap.usedBytes + size > runtime.heap.totalBytes) return 0;
      var id = String(++runtime.heap.nextId);
      var allocation = {
        id: id,
        size: size,
        bytes: new Array(size).fill(0),
        initialized: new Array(size).fill(Boolean(zero)),
        freed: false
      };
      runtime.heap.allocations[id] = allocation;
      runtime.heap.usedBytes += size;
      runtime.heap.peakBytes = Math.max(runtime.heap.peakBytes, runtime.heap.usedBytes);
      typeInfo = typeInfo || { elementSize: 1, unsigned: true };
      return {
        __alicePointer: "heap",
        id: id,
        offset: 0,
        elementSize: Math.max(1, Math.trunc(Number(typeInfo.elementSize) || 1)),
        unsigned: typeInfo.unsigned !== false
      };
    }

    function freeHeap(pointer) {
      if (pointer == null || pointer === 0) return;
      var allocation = heapAllocation(pointer);
      if (!allocation || Math.trunc(Number(pointer.offset) || 0) !== 0) throw new Error("free requires the original allocated pointer");
      allocation.freed = true;
      runtime.heap.usedBytes = Math.max(0, runtime.heap.usedBytes - allocation.size);
    }

    function executeHeapAllocate(operation) {
      var name = String(operation.function || "malloc");
      var size = Math.max(0, Math.trunc(Number(evaluate(operation.size)) || 0));
      var typeInfo = pointerTypeInfo(String(firstDefined(operation, ["resultTarget", "result", "target"], "")));
      if (name === "calloc") size *= Math.max(0, Math.trunc(Number(evaluate(operation.count)) || 0));
      var pointer;
      if (name === "realloc") {
        var previous = evaluate(operation.pointer);
        if (previous == null || previous === 0) pointer = allocateHeap(size, false, typeInfo);
        else if (size === 0) {
          freeHeap(previous);
          pointer = 0;
        } else {
          var previousAllocation = heapAllocation(previous);
          var available = runtime.heap.totalBytes - runtime.heap.usedBytes + previousAllocation.size;
          if (size > available) pointer = 0;
          else {
            var oldSize = previousAllocation.size;
            previousAllocation.bytes.length = size;
            previousAllocation.initialized.length = size;
            for (var index = oldSize; index < size; index += 1) {
              previousAllocation.bytes[index] = 0;
              previousAllocation.initialized[index] = false;
            }
            previousAllocation.size = size;
            runtime.heap.usedBytes += size - oldSize;
            runtime.heap.peakBytes = Math.max(runtime.heap.peakBytes, runtime.heap.usedBytes);
            pointer = previous;
          }
        }
      } else pointer = allocateHeap(size, name === "calloc" || Boolean(operation.zero), typeInfo);
      setOperationResult(operation, pointer);
    }

    function compareBytes(left, right, count) {
      var leftBytes = memoryBytes(left, count);
      var rightBytes = memoryBytes(right, count);
      var length = count == null ? Math.max(leftBytes.length, rightBytes.length) : Math.max(0, Math.trunc(Number(count) || 0));
      for (var index = 0; index < length; index += 1) {
        var difference = Number(leftBytes[index] || 0) - Number(rightBytes[index] || 0);
        if (difference) return difference;
      }
      return 0;
    }

    function evaluateLibcCall(name, values) {
      name = String(name || "");
      if (name === "rand") {
        runtime.randomState = (Math.imul(runtime.randomState, 1103515245) + 12345) & 0x7fffffff;
        if (sharedStore) sharedStore.randomState = runtime.randomState;
        return runtime.randomState;
      }
      if (name === "strcmp" || name === "strncmp") {
        var leftText = byteArray(cString(values[0])).concat([0]);
        var rightText = byteArray(cString(values[1])).concat([0]);
        return compareBytes(leftText, rightText, name === "strncmp" ? values[2] : Math.max(leftText.length, rightText.length));
      }
      if (name === "memcmp") return compareBytes(values[0], values[1], values[2]);
      if (["atoi", "atol", "atoll"].indexOf(name) >= 0) return parseInt(cString(values[0]), 10) || 0;
      if (name === "atof" || name === "strtod") return parseFloat(cString(values[0])) || 0;
      if (["strtol", "strtoul", "strtoll", "strtoull"].indexOf(name) >= 0) {
        var base = Math.trunc(Number(values[2]) || 0);
        var parsed = parseInt(cString(values[0]), base || 0);
        if (!Number.isFinite(parsed)) parsed = 0;
        return name.indexOf("strtou") === 0 && parsed < 0 ? parsed >>> 0 : parsed;
      }
      if (["abs", "labs", "llabs", "fabs", "fabsf", "fabsl"].indexOf(name) >= 0) return Math.abs(Number(values[0]) || 0);
      if (["isalnum", "isalpha", "isblank", "iscntrl", "isdigit", "isgraph", "islower", "isprint", "ispunct", "isspace", "isupper", "isxdigit", "tolower", "toupper"].indexOf(name) >= 0) {
        var characterCode = Math.trunc(Number(values[0]) || 0) & 0xff;
        var character = String.fromCharCode(characterCode);
        if (name === "tolower") return character.toLowerCase().charCodeAt(0);
        if (name === "toupper") return character.toUpperCase().charCodeAt(0);
        var patterns = {
          isalnum: /^[A-Za-z0-9]$/, isalpha: /^[A-Za-z]$/, isblank: /^[ \t]$/, iscntrl: /^[\x00-\x1f\x7f]$/,
          isdigit: /^[0-9]$/, isgraph: /^[\x21-\x7e]$/, islower: /^[a-z]$/, isprint: /^[\x20-\x7e]$/,
          ispunct: /^[!-/:-@[-`{-~]$/, isspace: /^\s$/, isupper: /^[A-Z]$/, isxdigit: /^[A-Fa-f0-9]$/
        };
        return patterns[name].test(character) ? 1 : 0;
      }
      var mathName = name.replace(/[fl]$/, "");
      var mathFunctions = {
        sqrt: Math.sqrt, pow: Math.pow, sin: Math.sin, cos: Math.cos, tan: Math.tan,
        asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
        floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
        fmod: function (left, right) { return Number(right) === 0 ? NaN : Number(left) % Number(right); },
        exp: Math.exp, log: Math.log, log10: Math.log10
      };
      if (mathFunctions[mathName]) return mathFunctions[mathName].apply(Math, values.map(Number));
      throw new Error("Unsupported C library expression: " + name);
    }

    function cBytes(value) {
      var bytes;
      if (isHeapPointer(value)) {
        var allocation = heapAllocation(value);
        var offset = Math.max(0, Math.trunc(Number(value.offset) || 0));
        bytes = [];
        for (var index = offset; index < allocation.size; index += 1) {
          if (!allocation.initialized[index]) throw new Error("String reads uninitialized malloc memory before a terminator");
          if (allocation.bytes[index] === 0) return bytes;
          bytes.push(allocation.bytes[index]);
        }
        throw new Error("String is not null terminated within its allocation");
      }
      bytes = memoryBytes(value);
      var terminator = bytes.indexOf(0);
      if (terminator >= 0) bytes = bytes.slice(0, terminator);
      return bytes;
    }

    function cString(value) {
      var bytes = cBytes(value);
      return bytesToText(bytes);
    }

    function formatPadding(text, width, flags, prefixLength) {
      width = Math.max(0, Math.trunc(Number(width) || 0));
      if (text.length >= width) return text;
      var padding = new Array(width - text.length + 1).join(flags.indexOf("0") >= 0 && flags.indexOf("-") < 0 ? "0" : " ");
      if (flags.indexOf("-") >= 0) return text + padding;
      if (padding[0] === "0" && prefixLength > 0) return text.slice(0, prefixLength) + padding + text.slice(prefixLength);
      return padding + text;
    }

    function formatCValue(specifier, flags, width, precision, value) {
      var text;
      var prefix = "";
      if (specifier === "s") {
        text = cString(value);
        if (precision != null) text = text.slice(0, Math.max(0, precision));
        return formatPadding(text, width, flags, 0);
      }
      if (specifier === "c") {
        text = typeof value === "string" ? value.slice(0, 1) : String.fromCharCode(Math.trunc(Number(value) || 0) & 0xff);
        return formatPadding(text, width, flags, 0);
      }
      if ("fFeEgGaA".indexOf(specifier) >= 0) {
        var floatValue = Number(value);
        if (!Number.isFinite(floatValue)) floatValue = 0;
        var digits = precision == null ? 6 : Math.max(0, precision);
        if (specifier.toLowerCase() === "f") text = floatValue.toFixed(digits);
        else if (specifier.toLowerCase() === "e") text = floatValue.toExponential(digits);
        else text = floatValue.toPrecision(Math.max(1, digits || 1)).replace(/(?:\.0+|(?:(\.\d*?)0+))(?=e|$)/i, "$1");
        if (specifier === specifier.toUpperCase()) text = text.toUpperCase();
        if (floatValue >= 0 && flags.indexOf("+") >= 0) text = "+" + text;
        else if (floatValue >= 0 && flags.indexOf(" ") >= 0) text = " " + text;
        return formatPadding(text, width, flags, text[0] === "+" || text[0] === "-" || text[0] === " " ? 1 : 0);
      }

      var numeric = Math.trunc(Number(value) || 0);
      var unsigned = "uoxXp".indexOf(specifier) >= 0;
      if (unsigned && numeric < 0) numeric = numeric >>> 0;
      var base = specifier === "o" ? 8 : "xXp".indexOf(specifier) >= 0 ? 16 : 10;
      var negative = !unsigned && numeric < 0;
      var digitsText = Math.abs(numeric).toString(base);
      if (specifier === "X") digitsText = digitsText.toUpperCase();
      if (precision != null) {
        digitsText = new Array(Math.max(0, precision - digitsText.length) + 1).join("0") + digitsText;
        flags = flags.replace(/0/g, "");
      }
      if (negative) prefix = "-";
      else if (!unsigned && flags.indexOf("+") >= 0) prefix = "+";
      else if (!unsigned && flags.indexOf(" ") >= 0) prefix = " ";
      if (specifier === "p" || flags.indexOf("#") >= 0 && numeric !== 0 && "xX".indexOf(specifier) >= 0) prefix += specifier === "X" ? "0X" : "0x";
      else if (flags.indexOf("#") >= 0 && numeric !== 0 && specifier === "o") prefix += "0";
      text = prefix + digitsText;
      return formatPadding(text, width, flags, prefix.length);
    }

    function formatCString(format, values) {
      var argumentIndex = 0;
      return String(format).replace(/%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d+))?(?:hh|h|ll|l|j|z|t|L)?([diuoxXfFeEgGaAcsp%])/g, function (match, flags, widthToken, precisionToken, specifier) {
        if (specifier === "%") return "%";
        var width = widthToken === "*" ? Number(values[argumentIndex++]) : widthToken == null ? 0 : Number(widthToken);
        var precision = precisionToken === "*" ? Number(values[argumentIndex++]) : precisionToken == null ? null : Number(precisionToken);
        return formatCValue(specifier, flags, width, precision, values[argumentIndex++]);
      });
    }

    function writeFormattedString(operation) {
      var buffer = String(firstDefined(operation, ["buffer", "target", "destination"], ""));
      if (!buffer) throw new Error("Formatted output buffer is missing");
      var format = cString(evaluate(firstDefined(operation, ["format", "template"], "")));
      var values = Array.isArray(operation.arguments) ? operation.arguments.map(function (value) { return evaluate(value); }) : [];
      var renderedBytes = byteArray(formatCString(format, values));
      var hasCapacity = operation.capacity !== undefined && operation.capacity !== null;
      var capacity = hasCapacity ? Math.max(0, Math.trunc(Number(evaluate(operation.capacity)) || 0)) : renderedBytes.length + 1;
      if (capacity > 0) {
        var written = renderedBytes.slice(0, Math.max(0, capacity - 1));
        if (isHeapPointer(runtime.variables[buffer])) {
          writeMemory(runtime.variables[buffer], written.concat([0]));
        } else {
          var existing = Array.isArray(runtime.variables[buffer]) ? runtime.variables[buffer].slice() : [];
          while (existing.length < capacity) existing.push(0);
          written.forEach(function (byte, index) { existing[index] = byte; });
          existing[written.length] = 0;
          runtime.variables[buffer] = existing;
        }
      }
      setOperationResult(operation, renderedBytes.length);
    }

    function executeLibcMemory(operation) {
      var name = String(operation.function || "");
      var args = Array.isArray(operation.arguments) ? operation.arguments : [];
      var destination = memoryTargetPointer(args[0]);
      var output;
      if (name === "memset") {
        var fill = Math.trunc(Number(evaluate(args[1])) || 0) & 0xff;
        output = new Array(Math.max(0, Math.trunc(Number(evaluate(args[2])) || 0))).fill(fill);
      } else if (name === "memcpy" || name === "memmove") {
        var copyCount = Math.max(0, Math.trunc(Number(evaluate(args[2])) || 0));
        output = memoryBytes(evaluate(args[1]), copyCount).slice();
        if (output.length < copyCount) throw new Error(name + " source read is out of bounds");
      } else if (name === "strcpy" || name === "strncpy") {
        output = cBytes(evaluate(args[1])).concat([0]);
        if (name === "strncpy") {
          var stringCount = Math.max(0, Math.trunc(Number(evaluate(args[2])) || 0));
          output = output.slice(0, stringCount);
          while (output.length < stringCount) output.push(0);
        }
      } else {
        var existing = cBytes(evaluate(args[0]));
        var addition = cBytes(evaluate(args[1]));
        if (name === "strncat") addition = addition.slice(0, Math.max(0, Math.trunc(Number(evaluate(args[2])) || 0)));
        destination = pointerOffset(destination, existing.length);
        output = addition.concat([0]);
      }
      writeMemory(destination, output);
      setOperationResult(operation, evaluate(args[0]));
    }

    function writeStdio(operation) {
      var name = String(operation.function || "printf");
      var bytes;
      var result;
      if (operation.format !== undefined) {
        var format = cString(evaluate(operation.format));
        var values = Array.isArray(operation.arguments) ? operation.arguments.map(function (value) { return evaluate(value); }) : [];
        bytes = byteArray(formatCString(format, values));
        result = bytes.length;
      } else if (operation.character !== undefined) {
        bytes = [Math.trunc(Number(evaluate(operation.character)) || 0) & 0xff];
        result = bytes[0];
      } else if (name === "fwrite") {
        var size = Math.max(0, Math.trunc(Number(evaluate(operation.size)) || 0));
        var count = Math.max(0, Math.trunc(Number(evaluate(operation.count)) || 0));
        bytes = memoryBytes(evaluate(operation.data), size * count);
        result = size ? Math.floor(bytes.length / size) : 0;
      } else {
        bytes = cBytes(evaluate(operation.data));
        if (operation.newline) bytes = bytes.concat([10]);
        result = bytes.length;
      }
      var event = {
        stream: String(operation.stream || "stdout"),
        function: name,
        bytes: bytes.slice(),
        text: bytesToText(bytes),
        time: runtime.time,
        timeMs: runtime.time
      };
      runtime.stdioCount += 1;
      appendBoundedHistory(runtime.stdio, event);
      callHook("onStdio", cloneValue(event));
      setOperationResult(operation, result);
    }

    function scanStdio(operation) {
      var input = cString(evaluate(operation.input));
      var format = cString(evaluate(operation.format));
      var descriptors = [];
      var pattern = "^";
      for (var index = 0; index < format.length;) {
        var character = format[index];
        if (/\s/.test(character)) {
          while (index < format.length && /\s/.test(format[index])) index += 1;
          pattern += "\\s+";
          continue;
        }
        if (character !== "%") {
          pattern += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          index += 1;
          continue;
        }
        index += 1;
        if (format[index] === "%") {
          pattern += "%";
          index += 1;
          continue;
        }
        var suppressed = format[index] === "*";
        if (suppressed) index += 1;
        var widthText = "";
        while (index < format.length && /\d/.test(format[index])) widthText += format[index++];
        while (index < format.length && /[hlLjzt]/.test(format[index])) index += 1;
        var specifier = format[index++] || "";
        var width = Math.max(0, Number(widthText) || 0);
        var capture;
        if (specifier === "d" || specifier === "u") capture = specifier === "d" ? "[+-]?\\d+" : "\\+?\\d+";
        else if (specifier === "i") capture = "[+-]?(?:0[xX][0-9A-Fa-f]+|0[0-7]+|\\d+)";
        else if (specifier === "x" || specifier === "X" || specifier === "p") capture = "(?:0[xX])?[0-9A-Fa-f]+";
        else if (specifier === "o") capture = "[0-7]+";
        else if ("fFeEgGaA".indexOf(specifier) >= 0) capture = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
        else if (specifier === "s") capture = width ? "\\S{1," + width + "}" : "\\S+";
        else if (specifier === "c") capture = ".{" + (width || 1) + "}";
        else throw new Error("Unsupported sscanf conversion: %" + specifier);
        pattern += suppressed ? "(?:" + capture + ")" : "(" + capture + ")";
        if (!suppressed) descriptors.push({ specifier: specifier });
      }
      var match = new RegExp(pattern).exec(input);
      if (!match) {
        setOperationResult(operation, 0);
        return;
      }
      var targets = Array.isArray(operation.targets) ? operation.targets : [];
      var assigned = Math.min(descriptors.length, targets.length);
      for (var targetIndex = 0; targetIndex < assigned; targetIndex += 1) {
        var descriptor = descriptors[targetIndex];
        var token = match[targetIndex + 1];
        if (descriptor.specifier === "s" || descriptor.specifier === "c") {
          var targetPointer = memoryTargetPointer(targets[targetIndex]);
          var scannedBytes = byteArray(token);
          if (descriptor.specifier === "s") scannedBytes.push(0);
          writeMemory(targetPointer, scannedBytes);
        } else {
          var base = descriptor.specifier === "x" || descriptor.specifier === "X" || descriptor.specifier === "p" ? 16 : descriptor.specifier === "o" ? 8 : descriptor.specifier === "i" ? 0 : 10;
          var value = "fFeEgGaA".indexOf(descriptor.specifier) >= 0 ? parseFloat(token) : parseInt(token, base);
          writePointer(evaluate(targets[targetIndex]), Number.isFinite(value) ? value : 0);
        }
      }
      setOperationResult(operation, assigned);
    }

    function resolveAlias(value, aliases) {
      var current = value;
      var visited = new Set();
      while (typeof current === "string") {
        var key = current.trim().replace(/^&/, "");
        if (visited.has(key)) break;
        visited.add(key);
        if (hasOwn(aliases, key)) {
          current = aliases[key];
          continue;
        }
        if (hasOwn(constants, key)) {
          current = resolveConstant(key);
          continue;
        }
        return key;
      }
      return current;
    }

    function resolvePeripheralInstance(raw, aliases, fallback, pattern) {
      var value = raw && typeof raw === "object" ? evaluate(raw) : raw;
      if (typeof value === "string" && hasOwn(runtime.variables, value)) value = runtime.variables[value];
      value = resolveAlias(value, aliases);
      if (value && typeof value === "object") value = value.instance || value.name || value.id;
      var name = String(value == null ? fallback : value).trim().replace(/^&/, "");
      if (pattern.test(name)) return name.toUpperCase();
      return name;
    }

    function resolveInstance(raw) {
      return resolvePeripheralInstance(raw, uartAliases, "UART", /^(?:usart|uart)\d+$/i);
    }

    function resolveI2cInstance(raw) {
      return resolvePeripheralInstance(raw, i2cAliases, "I2C", /^i2c\d+$/i);
    }

    function resolveSpiInstance(raw) {
      return resolvePeripheralInstance(raw, spiAliases, "SPI", /^spi\d+$/i);
    }

    function resolveAdcInstance(raw) {
      return resolvePeripheralInstance(raw, adcAliases, "ADC", /^adc\d+$/i);
    }

    function resolveDmaInstance(raw) {
      return resolvePeripheralInstance(raw, dmaAliases, "DMA", /^dma\d+_(?:channel|stream)\d+$/i);
    }

    function resolveTimerInstance(raw) {
      return resolvePeripheralInstance(raw, timerAliases, "TIM", /^tim\d+$/i);
    }

    function timerDescriptor(raw) {
      var resolved = resolveTimerInstance(raw);
      var timers = model.timers && typeof model.timers === "object" ? model.timers : {};
      var key = Object.keys(timers).find(function (name) {
        var descriptor = timers[name] || {};
        return String(name).toUpperCase() === String(raw || "").replace(/^&/, "").toUpperCase() || String(descriptor.instance || "").toUpperCase() === resolved.toUpperCase();
      });
      return key ? timers[key] : null;
    }

    function peripheralDescriptor(collection, raw, resolved) {
      collection = collection && typeof collection === "object" ? collection : {};
      var normalizedRaw = String(raw || "").replace(/^&/, "").toUpperCase();
      var key = Object.keys(collection).find(function (name) {
        var descriptor = collection[name] || {};
        return String(name).toUpperCase() === normalizedRaw || String(descriptor.instance || "").toUpperCase() === String(resolved || "").toUpperCase();
      });
      return key ? collection[key] : null;
    }

    function uartDescriptor(raw) {
      return peripheralDescriptor(model.uarts, raw, resolveInstance(raw));
    }

    function adcDescriptor(raw) {
      return peripheralDescriptor(model.adcs, raw, resolveAdcInstance(raw));
    }

    function dmaDescriptor(raw) {
      return peripheralDescriptor(model.dmas, raw, resolveDmaInstance(raw));
    }

    function uartQueue(instance) {
      if (!runtime.uartRx.has(instance)) runtime.uartRx.set(instance, []);
      return runtime.uartRx.get(instance);
    }

    function operationInstance(operation) {
      return resolveInstance(operation.instance || operation.uart || operation.handle || operation.peripheral || "UART");
    }

    function operationI2cInstance(operation) {
      return resolveI2cInstance(operation.instance || operation.i2c || operation.handle || operation.peripheral || "I2C");
    }

    function operationSpiInstance(operation) {
      return resolveSpiInstance(operation.instance || operation.spi || operation.handle || operation.peripheral || "SPI");
    }

    function operationAdcInstance(operation) {
      return resolveAdcInstance(operation.instance || operation.adc || operation.handle || operation.peripheral || "ADC");
    }

    function pwmChannelNumber(operation) {
      var direct = Number(evaluate(firstDefined(operation, ["channel", "channelNumber"], NaN)));
      if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
      var match = String(firstDefined(operation, ["channelExpression", "channelName"], "")).match(/(?:CHANNEL_|CH)?(\d+)/i);
      return match ? Number(match[1]) : 1;
    }

    function updatePwm(operation, changes) {
      var descriptor = timerDescriptor(firstDefined(operation, ["timer", "handle", "instance"], "TIM")) || {};
      var instance = descriptor.instance || resolveTimerInstance(firstDefined(operation, ["instance", "timer", "handle"], "TIM"));
      var channelNumber = pwmChannelNumber(operation);
      var key = instance + ":CH" + channelNumber;
      var previous = runtime.pwm[key] || {};
      var channel = Array.isArray(descriptor.channels) ? descriptor.channels.find(function (item) { return Number(item.channelNumber) === channelNumber; }) : null;
      var period = evaluatedNumber(firstDefined(operation, ["period", "autoReload"], descriptor.period), Number(descriptor.period));
      if (!Number.isFinite(period) || period < 0) period = 0;
      var compareFallback = previous.compare != null ? previous.compare : (firstDefined(operation, ["initialCompare"], channel && channel.pulse));
      var compare = changes && changes.compare !== undefined ? Number(changes.compare) : Number(compareFallback);
      if (!Number.isFinite(compare)) compare = 0;
      var active = changes && changes.active !== undefined ? Boolean(changes.active) : Boolean(previous.active);
      var dutyCycle = active && period >= 0 ? Math.max(0, Math.min(1, compare / Math.max(1, period + 1))) : 0;
      var frequencyHz = evaluatedNumber(firstDefined(operation, ["frequencyHz"], descriptor.frequencyHz), Number(descriptor.frequencyHz));
      var event = {
        key: key,
        timer: descriptor.handle || operation.timer || operation.handle || "",
        handle: descriptor.handle || operation.timer || operation.handle || "",
        instance: instance,
        channel: channelNumber,
        channelName: "CH" + channelNumber,
        channelExpression: operation.channelExpression || "TIM_CHANNEL_" + channelNumber,
        pin: operation.pin || channel && channel.pin || "",
        active: active,
        compare: compare,
        period: period,
        dutyCycle: dutyCycle,
        dutyPercent: dutyCycle * 100,
        frequencyHz: Number.isFinite(frequencyHz) ? frequencyHz : null,
        time: runtime.time,
        timeMs: runtime.time
      };
      runtime.pwm[key] = cloneValue(event);
      callHook("onPwm", cloneValue(event));
      return event;
    }

    function operationLength(operation) {
      var raw = firstDefined(operation, ["length", "size", "count"], undefined);
      if (raw === undefined) return 0;
      var value = evaluate(raw);
      if (value == null) return null;
      var length = Math.trunc(Number(value));
      return Number.isFinite(length) && length >= 0 ? length : null;
    }

    function receiveTarget(operation) {
      return firstDefined(operation, ["target", "buffer", "destination", "variable"], "rx_data");
    }

    function receiveTimeout(operation) {
      var raw = firstDefined(operation, ["timeout", "timeoutMs"], { type: "constant", name: "HAL_MAX_DELAY" });
      var value = Number(evaluate(raw));
      if (!Number.isFinite(value) || value >= MAX_DELAY_VALUE) return Infinity;
      return Math.max(0, value);
    }

    function setOperationResult(operation, value) {
      var target = firstDefined(operation, ["result", "resultTarget", "statusTarget"], null);
      if (target) assign(target, value);
    }

    function writeReceiveBuffer(target, bytes) {
      if (typeof target === "string") {
        if (bytes.length === 1 && hasOwn(runtime.variables, target) && !Array.isArray(runtime.variables[target])) {
          runtime.variables[target] = coerceCValue(target, bytes[0]);
          return;
        }
        var existing = Array.isArray(runtime.variables[target]) ? runtime.variables[target].slice() : [];
        bytes.forEach(function (byte, index) { existing[index] = byte; });
        runtime.variables[target] = existing;
        return;
      }
      assign(target, bytes.slice());
    }

    function tryUartReceive(operation) {
      var instance = operationInstance(operation);
      var length = operationLength(operation);
      if (length == null) return false;
      var queue = uartQueue(instance);
      if (queue.length < length) return false;
      var received = queue.splice(0, length);
      writeReceiveBuffer(receiveTarget(operation), received);
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
      runtime.blocked = null;
      runtime.pc += 1;
      return true;
    }

    function portPrefix(rawPort) {
      var value = rawPort && typeof rawPort === "object" ? evaluate(rawPort) : rawPort;
      value = resolveAlias(value, pinAliases);
      var name = String(value == null ? "" : value).trim().replace(/^&/, "").toUpperCase();
      var match = name.match(/^GPIO([A-G])$/) || name.match(/^P([A-G])$/) || name.match(/^([A-G])$/);
      return match ? "P" + match[1] : "";
    }

    function physicalPin(value) {
      value = resolveAlias(value, pinAliases);
      if (value && typeof value === "object") {
        if (value.physicalPin || value.name) return physicalPin(value.physicalPin || value.name);
        var prefix = portPrefix(value.port);
        var index = firstDefined(value, ["index", "pinIndex"], null);
        if (prefix && index != null) return prefix + Math.trunc(Number(index));
      }
      var name = String(value == null ? "" : value).trim().toUpperCase().replace(/[_.-]/g, "");
      var match = name.match(/^P([A-G])(1[0-5]|[0-9])$/) || name.match(/^GPIO([A-G])(1[0-5]|[0-9])$/);
      return match ? "P" + match[1] + Number(match[2]) : "";
    }

    function resolvePinTargets(operation) {
      var direct = firstDefined(operation, ["physicalPin", "pinName", "targetPin"], null);
      if (direct != null) {
        var resolvedDirect = physicalPin(direct && typeof direct === "object" ? evaluate(direct) : direct);
        if (resolvedDirect) return [resolvedDirect];
      }

      var pinValue = firstDefined(operation, ["pin", "pinMask", "mask"], null);
      if (pinValue != null && typeof pinValue === "string") {
        var resolvedAliasPin = physicalPin(pinValue);
        if (resolvedAliasPin) return [resolvedAliasPin];
      }
      if (pinValue && typeof pinValue === "object" && !canonicalExpressionKind(pinValue)) {
        var objectPin = physicalPin(pinValue);
        if (objectPin) return [objectPin];
      }

      var prefix = portPrefix(firstDefined(operation, ["port", "gpioPort"], ""));
      if (!prefix) {
        var fallbackPin = physicalPin(pinValue && typeof pinValue === "object" ? evaluate(pinValue) : pinValue);
        return fallbackPin ? [fallbackPin] : [];
      }

      if (operation.pinIndex != null) return [prefix + Math.trunc(Number(evaluate(operation.pinIndex)))];
      var mask = Number(evaluate(pinValue));
      if (!Number.isFinite(mask)) return [];
      mask = Math.trunc(mask) >>> 0;
      var pins = [];
      for (var index = 0; index <= 15; index += 1) if ((mask & Math.pow(2, index)) !== 0) pins.push(prefix + index);
      return pins;
    }

    function logicValue(value) {
      value = evaluate(value);
      if (typeof value === "string") {
        var normalized = value.trim().toUpperCase();
        if (["GPIO_PIN_SET", "SET", "HIGH", "ON", "TRUE", "1"].indexOf(normalized) >= 0) return 1;
        if (["GPIO_PIN_RESET", "RESET", "LOW", "OFF", "FALSE", "0"].indexOf(normalized) >= 0) return 0;
      }
      return value ? 1 : 0;
    }

    function emitGpio(pin, value) {
      var previous = hasOwn(runtime.gpio, pin) ? runtime.gpio[pin] : 0;
      runtime.gpio[pin] = value;
      callHook("onGpio", { pin: pin, value: value, previous: previous, time: runtime.time, timeMs: runtime.time });
    }

    function operationBytes(operation) {
      // hal_model reserves `source` for source-code location metadata and emits
      // the actual HAL buffer as `buffer`. Keep `source` last for legacy IR.
      var source = firstDefined(operation, ["buffer", "data", "value", "source"], []);
      var value = typeof source === "string" && hasOwn(runtime.variables, source) ? runtime.variables[source] : evaluate(source);
      var bytes = byteArray(value);
      var lengthValue = firstDefined(operation, ["length", "size", "count"], null);
      if (lengthValue !== null && lengthValue !== undefined) {
        var length = operationLength(operation);
        if (length == null) throw new Error("Transfer length is unresolved");
        bytes = bytes.slice(0, length);
      }
      return bytes;
    }

    function transmit(operation) {
      var instance = operationInstance(operation);
      var bytes = operationBytes(operation);
      var event = {
        instance: instance,
        text: bytesToText(bytes),
        bytes: bytes.slice(),
        dma: Boolean(operation.dma),
        interrupt: Boolean(operation.interrupt),
        dmaHandle: operation.dmaHandle || null,
        dmaInstance: operation.dmaInstance || null,
        transferId: operation.transferId || null,
        interruptId: operation.interruptId || null,
        durationMs: evaluatedNumber(operation.durationMs, 0),
        time: runtime.time,
        timeMs: runtime.time
      };
      runtime.uartTxCount += 1;
      appendBoundedHistory(runtime.uartTx, event);
      callHook("onUartTx", cloneValue(event));
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function evaluatedNumber(value, fallback) {
      if (value == null) return fallback;
      var evaluated = value && typeof value === "object" ? evaluate(value) : value;
      var numeric = Number(evaluated);
      return Number.isFinite(numeric) ? numeric : fallback;
    }

    function transmitI2c(operation, memoryWrite) {
      var instance = operationI2cInstance(operation);
      var bytes = operationBytes(operation);
      var deviceAddress = evaluatedNumber(firstDefined(operation, ["deviceAddress", "address", "slaveAddress"], null), null);
      var event = {
        kind: memoryWrite ? "memWrite" : "masterTransmit",
        instance: instance,
        i2c: firstDefined(operation, ["i2c", "handle"], instance),
        handle: firstDefined(operation, ["i2c", "handle"], ""),
        deviceAddress: deviceAddress,
        address: deviceAddress,
        bytes: bytes.slice(),
        length: bytes.length,
        timeout: evaluatedNumber(firstDefined(operation, ["timeout", "timeoutMs"], null), null),
        time: runtime.time,
        timeMs: runtime.time
      };
      if (memoryWrite) {
        event.memoryAddress = evaluatedNumber(firstDefined(operation, ["memoryAddress", "memAddress", "register"], null), null);
        event.memoryAddressSize = evaluatedNumber(firstDefined(operation, ["memoryAddressSize", "memAddressSize", "addressSize"], null), null);
      }
      var response = callHook("onI2cTx", cloneValue(event));
      var accepted = !(response && response.accepted === false);
      event.accepted = accepted;
      if (response !== undefined) event.response = cloneValue(response);
      runtime.i2cTxCount += 1;
      appendBoundedHistory(runtime.i2cTx, event);
      setOperationResult(operation, accepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR);
      return accepted;
    }

    function transmitSpi(operation) {
      var instance = operationSpiInstance(operation);
      var bytes = operationBytes(operation);
      var event = {
        kind: "transmit",
        instance: instance,
        spi: firstDefined(operation, ["spi", "handle"], instance),
        handle: firstDefined(operation, ["spi", "handle"], ""),
        bytes: bytes.slice(),
        length: bytes.length,
        timeout: evaluatedNumber(firstDefined(operation, ["timeout", "timeoutMs"], null), null),
        time: runtime.time,
        timeMs: runtime.time
      };
      var response = callHook("onSpiTx", cloneValue(event));
      var accepted = !(response && response.accepted === false);
      event.accepted = accepted;
      if (response !== undefined) event.response = cloneValue(response);
      runtime.spiTxCount += 1;
      appendBoundedHistory(runtime.spiTx, event);
      setOperationResult(operation, accepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR);
      return accepted;
    }

    function adcState(instance) {
      if (!hasOwn(runtime.adc, instance)) runtime.adc[instance] = { started: false, ready: false, value: 0, voltage: null, samples: 0 };
      return runtime.adc[instance];
    }

    function startAdc(operation) {
      var instance = operationAdcInstance(operation);
      var state = adcState(instance);
      state.started = true;
      state.ready = false;
      callHook("onAdcStart", { instance: instance, adc: firstDefined(operation, ["adc", "handle"], instance), time: runtime.time, timeMs: runtime.time });
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function pollAdc(operation) {
      var instance = operationAdcInstance(operation);
      var state = adcState(instance);
      var status = state.started ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR;
      state.ready = state.started;
      callHook("onAdcPoll", {
        instance: instance,
        adc: firstDefined(operation, ["adc", "handle"], instance),
        ready: state.ready,
        timeout: evaluatedNumber(firstDefined(operation, ["timeout", "timeoutMs"], null), null),
        time: runtime.time,
        timeMs: runtime.time
      });
      setOperationResult(operation, status);
      return status;
    }

    function readAdc(operation) {
      var instance = operationAdcInstance(operation);
      var state = adcState(instance);
      var sample;
      var value;
      if (state.interruptValueReady) {
        sample = state.interruptSample;
        value = state.value;
        state.interruptValueReady = false;
      } else {
        sample = callHook("onAdcRead", {
          instance: instance,
          adc: firstDefined(operation, ["adc", "handle"], instance),
          started: state.started,
          ready: state.ready,
          time: runtime.time,
          timeMs: runtime.time
        });
        value = sample && typeof sample === "object" ? firstDefined(sample, ["value", "raw"], null) : sample;
        value = Number(value);
        if (!Number.isFinite(value)) value = 0;
        value = Math.max(0, Math.round(value));
        state.value = value;
        state.voltage = sample && typeof sample === "object" && Number.isFinite(Number(sample.voltage)) ? Number(sample.voltage) : null;
        state.samples += 1;
      }
      state.ready = false;
      var target = firstDefined(operation, ["target", "destination", "variable", "resultTarget"], null);
      if (target) assign(target, value);
      callHook("onAdcValue", {
        instance: instance,
        value: value,
        voltage: state.voltage,
        sample: cloneValue(sample),
        time: runtime.time,
        timeMs: runtime.time
      });
    }

    function dmaHistory(event) {
      appendBoundedHistory(runtime.dma.history, event);
      callHook("onDma", cloneValue(event));
    }

    function pruneDmaTransfers() {
      var completed = runtime.dma.transfers.filter(function (transfer) { return !transfer.active && !transfer.processing; });
      var recentCompleted = new Set(completed.slice(-MAX_DMA_TRANSFER_RECORDS));
      var retained = runtime.dma.transfers.filter(function (transfer) {
        return transfer.active || transfer.processing || recentCompleted.has(transfer);
      });
      runtime.dma.transfers.splice.apply(runtime.dma.transfers, [0, runtime.dma.transfers.length].concat(retained));
    }

    function activeDmaTransfer(type, instance) {
      return runtime.dma.transfers.find(function (transfer) {
        return transfer.active && transfer.type === type && transfer.instance === instance;
      }) || null;
    }

    function rejectBusyDma(operation, type, instance) {
      var active = activeDmaTransfer(type, instance) || activeInterruptEvent(type, instance);
      if (!active) return false;
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_BUSY);
      dmaHistory({
        type: type,
        phase: "busy",
        id: active.id,
        key: active.key,
        instance: instance,
        dmaHandle: active.dmaHandle,
        dmaInstance: active.dmaInstance,
        time: runtime.time,
        timeMs: runtime.time
      });
      return true;
    }

    function dmaTransferKey(kind, instance) {
      return String(kind || "DMA") + ":" + String(instance || "");
    }

    function cancelDmaTransfers(predicate, time, reason) {
      var cancelled = 0;
      runtime.dma.transfers.forEach(function (transfer) {
        if (!transfer.active || !predicate(transfer)) return;
        transfer.active = false;
        transfer.cancelled = true;
        transfer.cancelReason = reason || "stopped";
        transfer.stoppedAt = time;
        cancelled += 1;
        dmaHistory({
          type: transfer.type,
          phase: "stopped",
          id: transfer.id,
          key: transfer.key,
          instance: transfer.instance,
          dmaHandle: transfer.dmaHandle,
          dmaInstance: transfer.dmaInstance,
          reason: transfer.cancelReason,
          time: time,
          timeMs: time
        });
      });
      pruneDmaTransfers();
      return cancelled;
    }

    function callbackSharedStore() {
      return {
        variables: runtime.variables,
        gpio: runtime.gpio,
        uartRx: runtime.uartRx,
        adc: runtime.adc,
        dma: runtime.dma,
        interrupts: runtime.interrupts,
        pwm: runtime.pwm,
        peripherals: runtime.peripherals,
        heap: runtime.heap,
        stdio: runtime.stdio,
        randomState: runtime.randomState
      };
    }

    function runFirmwareCallback(name, event, bindings, hookKind) {
      var callbacks = model.callbacks && typeof model.callbacks === "object" ? model.callbacks : {};
      var descriptor = callbacks[name];
      event = Object.assign({ callback: name, time: runtime.time, timeMs: runtime.time }, event || {});
      hookKind = hookKind || "Interrupt";
      callHook("on" + hookKind + "Callback", cloneValue(event));
      if (!descriptor || !Array.isArray(descriptor.operations) || !descriptor.operations.length) return event;

      var callbackHooks = Object.assign({}, hooks, {
        onState: null,
        onUartTx: function (payload) {
          runtime.uartTxCount += 1;
          appendBoundedHistory(runtime.uartTx, payload);
          return callHook("onUartTx", payload);
        },
        onI2cTx: function (payload) {
          runtime.i2cTxCount += 1;
          appendBoundedHistory(runtime.i2cTx, payload);
          return callHook("onI2cTx", payload);
        },
        onSpiTx: function (payload) {
          runtime.spiTxCount += 1;
          appendBoundedHistory(runtime.spiTx, payload);
          return callHook("onSpiTx", payload);
        }
      });
      var callbackModel = Object.assign({}, model, {
        callbacks: {},
        middlewares: null,
        program: Object.assign({}, model.program || {}, {
          entry: name,
          operations: descriptor.operations
        })
      });
      bindings = Object.assign({}, bindings || {});
      var bindingKey = ["hadc", "huart", "htim", "GPIO_Pin"].find(function (name) { return hasOwn(bindings, name); }) || Object.keys(bindings)[0];
      (Array.isArray(descriptor.parameters) ? descriptor.parameters : []).forEach(function (parameterName) {
        if (!hasOwn(bindings, parameterName) && bindingKey) bindings[parameterName] = bindings[bindingKey];
      });
      var previousBindings = {};
      Object.keys(bindings).forEach(function (bindingName) {
        previousBindings[bindingName] = {
          present: hasOwn(runtime.variables, bindingName),
          value: runtime.variables[bindingName]
        };
        runtime.variables[bindingName] = bindings[bindingName];
      });
      var callbackRuntime = create(callbackModel, callbackHooks, { sharedStore: callbackSharedStore() });
      callbackRuntime.advanceTimeTo(event.timeMs);
      callbackRuntime.start();
      var callbackState = callbackRuntime.step(0);
      Object.keys(previousBindings).forEach(function (bindingName) {
        if (previousBindings[bindingName].present) runtime.variables[bindingName] = previousBindings[bindingName].value;
        else delete runtime.variables[bindingName];
      });
      event.status = callbackState.status;
      event.operationsExecuted = callbackState.operationsExecuted;
      if (callbackState.error) event.error = cloneValue(callbackState.error);
      callHook("on" + hookKind + "CallbackComplete", cloneValue(event));
      return event;
    }

    function peripheralCallbackBindings(parameterName, transfer) {
      var handleName = String(transfer.handle || "").replace(/^&/, "");
      var instanceName = String(transfer.instance || "");
      var callbackHandle = { Instance: transfer.instance, handle: transfer.handle };
      var bindings = {};
      bindings[parameterName] = callbackHandle;
      if (handleName) bindings[handleName] = callbackHandle;
      if (instanceName) bindings[instanceName] = instanceName;
      return bindings;
    }

    function runDmaCallback(name, transfer, phase, eventTime) {
      return runFirmwareCallback(name, {
        phase: phase,
        type: transfer.type,
        id: transfer.id,
        key: transfer.key,
        instance: transfer.instance,
        handle: transfer.handle,
        dmaHandle: transfer.dmaHandle,
        dmaInstance: transfer.dmaInstance,
        buffer: transfer.buffer,
        length: transfer.length,
        circular: transfer.circular,
        cycle: transfer.cycle,
        time: eventTime,
        timeMs: eventTime
      }, peripheralCallbackBindings(transfer.type === "adc" ? "hadc" : "huart", transfer), "Dma");
    }

    function dmaCallbackName(transfer, phase) {
      if (transfer.type === "adc") return phase === "half" ? "HAL_ADC_ConvHalfCpltCallback" : "HAL_ADC_ConvCpltCallback";
      if (transfer.type === "uartTx") return phase === "half" ? "HAL_UART_TxHalfCpltCallback" : "HAL_UART_TxCpltCallback";
      if (transfer.type === "uartRx") return phase === "half" ? "HAL_UART_RxHalfCpltCallback" : "HAL_UART_RxCpltCallback";
      return "";
    }

    function dmaPhaseEvent(transfer, phase, eventTime) {
      var event = {
        type: transfer.type,
        phase: phase,
        id: transfer.id,
        key: transfer.key,
        instance: transfer.instance,
        handle: transfer.handle,
        dmaHandle: transfer.dmaHandle,
        dmaInstance: transfer.dmaInstance,
        buffer: transfer.buffer,
        length: transfer.length,
        transferred: transfer.transferred,
        circular: transfer.circular,
        cycle: transfer.cycle,
        time: eventTime,
        timeMs: eventTime
      };
      dmaHistory(event);
      var callbackName = dmaCallbackName(transfer, phase);
      if (callbackName) runDmaCallback(callbackName, transfer, phase, eventTime);
    }

    function dmaWriteArray(buffer, index, value) {
      var array = Array.isArray(runtime.variables[buffer]) ? runtime.variables[buffer] : [];
      array[index] = Math.max(0, Math.round(Number(value) || 0));
      runtime.variables[buffer] = array;
    }

    function sampleAdcDma(transfer, startIndex, endIndex, eventTime) {
      var descriptor = adcDescriptor(transfer.handle) || {};
      var channels = Array.isArray(descriptor.channels) ? descriptor.channels : [];
      var state = adcState(transfer.instance);
      for (var index = startIndex; index < endIndex; index += 1) {
        var channelIndex = channels.length ? index % channels.length : 0;
        var sample = callHook("onAdcRead", {
          instance: transfer.instance,
          adc: transfer.handle,
          started: true,
          ready: true,
          dma: true,
          transferId: transfer.id,
          sampleIndex: index,
          channelIndex: channelIndex,
          channel: channels[channelIndex] || null,
          time: eventTime,
          timeMs: eventTime
        });
        var value = sample && typeof sample === "object" ? firstDefined(sample, ["value", "raw"], null) : sample;
        value = Math.max(0, Math.round(Number(value) || 0));
        dmaWriteArray(transfer.buffer, index, value);
        state.value = value;
        state.voltage = sample && typeof sample === "object" && Number.isFinite(Number(sample.voltage)) ? Number(sample.voltage) : null;
        state.samples += 1;
        callHook("onAdcValue", {
          instance: transfer.instance,
          value: value,
          voltage: state.voltage,
          sample: cloneValue(sample),
          dma: true,
          transferId: transfer.id,
          sampleIndex: index,
          channelIndex: channelIndex,
          time: eventTime,
          timeMs: eventTime
        });
      }
      transfer.transferred = endIndex;
    }

    function completeDmaPhase(transfer, phase, eventTime) {
      if (!transfer.active) return;
      if (transfer.type === "adc") {
        var midpoint = transfer.halfLength;
        if (phase === "half") sampleAdcDma(transfer, 0, midpoint, eventTime);
        else sampleAdcDma(transfer, midpoint, transfer.length, eventTime);
      }
      if (phase === "half") {
        transfer.halfFired = true;
        if (transfer.type !== "adc") transfer.transferred = transfer.halfLength;
        transfer.processing = true;
        dmaPhaseEvent(transfer, "half", eventTime);
        transfer.processing = false;
        return;
      }

      transfer.transferred = transfer.length;
      transfer.processing = true;
      dmaPhaseEvent(transfer, "complete", eventTime);
      transfer.processing = false;
      if (transfer.circular) {
        transfer.cycle += 1;
        transfer.transferred = 0;
        transfer.halfFired = false;
        transfer.startedAt = transfer.completeAt;
        transfer.halfAt = transfer.length > 1 ? transfer.startedAt + transfer.durationMs * transfer.halfLength / transfer.length : null;
        transfer.completeAt = transfer.startedAt + transfer.durationMs;
      } else {
        transfer.active = false;
        if (transfer.type === "adc") adcState(transfer.instance).dmaActive = false;
      }
      pruneDmaTransfers();
    }

    function interruptHistory(event) {
      appendBoundedHistory(runtime.interrupts.history, event);
      callHook("onInterrupt", cloneValue(event));
    }

    function pruneInterruptEvents() {
      var completed = runtime.interrupts.events.filter(function (event) { return !event.active && !event.processing; });
      var recentCompleted = new Set(completed.slice(-MAX_INTERRUPT_EVENT_RECORDS));
      var retained = runtime.interrupts.events.filter(function (event) {
        return event.active || event.processing || recentCompleted.has(event);
      });
      runtime.interrupts.events.splice.apply(runtime.interrupts.events, [0, runtime.interrupts.events.length].concat(retained));
    }

    function activeInterruptEvent(type, instance) {
      return runtime.interrupts.events.find(function (event) {
        return event.active && event.type === type && event.instance === instance;
      }) || null;
    }

    function cancelInterruptEvents(predicate, eventTime, reason) {
      var cancelled = 0;
      runtime.interrupts.events.forEach(function (event) {
        if (!event.active || !predicate(event)) return;
        event.active = false;
        event.cancelReason = reason || "stopped";
        cancelled += 1;
        interruptHistory({
          type: event.type,
          phase: "stopped",
          id: event.id,
          key: event.key,
          instance: event.instance,
          handle: event.handle,
          reason: event.cancelReason,
          time: eventTime,
          timeMs: eventTime
        });
      });
      pruneInterruptEvents();
      return cancelled;
    }

    function interruptBusy(type, instance) {
      if (activeInterruptEvent(type, instance)) return true;
      var dmaType = type === "adc" ? "adc" : type === "uartTx" ? "uartTx" : type === "uartRx" ? "uartRx" : "";
      return dmaType ? Boolean(activeDmaTransfer(dmaType, instance)) : false;
    }

    function startInterruptEvent(type, instance, handle, dueAt, details) {
      var event = Object.assign({
        id: "irq-" + (++runtime.interrupts.sequence),
        key: type + ":" + instance,
        type: type,
        instance: instance,
        handle: handle,
        active: true,
        processing: false,
        startedAt: runtime.time,
        dueAt: dueAt
      }, details || {});
      runtime.interrupts.events.push(event);
      pruneInterruptEvents();
      interruptHistory({
        type: type,
        phase: "started",
        id: event.id,
        key: event.key,
        instance: instance,
        handle: handle,
        dueAt: dueAt,
        periodMs: event.periodMs == null ? null : event.periodMs,
        time: runtime.time,
        timeMs: runtime.time
      });
      return event;
    }

    function sampleAdcInterrupt(event, eventTime) {
      var descriptor = adcDescriptor(event.handle) || {};
      var channels = Array.isArray(descriptor.channels) ? descriptor.channels : [];
      var channel = channels[0] || null;
      var sample = callHook("onAdcRead", {
        instance: event.instance,
        adc: event.handle,
        started: true,
        ready: true,
        interrupt: true,
        interruptId: event.id,
        channelIndex: 0,
        channel: channel,
        time: eventTime,
        timeMs: eventTime
      });
      var value = sample && typeof sample === "object" ? firstDefined(sample, ["value", "raw"], null) : sample;
      value = Math.max(0, Math.round(Number(value) || 0));
      var state = adcState(event.instance);
      state.value = value;
      state.voltage = sample && typeof sample === "object" && Number.isFinite(Number(sample.voltage)) ? Number(sample.voltage) : null;
      state.ready = true;
      state.interruptValueReady = true;
      state.interruptSample = cloneValue(sample);
      state.samples += 1;
      callHook("onAdcValue", {
        instance: event.instance,
        value: value,
        voltage: state.voltage,
        sample: cloneValue(sample),
        interrupt: true,
        interruptId: event.id,
        time: eventTime,
        timeMs: eventTime
      });
    }

    function interruptCallbackName(event) {
      if (event.type === "adc") return "HAL_ADC_ConvCpltCallback";
      if (event.type === "uartTx") return "HAL_UART_TxCpltCallback";
      if (event.type === "uartRx") return "HAL_UART_RxCpltCallback";
      if (event.type === "timer") return event.pwm ? "HAL_TIM_PWM_PulseFinishedCallback" : "HAL_TIM_PeriodElapsedCallback";
      return "";
    }

    function completeInterruptEvent(event, eventTime) {
      if (!event.active) return;
      event.processing = true;
      if (event.type === "adc") sampleAdcInterrupt(event, eventTime);
      var callbackName = interruptCallbackName(event);
      var parameterName = event.type === "adc" ? "hadc" : event.type.indexOf("uart") === 0 ? "huart" : "htim";
      interruptHistory({
        type: event.type,
        phase: "complete",
        callback: callbackName,
        id: event.id,
        key: event.key,
        instance: event.instance,
        handle: event.handle,
        time: eventTime,
        timeMs: eventTime
      });
      if (callbackName) {
        runFirmwareCallback(callbackName, {
          type: event.type,
          phase: "complete",
          id: event.id,
          key: event.key,
          instance: event.instance,
          handle: event.handle,
          time: eventTime,
          timeMs: eventTime
        }, peripheralCallbackBindings(parameterName, event), "Interrupt");
      }
      event.processing = false;
      if (event.periodic && event.periodMs > 0) {
        event.cycle = Number(event.cycle || 0) + 1;
        event.dueAt += event.periodMs;
      } else {
        event.active = false;
        if (event.type === "adc") adcState(event.instance).interruptActive = false;
      }
      pruneInterruptEvents();
    }

    function startAdcInterrupt(operation) {
      var instance = operationAdcInstance(operation);
      if (interruptBusy("adc", instance)) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_BUSY);
        return;
      }
      var handle = firstDefined(operation, ["adc", "handle"], instance);
      var descriptor = adcDescriptor(handle) || {};
      var samplePeriodMs = Math.max(0.001, evaluatedNumber(firstDefined(operation, ["samplePeriodMs"], descriptor.samplePeriodMs), 1));
      var event = startInterruptEvent("adc", instance, handle, runtime.time + samplePeriodMs, { durationMs: samplePeriodMs });
      var state = adcState(instance);
      state.started = true;
      state.ready = false;
      state.interruptActive = true;
      callHook("onAdcStart", { instance: instance, adc: handle, interrupt: true, interruptId: event.id, time: runtime.time, timeMs: runtime.time });
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function stopAdcInterrupt(operation) {
      var instance = operationAdcInstance(operation);
      cancelInterruptEvents(function (event) { return event.type === "adc" && event.instance === instance; }, runtime.time, "HAL_ADC_Stop_IT");
      var state = adcState(instance);
      state.started = false;
      state.ready = false;
      state.interruptActive = false;
      state.interruptValueReady = false;
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function startTimerInterrupt(operation) {
      var descriptor = timerDescriptor(firstDefined(operation, ["timer", "handle", "instance"], "TIM")) || {};
      var instance = descriptor.instance || resolveTimerInstance(firstDefined(operation, ["instance", "timer", "handle"], "TIM"));
      var handle = descriptor.handle || firstDefined(operation, ["timer", "handle"], instance);
      if (activeInterruptEvent("timer", instance)) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_BUSY);
        return;
      }
      var frequencyHz = evaluatedNumber(firstDefined(operation, ["frequencyHz"], descriptor.frequencyHz), Number(descriptor.frequencyHz));
      if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      var periodMs = 1000 / frequencyHz;
      startInterruptEvent("timer", instance, handle, runtime.time + periodMs, {
        periodMs: periodMs,
        periodic: true,
        cycle: 0,
        pwm: Boolean(operation.pwm)
      });
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function stopTimerInterrupt(operation) {
      var instance = resolveTimerInstance(firstDefined(operation, ["instance", "timer", "handle"], "TIM"));
      cancelInterruptEvents(function (event) { return event.type === "timer" && event.instance === instance; }, runtime.time, "HAL_TIM_Base_Stop_IT");
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function startUartTxInterrupt(operation) {
      var instance = operationInstance(operation);
      var length = operationLength(operation);
      if (length == null || length < 1) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      if (interruptBusy("uartTx", instance)) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_BUSY);
        return;
      }
      var handle = firstDefined(operation, ["uart", "handle"], instance);
      var descriptor = uartDescriptor(handle) || {};
      var baudRate = Math.max(1, Number(descriptor.baudRate) || 115200);
      var durationMs = Math.max(0.001, length * uartFrameBits(descriptor) * 1000 / baudRate);
      var event = startInterruptEvent("uartTx", instance, handle, runtime.time + durationMs, {
        buffer: firstDefined(operation, ["buffer", "source"], null),
        length: length,
        durationMs: durationMs
      });
      transmit(Object.assign({}, operation, { interrupt: true, interruptId: event.id, durationMs: durationMs }));
    }

    function startUartRxInterrupt(operation) {
      var instance = operationInstance(operation);
      var length = operationLength(operation);
      var buffer = firstDefined(operation, ["buffer", "target", "destination"], null);
      if (!buffer || length == null || length < 1) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      if (interruptBusy("uartRx", instance)) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_BUSY);
        return;
      }
      var event = startInterruptEvent("uartRx", instance, firstDefined(operation, ["uart", "handle"], instance), null, {
        buffer: buffer,
        length: length,
        transferred: 0
      });
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
      serviceUartRxInterrupt(instance, runtime.time);
      return event;
    }

    function serviceUartRxInterrupt(instance, eventTime) {
      runtime.interrupts.events.forEach(function (event) {
        if (!event.active || event.type !== "uartRx" || event.instance !== instance) return;
        var queue = uartQueue(instance);
        var needed = event.length - event.transferred;
        if (needed <= 0 || !queue.length) return;
        var received = queue.splice(0, Math.min(needed, queue.length));
        var array = Array.isArray(runtime.variables[event.buffer]) ? runtime.variables[event.buffer] : [];
        received.forEach(function (byte, offset) { array[event.transferred + offset] = byte; });
        runtime.variables[event.buffer] = array;
        event.transferred += received.length;
        if (event.transferred >= event.length) completeInterruptEvent(event, eventTime);
      });
    }

    function serviceAllUartRxInterrupts(eventTime) {
      var instances = new Set();
      runtime.interrupts.events.forEach(function (event) {
        if (event.active && event.type === "uartRx") instances.add(event.instance);
      });
      instances.forEach(function (instance) { serviceUartRxInterrupt(instance, eventTime); });
    }

    function abortUartInterrupt(operation) {
      var instance = operationInstance(operation);
      var direction = String(operation.direction || "both");
      cancelInterruptEvents(function (event) {
        return event.instance === instance && (direction === "both" || event.type === (direction === "tx" ? "uartTx" : "uartRx"));
      }, runtime.time, "HAL_UART_Abort_IT");
      var callbackName = direction === "tx" ? "HAL_UART_AbortTransmitCpltCallback" : direction === "rx" ? "HAL_UART_AbortReceiveCpltCallback" : "HAL_UART_AbortCpltCallback";
      var handle = firstDefined(operation, ["uart", "handle"], instance);
      runFirmwareCallback(callbackName, { type: "uartAbort", phase: "complete", instance: instance, handle: handle, time: runtime.time, timeMs: runtime.time }, peripheralCallbackBindings("huart", { instance: instance, handle: handle }), "Interrupt");
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function syncGpioInputs(levels) {
      levels = levels && typeof levels === "object" ? levels : {};
      var pins = model.pins && typeof model.pins === "object" ? model.pins : {};
      Object.keys(levels).forEach(function (rawPin) {
        var pin = physicalPin(rawPin);
        if (!pin || levels[rawPin] == null) return;
        var next = logicValue(levels[rawPin]);
        var hadPrevious = hasOwn(runtime.interrupts.gpioLevels, pin);
        var previous = hadPrevious ? runtime.interrupts.gpioLevels[pin] : next;
        runtime.interrupts.gpioLevels[pin] = next;
        if (!hadPrevious || previous === next) return;
        var descriptor = pins[pin] || {};
        var edge = String(descriptor.interruptEdge || "").toLowerCase();
        var triggered = edge === "both" || edge === "rising" && previous === 0 && next === 1 || edge === "falling" && previous === 1 && next === 0;
        if (!triggered) return;
        var pinNumber = Number((pin.match(/\d+$/) || [0])[0]);
        var pinMask = Math.pow(2, pinNumber);
        var event = {
          type: "gpioExti",
          phase: "edge",
          pin: pin,
          pinMask: pinMask,
          edge: previous === 0 ? "rising" : "falling",
          previous: previous,
          value: next,
          time: runtime.time,
          timeMs: runtime.time
        };
        interruptHistory(event);
        runFirmwareCallback("HAL_GPIO_EXTI_Callback", event, { GPIO_Pin: pinMask }, "Interrupt");
      });
      return snapshot();
    }

    function dmaHasFirmwareCallbacks(transfer) {
      var callbacks = model.callbacks && typeof model.callbacks === "object" ? model.callbacks : {};
      return [dmaCallbackName(transfer, "half"), dmaCallbackName(transfer, "complete")].some(function (name) {
        var descriptor = callbacks[name];
        return descriptor && Array.isArray(descriptor.operations) && descriptor.operations.length > 0;
      });
    }

    function nextTimedDmaTime(limit) {
      var selected = Infinity;
      runtime.dma.transfers.forEach(function (transfer) {
        if (!transfer.active || transfer.processing || transfer.type === "uartRx") return;
        var due = !transfer.halfFired && transfer.halfAt != null ? transfer.halfAt : transfer.completeAt;
        if (due != null && due <= limit + 1e-9 && due < selected) selected = due;
      });
      runtime.interrupts.events.forEach(function (event) {
        if (!event.active || event.processing || event.dueAt == null) return;
        if (event.dueAt <= limit + 1e-9 && event.dueAt < selected) selected = event.dueAt;
      });
      return Number.isFinite(selected) ? selected : null;
    }

    function processTimedDmaUntil(targetTime, eventBudget) {
      eventBudget = eventBudget || { remaining: MAX_DMA_EVENTS_PER_STEP };
      var processed = 0;
      var lastEventTime = null;
      while (eventBudget.remaining > 0) {
        var candidate = null;
        var candidatePhase = null;
        var interruptCandidate = null;
        var candidateTime = Infinity;
        runtime.dma.transfers.forEach(function (transfer) {
          if (!transfer.active || transfer.processing || transfer.type === "uartRx") return;
          var phase = !transfer.halfFired && transfer.halfAt != null ? "half" : "complete";
          var due = phase === "half" ? transfer.halfAt : transfer.completeAt;
          if (due != null && due <= targetTime + 1e-9 && due < candidateTime) {
            candidate = transfer;
            candidatePhase = phase;
            candidateTime = due;
          }
        });
        runtime.interrupts.events.forEach(function (event) {
          if (!event.active || event.processing || event.dueAt == null) return;
          if (event.dueAt <= targetTime + 1e-9 && event.dueAt < candidateTime) {
            candidate = null;
            interruptCandidate = event;
            candidateTime = event.dueAt;
          }
        });
        if (!candidate && !interruptCandidate) break;
        if (interruptCandidate) completeInterruptEvent(interruptCandidate, candidateTime);
        else completeDmaPhase(candidate, candidatePhase, candidateTime);
        processed += 1;
        eventBudget.remaining -= 1;
        lastEventTime = candidateTime;
      }
      if (eventBudget.remaining <= 0) {
        runtime.dma.transfers.forEach(function (transfer) {
          if (!transfer.active || !transfer.circular || transfer.type === "uartRx" || !(transfer.durationMs > 0) || dmaHasFirmwareCallbacks(transfer)) return;
          var due = !transfer.halfFired && transfer.halfAt != null ? transfer.halfAt : transfer.completeAt;
          if (due != null && due <= targetTime) {
            var skipped = Math.max(0, Math.floor((targetTime - transfer.startedAt) / transfer.durationMs));
            transfer.cycle += skipped;
            transfer.startedAt = targetTime;
            transfer.halfAt = transfer.length > 1 ? transfer.startedAt + transfer.durationMs * transfer.halfLength / transfer.length : null;
            transfer.completeAt = transfer.startedAt + transfer.durationMs;
            transfer.halfFired = false;
            transfer.transferred = 0;
            transfer.coalescedCycles = Number(transfer.coalescedCycles || 0) + skipped;
            if (transfer.type === "adc") {
              sampleAdcDma(transfer, 0, transfer.length, targetTime);
              transfer.transferred = 0;
            }
            dmaHistory({
              type: transfer.type,
              phase: "coalesced",
              id: transfer.id,
              key: transfer.key,
              instance: transfer.instance,
              dmaHandle: transfer.dmaHandle,
              dmaInstance: transfer.dmaInstance,
              skippedCycles: skipped,
              time: targetTime,
              timeMs: targetTime
            });
          }
        });
        runtime.interrupts.events.forEach(function (event) {
          if (!event.active || !event.periodic || !(event.periodMs > 0) || event.dueAt == null || event.dueAt > targetTime) return;
          var callbacks = model.callbacks && typeof model.callbacks === "object" ? model.callbacks : {};
          var callback = callbacks[interruptCallbackName(event)];
          if (callback && Array.isArray(callback.operations) && callback.operations.length) return;
          var skipped = Math.floor((targetTime - event.dueAt) / event.periodMs) + 1;
          event.cycle = Number(event.cycle || 0) + skipped;
          event.dueAt += skipped * event.periodMs;
          event.coalescedCycles = Number(event.coalescedCycles || 0) + skipped;
          interruptHistory({
            type: event.type,
            phase: "coalesced",
            id: event.id,
            key: event.key,
            instance: event.instance,
            skippedCycles: skipped,
            time: targetTime,
            timeMs: targetTime
          });
        });
      }
      return {
        processed: processed,
        lastEventTime: lastEventTime,
        limited: eventBudget.remaining <= 0 && nextTimedDmaTime(targetTime) != null,
        nextEventTime: nextTimedDmaTime(targetTime)
      };
    }

    function serviceUartRxDma(instance, eventTime) {
      runtime.dma.transfers.forEach(function (transfer) {
        if (!transfer.active || transfer.type !== "uartRx" || transfer.instance !== instance) return;
        var queue = uartQueue(instance);
        var guard = 0;
        while (queue.length && transfer.active && guard++ < 1024) {
          var needed = transfer.length - transfer.transferred;
          var count = Math.min(needed, queue.length);
          var received = queue.splice(0, count);
          var array = Array.isArray(runtime.variables[transfer.buffer]) ? runtime.variables[transfer.buffer] : [];
          received.forEach(function (byte, offset) { array[transfer.transferred + offset] = byte; });
          runtime.variables[transfer.buffer] = array;
          var previous = transfer.transferred;
          transfer.transferred += count;
          if (!transfer.halfFired && transfer.halfLength > 0 && previous < transfer.halfLength && transfer.transferred >= transfer.halfLength) {
            transfer.halfFired = true;
            dmaPhaseEvent(transfer, "half", eventTime);
          }
          if (transfer.transferred >= transfer.length) {
            dmaPhaseEvent(transfer, "complete", eventTime);
            if (transfer.circular) {
              transfer.cycle += 1;
              transfer.transferred = 0;
              transfer.halfFired = false;
              transfer.startedAt = eventTime;
            } else transfer.active = false;
          }
        }
      });
      pruneDmaTransfers();
    }

    function serviceAllUartRxDma(eventTime) {
      var instances = new Set();
      runtime.dma.transfers.forEach(function (transfer) {
        if (transfer.active && transfer.type === "uartRx") instances.add(transfer.instance);
      });
      instances.forEach(function (instance) { serviceUartRxDma(instance, eventTime); });
    }

    function startAdcDma(operation) {
      var instance = operationAdcInstance(operation);
      var length = operationLength(operation);
      var buffer = firstDefined(operation, ["buffer", "target", "destination"], null);
      if (!buffer || length == null || length < 1) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      if (rejectBusyDma(operation, "adc", instance)) return;
      var descriptor = adcDescriptor(firstDefined(operation, ["adc", "handle"], instance)) || {};
      var samplePeriodMs = Math.max(0.001, evaluatedNumber(firstDefined(operation, ["samplePeriodMs"], descriptor.samplePeriodMs), 1));
      var durationMs = Math.max(samplePeriodMs, samplePeriodMs * length);
      var transfer = {
        id: "dma-" + (++runtime.dma.sequence),
        key: dmaTransferKey("adc", instance),
        type: "adc",
        instance: instance,
        handle: firstDefined(operation, ["adc", "handle"], instance),
        dmaHandle: operation.dmaHandle || descriptor.dmaHandle || null,
        dmaInstance: operation.dmaInstance || resolveDmaInstance(operation.dmaHandle || descriptor.dmaHandle || "DMA"),
        buffer: buffer,
        length: length,
        halfLength: Math.floor(length / 2),
        transferred: 0,
        active: true,
        circular: Boolean(operation.circular),
        cycle: 0,
        halfFired: false,
        startedAt: runtime.time,
        durationMs: durationMs,
        halfAt: length > 1 ? runtime.time + durationMs * Math.floor(length / 2) / length : null,
        completeAt: runtime.time + durationMs
      };
      runtime.dma.transfers.push(transfer);
      pruneDmaTransfers();
      var state = adcState(instance);
      state.started = true;
      state.ready = false;
      state.dmaActive = true;
      dmaHistory({ type: "adc", phase: "started", id: transfer.id, key: transfer.key, instance: instance, dmaHandle: transfer.dmaHandle, dmaInstance: transfer.dmaInstance, buffer: buffer, length: length, circular: transfer.circular, durationMs: durationMs, time: runtime.time, timeMs: runtime.time });
      callHook("onAdcStart", { instance: instance, adc: transfer.handle, dma: true, transferId: transfer.id, buffer: buffer, length: length, circular: transfer.circular, time: runtime.time, timeMs: runtime.time });
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function stopAdcDma(operation) {
      var instance = operationAdcInstance(operation);
      cancelDmaTransfers(function (item) { return item.type === "adc" && item.instance === instance; }, runtime.time, "HAL_ADC_Stop_DMA");
      var state = adcState(instance);
      state.started = false;
      state.ready = false;
      state.dmaActive = false;
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function uartFrameBits(descriptor) {
      descriptor = descriptor || {};
      var frame = descriptor.frame || {};
      var dataBits = Math.max(5, Number(frame.dataBits) || 8);
      var stopBits = Math.max(1, Number(frame.stopBits) || 1);
      var parityBits = String(frame.parity || "none").toLowerCase() === "none" ? 0 : 1;
      return 1 + dataBits + parityBits + stopBits;
    }

    function startUartTxDma(operation) {
      var instance = operationInstance(operation);
      var length = operationLength(operation);
      if (length == null || length < 1) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      if (rejectBusyDma(operation, "uartTx", instance)) return;
      var descriptor = uartDescriptor(firstDefined(operation, ["uart", "handle"], instance)) || {};
      var baudRate = Math.max(1, Number(descriptor.baudRate) || 115200);
      var durationMs = Math.max(0.001, length * uartFrameBits(descriptor) * 1000 / baudRate);
      var transfer = {
        id: "dma-" + (++runtime.dma.sequence),
        key: dmaTransferKey("uartTx", instance),
        type: "uartTx",
        instance: instance,
        handle: firstDefined(operation, ["uart", "handle"], instance),
        dmaHandle: operation.dmaHandle || descriptor.txDmaHandle || null,
        dmaInstance: operation.dmaInstance || resolveDmaInstance(operation.dmaHandle || descriptor.txDmaHandle || "DMA"),
        buffer: firstDefined(operation, ["buffer", "source"], null),
        length: length,
        halfLength: Math.floor(length / 2),
        transferred: 0,
        active: true,
        circular: false,
        cycle: 0,
        halfFired: false,
        startedAt: runtime.time,
        durationMs: durationMs,
        halfAt: length > 1 ? runtime.time + durationMs * Math.floor(length / 2) / length : null,
        completeAt: runtime.time + durationMs
      };
      runtime.dma.transfers.push(transfer);
      pruneDmaTransfers();
      transmit(Object.assign({}, operation, { dma: true, transferId: transfer.id, durationMs: durationMs }));
      dmaHistory({ type: "uartTx", phase: "started", id: transfer.id, key: transfer.key, instance: instance, dmaHandle: transfer.dmaHandle, dmaInstance: transfer.dmaInstance, buffer: transfer.buffer, length: length, durationMs: durationMs, time: runtime.time, timeMs: runtime.time });
    }

    function startUartRxDma(operation) {
      var instance = operationInstance(operation);
      var length = operationLength(operation);
      var buffer = firstDefined(operation, ["buffer", "target", "destination"], null);
      if (!buffer || length == null || length < 1) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      if (rejectBusyDma(operation, "uartRx", instance)) return;
      var descriptor = uartDescriptor(firstDefined(operation, ["uart", "handle"], instance)) || {};
      var transfer = {
        id: "dma-" + (++runtime.dma.sequence),
        key: dmaTransferKey("uartRx", instance),
        type: "uartRx",
        instance: instance,
        handle: firstDefined(operation, ["uart", "handle"], instance),
        dmaHandle: operation.dmaHandle || descriptor.rxDmaHandle || null,
        dmaInstance: operation.dmaInstance || resolveDmaInstance(operation.dmaHandle || descriptor.rxDmaHandle || "DMA"),
        buffer: buffer,
        length: length,
        halfLength: Math.floor(length / 2),
        transferred: 0,
        active: true,
        circular: Boolean(operation.circular),
        cycle: 0,
        halfFired: false,
        startedAt: runtime.time,
        durationMs: null,
        halfAt: null,
        completeAt: null
      };
      runtime.dma.transfers.push(transfer);
      pruneDmaTransfers();
      dmaHistory({ type: "uartRx", phase: "started", id: transfer.id, key: transfer.key, instance: instance, dmaHandle: transfer.dmaHandle, dmaInstance: transfer.dmaInstance, buffer: buffer, length: length, circular: transfer.circular, time: runtime.time, timeMs: runtime.time });
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
      serviceUartRxDma(instance, runtime.time);
    }

    function stopUartDma(operation) {
      var instance = operationInstance(operation);
      cancelDmaTransfers(function (item) { return (item.type === "uartTx" || item.type === "uartRx") && item.instance === instance; }, runtime.time, "HAL_UART_DMAStop");
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function aliceContextName(operation, fallback) {
      var name = firstDefined(operation, ["context", "device", "handle"], fallback);
      if (name && typeof name === "object") name = firstDefined(name, ["name", "variable", "value"], fallback);
      return String(name || fallback).replace(/^&/, "");
    }

    function aliceNumber(value, fallback) {
      var evaluated = value && typeof value === "object" ? evaluate(value) : value;
      var numeric = Number(evaluated);
      return Number.isFinite(numeric) ? numeric : fallback;
    }

    function aliceOledContext(operation, createIfMissing) {
      var name = aliceContextName(operation, "display");
      var contexts = runtime.peripherals.oled;
      if (!hasOwn(contexts, name) && createIfMissing !== false) {
        contexts[name] = {
          name: name,
          i2c: firstDefined(operation, ["i2c", "handle"], "hi2c1"),
          instance: operationI2cInstance(operation),
          address7Bit: 0x3c,
          halAddress: 0x78,
          timeout: MAX_DELAY_VALUE,
          framebuffer: new Array(ALICE_OLED_BUFFER_SIZE).fill(0),
          initialized: false,
          displayOn: false,
          inverse: false,
          dirty: false
        };
      }
      return contexts[name] || null;
    }

    function aliceOledTransfer(context, control, bytes) {
      return transmitI2c({
        op: "i2cMemWrite",
        i2c: context.i2c,
        instance: context.instance,
        deviceAddress: context.halAddress,
        memoryAddress: control,
        memoryAddressSize: 1,
        buffer: byteArray(bytes),
        length: byteArray(bytes).length,
        timeout: context.timeout
      }, true);
    }

    function aliceOledPixel(context, x, y, color) {
      x = Math.trunc(Number(x));
      y = Math.trunc(Number(y));
      color = Math.trunc(Number(color));
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= ALICE_OLED_WIDTH || y < 0 || y >= ALICE_OLED_HEIGHT) return;
      var index = x + Math.floor(y / 8) * ALICE_OLED_WIDTH;
      var mask = 1 << (y & 7);
      if (color === 1) context.framebuffer[index] |= mask;
      else if (color === 2) context.framebuffer[index] ^= mask;
      else context.framebuffer[index] &= ~mask;
      context.framebuffer[index] &= 0xff;
      context.dirty = true;
    }

    function aliceOledGetPixel(context, x, y) {
      x = Math.trunc(Number(x));
      y = Math.trunc(Number(y));
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= ALICE_OLED_WIDTH || y < 0 || y >= ALICE_OLED_HEIGHT) return 0;
      return (context.framebuffer[x + Math.floor(y / 8) * ALICE_OLED_WIDTH] >> (y & 7)) & 1;
    }

    function aliceOledLine(context, x, y, length, vertical, color) {
      var count = Math.max(0, Math.trunc(Number(length)) || 0);
      for (var offset = 0; offset < count; offset += 1) {
        aliceOledPixel(context, x + (vertical ? 0 : offset), y + (vertical ? offset : 0), color);
      }
    }

    function aliceOledCharacter(context, x, y, character, scale, color) {
      var glyph = aliceOledGlyph(character);
      var multiplier = Math.max(1, Math.trunc(Number(scale)) || 1);
      for (var column = 0; column < 5; column += 1) {
        for (var row = 0; row < 7; row += 1) {
          if ((glyph[column] & (1 << row)) === 0) continue;
          for (var sx = 0; sx < multiplier; sx += 1) {
            for (var sy = 0; sy < multiplier; sy += 1) {
              aliceOledPixel(context, x + column * multiplier + sx, y + row * multiplier + sy, color);
            }
          }
        }
      }
    }

    function executeAliceOled(operation, kind) {
      var context = aliceOledContext(operation, true);
      var color = aliceNumber(firstDefined(operation, ["color", "value"], 1), 1);
      var x = aliceNumber(operation.x, 0);
      var y = aliceNumber(operation.y, 0);
      var status = BUILTIN_CONSTANTS.HAL_OK;
      var accepted;

      if (kind === "aliceoledinit") {
        var address = Math.trunc(aliceNumber(operation.address, 0x3c));
        if (address === 0) address = 0x3c;
        if (address < 0x03 || address > 0x77) {
          setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
          return;
        }
        context.i2c = firstDefined(operation, ["i2c", "handle"], context.i2c);
        context.instance = operationI2cInstance(operation);
        context.address7Bit = address;
        context.halAddress = address << 1;
        context.timeout = aliceNumber(operation.timeout, MAX_DELAY_VALUE) || MAX_DELAY_VALUE;
        context.framebuffer = new Array(ALICE_OLED_BUFFER_SIZE).fill(0);
        context.initialized = true;
        context.displayOn = true;
        context.inverse = false;
        context.dirty = true;
        accepted = aliceOledTransfer(context, 0x00, [
          0xae, 0xd5, 0x80, 0xa8, 0x3f, 0xd3, 0x00, 0x40,
          0x8d, 0x14, 0x20, 0x00, 0xa1, 0xc8, 0xda, 0x12,
          0x81, 0xcf, 0xd9, 0xf1, 0xdb, 0x40, 0xa4, 0xa6, 0xaf
        ]);
        accepted = aliceOledTransfer(context, 0x00, [0x21, 0x00, 0x7f, 0x22, 0x00, 0x07]) && accepted;
        accepted = aliceOledTransfer(context, 0x40, context.framebuffer) && accepted;
        context.dirty = !accepted;
        status = accepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind === "aliceoledupdate") {
        accepted = aliceOledTransfer(context, 0x00, [0x21, 0x00, 0x7f, 0x22, 0x00, 0x07]);
        accepted = aliceOledTransfer(context, 0x40, context.framebuffer) && accepted;
        context.dirty = !accepted;
        status = accepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind === "aliceoledcommand" || kind === "aliceoleddata") {
        accepted = aliceOledTransfer(context, kind === "aliceoleddata" ? 0x40 : 0x00, operationBytes(operation));
        status = accepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind === "aliceoledsetdisplay") {
        context.displayOn = Boolean(aliceNumber(operation.value, 0));
        accepted = aliceOledTransfer(context, 0x00, [context.displayOn ? 0xaf : 0xae]);
        status = accepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind === "aliceoledsetinvert") {
        context.inverse = Boolean(aliceNumber(operation.value, 0));
        accepted = aliceOledTransfer(context, 0x00, [context.inverse ? 0xa7 : 0xa6]);
        status = accepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind === "aliceoledsetcontrast") {
        accepted = aliceOledTransfer(context, 0x00, [0x81, aliceNumber(operation.value, 0x7f) & 0xff]);
        status = accepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind === "aliceoledfill" || kind === "aliceoledclear") {
        var fillColor = kind === "aliceoledclear" ? 0 : aliceNumber(operation.value, 0);
        context.framebuffer = context.framebuffer.map(function (value) {
          return fillColor === 2 ? (value ^ 0xff) : (fillColor === 1 ? 0xff : 0x00);
        });
        context.dirty = true;
      } else if (kind === "aliceoleddrawpixel") {
        aliceOledPixel(context, x, y, color);
      } else if (kind === "aliceoledgetpixel") {
        setOperationResult(operation, aliceOledGetPixel(context, x, y));
        return;
      } else if (kind === "aliceoleddrawhorizontalline" || kind === "aliceoleddrawverticalline") {
        aliceOledLine(context, x, y, aliceNumber(operation.length, 0), kind === "aliceoleddrawverticalline", color);
      } else if (kind === "aliceoleddrawrectangle") {
        var width = Math.max(0, Math.trunc(aliceNumber(operation.width, 0)));
        var height = Math.max(0, Math.trunc(aliceNumber(operation.height, 0)));
        if (width > 0 && height > 0) {
          aliceOledLine(context, x, y, width, false, color);
          aliceOledLine(context, x, y + height - 1, width, false, color);
          aliceOledLine(context, x, y, height, true, color);
          aliceOledLine(context, x + width - 1, y, height, true, color);
        }
      } else if (kind === "aliceoleddrawbitmap") {
        var bitmapWidth = Math.max(0, Math.trunc(aliceNumber(operation.width, 0)));
        var bitmapHeight = Math.max(0, Math.trunc(aliceNumber(operation.height, 0)));
        var bitmap = operationBytes(operation);
        var bytesPerRow = Math.ceil(bitmapWidth / 8);
        for (var bitmapY = 0; bitmapY < bitmapHeight; bitmapY += 1) {
          for (var bitmapX = 0; bitmapX < bitmapWidth; bitmapX += 1) {
            if (((bitmap[bitmapY * bytesPerRow + Math.floor(bitmapX / 8)] || 0) & (0x80 >> (bitmapX & 7))) !== 0) {
              aliceOledPixel(context, x + bitmapX, y + bitmapY, color);
            }
          }
        }
      } else if (kind === "aliceoleddrawchar") {
        var characterValue = evaluate(operation.character);
        if (typeof characterValue === "number") characterValue = String.fromCharCode(characterValue & 0xff);
        aliceOledCharacter(context, x, y, characterValue, aliceNumber(operation.scale, 1), color);
      } else if (kind === "aliceoleddrawstring") {
        var textValue = evaluate(operation.text);
        if (Array.isArray(textValue)) textValue = bytesToText(textValue).split("\0", 1)[0];
        textValue = String(textValue == null ? "" : textValue);
        var scale = Math.max(1, Math.trunc(aliceNumber(operation.scale, 1)) || 1);
        var advance = 6 * scale;
        var count = 0;
        while (count < textValue.length && x + count * advance + 5 * scale <= ALICE_OLED_WIDTH) {
          aliceOledCharacter(context, x + count * advance, y, textValue[count], scale, color);
          count += 1;
        }
        setOperationResult(operation, count);
        return;
      }
      setOperationResult(operation, status);
    }

    function aliceLightContext(operation, createIfMissing) {
      var name = aliceContextName(operation, "light");
      var contexts = runtime.peripherals.lightSensor;
      if (!hasOwn(contexts, name) && createIfMissing !== false) {
        contexts[name] = {
          name: name,
          adc: firstDefined(operation, ["adc", "handle"], "hadc1"),
          instance: operationAdcInstance(operation),
          digitalPin: firstDefined(operation, ["digitalPin", "pin"], ""),
          digitalActiveLow: false,
          referenceMv: 3300,
          adcBits: 12,
          adcMax: 4095,
          timeout: MAX_DELAY_VALUE,
          rawAtMinLux: 0,
          rawAtMaxLux: 4095,
          minLux: 0,
          maxLux: 100000
        };
      }
      return contexts[name] || null;
    }

    function aliceLightSampleRaw(context) {
      var scratch = "__alice_light_sample_" + context.name;
      startAdc({ adc: context.adc, instance: context.instance });
      pollAdc({ adc: context.adc, instance: context.instance, timeout: context.timeout });
      readAdc({ adc: context.adc, instance: context.instance, target: scratch });
      var raw = Math.max(0, Math.round(Number(runtime.variables[scratch])) || 0);
      delete runtime.variables[scratch];
      return raw;
    }

    function aliceLightMillivolts(context, raw) {
      var clamped = Math.max(0, Math.min(context.adcMax, Math.round(Number(raw)) || 0));
      return context.adcMax > 0 ? Math.round(clamped * context.referenceMv / context.adcMax) : 0;
    }

    function aliceLightPercent(context, raw) {
      var clamped = Math.max(0, Math.min(context.adcMax, Math.round(Number(raw)) || 0));
      return context.adcMax > 0 ? Math.round(clamped * 10000 / context.adcMax) : 0;
    }

    function aliceLightLux(context, raw) {
      var rawA = context.rawAtMinLux;
      var rawB = context.rawAtMaxLux;
      if (rawA === rawB) return 0;
      var lowRaw = Math.min(rawA, rawB);
      var highRaw = Math.max(rawA, rawB);
      var lowLux = rawA <= rawB ? context.minLux : context.maxLux;
      var highLux = rawA <= rawB ? context.maxLux : context.minLux;
      var clamped = Math.max(lowRaw, Math.min(highRaw, Math.round(Number(raw)) || 0));
      var distance = Math.floor((clamped - lowRaw) * Math.abs(highLux - lowLux) / (highRaw - lowRaw));
      return highLux >= lowLux ? lowLux + distance : Math.max(0, lowLux - distance);
    }

    function aliceLightDigital(context) {
      if (!context.digitalPin) return { valid: false, level: 0, triggered: 0 };
      var response = callHook("onGpioRead", {
        pin: context.digitalPin,
        physicalPin: context.digitalPin,
        time: runtime.time,
        timeMs: runtime.time
      });
      var level = response && typeof response === "object" ? firstDefined(response, ["value", "level", "raw"], null) : response;
      if (level == null && hasOwn(runtime.gpio, context.digitalPin)) level = runtime.gpio[context.digitalPin];
      if (level == null) return { valid: false, level: 0, triggered: 0 };
      level = level ? 1 : 0;
      return { valid: true, level: level, triggered: context.digitalActiveLow ? (level ? 0 : 1) : level };
    }

    function executeAliceLight(operation, kind) {
      var context = aliceLightContext(operation, true);
      if (kind === "alicelightinit") {
        context.adc = firstDefined(operation, ["adc", "handle"], context.adc);
        context.instance = operationAdcInstance(operation);
        context.digitalPin = firstDefined(operation, ["digitalPin", "pin"], "") || "";
        context.digitalActiveLow = Boolean(aliceNumber(operation.digitalActiveLow, 0));
        context.referenceMv = Math.max(1, Math.round(aliceNumber(operation.referenceMv, 3300)) || 3300);
        context.adcBits = Math.max(1, Math.min(24, Math.round(aliceNumber(operation.adcBits, 12)) || 12));
        context.adcMax = Math.pow(2, context.adcBits) - 1;
        context.timeout = aliceNumber(operation.timeout, MAX_DELAY_VALUE) || MAX_DELAY_VALUE;
        context.rawAtMinLux = 0;
        context.rawAtMaxLux = context.adcMax;
        context.minLux = 0;
        context.maxLux = 100000;
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
        return;
      }
      if (kind === "alicelightsetcalibration") {
        var rawMin = Math.max(0, Math.round(aliceNumber(operation.rawAtMinLux, context.rawAtMinLux)));
        var rawMax = Math.max(0, Math.round(aliceNumber(operation.rawAtMaxLux, context.rawAtMaxLux)));
        var luxMin = Math.max(0, Math.round(aliceNumber(operation.minLux, context.minLux)));
        var luxMax = Math.max(0, Math.round(aliceNumber(operation.maxLux, context.maxLux)));
        if (rawMin !== rawMax && luxMin !== luxMax) {
          context.rawAtMinLux = rawMin;
          context.rawAtMaxLux = rawMax;
          context.minLux = luxMin;
          context.maxLux = luxMax;
        }
        return;
      }
      if (kind === "alicelightrawtomillivolts" || kind === "alicelightrawtolux" || kind === "alicelightrawtopercent") {
        var conversionRaw = aliceNumber(operation.raw, 0);
        var converted = kind === "alicelightrawtomillivolts"
          ? aliceLightMillivolts(context, conversionRaw)
          : (kind === "alicelightrawtolux" ? aliceLightLux(context, conversionRaw) : aliceLightPercent(context, conversionRaw));
        setOperationResult(operation, converted);
        return;
      }
      if (kind === "alicelightreaddigital") {
        var digitalOnly = aliceLightDigital(context);
        if (operation.levelTarget) assign(operation.levelTarget, digitalOnly.level);
        if (operation.triggeredTarget) assign(operation.triggeredTarget, digitalOnly.triggered);
        setOperationResult(operation, digitalOnly.valid ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }

      var raw = aliceLightSampleRaw(context);
      var millivolts = aliceLightMillivolts(context, raw);
      var lux = aliceLightLux(context, raw);
      var percent = aliceLightPercent(context, raw);
      if (kind === "alicelightreadraw") assign(operation.target, raw);
      else if (kind === "alicelightreadmillivolts") assign(operation.target, millivolts);
      else if (kind === "alicelightreadlux") assign(operation.target, lux);
      else if (kind === "alicelightread") {
        var digital = aliceLightDigital(context);
        assign(operation.target, {
          raw: raw,
          millivolts: millivolts,
          lux: lux,
          percent_x100: percent,
          digital_level: digital.level,
          digital_valid: digital.valid ? 1 : 0,
          triggered: digital.triggered
        });
      }
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function alicePeripheralContext(group, operation, defaults) {
      var name = aliceContextName(operation, group);
      var contexts = runtime.peripherals[group];
      if (!hasOwn(contexts, name)) contexts[name] = Object.assign({ name: name }, defaults || {});
      return contexts[name];
    }

    function requestAlicePeripheral(peripheralType, action, context, extra) {
      var payload = Object.assign({
        peripheralType: peripheralType,
        action: action,
        context: context.name,
        dataPin: context.dataPin || "",
        triggerPin: context.triggerPin || "",
        echoPin: context.echoPin || "",
        pwmPin: context.pwmPin || "",
        signalPin: context.signalPin || "",
        clkPin: context.clkPin || "",
        dioPin: context.dioPin || "",
        timer: context.timer || "",
        channel: context.channel,
        channelExpression: context.channelExpression || "",
        time: runtime.time,
        timeMs: runtime.time
      }, extra || {});
      var response = callHook("onPeripheral", payload);
      return response && typeof response === "object" ? response : { accepted: false, result: null, targets: [] };
    }

    function executeAlicePeripheral(operation, kind) {
      var context;
      var response;
      var status = BUILTIN_CONSTANTS.HAL_OK;
      if (kind === "alicedht11init") {
        context = alicePeripheralContext("dht11", operation, { dataPin: "" });
        context.dataPin = operation.dataPin || context.dataPin;
      } else if (kind === "alicedht11read") {
        context = alicePeripheralContext("dht11", operation, { dataPin: "" });
        response = requestAlicePeripheral("dht11", "read", context);
        if (response.accepted && response.result) {
          var temperatureX10 = Math.round(Number(response.result.temperatureX10) || 0);
          var humidityX10 = Math.round(Number(response.result.humidityX10) || 0);
          var raw = [Math.floor(humidityX10 / 10) & 0xff, Math.abs(humidityX10) % 10, Math.floor(Math.abs(temperatureX10) / 10) & 0x7f, Math.abs(temperatureX10) % 10, 0];
          if (temperatureX10 < 0) raw[2] |= 0x80;
          raw[4] = (raw[0] + raw[1] + raw[2] + raw[3]) & 0xff;
          assign(operation.target, { raw: raw, humidity_x10: humidityX10, temperature_x10: temperatureX10 });
        } else status = BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind === "alicehcsr04init") {
        context = alicePeripheralContext("hcsr04", operation, { triggerPin: "", echoPin: "", timeout: 30000 });
        context.triggerPin = operation.triggerPin || context.triggerPin;
        context.echoPin = operation.echoPin || context.echoPin;
        context.timeout = aliceNumber(operation.timeout, 30000);
      } else if (kind === "alicehcsr04measure") {
        context = alicePeripheralContext("hcsr04", operation, { triggerPin: "", echoPin: "", timeout: 30000 });
        response = requestAlicePeripheral("hcsr04", "measure", context);
        if (response.accepted && response.result) assign(operation.target, Math.max(0, Math.round(Number(response.result.distanceMm) || 0)));
        else status = BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind === "alicesg90init") {
        context = alicePeripheralContext("sg90", operation, { timer: "", channel: 0, channelExpression: "", angle: 90 });
        context.timer = operation.timer || context.timer;
        context.channel = aliceNumber(operation.channel, context.channel);
        context.channelExpression = operation.channelExpression || context.channelExpression;
        response = requestAlicePeripheral("sg90", "set-angle", context, { angle: context.angle });
        if (!response.accepted) status = BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind.indexOf("alicesg90") === 0) {
        context = alicePeripheralContext("sg90", operation, { timer: "", channel: 0, channelExpression: "", angle: 90 });
        if (kind === "alicesg90setangle") context.angle = Math.max(0, Math.min(180, aliceNumber(operation.angle, context.angle)));
        else if (kind === "alicesg90setanglex10") context.angle = Math.max(0, Math.min(180, aliceNumber(operation.angleX10, context.angle * 10) / 10));
        else if (kind === "alicesg90setpulse") context.angle = Math.max(0, Math.min(180, (aliceNumber(operation.pulseUs, 1500) - 500) * 180 / 2000));
        response = requestAlicePeripheral("sg90", kind === "alicesg90stop" ? "stop" : "set-angle", context, { angle: context.angle });
        if (!response.accepted) status = BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind === "alicebuzzerinit") {
        context = alicePeripheralContext("buzzer", operation, { timer: "", channel: 0, channelExpression: "", frequencyHz: 0, dutyPermille: 500 });
        context.timer = operation.timer || context.timer;
        context.channel = aliceNumber(operation.channel, context.channel);
        context.channelExpression = operation.channelExpression || context.channelExpression;
      } else if (kind.indexOf("alicebuzzer") === 0) {
        context = alicePeripheralContext("buzzer", operation, { timer: "", channel: 0, channelExpression: "", frequencyHz: 0, dutyPermille: 500 });
        if (kind === "alicebuzzerstop") {
          context.frequencyHz = 0;
          response = requestAlicePeripheral("buzzer", "stop", context);
        } else {
          context.frequencyHz = Math.max(0, Math.round(aliceNumber(operation.frequencyHz, context.frequencyHz)));
          context.dutyPermille = kind === "alicebuzzerset" ? Math.max(0, Math.min(1000, Math.round(aliceNumber(operation.dutyPermille, context.dutyPermille)))) : 500;
          response = requestAlicePeripheral("buzzer", kind === "alicebuzzertone" ? "tone" : "set", context, { frequencyHz: context.frequencyHz, dutyPermille: context.dutyPermille, durationMs: aliceNumber(operation.durationMs, 0) });
        }
        if (!response.accepted) status = BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind === "alicetm1637init") {
        context = alicePeripheralContext("tm1637", operation, { clkPin: "", dioPin: "", brightness: 7, enabled: true, value: 0 });
        context.clkPin = operation.clkPin || context.clkPin;
        context.dioPin = operation.dioPin || context.dioPin;
        response = requestAlicePeripheral("tm1637", "clear", context);
        if (!response.accepted) status = BUILTIN_CONSTANTS.HAL_ERROR;
      } else if (kind.indexOf("alicetm1637") === 0) {
        context = alicePeripheralContext("tm1637", operation, { clkPin: "", dioPin: "", brightness: 7, enabled: true, value: 0 });
        if (kind === "alicetm1637setbrightness") {
          context.brightness = Math.max(0, Math.min(7, Math.round(aliceNumber(operation.brightness, context.brightness))));
          context.enabled = Boolean(aliceNumber(operation.enabled, context.enabled ? 1 : 0));
          response = requestAlicePeripheral("tm1637", "set-brightness", context, { brightness: context.brightness, enabled: context.enabled });
        } else if (kind === "alicetm1637clear") response = requestAlicePeripheral("tm1637", "clear", context);
        else {
          context.value = Math.trunc(aliceNumber(operation.value, context.value));
          response = requestAlicePeripheral("tm1637", "display-number", context, { value: context.value, leadingZero: Boolean(aliceNumber(operation.leadingZero, 0)), colon: Boolean(aliceNumber(operation.colon, 0)) });
        }
        if (!response.accepted) status = BUILTIN_CONSTANTS.HAL_ERROR;
      }
      setOperationResult(operation, status);
    }

    function fail(error, code) {
      runtime.running = false;
      runtime.status = "error";
      var failedInstruction = instructions[runtime.pc];
      var failedOperation = failedInstruction && failedInstruction.operation;
      runtime.error = {
        code: code || "RUNTIME_ERROR",
        message: error && error.message ? error.message : String(error),
        pc: runtime.pc,
        source: failedOperation && failedOperation.source && typeof failedOperation.source === "object"
          ? cloneValue(failedOperation.source)
          : null
      };
    }

    function executeInstruction(instruction) {
      var operation = instruction.operation;
      if (instruction.kind === "branch") {
        runtime.pc = evaluate(instruction.condition)
          ? (instruction.trueTarget == null ? runtime.pc + 1 : instruction.trueTarget)
          : instruction.falseTarget;
        return;
      }
      if (instruction.kind === "jump") {
        runtime.pc = instruction.target;
        return;
      }
      if (instruction.kind === "return") {
        runtime.returnValue = operation && hasOwn(operation, "value") ? evaluate(operation.value) : undefined;
        runtime.pc = instructions.length;
        runtime.running = false;
        runtime.status = "completed";
        return;
      }
      if (instruction.kind === "assign") {
        assign(firstDefined(operation, ["target", "variable", "name"], null), evaluate(firstDefined(operation, ["value", "expression", "source"], null)));
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "formatstring") {
        writeFormattedString(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "stdiowrite") {
        writeStdio(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "stdioscan") {
        scanStdio(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "libcmemory") {
        executeLibcMemory(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "heapallocate") {
        executeHeapAllocate(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "heapfree") {
        freeHeap(evaluate(operation.pointer));
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "libcseed") {
        runtime.randomState = Math.trunc(Number(evaluate(operation.seed)) || 1) & 0x7fffffff;
        if (sharedStore) sharedStore.randomState = runtime.randomState;
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "processexit") {
        runtime.returnValue = Math.trunc(Number(evaluate(operation.status)) || 0);
        runtime.pc = instructions.length;
        runtime.running = false;
        runtime.status = operation.abnormal ? "error" : "completed";
        if (operation.abnormal) runtime.error = { code: "ABORT", message: "Firmware called abort()", pc: runtime.pc, source: cloneValue(operation.source || null) };
        return;
      }
      if (instruction.kind === "uartreceive") {
        if (operationLength(operation) == null) {
          setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
          runtime.pc += 1;
          return;
        }
        if (tryUartReceive(operation)) return;
        var timeout = receiveTimeout(operation);
        runtime.blocked = {
          type: "uartReceive",
          instance: operationInstance(operation),
          length: operationLength(operation),
          target: receiveTarget(operation),
          deadline: timeout === Infinity ? null : runtime.time + timeout
        };
        runtime.status = "blocked";
        return;
      }
      if (instruction.kind === "uarttransmit") {
        transmit(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "uarttransmitdma") {
        startUartTxDma(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "uarttransmitit") {
        startUartTxInterrupt(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "uartreceivedma") {
        startUartRxDma(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "uartreceiveit") {
        startUartRxInterrupt(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "uartabortit") {
        abortUartInterrupt(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "uartdmastop") {
        stopUartDma(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2ctransmit") {
        transmitI2c(operation, false);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2cmemwrite") {
        transmitI2c(operation, true);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "spitransmit") {
        transmitSpi(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "adcstart") {
        startAdc(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "adcstartdma") {
        startAdcDma(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "adcstartit") {
        startAdcInterrupt(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "adcstopdma") {
        stopAdcDma(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "adcstopit") {
        stopAdcInterrupt(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "adcpoll") {
        pollAdc(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "adcgetvalue") {
        readAdc(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "pwmstart") {
        updatePwm(operation, { active: true });
        if (operation.interrupt) startTimerInterrupt(Object.assign({}, operation, { pwm: true }));
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "pwmstop") {
        updatePwm(operation, { active: false });
        if (operation.interrupt) stopTimerInterrupt(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "timerstartit") {
        startTimerInterrupt(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "timerstopit") {
        stopTimerInterrupt(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "pwmsetcompare") {
        updatePwm(operation, { compare: evaluate(firstDefined(operation, ["compare", "value", "pulse"], 0)) });
        runtime.pc += 1;
        return;
      }
      if (instruction.kind.indexOf("aliceoled") === 0) {
        executeAliceOled(operation, instruction.kind);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind.indexOf("alicelight") === 0) {
        executeAliceLight(operation, instruction.kind);
        runtime.pc += 1;
        return;
      }
      if (["alicedht11", "alicehcsr04", "alicesg90", "alicebuzzer", "alicetm1637"].some(function (prefix) { return instruction.kind.indexOf(prefix) === 0; })) {
        executeAlicePeripheral(operation, instruction.kind);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "gpiowrite") {
        var level = logicValue(firstDefined(operation, ["value", "state", "level"], 0));
        resolvePinTargets(operation).forEach(function (pin) { emitGpio(pin, level); });
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "gpioread") {
        var readPin = resolvePinTargets(operation)[0];
        var readResponse = readPin ? callHook("onGpioRead", {
          pin: readPin,
          physicalPin: readPin,
          time: runtime.time,
          timeMs: runtime.time
        }) : null;
        var readLevel = readResponse && typeof readResponse === "object"
          ? firstDefined(readResponse, ["value", "level", "raw"], null)
          : readResponse;
        if (readLevel == null && readPin && hasOwn(runtime.gpio, readPin)) readLevel = runtime.gpio[readPin];
        setOperationResult(operation, readLevel == null ? BUILTIN_CONSTANTS.GPIO_PIN_RESET : logicValue(readLevel));
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "gpiotoggle") {
        resolvePinTargets(operation).forEach(function (pin) { emitGpio(pin, hasOwn(runtime.gpio, pin) && runtime.gpio[pin] ? 0 : 1); });
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "delay") {
        var durationExpression = firstDefined(operation, ["milliseconds", "duration", "durationMs", "ms", "value"], null);
        if (durationExpression == null && operation.expression !== undefined) durationExpression = operation.expression;
        var duration = Number(evaluate(durationExpression == null ? 0 : durationExpression));
        if (!Number.isFinite(duration) || duration < 0) throw new Error("Delay duration must be a non-negative number");
        runtime.pc += 1;
        runtime.sleepUntil = runtime.time + duration;
        runtime.status = "sleeping";
        return;
      }
      if (instruction.kind === "fault") {
        var faultSource = operation && operation.source && typeof operation.source === "object" ? operation.source : {};
        var faultLocation = faultSource.file
          ? " at " + faultSource.file + ":" + (faultSource.line || 1) + ":" + (faultSource.column || 1)
          : "";
        throw new Error(String(operation && operation.message || "Firmware entered a fault handler") + faultLocation);
      }
      if (instruction.kind === "rtosdelay" || instruction.kind === "rtosyield" || instruction.kind === "rtoswait") {
        var middlewareDuration;
        if (operation.milliseconds != null) middlewareDuration = Number(evaluate(operation.milliseconds));
        else {
          var ticks = instruction.kind === "rtosyield" ? 1 : Number(evaluate(operation.ticks == null ? 1 : operation.ticks));
          if (!Number.isFinite(ticks) || ticks < 0 || ticks >= MAX_DELAY_VALUE) ticks = 1;
          middlewareDuration = ticks * 1000 / rtosTickRateHz;
        }
        if (!Number.isFinite(middlewareDuration) || middlewareDuration < 0) middlewareDuration = 1000 / rtosTickRateHz;
        runtime.pc += 1;
        runtime.sleepUntil = runtime.time + Math.max(1000 / rtosTickRateHz, middlewareDuration);
        runtime.status = "sleeping";
      }
    }

    function snapshot() {
      var rx = {};
      runtime.uartRx.forEach(function (queue, instance) {
        rx[instance] = { bytes: queue.slice(), text: bytesToText(queue), length: queue.length };
      });
      var blocked = runtime.blocked ? cloneValue(runtime.blocked) : null;
      if (blocked) blocked.available = uartQueue(blocked.instance).length;
      return {
        status: runtime.status,
        running: runtime.running,
        time: runtime.time,
        timeMs: runtime.time,
        pc: runtime.pc,
        variables: cloneValue(runtime.variables),
        gpio: Object.assign({}, runtime.gpio),
        uartRx: rx,
        uartTx: cloneValue(runtime.uartTx),
        i2cTx: cloneValue(runtime.i2cTx),
        spiTx: cloneValue(runtime.spiTx),
        uartTxCount: runtime.uartTxCount,
        i2cTxCount: runtime.i2cTxCount,
        spiTxCount: runtime.spiTxCount,
        adc: cloneValue(runtime.adc),
        dma: cloneValue(runtime.dma),
        interrupts: cloneValue(runtime.interrupts),
        pwm: cloneValue(runtime.pwm),
        peripherals: cloneValue(runtime.peripherals),
        heap: cloneValue(runtime.heap),
        stdio: cloneValue(runtime.stdio),
        stdioCount: runtime.stdioCount,
        blocked: blocked,
        sleepUntil: runtime.sleepUntil,
        pendingAdvanceMs: runtime.pendingAdvanceMs,
        operationsExecuted: runtime.operationsExecuted,
        returnValue: cloneValue(runtime.returnValue),
        error: runtime.error ? cloneValue(runtime.error) : null
      };
    }

    function notifyState() {
      var state = snapshot();
      callHook("onState", state);
      return state;
    }

    function start() {
      if (runtime.status === "completed" || runtime.status === "error" || runtime.status === "budget-exceeded") return notifyState();
      runtime.running = true;
      runtime.status = runtime.blocked ? "blocked" : (runtime.sleepUntil == null ? "running" : "sleeping");
      serviceAllUartRxDma(runtime.time);
      serviceAllUartRxInterrupts(runtime.time);
      return notifyState();
    }

    function pause() {
      runtime.running = false;
      if (runtime.status !== "completed" && runtime.status !== "error" && runtime.status !== "budget-exceeded") runtime.status = "paused";
      return notifyState();
    }

    function reset() {
      runtime.status = "idle";
      runtime.running = false;
      runtime.time = 0;
      runtime.pc = 0;
      if (sharedStore) {
        Object.keys(runtime.variables).forEach(function (name) { delete runtime.variables[name]; });
        Object.assign(runtime.variables, cloneValue(initialVariables));
        Object.keys(runtime.gpio).forEach(function (name) { delete runtime.gpio[name]; });
        runtime.uartRx.clear();
        Object.keys(runtime.adc).forEach(function (name) { delete runtime.adc[name]; });
        runtime.dma.transfers.splice(0, runtime.dma.transfers.length);
        runtime.dma.history.splice(0, runtime.dma.history.length);
        runtime.dma.sequence = 0;
        runtime.interrupts.events.splice(0, runtime.interrupts.events.length);
        runtime.interrupts.history.splice(0, runtime.interrupts.history.length);
        runtime.interrupts.sequence = 0;
        runtime.interrupts.gpioLevels = {};
        Object.keys(runtime.pwm).forEach(function (name) { delete runtime.pwm[name]; });
        Object.keys(runtime.peripherals).forEach(function (name) { delete runtime.peripherals[name]; });
        Object.assign(runtime.peripherals, cloneValue(peripheralDefaults));
        Object.keys(runtime.heap.allocations).forEach(function (name) { delete runtime.heap.allocations[name]; });
        runtime.heap.usedBytes = 0;
        runtime.heap.peakBytes = 0;
        runtime.heap.nextId = 0;
        runtime.stdio.splice(0, runtime.stdio.length);
        runtime.randomState = 1;
      } else {
        runtime.variables = cloneValue(initialVariables);
        runtime.gpio = {};
        runtime.uartRx = new Map();
        runtime.adc = {};
        runtime.dma = { transfers: [], history: [], sequence: 0 };
        runtime.interrupts = { events: [], history: [], sequence: 0, gpioLevels: {} };
        runtime.pwm = {};
        runtime.peripherals = cloneValue(peripheralDefaults);
        runtime.heap = emptyHeap();
        runtime.stdio = [];
        runtime.randomState = 1;
      }
      runtime.uartTx = [];
      runtime.i2cTx = [];
      runtime.spiTx = [];
      runtime.uartTxCount = 0;
      runtime.i2cTxCount = 0;
      runtime.spiTxCount = 0;
      runtime.stdioCount = 0;
      runtime.blocked = null;
      runtime.sleepUntil = null;
      runtime.pendingAdvanceMs = 0;
      runtime.operationsExecuted = 0;
      runtime.error = null;
      runtime.returnValue = undefined;
      return notifyState();
    }

    function enqueueUart(instance, text) {
      var resolved = resolveInstance(instance);
      var queue = uartQueue(resolved);
      Array.prototype.push.apply(queue, byteArray(text));
      if (runtime.running) {
        serviceUartRxDma(resolved, runtime.time);
        serviceUartRxInterrupt(resolved, runtime.time);
      }
      return notifyState();
    }

    function advanceTimeTo(targetTime) {
      var target = Number(targetTime);
      if (!Number.isFinite(target) || target < runtime.time) return snapshot();
      if (runtime.running) {
        var advanceResult = processTimedDmaUntil(target, { remaining: MAX_DMA_EVENTS_PER_STEP });
        if (advanceResult.limited) {
          runtime.time = advanceResult.lastEventTime == null ? runtime.time : advanceResult.lastEventTime;
          runtime.pendingAdvanceMs = Math.max(0, target - runtime.time);
          return snapshot();
        }
      }
      runtime.time = target;
      runtime.pendingAdvanceMs = 0;
      return snapshot();
    }

    function step(deltaMs) {
      var delta = Number(deltaMs == null ? 0 : deltaMs);
      if (!Number.isFinite(delta) || delta < 0) throw new RangeError("step(deltaMs) requires a non-negative finite duration");
      if (!runtime.running) return notifyState();

      runtime.pendingAdvanceMs += delta;
      var targetTime = runtime.time + runtime.pendingAdvanceMs;
      var budget = operationBudget;
      var dmaBudget = { remaining: MAX_DMA_EVENTS_PER_STEP };
      var dmaLimited = false;
      try {
        serviceAllUartRxDma(runtime.time);
        serviceAllUartRxInterrupts(runtime.time);
        while (runtime.running) {
          if (runtime.sleepUntil != null) {
            var sleepBoundary = Math.min(runtime.sleepUntil, targetTime);
            if (dmaBudget.remaining <= 0) {
              var sleepCoalesceLimit = runtime.sleepUntil <= targetTime ? Math.max(runtime.time, sleepBoundary - 1e-9) : sleepBoundary;
              var sleepCoalesce = processTimedDmaUntil(sleepCoalesceLimit, dmaBudget);
              if (sleepCoalesce.limited) {
                dmaLimited = true;
                break;
              }
            }
            var sleepingDmaTime = nextTimedDmaTime(sleepBoundary);
            if (sleepingDmaTime != null && (runtime.sleepUntil > targetTime || sleepingDmaTime < runtime.sleepUntil - 1e-9)) {
              runtime.time = sleepingDmaTime;
              var sleepingDmaResult = processTimedDmaUntil(sleepingDmaTime, dmaBudget);
              if (sleepingDmaResult.limited) {
                dmaLimited = true;
                break;
              }
              continue;
            }
            if (runtime.sleepUntil > targetTime) {
              runtime.time = targetTime;
              runtime.status = "sleeping";
              runtime.pendingAdvanceMs = 0;
              break;
            }
            runtime.time = runtime.sleepUntil;
            runtime.sleepUntil = null;
            runtime.status = "running";
            continue;
          }

          if (runtime.blocked) {
            var blockedInstruction = instructions[runtime.pc];
            if (blockedInstruction && tryUartReceive(blockedInstruction.operation)) {
              runtime.status = "running";
              budget -= 1;
              runtime.operationsExecuted += 1;
              continue;
            }
            var blockedDeadline = runtime.blocked.deadline == null ? Infinity : runtime.blocked.deadline;
            var blockedBoundary = Math.min(blockedDeadline, targetTime);
            if (dmaBudget.remaining <= 0) {
              var blockedCoalesceLimit = blockedDeadline <= targetTime ? Math.max(runtime.time, blockedBoundary - 1e-9) : blockedBoundary;
              var blockedCoalesce = processTimedDmaUntil(blockedCoalesceLimit, dmaBudget);
              if (blockedCoalesce.limited) {
                dmaLimited = true;
                break;
              }
            }
            var blockedDmaTime = nextTimedDmaTime(blockedBoundary);
            if (blockedDmaTime != null && (blockedDeadline > targetTime || blockedDmaTime < blockedDeadline - 1e-9)) {
              runtime.time = blockedDmaTime;
              var blockedDmaResult = processTimedDmaUntil(blockedDmaTime, dmaBudget);
              if (blockedDmaResult.limited) {
                dmaLimited = true;
                break;
              }
              continue;
            }
            if (runtime.blocked.deadline != null && runtime.blocked.deadline <= targetTime) {
              runtime.time = Math.max(runtime.time, runtime.blocked.deadline);
              setOperationResult(blockedInstruction.operation, BUILTIN_CONSTANTS.HAL_TIMEOUT);
              runtime.blocked = null;
              runtime.pc += 1;
              runtime.status = "running";
              budget -= 1;
              runtime.operationsExecuted += 1;
              continue;
            }
            runtime.time = targetTime;
            runtime.status = "blocked";
            runtime.pendingAdvanceMs = 0;
            break;
          }

          if (runtime.pc >= instructions.length) {
            runtime.running = false;
            runtime.status = "completed";
            runtime.pendingAdvanceMs = 0;
            break;
          }
          if (budget <= 0) {
            runtime.running = false;
            runtime.status = "budget-exceeded";
            runtime.pendingAdvanceMs = 0;
            runtime.error = {
              code: "OPERATION_BUDGET_EXCEEDED",
              message: "Firmware executed more than " + operationBudget + " operations without yielding",
              pc: runtime.pc,
              source: instructions[runtime.pc] && instructions[runtime.pc].operation && instructions[runtime.pc].operation.source && typeof instructions[runtime.pc].operation.source === "object"
                ? cloneValue(instructions[runtime.pc].operation.source)
                : null
            };
            break;
          }

          var instruction = instructions[runtime.pc];
          budget -= 1;
          runtime.operationsExecuted += 1;
          executeInstruction(instruction);
        }
        if (dmaLimited) {
          runtime.pendingAdvanceMs = Math.max(0, targetTime - runtime.time);
          runtime.status = runtime.blocked ? "blocked" : (runtime.sleepUntil == null ? "running" : "sleeping");
        } else if (runtime.time >= targetTime - 1e-9) {
          runtime.pendingAdvanceMs = 0;
        }
      } catch (error) {
        fail(error);
        runtime.pendingAdvanceMs = 0;
      }
      return notifyState();
    }

    return Object.freeze({
      start: start,
      pause: pause,
      reset: reset,
      step: step,
      advanceTimeTo: advanceTimeTo,
      enqueueUart: enqueueUart,
      syncGpioInputs: syncGpioInputs,
      getState: snapshot
    });
  }

  return Object.freeze({
    version: "1.0.0",
    create: create
  });
}));
