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

  var BUILTIN_CONSTANTS = {
    HAL_OK: 0,
    HAL_ERROR: 1,
    HAL_BUSY: 2,
    HAL_TIMEOUT: 3,
    HAL_MAX_DELAY: MAX_DELAY_VALUE,
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
      haluartdmastop: "uartdmastop",
      hali2cmastertransmit: "i2ctransmit",
      i2cmastertransmit: "i2ctransmit",
      hali2cmemwrite: "i2cmemwrite",
      halspitransmit: "spitransmit",
      haladcstart: "adcstart",
      haladcstartdma: "adcstartdma",
      haladcstopdma: "adcstopdma",
      haladcpollforconversion: "adcpoll",
      adcpollforconversion: "adcpoll",
      haladcgetvalue: "adcgetvalue",
      haltimpwmstart: "pwmstart",
      haltimpwmstartit: "pwmstart",
      haltimpwmstop: "pwmstop",
      haltimpwmstopit: "pwmstop",
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
          "uartreceive", "uarttransmit", "uartreceivedma", "uarttransmitdma", "uartdmastop", "i2ctransmit", "i2cmemwrite", "spitransmit", "adcstart", "adcstartdma", "adcstopdma", "adcpoll", "adcgetvalue", "pwmstart", "pwmstop", "pwmsetcompare",
          "assign", "gpiowrite", "gpioread", "gpiotoggle", "delay", "fault", "rtosdelay", "rtosyield", "rtoswait",
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
      uartTxCount: 0, i2cTxCount: 0, spiTxCount: 0, adc: {}, dma: { transfers: [], history: [], sequence: 0 }, pwm: {}, peripherals: {},
      operationsExecuted: 0, currentTaskId: null, error: null, lastSelectedIndex: -1
    };
    var sharedStore = {
      variables: shared.variables, gpio: shared.gpio, uartRx: shared.uartRx, adc: shared.adc, dma: shared.dma, pwm: shared.pwm, peripherals: shared.peripherals
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
      var heapUsed = rtosTasks.reduce(function (total, task) { return total + task.stackWords * 4 + 96; }, 0);
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
        uartTxCount: shared.uartTxCount, i2cTxCount: shared.i2cTxCount, spiTxCount: shared.spiTxCount, adc: cloneValue(shared.adc), dma: cloneValue(shared.dma), pwm: cloneValue(shared.pwm),
        peripherals: cloneValue(shared.peripherals), blocked: shared.status === "blocked" ? blocked : null, sleepUntil: null,
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
      Object.keys(shared.pwm).forEach(function (name) { delete shared.pwm[name]; });
      Object.keys(shared.peripherals).forEach(function (name) { delete shared.peripherals[name]; });
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
    return Object.freeze({ start: start, pause: pause, reset: reset, step: step, advanceTimeTo: advanceTimeTo, enqueueUart: enqueueUart, getState: snapshot });
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

    var sharedStore = options.sharedStore && typeof options.sharedStore === "object" ? options.sharedStore : null;
    var peripheralDefaults = { oled: {}, lightSensor: {}, dht11: {}, hcsr04: {}, sg90: {}, buzzer: {}, tm1637: {} };
    if (sharedStore) {
      if (!sharedStore.variables) sharedStore.variables = cloneValue(initialVariables);
      if (!sharedStore.gpio) sharedStore.gpio = {};
      if (!sharedStore.uartRx) sharedStore.uartRx = new Map();
      if (!sharedStore.adc) sharedStore.adc = {};
      if (!sharedStore.dma) sharedStore.dma = { transfers: [], history: [], sequence: 0 };
      if (!sharedStore.pwm) sharedStore.pwm = {};
      if (!sharedStore.peripherals) sharedStore.peripherals = cloneValue(peripheralDefaults);
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
      pwm: sharedStore ? sharedStore.pwm : {},
      peripherals: sharedStore ? sharedStore.peripherals : cloneValue(peripheralDefaults),
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

      if (kind === "literal") return expression.value;
      if (kind === "string") return firstDefined(expression, ["value", "text"], "");
      if (kind === "constant") {
        var constantName = firstDefined(expression, ["name", "constant"], "");
        var resolvedConstant = resolveConstant(constantName, resolving);
        return resolvedConstant === undefined && hasOwn(expression, "value") ? expression.value : resolvedConstant;
      }
      if (kind === "variable") return runtime.variables[firstDefined(expression, ["name", "variable", "value"], "")];
      if (kind === "char") return byteArray(String(firstDefined(expression, ["value", "char"], "")))[0] || 0;
      if (kind === "arrayindex") {
        var arraySource = firstDefined(expression, ["array", "source", "target", "name"], []);
        var array = typeof arraySource === "string" && hasOwn(runtime.variables, arraySource)
          ? runtime.variables[arraySource]
          : evaluate(arraySource, resolving);
        var index = Math.trunc(Number(evaluate(firstDefined(expression, ["index", "subscript"], 0), resolving)) || 0);
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
      if (["add", "sub", "mul", "div", "mod", "bitor", "bitxor", "bitand", "shiftleft", "shiftright"].indexOf(kind) >= 0) {
        var arithmeticLeft = Number(evaluate(firstDefined(expression, ["left", "a"], 0), resolving)) || 0;
        var arithmeticRight = Number(evaluate(firstDefined(expression, ["right", "b"], 0), resolving)) || 0;
        if (kind === "add") return arithmeticLeft + arithmeticRight;
        if (kind === "sub") return arithmeticLeft - arithmeticRight;
        if (kind === "mul") return arithmeticLeft * arithmeticRight;
        if (kind === "div") return arithmeticRight === 0 ? 0 : Math.trunc(arithmeticLeft / arithmeticRight);
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
      throw new Error("Unsupported firmware expression: " + kind);
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

    function coerceCValue(name, value) {
      var info = integerTypeInfo(variableTypes[name]);
      if (!info || Array.isArray(value) || (value && typeof value === "object")) return cloneValue(value);
      var number = Number(value);
      if (!Number.isFinite(number)) number = 0;
      if (info.bits > 32) return Math.trunc(number);
      number = Math.trunc(number);
      var modulus = Math.pow(2, info.bits);
      var wrapped = ((number % modulus) + modulus) % modulus;
      if (!info.unsigned && wrapped >= modulus / 2) wrapped -= modulus;
      return wrapped;
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
        array[index] = coerceCValue(arrayName, value);
        runtime.variables[arrayName] = array;
        return;
      }
      throw new Error("Unsupported assignment target");
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
      return resolveInstance(firstDefined(operation, ["instance", "uart", "handle", "peripheral"], "UART"));
    }

    function operationI2cInstance(operation) {
      return resolveI2cInstance(firstDefined(operation, ["instance", "i2c", "handle", "peripheral"], "I2C"));
    }

    function operationSpiInstance(operation) {
      return resolveSpiInstance(firstDefined(operation, ["instance", "spi", "handle", "peripheral"], "SPI"));
    }

    function operationAdcInstance(operation) {
      return resolveAdcInstance(firstDefined(operation, ["instance", "adc", "handle", "peripheral"], "ADC"));
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
        dmaHandle: operation.dmaHandle || null,
        dmaInstance: operation.dmaInstance || null,
        transferId: operation.transferId || null,
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
    }

    function readAdc(operation) {
      var instance = operationAdcInstance(operation);
      var state = adcState(instance);
      var sample = callHook("onAdcRead", {
        instance: instance,
        adc: firstDefined(operation, ["adc", "handle"], instance),
        started: state.started,
        ready: state.ready,
        time: runtime.time,
        timeMs: runtime.time
      });
      var value = sample && typeof sample === "object" ? firstDefined(sample, ["value", "raw"], null) : sample;
      value = Number(value);
      if (!Number.isFinite(value)) value = 0;
      value = Math.max(0, Math.round(value));
      state.value = value;
      state.voltage = sample && typeof sample === "object" && Number.isFinite(Number(sample.voltage)) ? Number(sample.voltage) : null;
      state.ready = false;
      state.samples += 1;
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
      var active = activeDmaTransfer(type, instance);
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
        pwm: runtime.pwm,
        peripherals: runtime.peripherals
      };
    }

    function runDmaCallback(name, transfer, phase, eventTime) {
      var event = {
        callback: name,
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
      };
      callHook("onDmaCallback", cloneValue(event));
      var callbacks = model.callbacks && typeof model.callbacks === "object" ? model.callbacks : {};
      var descriptor = callbacks[name];
      if (!descriptor || !Array.isArray(descriptor.operations) || !descriptor.operations.length) return;

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
      var parameterName = transfer.type === "adc" ? "hadc" : "huart";
      var hadPreviousParameter = hasOwn(runtime.variables, parameterName);
      var previousParameter = runtime.variables[parameterName];
      var handleName = String(transfer.handle || "").replace(/^&/, "");
      var hadPreviousHandle = handleName ? hasOwn(runtime.variables, handleName) : false;
      var previousHandle = handleName ? runtime.variables[handleName] : undefined;
      var instanceName = String(transfer.instance || "");
      var hadPreviousInstance = instanceName ? hasOwn(runtime.variables, instanceName) : false;
      var previousInstance = instanceName ? runtime.variables[instanceName] : undefined;
      var callbackHandle = { Instance: transfer.instance, handle: transfer.handle };
      runtime.variables[parameterName] = callbackHandle;
      if (handleName) runtime.variables[handleName] = callbackHandle;
      if (instanceName) runtime.variables[instanceName] = instanceName;
      var callbackRuntime = create(callbackModel, callbackHooks, { sharedStore: callbackSharedStore() });
      callbackRuntime.advanceTimeTo(eventTime);
      callbackRuntime.start();
      var callbackState = callbackRuntime.step(0);
      if (hadPreviousParameter) runtime.variables[parameterName] = previousParameter;
      else delete runtime.variables[parameterName];
      if (handleName) {
        if (hadPreviousHandle) runtime.variables[handleName] = previousHandle;
        else delete runtime.variables[handleName];
      }
      if (instanceName) {
        if (hadPreviousInstance) runtime.variables[instanceName] = previousInstance;
        else delete runtime.variables[instanceName];
      }
      event.status = callbackState.status;
      event.operationsExecuted = callbackState.operationsExecuted;
      if (callbackState.error) event.error = cloneValue(callbackState.error);
      callHook("onDmaCallbackComplete", cloneValue(event));
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
      return Number.isFinite(selected) ? selected : null;
    }

    function processTimedDmaUntil(targetTime, eventBudget) {
      eventBudget = eventBudget || { remaining: MAX_DMA_EVENTS_PER_STEP };
      var processed = 0;
      var lastEventTime = null;
      while (eventBudget.remaining > 0) {
        var candidate = null;
        var candidatePhase = null;
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
        if (!candidate) break;
        completeDmaPhase(candidate, candidatePhase, candidateTime);
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
      if (instruction.kind === "uartreceivedma") {
        startUartRxDma(operation);
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
      if (instruction.kind === "adcstopdma") {
        stopAdcDma(operation);
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
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "pwmstop") {
        updatePwm(operation, { active: false });
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
        pwm: cloneValue(runtime.pwm),
        peripherals: cloneValue(runtime.peripherals),
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
        Object.keys(runtime.pwm).forEach(function (name) { delete runtime.pwm[name]; });
        Object.keys(runtime.peripherals).forEach(function (name) { delete runtime.peripherals[name]; });
        Object.assign(runtime.peripherals, cloneValue(peripheralDefaults));
      } else {
        runtime.variables = cloneValue(initialVariables);
        runtime.gpio = {};
        runtime.uartRx = new Map();
        runtime.adc = {};
        runtime.dma = { transfers: [], history: [], sequence: 0 };
        runtime.pwm = {};
        runtime.peripherals = cloneValue(peripheralDefaults);
      }
      runtime.uartTx = [];
      runtime.i2cTx = [];
      runtime.spiTx = [];
      runtime.uartTxCount = 0;
      runtime.i2cTxCount = 0;
      runtime.spiTxCount = 0;
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
      if (runtime.running) serviceUartRxDma(resolved, runtime.time);
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
      getState: snapshot
    });
  }

  return Object.freeze({
    version: "1.0.0",
    create: create
  });
}));
