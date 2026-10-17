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
  var MAX_PENDING_INTERRUPT_CALLBACKS = 128;

  var BUILTIN_CONSTANTS = {
    HAL_OK: 0,
    HAL_ERROR: 1,
    HAL_BUSY: 2,
    HAL_TIMEOUT: 3,
    HAL_MAX_DELAY: MAX_DELAY_VALUE,
    NULL: 0,
    EOF: -1,
    EXIT_SUCCESS: 0,
    EXIT_FAILURE: 1,
    RAND_MAX: 0x7fffffff,
    CHAR_BIT: 8,
    SCHAR_MAX: 0x7f,
    SHRT_MAX: 0x7fff,
    INT_MAX: 0x7fffffff,
    LONG_MAX: 0x7fffffff,
    UCHAR_MAX: 0xff,
    USHRT_MAX: 0xffff,
    UINT_MAX: 0xffffffff,
    M_E: Math.E,
    M_LOG2E: Math.LOG2E,
    M_LOG10E: Math.LOG10E,
    M_LN2: Math.LN2,
    M_LN10: Math.LN10,
    M_PI: Math.PI,
    M_PI_2: Math.PI / 2,
    M_PI_4: Math.PI / 4,
    M_1_PI: 1 / Math.PI,
    M_2_PI: 2 / Math.PI,
    M_2_SQRTPI: 2 / Math.sqrt(Math.PI),
    M_SQRT2: Math.SQRT2,
    M_SQRT1_2: Math.SQRT1_2,
    HUGE_VAL: Infinity,
    HUGE_VALF: Infinity,
    HUGE_VALL: Infinity,
    INFINITY: Infinity,
    NAN: NaN,
    FLT_RADIX: 2,
    FLT_EPSILON: 1.19209290e-7,
    DBL_EPSILON: Number.EPSILON,
    LDBL_EPSILON: Number.EPSILON,
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
  ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"].forEach(function (port) {
    BUILTIN_CONSTANTS["GPIO" + port] = { __alicePointer: "variable", name: "GPIO" + port, offset: 0, elementSize: 4, storageElementSize: 4, pointeeType: "GPIO_TypeDef", unsigned: true };
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
      hali2cmastertransmitit: "i2ctransmitit",
      hali2cmastertransmitdma: "i2ctransmitdma",
      i2cmastertransmit: "i2ctransmit",
      i2cmastertransmitit: "i2ctransmitit",
      i2cmastertransmitdma: "i2ctransmitdma",
      hali2cmasterreceive: "i2creceive",
      hali2cmasterreceiveit: "i2creceiveit",
      hali2cmasterreceivedma: "i2creceivedma",
      i2cmasterreceive: "i2creceive",
      i2cmasterreceiveit: "i2creceiveit",
      i2cmasterreceivedma: "i2creceivedma",
      hali2cmemwrite: "i2cmemwrite",
      hali2cmemwriteit: "i2cmemwriteit",
      hali2cmemwritedma: "i2cmemwritedma",
      hali2cmemread: "i2cmemread",
      hali2cmemreadit: "i2cmemreadit",
      hali2cmemreaddma: "i2cmemreaddma",
      i2cmemwriteit: "i2cmemwriteit",
      i2cmemwritedma: "i2cmemwritedma",
      i2cmemreadit: "i2cmemreadit",
      i2cmemreaddma: "i2cmemreaddma",
      hali2cmasterabortit: "i2cabortit",
      i2cmasterabortit: "i2cabortit",
      i2cabortit: "i2cabortit",
      halspitransmit: "spitransmit",
      halspitransmitit: "spitransmitit",
      halspitransmitdma: "spitransmitdma",
      halspireceive: "spireceive",
      halspireceiveit: "spireceiveit",
      halspireceivedma: "spireceivedma",
      halspitransmitreceive: "spitransmitreceive",
      halspitransmitreceiveit: "spitransmitreceiveit",
      halspitransmitreceivedma: "spitransmitreceivedma",
      spitransmitit: "spitransmitit",
      spitransmitdma: "spitransmitdma",
      spireceiveit: "spireceiveit",
      spireceivedma: "spireceivedma",
      spitransmitreceiveit: "spitransmitreceiveit",
      spitransmitreceivedma: "spitransmitreceivedma",
      halspiabortit: "spiabortit",
      spiabortit: "spiabortit",
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
    var expressionSlotSequence = 0;

    function patchJumps(jumps, target) {
      jumps.forEach(function (index) { instructions[index].target = target; });
    }

    function nearestContext(contextStack, predicate) {
      for (var index = contextStack.length - 1; index >= 0; index -= 1) {
        if (predicate(contextStack[index])) return contextStack[index];
      }
      return null;
    }

    function internalExpressionSlot(name) {
      return { kind: "internalSlot", name: name };
    }

    function emitExpressionCall(expression) {
      var sourceOperation = expression && expression.operation;
      if (!sourceOperation || typeof sourceOperation !== "object") {
        throw new TypeError("HAL call expression is missing its lowered operation");
      }
      var operation = cloneValue(sourceOperation);
      var kind = canonicalOperationKind(operation);
      var slot = "call-" + (++expressionSlotSequence);
      var target = internalExpressionSlot(slot);
      // Every non-void HAL operation writes its C return value through the
      // same target. The slot is private to the compiled instruction stream,
      // so it cannot collide with a variable declared by firmware code.
      operation.resultTarget = target;
      instructions.push({ kind: kind, operation: operation });
      return target;
    }

    function lowerExpressionCalls(expression) {
      if (expression == null || typeof expression !== "object") return expression;
      if (Array.isArray(expression)) return expression.map(lowerExpressionCalls);
      if (canonicalExpressionKind(expression) === "sizeof") {
        // Except for variable-length arrays (which the semantic model does
        // not lower), C never evaluates the operand of sizeof. Recursing into
        // it here would incorrectly execute HAL calls, increments, or
        // assignments before the runtime gets a chance to measure the type.
        return cloneValue(expression);
      }
      if (canonicalExpressionKind(expression) === "halcall") return emitExpressionCall(expression);
      if (canonicalExpressionKind(expression) === "inlinecall") {
        var inlineOperations = firstDefined(expression, ["operations", "body"], []);
        if (!Array.isArray(inlineOperations)) {
          throw new TypeError("Inline helper call is missing its operation list");
        }
        var inlineResultSlot = internalExpressionSlot("inline-" + (++expressionSlotSequence));
        var inlineContext = {
          inlineFunction: true,
          resultTarget: inlineResultSlot,
          returnJumps: []
        };
        // A helper runs as an isolated control-flow region. Its return
        // statements assign this slot and jump to the instruction following
        // the region instead of terminating the caller program.
        var inlineLocals = Array.isArray(expression.locals) ? expression.locals : [];
        if (inlineLocals.length) instructions.push({ kind: "scopeenter", names: inlineLocals });
        compileBlock(inlineOperations, [inlineContext]);
        if (!inlineContext.returnJumps.length && !expression.discard) {
          throw new TypeError("Inline helper call has no value return");
        }
        patchJumps(inlineContext.returnJumps, instructions.length);
        if (inlineLocals.length) instructions.push({ kind: "scopeexit", names: inlineLocals });
        return inlineResultSlot;
      }
      if (canonicalExpressionKind(expression) === "assignment") {
        var assignmentTarget = lowerExpressionCalls(firstDefined(expression, ["target", "lvalue"], null));
        if (!assignmentTarget || typeof assignmentTarget !== "object") {
          throw new TypeError("Assignment expression is missing a writable target");
        }
        var assignmentOperator = normalizedKind(firstDefined(expression, ["operator", "assignmentOperator"], "assign"));
        var assignmentValue = lowerExpressionCalls(firstDefined(expression, ["value", "expression", "right"], null));
        var assignmentResultSlot = internalExpressionSlot("assignment-" + (++expressionSlotSequence));
        if (assignmentOperator === "assign") {
          instructions.push({
            kind: "assign",
            operation: { op: "assign", target: cloneValue(assignmentTarget), value: assignmentValue }
          });
        } else {
          var assignmentOldSlot = internalExpressionSlot("assignment-old-" + (++expressionSlotSequence));
          instructions.push({
            kind: "assign",
            operation: { op: "assign", target: assignmentOldSlot, value: cloneValue(assignmentTarget) }
          });
          if (["add", "sub", "mul", "div", "mod", "bitand", "bitor", "bitxor", "shiftleft", "shiftright"].indexOf(assignmentOperator) < 0) {
            throw new TypeError("Unsupported assignment operator: " + assignmentOperator);
          }
          instructions.push({
            kind: "assign",
            operation: {
              op: "assign",
              target: cloneValue(assignmentTarget),
              value: { kind: assignmentOperator, left: assignmentOldSlot, right: assignmentValue }
            }
          });
        }
        instructions.push({
          kind: "assign",
          operation: { op: "assign", target: assignmentResultSlot, value: cloneValue(assignmentTarget) }
        });
        return assignmentResultSlot;
      }
      if (canonicalExpressionKind(expression) === "sequence") {
        var sequenceItems = firstDefined(expression, ["expressions", "operands", "values"], []);
        if (!Array.isArray(sequenceItems)) sequenceItems = [sequenceItems];
        var sequenceResult = { kind: "literal", value: 0 };
        sequenceItems.forEach(function (item) {
          // Each item is lowered in source order.  Non-final items may emit
          // HAL calls, assignments, or branches whose result is intentionally
          // discarded; the final lowered value is returned to the parent.
          sequenceResult = lowerExpressionCalls(item);
        });
        return sequenceResult;
      }
      if (canonicalExpressionKind(expression) === "and" || canonicalExpressionKind(expression) === "or") {
        // Logical operators in a value context still short-circuit. Compile
        // them as branches that write a canonical C boolean (0/1) to a private
        // result slot, so side effects in the right operand are conditional.
        var logicalResultSlot = internalExpressionSlot("logical-" + (++expressionSlotSequence));
        var logicalBranches = compileCondition(expression);
        var logicalTrueStart = instructions.length;
        patchBranchTargets(logicalBranches.trueJumps, logicalTrueStart);
        instructions.push({
          kind: "assign",
          operation: { op: "assign", target: logicalResultSlot, value: { kind: "literal", value: true } }
        });
        var logicalJoin = instructions.length;
        instructions.push({ kind: "jump", target: -1 });
        var logicalFalseStart = instructions.length;
        patchBranchTargets(logicalBranches.falseJumps, logicalFalseStart);
        instructions.push({
          kind: "assign",
          operation: { op: "assign", target: logicalResultSlot, value: { kind: "literal", value: false } }
        });
        instructions[logicalJoin].target = instructions.length;
        return logicalResultSlot;
      }
      if (["postincrement", "postdecrement", "preincrement", "predecrement"].indexOf(canonicalExpressionKind(expression)) >= 0) {
        var updateKind = canonicalExpressionKind(expression);
        var rawUpdateTarget = firstDefined(expression, ["target", "lvalue"], null);
        if (typeof rawUpdateTarget === "string") rawUpdateTarget = { kind: "variable", name: rawUpdateTarget };
        var updateTarget = lowerExpressionCalls(rawUpdateTarget);
        if (!updateTarget || typeof updateTarget !== "object") {
          throw new TypeError("Increment expression is missing a writable target");
        }
        var updateResultSlot = internalExpressionSlot("update-" + (++expressionSlotSequence));
        var updateOperator = updateKind.indexOf("increment") >= 0 ? "add" : "sub";
        var updateValue = function (left) {
          return { kind: updateOperator, left: left, right: { kind: "literal", value: 1 } };
        };
        if (updateKind.indexOf("post") === 0) {
          instructions.push({
            kind: "assign",
            operation: { op: "assign", target: updateResultSlot, value: cloneValue(updateTarget) }
          });
          instructions.push({
            kind: "assign",
            operation: { op: "assign", target: cloneValue(updateTarget), value: updateValue(cloneValue(updateResultSlot)) }
          });
        } else {
          instructions.push({
            kind: "assign",
            operation: { op: "assign", target: cloneValue(updateTarget), value: updateValue(cloneValue(updateTarget)) }
          });
          instructions.push({
            kind: "assign",
            operation: { op: "assign", target: updateResultSlot, value: cloneValue(updateTarget) }
          });
        }
        return updateResultSlot;
      }
      if (canonicalExpressionKind(expression) === "conditional") {
        var resultSlot = internalExpressionSlot("conditional-" + (++expressionSlotSequence));
        var conditionalBranches = compileCondition(firstDefined(expression, ["condition", "test"], false));
        var consequentStart = instructions.length;
        patchBranchTargets(conditionalBranches.trueJumps, consequentStart);
        instructions.push({
          kind: "assign",
          operation: {
            op: "assign",
            target: resultSlot,
            value: lowerExpressionCalls(firstDefined(expression, ["consequent", "then", "trueValue", "ifTrue"], null))
          }
        });
        var jumpPastAlternate = instructions.length;
        instructions.push({ kind: "jump", target: -1 });
        var alternateStart = instructions.length;
        patchBranchTargets(conditionalBranches.falseJumps, alternateStart);
        instructions.push({
          kind: "assign",
          operation: {
            op: "assign",
            target: resultSlot,
            value: lowerExpressionCalls(firstDefined(expression, ["alternate", "else", "falseValue", "ifFalse"], null))
          }
        });
        instructions[jumpPastAlternate].target = instructions.length;
        return resultSlot;
      }
      var lowered = {};
      Object.keys(expression).forEach(function (key) {
        lowered[key] = key === "source" ? cloneValue(expression[key]) : lowerExpressionCalls(expression[key]);
      });
      return lowered;
    }

    function lowerOperationExpressions(operation) {
      var lowered = cloneValue(operation);
      ["target", "resultTarget", "buffer", "txBuffer", "rxBuffer", "pointer", "size", "count", "data", "input"].forEach(function (key) {
        if (lowered[key] !== undefined) lowered[key] = lowerExpressionCalls(lowered[key]);
      });
      if (Array.isArray(lowered.targets)) lowered.targets = lowered.targets.map(lowerExpressionCalls);
      [
        "value", "format", "capacity", "milliseconds", "expression", "compare", "timeout", "timeoutExpression", "length",
        "deviceAddress", "memoryAddress", "memoryAddressSize", "status", "ticks", "frequencyHz",
        "dutyPermille", "angle", "angleX10", "pulseUs", "raw", "x", "y", "width", "height",
        "color", "character", "scale", "leadingZero", "colon", "enabled"
      ].forEach(function (key) {
        if (lowered[key] !== undefined) lowered[key] = lowerExpressionCalls(lowered[key]);
      });
      if (Array.isArray(lowered.arguments)) lowered.arguments = lowered.arguments.map(lowerExpressionCalls);
      return lowered;
    }

    function patchBranchTargets(jumps, target) {
      jumps.forEach(function (jump) { instructions[jump.index][jump.field] = target; });
    }

    function compileCondition(condition) {
      var kind = canonicalExpressionKind(condition);
      if (kind === "logicalnot") {
        var negated = compileCondition(firstDefined(condition, ["value", "source"], false));
        return { trueJumps: negated.falseJumps, falseJumps: negated.trueJumps };
      }
      if (kind === "and" || kind === "or") {
        var left = compileCondition(firstDefined(condition, ["left", "a"], false));
        var rightStart = instructions.length;
        if (kind === "and") patchBranchTargets(left.trueJumps, rightStart);
        else patchBranchTargets(left.falseJumps, rightStart);
        var right = compileCondition(firstDefined(condition, ["right", "b"], false));
        return kind === "and"
          ? { trueJumps: right.trueJumps, falseJumps: left.falseJumps.concat(right.falseJumps) }
          : { trueJumps: left.trueJumps.concat(right.trueJumps), falseJumps: right.falseJumps };
      }
      // Lowering a call expression emits one or more instructions before the
      // branch. Record the branch index only after that expansion so jump
      // patching never targets the preceding call instruction.
      var loweredCondition = lowerExpressionCalls(condition);
      var branch = instructions.length;
      instructions.push({ kind: "branch", condition: loweredCondition, trueTarget: -1, falseTarget: -1 });
      return {
        trueJumps: [{ index: branch, field: "trueTarget" }],
        falseJumps: [{ index: branch, field: "falseTarget" }]
      };
    }

    function compileBlock(block, contextStack) {
      operationList(block).forEach(function (operation) {
        if (!operation) return;
        if (typeof operation !== "object") throw new TypeError("Firmware operation must be an object");

        var kind = canonicalOperationKind(operation);
        if (kind === "compoundassign") {
          var rawCompoundTarget = firstDefined(operation, ["target", "lvalue"], null);
          if (typeof rawCompoundTarget === "string") rawCompoundTarget = { kind: "variable", name: rawCompoundTarget };
          var compoundTarget = lowerExpressionCalls(rawCompoundTarget);
          if (!compoundTarget || typeof compoundTarget !== "object") {
            throw new TypeError("Compound assignment is missing a writable target");
          }
          var compoundOperator = normalizedKind(firstDefined(operation, ["operator", "binaryOperator"], ""));
          if (["add", "sub", "mul", "div", "mod", "bitand", "bitor", "bitxor", "shiftleft", "shiftright"].indexOf(compoundOperator) < 0) {
            throw new TypeError("Unsupported compound assignment operator: " + compoundOperator);
          }
          var compoundValueSlot = internalExpressionSlot("compound-" + (++expressionSlotSequence));
          instructions.push({
            kind: "assign",
            operation: {
              op: "assign",
              target: compoundValueSlot,
              value: cloneValue(compoundTarget),
              source: cloneValue(operation.source || null)
            }
          });
          var loweredCompoundValue = lowerExpressionCalls(firstDefined(operation, ["value", "expression", "right"], null));
          instructions.push({
            kind: "assign",
            operation: {
              op: "assign",
              target: cloneValue(compoundTarget),
              value: { kind: compoundOperator, left: compoundValueSlot, right: loweredCompoundValue },
              source: cloneValue(operation.source || null)
            }
          });
          return;
        }
        if (kind === "while") {
          var whileCheck = instructions.length;
          var whileCondition = compileCondition(firstDefined(operation, ["condition", "test"], { type: "literal", value: true }));
          var whileBodyStart = instructions.length;
          patchBranchTargets(whileCondition.trueJumps, whileBodyStart);
          var whileContext = { loop: true, breakJumps: [], continueJumps: [], continueTarget: whileCheck };
          compileBlock(firstDefined(operation, ["operations", "body", "do"], []), contextStack.concat([whileContext]));
          instructions.push({ kind: "jump", target: whileCheck });
          var whileEnd = instructions.length;
          patchBranchTargets(whileCondition.falseJumps, whileEnd);
          patchJumps(whileContext.breakJumps, whileEnd);
          patchJumps(whileContext.continueJumps, whileCheck);
          return;
        }

        if (kind === "dowhile") {
          // A do/while always executes its body once.  Continue statements
          // jump to the condition check, while break statements leave the
          // complete loop just like they do for while/for.
          var doBodyStart = instructions.length;
          var doContext = { loop: true, breakJumps: [], continueJumps: [], continueTarget: null };
          compileBlock(firstDefined(operation, ["operations", "body", "do"], []), contextStack.concat([doContext]));
          var doConditionStart = instructions.length;
          doContext.continueTarget = doConditionStart;
          patchJumps(doContext.continueJumps, doConditionStart);
          var doCondition = compileCondition(firstDefined(operation, ["condition", "test"], { type: "literal", value: true }));
          patchBranchTargets(doCondition.trueJumps, doBodyStart);
          var doEnd = instructions.length;
          patchBranchTargets(doCondition.falseJumps, doEnd);
          patchJumps(doContext.breakJumps, doEnd);
          return;
        }

        if (kind === "for") {
          compileBlock(firstDefined(operation, ["init", "initialization"], []), contextStack);
          var forCheck = instructions.length;
          var forCondition = compileCondition(firstDefined(operation, ["condition", "test"], { type: "literal", value: true }));
          var forBodyStart = instructions.length;
          patchBranchTargets(forCondition.trueJumps, forBodyStart);
          var forContext = { loop: true, breakJumps: [], continueJumps: [], continueTarget: null };
          compileBlock(firstDefined(operation, ["operations", "body", "do"], []), contextStack.concat([forContext]));
          var incrementStart = instructions.length;
          forContext.continueTarget = incrementStart;
          patchJumps(forContext.continueJumps, incrementStart);
          compileBlock(firstDefined(operation, ["increment", "update", "step"], []), contextStack);
          instructions.push({ kind: "jump", target: forCheck });
          var forEnd = instructions.length;
          patchBranchTargets(forCondition.falseJumps, forEnd);
          patchJumps(forContext.breakJumps, forEnd);
          return;
        }

        if (kind === "if") {
          var ifCondition = compileCondition(firstDefined(operation, ["condition", "test"], false));
          var ifThenStart = instructions.length;
          patchBranchTargets(ifCondition.trueJumps, ifThenStart);
          compileBlock(firstDefined(operation, ["then", "consequent", "thenOperations", "operations", "body"], []), contextStack);
          var alternate = firstDefined(operation, ["else", "alternate", "elseOperations"], []);
          if (operationList(alternate).length) {
            var jumpPastElse = instructions.length;
            instructions.push({ kind: "jump", target: -1 });
            patchBranchTargets(ifCondition.falseJumps, instructions.length);
            compileBlock(alternate, contextStack);
            instructions[jumpPastElse].target = instructions.length;
          } else {
            patchBranchTargets(ifCondition.falseJumps, instructions.length);
          }
          return;
        }

        if (kind === "switch") {
          var switchExpression = lowerExpressionCalls(firstDefined(operation, ["expression", "value", "test"], { type: "literal", value: 0 }));
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
          var inlineContext = nearestContext(contextStack, function (entry) { return Boolean(entry && entry.inlineFunction); });
          if (inlineContext) {
            var loweredInlineReturn = lowerOperationExpressions(operation);
            instructions.push({
              kind: "assign",
              operation: {
                op: "assign",
                target: cloneValue(inlineContext.resultTarget),
                value: hasOwn(loweredInlineReturn, "value") ? loweredInlineReturn.value : { kind: "literal", value: 0 },
                source: cloneValue(operation.source || null)
              }
            });
            var inlineReturnJump = instructions.length;
            instructions.push({ kind: "jump", target: -1 });
            inlineContext.returnJumps.push(inlineReturnJump);
            return;
          }
          instructions.push({ kind: "return", operation: lowerOperationExpressions(operation) });
          return;
        }

        if ([
          "uartreceive", "uarttransmit", "uartreceiveit", "uarttransmitit", "uartabortit", "uartreceivedma", "uarttransmitdma", "uartdmastop",
          "i2ctransmit", "i2creceive", "i2ctransmitit", "i2ctransmitdma", "i2creceiveit", "i2creceivedma", "i2cmemwrite", "i2cmemread", "i2cmemwriteit", "i2cmemwritedma", "i2cmemreadit", "i2cmemreaddma", "i2cabortit", "spitransmit", "spireceive", "spitransmitreceive", "spitransmitit", "spitransmitdma", "spireceiveit", "spireceivedma", "spitransmitreceiveit", "spitransmitreceivedma", "spiabortit", "adcstart", "adcstop", "adcstartit", "adcstopit", "adcstartdma", "adcstopdma", "adcpoll", "adcgetvalue",
          "timerstartit", "timerstopit", "pwmstart", "pwmstop", "pwmstartdma", "pwmstopdma", "pwmsetcompare",
          "irqdisable", "irqenable", "irqsetmask",
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
          "alicetm1637init", "alicetm1637setbrightness", "alicetm1637displaynumber", "alicetm1637clear",
          "alicetm1637displayraw", "alicetm1637writesegments", "alicetm1637setcolon",
          "alicews2812init", "alicews2812requiredpulsecount", "alicews2812encode", "alicews2812show",
          "aliceds18b20init", "aliceds18b20startconversion", "aliceds18b20readraw", "aliceds18b20rawtocelsiusx100", "expression"
        ].indexOf(kind) < 0) {
          var unsupportedSource = operation.source && typeof operation.source === "object" ? operation.source : {};
          var unsupportedLocation = unsupportedSource.file
            ? " at " + unsupportedSource.file + ":" + (unsupportedSource.line || 1) + ":" + (unsupportedSource.column || 1)
            : "";
          var unsupportedStatement = operation.statement ? ": " + operation.statement : "";
          throw new TypeError("Unsupported firmware operation: " + (operation.op || operation.type || operation.kind || "<missing>") + unsupportedLocation + unsupportedStatement);
        }
        instructions.push({ kind: kind, operation: lowerOperationExpressions(operation) });
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
      if (left.__alicePointer === "literal" || right.__alicePointer === "literal") {
        return left.__alicePointer === right.__alicePointer
          && String(left.id || left.name || left.text || "") === String(right.id || right.name || right.text || "")
          && Number(left.offset || 0) === Number(right.offset || 0);
      }
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
      status: "idle", running: false, time: 0, variables: initialVariables, gpio: {}, uartRx: new Map(), uartTx: [], i2cTx: [], i2cRx: [], spiTx: [], spiRx: [],
      uartTxCount: 0, i2cTxCount: 0, i2cRxCount: 0, spiTxCount: 0, spiRxCount: 0, adc: {}, dma: { transfers: [], history: [], sequence: 0 },
      interrupts: { events: [], history: [], sequence: 0, gpioLevels: {}, primask: 0, pendingCallbacks: [], drainingCallbacks: false }, pwm: {}, peripherals: {},
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
        onI2cRx: function (event) { shared.i2cRxCount += 1; appendBoundedHistory(shared.i2cRx, event); return forward("onI2cRx", event); },
        onSpiTx: function (event) { shared.spiTxCount += 1; appendBoundedHistory(shared.spiTx, event); return forward("onSpiTx", event); },
        onSpiRx: function (event) { shared.spiRxCount += 1; appendBoundedHistory(shared.spiRx, event); return forward("onSpiRx", event); },
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
        uartRx: uartRx, uartTx: cloneValue(shared.uartTx), i2cTx: cloneValue(shared.i2cTx), i2cRx: cloneValue(shared.i2cRx), spiTx: cloneValue(shared.spiTx), spiRx: cloneValue(shared.spiRx),
        uartTxCount: shared.uartTxCount, i2cTxCount: shared.i2cTxCount, i2cRxCount: shared.i2cRxCount, spiTxCount: shared.spiTxCount, spiRxCount: shared.spiRxCount, adc: cloneValue(shared.adc), dma: cloneValue(shared.dma),
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
      shared.status = "idle"; shared.running = false; shared.time = 0; Object.keys(shared.gpio).forEach(function (name) { delete shared.gpio[name]; }); shared.uartRx.clear(); shared.uartTx = []; shared.i2cTx = []; shared.i2cRx = []; shared.spiTx = []; shared.spiRx = [];
      shared.uartTxCount = 0; shared.i2cTxCount = 0; shared.i2cRxCount = 0; shared.spiTxCount = 0; shared.spiRxCount = 0;
      Object.keys(shared.adc).forEach(function (name) { delete shared.adc[name]; });
      shared.dma.transfers.splice(0, shared.dma.transfers.length); shared.dma.history.splice(0, shared.dma.history.length); shared.dma.sequence = 0;
      shared.interrupts.events.splice(0, shared.interrupts.events.length); shared.interrupts.history.splice(0, shared.interrupts.history.length); shared.interrupts.sequence = 0; shared.interrupts.gpioLevels = {};
      shared.interrupts.primask = 0; shared.interrupts.pendingCallbacks.splice(0, shared.interrupts.pendingCallbacks.length); shared.interrupts.drainingCallbacks = false;
      shared.interrupts.callbackDepth = 0;
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
    var cTypes = model.types || {};
    var cStorage = options.sharedStore && options.sharedStore.cStorage;
    var existingCStorage = Boolean(cStorage);
    if (!cStorage) cStorage = { lifetimes: {}, sequence: 0, storedPointers: new Map(), staticInitialized: new Set(), variableTypes: {} };
    if (options.sharedStore) options.sharedStore.cStorage = cStorage;
    Object.assign(cStorage.variableTypes, variableTypes);
    variableTypes = cStorage.variableTypes;
    var lifetimes = cStorage.lifetimes;
    var storedPointers = cStorage.storedPointers;
    var staticInitialized = cStorage.staticInitialized;
    var layoutCache = {};
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
    var peripheralDefaults = { oled: {}, lightSensor: {}, dht11: {}, ds18b20: {}, hcsr04: {}, sg90: {}, buzzer: {}, tm1637: {}, ws2812: {} };
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
      i2cRx: [],
      spiTx: [],
      spiRx: [],
      uartTxCount: 0,
      i2cTxCount: 0,
      i2cRxCount: 0,
      spiTxCount: 0,
      spiRxCount: 0,
      adc: sharedStore ? sharedStore.adc : {},
      dma: sharedStore ? sharedStore.dma : { transfers: [], history: [], sequence: 0 },
      interrupts: sharedStore ? sharedStore.interrupts : { events: [], history: [], sequence: 0, gpioLevels: {} },
      pwm: sharedStore ? sharedStore.pwm : {},
      peripherals: sharedStore ? sharedStore.peripherals : cloneValue(peripheralDefaults),
      heap: sharedStore ? sharedStore.heap : emptyHeap(),
      stdio: sharedStore ? sharedStore.stdio : [],
      stdioCount: 0,
      randomState: sharedStore ? sharedStore.randomState : 1,
      internalSlots: {},
      blocked: null,
      sleepUntil: null,
      pendingAdvanceMs: 0,
      operationsExecuted: 0,
      error: null,
      returnValue: undefined
    };
    if (!Array.isArray(runtime.interrupts.pendingCallbacks)) runtime.interrupts.pendingCallbacks = [];
    runtime.interrupts.primask = Number(runtime.interrupts.primask) & 1;
    if (runtime.interrupts.drainingCallbacks == null) runtime.interrupts.drainingCallbacks = false;
    if (!Number.isFinite(runtime.interrupts.callbackDepth)) runtime.interrupts.callbackDepth = 0;

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
        return /^(?:atof|strtod|strtof|strtold|sqrt|sqrtf|sqrtl|cbrt|cbrtf|cbrtl|pow|powf|powl|sin|sinf|sinl|cos|cosf|cosl|tan|tanf|tanl|asin|asinf|asinl|acos|acosf|acosl|atan|atanf|atanl|atan2|atan2f|atan2l|cosh|coshf|coshl|sinh|sinhf|sinhl|tanh|tanhf|tanhl|floor|floorf|floorl|ceil|ceilf|ceill|round|roundf|roundl|trunc|truncf|truncl|nearbyint|nearbyintf|nearbyintl|rint|rintf|rintl|fabs|fabsf|fabsl|fmod|fmodf|fmodl|remainder|remainderf|remainderl|fmin|fminf|fminl|fmax|fmaxf|fmaxl|copysign|copysignf|copysignl|hypot|hypotf|hypotl|ldexp|ldexpf|ldexpl|exp|expf|expl|exp2|exp2f|exp2l|log|logf|logl|log10|log10f|log10l|log2|log2f|log2l|frexp|frexpf|frexpl|modf|modff|modfl)$/.test(String(expression.function || expression.name || ""));
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
      if (kind === "initializer") {
        var initialValues = evaluate(expression.values || [], resolving);
        var initializerType = canonicalCType(expression.cType);
        return structLayout(initializerType)
          ? scalarFromMemoryBytes(scalarMemoryBytes(initialValues, initializerType), initializerType)
          : initialValues[0] == null ? 0 : initialValues[0];
      }
      if (kind === "constant") {
        var constantName = firstDefined(expression, ["name", "constant"], "");
        var resolvedConstant = resolveConstant(constantName, resolving);
        return resolvedConstant === undefined && hasOwn(expression, "value") ? expression.value : resolvedConstant;
      }
      if (kind === "variable") return runtime.variables[firstDefined(expression, ["name", "variable", "value"], "")];
      if (kind === "internalslot") return runtime.internalSlots[String(firstDefined(expression, ["name", "slot", "value"], ""))];
      if (kind === "tick") return Math.max(0, Math.floor(runtime.time));
      if (kind === "irqmask") return runtime.interrupts.primask;
      if (kind === "char") return byteArray(String(firstDefined(expression, ["value", "char"], "")))[0] || 0;
      if (kind === "sequence") {
        var sequenceExpressions = firstDefined(expression, ["expressions", "operands", "values"], []);
        if (!Array.isArray(sequenceExpressions)) sequenceExpressions = [sequenceExpressions];
        var sequenceValue;
        sequenceExpressions.forEach(function (item) { sequenceValue = evaluate(item, resolving); });
        return sequenceValue;
      }
      if (kind === "assignment") {
        var assignmentTarget = firstDefined(expression, ["target", "lvalue"], null);
        var assignmentOperator = normalizedKind(firstDefined(expression, ["operator", "assignmentOperator"], "assign"));
        var assignmentRhs = evaluate(firstDefined(expression, ["value", "expression", "right"], null), resolving);
        var assignedValue = assignmentRhs;
        if (assignmentOperator !== "assign") {
          var assignmentCurrent = evaluate(assignmentTarget, resolving);
          var numericLeft = assignmentCurrent == null ? 0 : Number(assignmentCurrent);
          var numericRight = assignmentRhs == null ? 0 : Number(assignmentRhs);
          if (assignmentOperator === "add") assignedValue = numericLeft + numericRight;
          else if (assignmentOperator === "sub") assignedValue = numericLeft - numericRight;
          else if (assignmentOperator === "mul") assignedValue = numericLeft * numericRight;
          else if (assignmentOperator === "div") assignedValue = numericRight === 0 ? 0 : Math.trunc(numericLeft / numericRight);
          else if (assignmentOperator === "mod") assignedValue = numericRight === 0 ? 0 : Math.trunc(numericLeft) % Math.trunc(numericRight);
          else if (assignmentOperator === "bitand") assignedValue = Math.trunc(numericLeft) & Math.trunc(numericRight);
          else if (assignmentOperator === "bitor") assignedValue = Math.trunc(numericLeft) | Math.trunc(numericRight);
          else if (assignmentOperator === "bitxor") assignedValue = Math.trunc(numericLeft) ^ Math.trunc(numericRight);
          else if (assignmentOperator === "shiftleft") assignedValue = Math.trunc(numericLeft) << (Math.trunc(numericRight) & 31);
          else if (assignmentOperator === "shiftright") assignedValue = Math.trunc(numericLeft) >> (Math.trunc(numericRight) & 31);
          else throw new Error("Unsupported assignment operator: " + assignmentOperator);
        }
        assign(assignmentTarget, assignedValue);
        return evaluate(assignmentTarget, resolving);
      }
      if (kind === "arrayindex") {
        var arraySource = firstDefined(expression, ["array", "source", "target", "name"], []);
        var array = typeof arraySource === "string" && hasOwn(runtime.variables, arraySource)
          ? runtime.variables[arraySource]
          : evaluate(arraySource, resolving);
        var index = Math.trunc(Number(evaluate(firstDefined(expression, ["index", "subscript"], 0), resolving)) || 0);
        if (isHeapPointer(array) || isVariablePointer(array)) return readPointer(pointerElementOffset(array, index));
        if (Array.isArray(array) && (index < 0 || index >= array.length)) throw new Error("Array read is out of bounds");
        if (isLiteralPointer(array)) return readPointer(pointerElementOffset(array, index));
        return array == null ? undefined : array[index];
      }
      if (kind === "member") {
        var fieldPointer = memberPointer(expression);
        if (fieldPointer) return fieldPointer.arrayLength != null ? fieldPointer : readPointer(fieldPointer);
        var objectSource = firstDefined(expression, ["object", "source", "target"], null);
        var objectValue = typeof objectSource === "string" && hasOwn(runtime.variables, objectSource)
          ? runtime.variables[objectSource]
          : evaluate(objectSource, resolving);
        if (Boolean(expression.pointer) && (isVariablePointer(objectValue) || isHeapPointer(objectValue))) {
          objectValue = readPointer(objectValue);
        }
        var memberName = String(firstDefined(expression, ["member", "field", "property", "name"], ""));
        return objectValue == null ? undefined : objectValue[memberName];
      }
      if (kind === "stringlength") {
        var stringValue = evaluate(firstDefined(expression, ["value", "source", "buffer"], ""), resolving);
        return cBytes(stringValue).length;
      }
      if (kind === "sizeof") {
        var sizedType = firstDefined(expression, ["cType", "typeName", "type"], null);
        if (sizedType && typeof sizedType === "string" && sizedType !== "sizeof") return cTypeSize(sizedType);
        return expressionSizeOf(firstDefined(expression, ["value", "source", "buffer"], null));
      }
      if (kind === "adcpoll") {
        return pollAdc({
          op: "adcPollForConversion",
          adc: firstDefined(expression, ["adc", "handle"], null),
          instance: expression.instance,
          timeout: firstDefined(expression, ["timeout", "timeoutMs"], null)
        });
      }
      if (kind === "positive") {
        var positiveValue = evaluate(firstDefined(expression, ["value", "source"], 0), resolving);
        return positiveValue == null ? 0 : Number(positiveValue);
      }
      if (kind === "negate") {
        var negativeValue = evaluate(firstDefined(expression, ["value", "source"], 0), resolving);
        return -(negativeValue == null ? 0 : Number(negativeValue));
      }
      if (kind === "logicalnot") return !evaluate(firstDefined(expression, ["value", "source"], 0), resolving);
      if (kind === "bitnot") return ~Math.trunc(Number(evaluate(firstDefined(expression, ["value", "source"], 0), resolving)) || 0);
      if (kind === "conditional") {
        return evaluate(firstDefined(expression, ["condition", "test"], false), resolving)
          ? evaluate(firstDefined(expression, ["consequent", "then", "trueValue", "ifTrue"], null), resolving)
          : evaluate(firstDefined(expression, ["alternate", "else", "falseValue", "ifFalse"], null), resolving);
      }
      if (kind === "cast") {
        var castValue = evaluate(firstDefined(expression, ["value", "source"], 0), resolving);
        var castType = canonicalCType(expression.cType || expression.castType).toLowerCase();
        if (castType.indexOf("*") >= 0) return castPointer(castValue, expression.cType || expression.castType);
        if (/\bfloat\b/.test(castType)) return Math.fround(castValue == null ? 0 : Number(castValue));
        if (/\bdouble\b/.test(castType)) return castValue == null ? 0 : Number(castValue);
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
        if (Array.isArray(rawArithmeticLeft)) rawArithmeticLeft = pointerForBufferValue(rawArithmeticLeft, 0);
        if (Array.isArray(rawArithmeticRight)) rawArithmeticRight = pointerForBufferValue(rawArithmeticRight, 0);
        if (kind === "sub" && (isHeapPointer(rawArithmeticLeft) || isVariablePointer(rawArithmeticLeft))
            && (isHeapPointer(rawArithmeticRight) || isVariablePointer(rawArithmeticRight))) {
          if (rawArithmeticLeft.__alicePointer !== rawArithmeticRight.__alicePointer
              || String(rawArithmeticLeft.id || rawArithmeticLeft.name || "") !== String(rawArithmeticRight.id || rawArithmeticRight.name || "")) return 0;
          var differenceWidth = Math.max(1, Math.trunc(Number(rawArithmeticLeft.elementSize) || 1));
          return Math.trunc((Number(rawArithmeticLeft.offset || 0) - Number(rawArithmeticRight.offset || 0)) / differenceWidth);
        }
        if ((kind === "add" || kind === "sub") && isPointer(rawArithmeticLeft)) {
          return pointerElementOffset(rawArithmeticLeft, (kind === "sub" ? -1 : 1) * (Number(rawArithmeticRight) || 0));
        }
        if (kind === "add" && isPointer(rawArithmeticRight)) {
          return pointerElementOffset(rawArithmeticRight, Number(rawArithmeticLeft) || 0);
        }
        var arithmeticLeft = rawArithmeticLeft == null ? 0 : Number(rawArithmeticLeft);
        var arithmeticRight = rawArithmeticRight == null ? 0 : Number(rawArithmeticRight);
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
        if (Array.isArray(left)) left = pointerForBufferValue(left, 0);
        if (Array.isArray(right)) right = pointerForBufferValue(right, 0);
        return cEqual(left, right);
      }
      if (kind === "ne") {
        var notEqualOperands = Array.isArray(expression.operands) ? expression.operands : [];
        var notEqualLeft = evaluate(firstDefined(expression, ["left", "a"], notEqualOperands[0]), resolving);
        var notEqualRight = evaluate(firstDefined(expression, ["right", "b"], notEqualOperands[1]), resolving);
        if (Array.isArray(notEqualLeft)) notEqualLeft = pointerForBufferValue(notEqualLeft, 0);
        if (Array.isArray(notEqualRight)) notEqualRight = pointerForBufferValue(notEqualRight, 0);
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
        if (Array.isArray(comparisonLeft)) comparisonLeft = pointerForBufferValue(comparisonLeft, 0);
        if (Array.isArray(comparisonRight)) comparisonRight = pointerForBufferValue(comparisonRight, 0);
        if (isPointer(comparisonLeft) && isPointer(comparisonRight)) {
          if (comparisonLeft.__alicePointer !== comparisonRight.__alicePointer
              || (comparisonLeft.name || comparisonLeft.id) !== (comparisonRight.name || comparisonRight.id)) {
            throw new Error("Pointer ordering requires pointers into the same object");
          }
          comparisonLeft = Number(comparisonLeft.offset || 0);
          comparisonRight = Number(comparisonRight.offset || 0);
        }
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
      if (type === "unsigned") return { bits: 32, unsigned: true };
      if (type === "unsigned char") return { bits: 8, unsigned: true };
      if (type === "signed char" || type === "char") return { bits: 8, unsigned: false };
      if (type === "unsigned short") return { bits: 16, unsigned: true };
      if (type === "short" || type === "signed short") return { bits: 16, unsigned: false };
      if (type === "unsigned int" || type === "unsigned long") return { bits: 32, unsigned: true };
      if (type === "int" || type === "signed int" || type === "long" || type === "signed long") return { bits: 32, unsigned: false };
      if (type === "unsigned long long") return { bits: 64, unsigned: true };
      if (type === "long long" || type === "signed long long") return { bits: 64, unsigned: false };
      return null;
    }

    // STM32 targets use a 32-bit data pointer. Keep the size table here rather
    // than relying on JavaScript's number representation so sizeof and pointer
    // arithmetic agree for fixed-width C objects.
    function canonicalCType(rawType, depth) {
      var type = String(rawType || "")
        .replace(/\b(const|volatile|register|static|restrict)\b/g, "")
        .replace(/\s*\*\s*/g, "*").replace(/\s+/g, " ").trim();
      if ((depth || 0) > 16) throw new Error("Circular C type alias: " + type);
      var stars = (type.match(/\*+$/) || [""])[0];
      var base = stars ? type.slice(0, -stars.length) : type;
      return cTypes[base] && cTypes[base].target ? canonicalCType(cTypes[base].target + stars, (depth || 0) + 1) : type;
    }

    function structLayout(rawType) {
      var type = canonicalCType(rawType);
      if (!cTypes[type] || !Array.isArray(cTypes[type].fields)) return null;
      if (layoutCache[type]) return layoutCache[type];
      var offset = 0, alignment = 1;
      var fields = cTypes[type].fields.map(function (field) {
        var child = structLayout(field.cType);
        var width = cTypeSize(field.cType);
        var align = child ? child.alignment : Math.min(8, width);
        alignment = Math.max(alignment, align);
        offset = Math.ceil(offset / align) * align;
        var result = Object.assign({}, field, { offset: offset, width: width });
        offset += width * (field.length == null ? 1 : field.length);
        return result;
      });
      return (layoutCache[type] = { fields: fields, alignment: alignment, size: Math.ceil(offset / alignment) * alignment });
    }

    function cTypeSize(rawType) {
      var canonical = canonicalCType(rawType);
      var type = canonical.toLowerCase();
      if (!type) return 4;
      if (type.indexOf("*") >= 0) return 4;
      var layout = structLayout(canonical);
      if (layout) return layout.size;
      if (type === "void") return 1;
      if (type === "float") return 4;
      if (type === "double") return 8;
      if (type === "long double") return 8;
      var integer = integerTypeInfo(type);
      if (integer) return Math.max(1, integer.bits / 8);
      // Unknown typedefs/handles are represented as one machine word in the
      // semantic runtime. This is deterministic and avoids inventing layout.
      return 4;
    }

    function cTypeIntegerInfo(rawType) {
      var type = canonicalCType(rawType);
      if (type.indexOf("*") >= 0) return null;
      return integerTypeInfo(type);
    }

    function variableStorageInfo(name) {
      var variableName = String(name || "");
      var declared = String(variableTypes[variableName] || "").trim();
      // Models produced by older projects may omit variableTypes for ad-hoc
      // byte buffers. Their JavaScript array representation is intentionally
      // byte-addressable, so retain the historical one-byte fallback.
      if (!declared && Array.isArray(runtime.variables[variableName])) {
        return { elementSize: 1, unsigned: true, type: "uint8_t" };
      }
      var elementType = canonicalCType(declared);
      var elementSize = cTypeSize(elementType);
      var integer = cTypeIntegerInfo(elementType);
      return {
        elementSize: Math.max(1, elementSize),
        unsigned: !integer || integer.unsigned !== false,
        type: elementType || "int"
      };
    }

    function pointerForVariable(name, offset) {
      var declaredType = canonicalCType(variableTypes[name] || "");
      var pointerStorage = declaredType.indexOf("*") >= 0;
      var info = variableStorageInfo(name);
      return {
        __alicePointer: "variable",
        name: String(name || ""),
        offset: Math.trunc(Number(offset) || 0),
        elementSize: pointerStorage ? 4 : info.elementSize,
        storageElementSize: info.elementSize,
        pointeeType: pointerStorage ? declaredType : info.type,
        unsigned: info.unsigned,
        lifetime: lifetimes[name]
      };
    }

    function expressionSizeOf(expression) {
      if (expression == null) return 4;
      if (typeof expression === "string") {
        if (hasOwn(runtime.variables, expression)) return expressionSizeOf({ kind: "variable", name: expression });
        return 4;
      }
      if (typeof expression !== "object") return 4;
      var kind = canonicalExpressionKind(expression);
      if (kind === "literal") {
        var numericType = normalizedKind(expression.numericType);
        if (numericType === "float") return 4;
        if (numericType === "double" || numericType === "longdouble") return 8;
        return 4;
      }
      if (kind === "string") {
        var stringBytes = firstDefined(expression, ["bytes"], null);
        return (Array.isArray(stringBytes) ? stringBytes.length : byteArray(firstDefined(expression, ["value", "text"], "")).length) + 1;
      }
      if (kind === "char") return 1;
      if (kind === "variable") {
        var variableName = String(firstDefined(expression, ["name", "variable", "value"], ""));
        var declared = String(variableTypes[variableName] || "").trim();
        if (declared.indexOf("*") >= 0) return 4;
        var storage = variableStorageInfo(variableName);
        var variableValue = runtime.variables[variableName];
        if (Array.isArray(variableValue)) return variableValue.length * storage.elementSize;
        return storage.elementSize;
      }
      if (kind === "arrayindex") {
        var source = firstDefined(expression, ["array", "source"], null);
        var sourceName = firstDefined(expression, ["name"], "");
        if (!sourceName && source && typeof source === "object" && canonicalExpressionKind(source) === "variable") {
          sourceName = firstDefined(source, ["name", "variable", "value"], "");
        }
        if (sourceName) {
          var sourceType = String(variableTypes[sourceName] || "");
          if (sourceType.indexOf("*") >= 0) return cTypeSize(sourceType.replace(/\*\s*$/, "").trim());
          return variableStorageInfo(sourceName).elementSize;
        }
        var sourceValue = source == null ? undefined : evaluate(source);
        if (isHeapPointer(sourceValue) || isVariablePointer(sourceValue)) return Math.max(1, Number(sourceValue.elementSize) || 1);
        return 1;
      }
      if (kind === "dereference") {
        var pointerExpression = firstDefined(expression, ["pointer", "value", "source"], null);
        if (pointerExpression && typeof pointerExpression === "object" && canonicalExpressionKind(pointerExpression) === "variable") {
          var pointerName = String(firstDefined(pointerExpression, ["name", "variable", "value"], ""));
          var pointerType = String(variableTypes[pointerName] || "");
          if (pointerType.indexOf("*") >= 0) return cTypeSize(pointerType.replace(/\*\s*$/, "").trim());
        }
        var pointerValue = evaluate(pointerExpression);
        if (isHeapPointer(pointerValue) || isVariablePointer(pointerValue)) return Math.max(1, Number(pointerValue.elementSize) || 1);
        return 4;
      }
      if (kind === "addressof") return 4;
      if (kind === "cast") return cTypeSize(expression.cType || expression.castType || "int");
      if (kind === "sizeOf") return 4;
      if (kind === "member") {
        var member = memberPointer(expression);
        return member ? member.elementSize * (member.arrayLength == null ? 1 : member.arrayLength) : 4;
      }
      return 4;
    }

    function pointerTypeInfo(name) {
      return pointedTypeInfo(variableTypes[name]);
    }

    function pointedTypeInfo(rawType) {
      var type = canonicalCType(rawType);
      if (type.indexOf("*") < 0) return { elementSize: 1, unsigned: true };
      var pointedType = type.replace(/\*$/, "").trim();
      var info = cTypeIntegerInfo(pointedType);
      return {
        elementSize: cTypeSize(pointedType),
        unsigned: info ? info.unsigned : true,
        pointeeType: pointedType
      };
    }

    function castPointer(value, type) {
      // GPIO constants denote opaque peripheral identities, not text buffers.
      // Preserve the identity without assuming a physical register address.
      if (typeof value === "string" && /^GPIO[A-K]$/.test(value) && /^GPIO_TypeDef\s*\*$/.test(canonicalCType(type))) value = pointerForVariable(value, 0);
      else if (Array.isArray(value) || typeof value === "string") value = pointerForBufferValue(value, 0);
      return isPointer(value) ? Object.assign({}, value, pointedTypeInfo(type)) : value;
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
      var canonicalType = canonicalCType(variableTypes[name]);
      var declaredType = canonicalType.toLowerCase();
      if (declaredType.indexOf("*") >= 0 && typeof value === "string") return castPointer(value, canonicalType);
      if (declaredType.indexOf("*") >= 0 && value && typeof value === "object" && value.__alicePointer) {
        var pointerInfo = pointerTypeInfo(name);
        var pointerCopy = cloneValue(value);
        pointerCopy.elementSize = pointerInfo.elementSize;
        pointerCopy.pointeeType = pointerInfo.pointeeType;
        pointerCopy.unsigned = pointerInfo.unsigned;
        if (!pointerCopy.storageElementSize && pointerCopy.__alicePointer === "variable") {
          pointerCopy.storageElementSize = variableStorageInfo(pointerCopy.name).elementSize;
        }
        return pointerCopy;
      }
      if (declaredType.indexOf("*") >= 0 && Array.isArray(value)) {
        // C array expressions decay to a pointer in assignment/argument
        // contexts. The evaluator preserves the original array reference, so
        // recover its declared storage name and create a typed pointer.
        var sourceName = Object.keys(runtime.variables).find(function (candidate) {
          return runtime.variables[candidate] === value;
        });
        if (sourceName) {
          var decayed = pointerForVariable(sourceName, 0);
          var decayInfo = pointerTypeInfo(name);
          decayed.elementSize = decayInfo.elementSize;
          decayed.pointeeType = decayInfo.pointeeType;
          decayed.unsigned = decayInfo.unsigned;
          return decayed;
        }
      }
      if (declaredType.indexOf("*") < 0 && /\bfloat\b/.test(declaredType)) {
        return Math.fround(value == null ? 0 : Number(value));
      }
      if (declaredType.indexOf("*") < 0 && /\bdouble\b/.test(declaredType)) {
        return value == null ? 0 : Number(value);
      }
      if (structLayout(canonicalType)) {
        if (Array.isArray(value)) return value.map(function (item) { return scalarFromMemoryBytes(scalarMemoryBytes(item, canonicalType), canonicalType); });
        return scalarFromMemoryBytes(scalarMemoryBytes(value, canonicalType), canonicalType);
      }
      var info = integerTypeInfo(variableTypes[name]);
      if (Array.isArray(value)) {
        return value.map(function (item) {
          if (declaredType.indexOf("*") >= 0 || !info) return cloneValue(item);
          return coerceIntegerValue(item, info);
        });
      }
      if (!info || (value && typeof value === "object")) return cloneValue(value);
      return coerceIntegerValue(value, info);
    }

    // Normalize model-provided array initializers once their declared types
    // are available. This preserves C's truncation/sign rules before any
    // pointer or sizeof operation observes the storage.
    function initializeCStorage() {
      Object.keys(runtime.variables).forEach(function (name) {
        if (hasOwn(variableTypes, name)) runtime.variables[name] = coerceCValue(name, runtime.variables[name]);
      });
      Object.keys(model.initializers || {}).forEach(function (name) { assign(name, evaluate(model.initializers[name])); });
    }
    if (!existingCStorage) initializeCStorage();

    function scalarMemoryBytes(value, rawType) {
      var canonicalType = canonicalCType(rawType);
      var type = canonicalType.toLowerCase();
      var size = cTypeSize(type);
      var layout = structLayout(canonicalType);
      if (layout) {
        var recordBytes = new Array(layout.size).fill(0);
        layout.fields.forEach(function (field, fieldIndex) {
          var fieldValue = value && typeof value === "object" ? value[Array.isArray(value) ? fieldIndex : field.name] : 0;
          for (var i = 0; i < (field.length == null ? 1 : field.length); i += 1) {
            scalarMemoryBytes(field.length == null ? fieldValue : (fieldValue || [])[i], field.cType)
              .forEach(function (byte, index) { recordBytes[field.offset + i * field.width + index] = byte; });
          }
        });
        return recordBytes;
      }
      if (type.indexOf("*") >= 0 && typeof value === "string" && /^GPIO[A-K]$/.test(value) && /^GPIO_TypeDef\s*\*$/.test(canonicalType)) value = castPointer(value, canonicalType);
      if (type.indexOf("*") >= 0 && isPointer(value)) {
        var address = syntheticPointerAddress(value);
        storedPointers.set(address, cloneValue(value));
        value = address;
      }
      var bytes = new Array(size).fill(0);
      var number = value == null ? 0 : Number(value);
      if (type === "float" || type === "double" || type === "long double") {
        var buffer = new ArrayBuffer(size);
        var view = new DataView(buffer);
        if (type === "float") view.setFloat32(0, number, true);
        else view.setFloat64(0, number, true);
        for (var floatIndex = 0; floatIndex < size; floatIndex += 1) bytes[floatIndex] = view.getUint8(floatIndex);
        return bytes;
      }
      if (!Number.isFinite(number)) number = 0;
      var info = cTypeIntegerInfo(type);
      if (info) number = coerceIntegerValue(number, info);
      number = Math.trunc(number);
      var modulus = Math.pow(2, size * 8);
      number = ((number % modulus) + modulus) % modulus;
      for (var index = 0; index < size; index += 1) {
        bytes[index] = Math.floor(number / Math.pow(256, index)) & 0xff;
      }
      return bytes;
    }

    function scalarFromMemoryBytes(bytes, rawType) {
      var canonicalType = canonicalCType(rawType);
      var type = canonicalType.toLowerCase();
      var layout = structLayout(canonicalType);
      if (layout) {
        var record = {};
        layout.fields.forEach(function (field) {
          var values = [];
          for (var i = 0; i < (field.length == null ? 1 : field.length); i += 1) {
            var offset = field.offset + i * field.width;
            values.push(scalarFromMemoryBytes(bytes.slice(offset, offset + field.width), field.cType));
          }
          record[field.name] = field.length == null ? values[0] : values;
        });
        return record;
      }
      var size = cTypeSize(type);
      var normalized = Array.prototype.slice.call(bytes || [], 0, size);
      while (normalized.length < size) normalized.push(0);
      if (type === "float" || type === "double" || type === "long double") {
        var buffer = new ArrayBuffer(size);
        var view = new DataView(buffer);
        normalized.forEach(function (item, index) { view.setUint8(index, Number(item) & 0xff); });
        return type === "float" ? view.getFloat32(0, true) : view.getFloat64(0, true);
      }
      var result = 0;
      normalized.forEach(function (item, index) { result += (Number(item) & 0xff) * Math.pow(256, index); });
      if (type.indexOf("*") >= 0) return storedPointers.has(result) ? castPointer(storedPointers.get(result), canonicalType) : result;
      var info = cTypeIntegerInfo(type);
      if (info && info.unsigned === false) {
        var signLimit = Math.pow(2, size * 8 - 1);
        if (result >= signLimit) result -= Math.pow(2, size * 8);
      }
      return info ? coerceIntegerValue(result, info) : result;
    }

    function variableMemoryBytes(name) {
      var variableName = String(name || "");
      var value = runtime.variables[variableName];
      var info = variableStorageInfo(variableName);
      var type = info.type;
      if (Array.isArray(value)) {
        var arrayBytes = [];
        value.forEach(function (item) { arrayBytes = arrayBytes.concat(scalarMemoryBytes(item, type)); });
        return arrayBytes;
      }
      return scalarMemoryBytes(value, type);
    }

    function variableMemoryWrite(name, offset, bytes) {
      var variableName = String(name || "");
      var value = runtime.variables[variableName];
      var info = variableStorageInfo(variableName);
      var storage = variableMemoryBytes(variableName);
      var start = Math.trunc(Number(offset) || 0);
      var incoming = Array.prototype.slice.call(bytes || []).map(function (item) { return Number(item) & 0xff; });
      if (start < 0 || start + incoming.length > storage.length) throw new Error("Variable pointer write is out of bounds");
      incoming.forEach(function (item, index) { storage[start + index] = item; });
      if (Array.isArray(value)) {
        var elementSize = info.elementSize;
        for (var arrayIndex = 0; arrayIndex < value.length; arrayIndex += 1) {
          var begin = arrayIndex * elementSize;
          var end = begin + elementSize;
          if (end <= start || begin >= start + incoming.length) continue;
          value[arrayIndex] = scalarFromMemoryBytes(storage.slice(begin, end), info.type);
        }
        runtime.variables[variableName] = value;
      } else {
        runtime.variables[variableName] = scalarFromMemoryBytes(storage, info.type);
      }
    }

    function variableMemoryRead(name, offset, count) {
      var bytes = variableMemoryBytes(name);
      var start = Math.trunc(Number(offset) || 0);
      if (start < 0 || start > bytes.length) throw new Error("Variable pointer read is out of bounds");
      var length = count == null ? bytes.length - start : Math.max(0, Math.trunc(Number(count) || 0));
      if (start + length > bytes.length) throw new Error("Variable pointer read is out of bounds");
      return bytes.slice(start, start + length);
    }

    function assign(target, value) {
      if (typeof target === "string") {
        runtime.variables[target] = coerceCValue(target, value);
        return;
      }
      if (!target || typeof target !== "object") throw new Error("Assignment target is missing");
      var kind = canonicalExpressionKind(target);
      if (kind === "internalslot") {
        var slotName = String(firstDefined(target, ["name", "slot", "value"], ""));
        if (!slotName) throw new Error("Internal result slot is missing its name");
        runtime.internalSlots[slotName] = cloneValue(value);
        return;
      }
      if (kind === "variable" || (!kind && (target.name || target.variable))) {
        var variableName = firstDefined(target, ["name", "variable"], "");
        runtime.variables[variableName] = coerceCValue(variableName, value);
        return;
      }
      if (kind === "member") {
        var fieldPointer = memberPointer(target);
        if (fieldPointer) { writePointer(fieldPointer, value); return; }
        var memberName = String(firstDefined(target, ["member", "field", "property", "name"], ""));
        if (!memberName) throw new Error("Struct member assignment is missing its field name");

        function ensureMemberObject(objectExpression, pointerAccess) {
          var objectKind = canonicalExpressionKind(objectExpression);
          if (objectKind === "variable") {
            var variableName = String(firstDefined(objectExpression, ["name", "variable", "value"], ""));
            var variableValue = runtime.variables[variableName];
            if (pointerAccess && (isVariablePointer(variableValue) || isHeapPointer(variableValue))) {
              variableValue = readPointer(variableValue);
            }
            if (variableValue == null || typeof variableValue !== "object" || Array.isArray(variableValue)) {
              if (pointerAccess) throw new Error("Struct pointer does not reference an object");
              variableValue = {};
              runtime.variables[variableName] = variableValue;
            }
            return variableValue;
          }
          if (objectKind === "member") {
            var nestedName = String(firstDefined(objectExpression, ["member", "field", "property", "name"], ""));
            var nestedParent = ensureMemberObject(
              firstDefined(objectExpression, ["object", "source", "target"], null),
              Boolean(objectExpression.pointer)
            );
            var nestedValue = nestedParent[nestedName];
            if (nestedValue == null || typeof nestedValue !== "object" || Array.isArray(nestedValue)) {
              if (objectExpression.pointer) throw new Error("Struct pointer member does not reference an object");
              nestedValue = {};
              nestedParent[nestedName] = nestedValue;
            }
            return nestedValue;
          }
          var evaluatedObject = evaluate(objectExpression);
          if (pointerAccess && (isVariablePointer(evaluatedObject) || isHeapPointer(evaluatedObject))) {
            evaluatedObject = readPointer(evaluatedObject);
          }
          if (evaluatedObject == null || typeof evaluatedObject !== "object" || Array.isArray(evaluatedObject)) {
            throw new Error("Struct member base is not an object");
          }
          return evaluatedObject;
        }

        var memberObjectExpression = firstDefined(target, ["object", "source", "target"], null);
        var memberObject = ensureMemberObject(memberObjectExpression, Boolean(target.pointer));
        memberObject[memberName] = cloneValue(value);
        return;
      }
      if (kind === "arrayindex" || (!kind && target.array !== undefined && target.index !== undefined)) {
        var arraySource = firstDefined(target, ["array", "source"], null);
        var arrayName = firstDefined(target, ["name"], "");
        if (!arrayName && arraySource && typeof arraySource === "object") {
          var sourceKind = canonicalExpressionKind(arraySource);
          if (sourceKind === "variable") arrayName = firstDefined(arraySource, ["name", "variable", "value"], "");
        }
        var index = Math.trunc(Number(evaluate(target.index)) || 0);
        if (arrayName && hasOwn(runtime.variables, arrayName)) {
          var namedArrayValue = runtime.variables[arrayName];
          if (isHeapPointer(namedArrayValue) || isVariablePointer(namedArrayValue)) {
            writePointer(pointerElementOffset(namedArrayValue, index), value);
            return;
          }
          if (Array.isArray(namedArrayValue)) {
            if (index < 0 || index >= namedArrayValue.length) throw new Error("Array assignment is out of bounds");
            namedArrayValue[index] = coerceCValue(arrayName, value);
            runtime.variables[arrayName] = namedArrayValue;
            return;
          }
        }
        // Parenthesized/general array bases (for example ``(a)[i]``) can be
        // pointers or pointer-valued expressions. Resolve them once and use
        // the same typed pointer path as ``p[i]``.
        var arrayValue = arraySource == null ? undefined : evaluate(arraySource);
        if (isHeapPointer(arrayValue) || isVariablePointer(arrayValue)) {
          writePointer(pointerElementOffset(arrayValue, index), value);
          return;
        }
        throw new Error("Array assignment target is not writable");
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

    function isLiteralPointer(value) {
      return Boolean(value && typeof value === "object" && value.__alicePointer === "literal");
    }

    function isPointer(value) {
      return isVariablePointer(value) || isHeapPointer(value) || isLiteralPointer(value);
    }

    function checkPointerLifetime(pointer) {
      if (isVariablePointer(pointer) && pointer.lifetime != null && lifetimes[pointer.name] !== pointer.lifetime) {
        throw new Error("Dangling pointer: local object lifetime has ended");
      }
    }

    function memberPointer(expression) {
      var base = firstDefined(expression, ["object", "source", "target"], null);
      var pointer;
      if (expression.pointer) {
        pointer = evaluate(base);
        if (pointer === 0 || pointer == null) throw new Error("Null pointer member access");
      } else {
        var baseKind = canonicalExpressionKind(base);
        if (["variable", "arrayindex", "dereference", "member"].indexOf(baseKind) < 0) return null;
        if (baseKind === "member") pointer = memberPointer(base);
        else pointer = addressOf(base);
      }
      if (!isPointer(pointer)) return null;
      checkPointerLifetime(pointer);
      var layout = structLayout(pointer.pointeeType);
      if (!layout) return null;
      var name = String(firstDefined(expression, ["member", "field", "property", "name"], ""));
      var field = layout.fields.find(function (item) { return item.name === name; });
      if (!field) throw new Error("Unknown struct member: " + name);
      var result = Object.assign(pointerOffset(pointer, field.offset), pointedTypeInfo(field.cType + "*"));
      delete result.arrayLength;
      if (field.length != null) result.arrayLength = field.length;
      return result;
    }

    function pointerOffset(pointer, offset) {
      if (!pointer || typeof pointer !== "object") return pointer;
      var copy = cloneValue(pointer);
      copy.offset = Math.trunc(Number(copy.offset || 0) + Number(offset || 0));
      return copy;
    }

    function pointerElementOffset(pointer, elements) {
      return pointerOffset(pointer, Number(elements || 0) * Math.max(1, Math.trunc(Number(pointer && pointer.elementSize) || 1)));
    }

    function addressOf(expression) {
      if (!expression || typeof expression !== "object") throw new Error("Address-of requires a named variable or array element");
      var kind = canonicalExpressionKind(expression);
      if (kind === "variable") {
        var variableName = String(firstDefined(expression, ["name", "variable", "value"], ""));
        // Taking the address of an array denotes its first element for the
        // byte-oriented runtime, which matches the usual array-to-pointer use
        // in HAL buffer APIs while retaining the declared element width.
        return pointerForVariable(variableName, 0);
      }
      if (kind === "arrayindex") {
        var arraySource = firstDefined(expression, ["array", "source"], null);
        var arrayName = firstDefined(expression, ["name"], "");
        if (!arrayName && arraySource && typeof arraySource === "object" && canonicalExpressionKind(arraySource) === "variable") {
          arrayName = firstDefined(arraySource, ["name", "variable", "value"], "");
        }
        var index = Math.trunc(Number(evaluate(firstDefined(expression, ["index", "subscript"], 0))) || 0);
        if (arrayName && hasOwn(runtime.variables, arrayName)) {
          var namedValue = runtime.variables[arrayName];
          if (isHeapPointer(namedValue) || isVariablePointer(namedValue)) return pointerElementOffset(namedValue, index);
          return pointerForVariable(arrayName, index * variableStorageInfo(arrayName).elementSize);
        }
        var evaluatedSource = arraySource == null ? undefined : evaluate(arraySource);
        if (isHeapPointer(evaluatedSource) || isVariablePointer(evaluatedSource)) return pointerElementOffset(evaluatedSource, index);
        throw new Error("Address-of array target is unsupported");
      }
      if (kind === "dereference") return evaluate(firstDefined(expression, ["pointer", "value"], null));
      if (kind === "member") {
        var member = memberPointer(expression);
        if (member) return member;
      }
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
      checkPointerLifetime(pointer);
      if (isVariablePointer(pointer)) {
        var variableValue = runtime.variables[pointer.name];
        var variableInfo = variableStorageInfo(pointer.name);
        var variableOffset = Math.trunc(Number(pointer.offset) || 0);
        var pointerWidth = Math.max(1, Math.trunc(Number(pointer.elementSize) || variableInfo.elementSize || 1));
        var pointerBytes = variableMemoryRead(pointer.name, variableOffset, pointerWidth);
        // A typed pointer must address a complete object. Byte pointers are
        // still supported (and are useful for packed protocol buffers), while
        // misaligned wider accesses fail explicitly instead of reading a
        // neighboring array element by accident.
        var pointeeLayout = structLayout(pointer.pointeeType);
        var pointerAlignment = pointeeLayout ? pointeeLayout.alignment : Math.min(8, pointerWidth);
        if (variableOffset % pointerAlignment !== 0) throw new Error("Unaligned variable pointer read");
        var pointeeType = String(pointer.pointeeType || (pointer.unsigned === false ? "int" : variableInfo.type));
        return scalarFromMemoryBytes(pointerBytes, pointeeType);
      }
      if (pointer && typeof pointer === "object" && pointer.__alicePointer === "literal") {
        var literalPointerBytes = byteArray(pointer.bytes || pointer.text || "");
        var literalPointerOffset = Math.trunc(Number(pointer.offset) || 0);
        var literalWidth = Math.max(1, Math.trunc(Number(pointer.elementSize) || 1));
        if (literalPointerOffset < 0 || literalPointerOffset + literalWidth > literalPointerBytes.length) throw new Error("Literal pointer read is out of bounds");
        return scalarFromMemoryBytes(literalPointerBytes.slice(literalPointerOffset, literalPointerOffset + literalWidth), String(pointer.pointeeType || "char"));
      }
      var allocation = heapAllocation(pointer);
      if (!allocation) throw new Error("Value is not a valid pointer");
      var offset = Math.trunc(Number(pointer.offset) || 0);
      var width = Math.max(1, Math.trunc(Number(pointer.elementSize) || 1));
      if (offset < 0 || offset + width > allocation.size) throw new Error("Heap pointer read is out of bounds");
      var heapBytes = [];
      for (var readIndex = 0; readIndex < width; readIndex += 1) {
        if (!allocation.initialized[offset + readIndex]) throw new Error("Read from uninitialized malloc memory");
        heapBytes.push(allocation.bytes[offset + readIndex]);
      }
      var heapPointeeType = String(pointer.pointeeType || (pointer.unsigned === false ? "int" : "unsigned int"));
      return scalarFromMemoryBytes(heapBytes, heapPointeeType);
    }

    function writePointer(pointer, value) {
      if (pointer == null || pointer === 0) throw new Error("Null pointer write");
      checkPointerLifetime(pointer);
      if (pointer && typeof pointer === "object" && pointer.__alicePointer === "literal") {
        throw new Error("String literal pointer is read-only");
      }
      if (isVariablePointer(pointer)) {
        var variableInfo = variableStorageInfo(pointer.name);
        var variableOffset = Math.trunc(Number(pointer.offset) || 0);
        var pointerWidth = Math.max(1, Math.trunc(Number(pointer.elementSize) || variableInfo.elementSize || 1));
        // Legacy ad-hoc scalar variables have no declaration metadata. Keep
        // their JavaScript numeric kind (notably scanf's floating results)
        // instead of forcing every value through the default int serializer.
        if (!hasOwn(variableTypes, pointer.name) && !Array.isArray(runtime.variables[pointer.name])) {
          if (variableOffset !== 0) throw new Error("Scalar pointer write is out of bounds");
          runtime.variables[pointer.name] = value;
          return;
        }
        var pointeeLayout = structLayout(pointer.pointeeType);
        var pointerAlignment = pointeeLayout ? pointeeLayout.alignment : Math.min(8, pointerWidth);
        if (variableOffset % pointerAlignment !== 0) throw new Error("Unaligned variable pointer write");
        var targetType = String(pointer.pointeeType || (pointer.unsigned === false && pointerWidth === 4 ? "int" : variableInfo.type));
        variableMemoryWrite(pointer.name, variableOffset, scalarMemoryBytes(value, targetType).slice(0, pointerWidth));
        return;
      }
      var allocation = heapAllocation(pointer);
      if (!allocation) throw new Error("Value is not a valid pointer");
      var offset = Math.trunc(Number(pointer.offset) || 0);
      var width = Math.max(1, Math.trunc(Number(pointer.elementSize) || 1));
      if (offset < 0 || offset + width > allocation.size) throw new Error("Heap pointer write is out of bounds");
      var heapValueBytes = scalarMemoryBytes(value, String(pointer.pointeeType || (pointer.unsigned === false ? "int" : "unsigned int")));
      for (var writeIndex = 0; writeIndex < width; writeIndex += 1) {
        allocation.bytes[offset + writeIndex] = Number(heapValueBytes[writeIndex] || 0) & 0xff;
        allocation.initialized[offset + writeIndex] = true;
      }
    }

    // C string-search routines return a pointer into their input.  Preserve
    // that relationship for arrays and heap buffers instead of reducing the
    // result to a JavaScript index.  String literals are represented by a
    // read-only, deterministic pointer so comparisons and subsequent reads
    // still follow normal C semantics.
    function pointerForBufferValue(value, offset) {
      var normalizedOffset = Math.max(0, Math.trunc(Number(offset) || 0));
      if (isVariablePointer(value) || isHeapPointer(value)) return pointerOffset(value, normalizedOffset);
      if (Array.isArray(value)) {
        var sourceName = Object.keys(runtime.variables).find(function (candidate) {
          return runtime.variables[candidate] === value;
        });
        if (sourceName) return pointerForVariable(sourceName, normalizedOffset);
      }
      if (typeof value === "string") {
        return {
          __alicePointer: "literal",
          id: value,
          text: value,
          bytes: byteArray(value).concat([0]),
          offset: normalizedOffset,
          elementSize: 1,
          unsigned: true,
          pointeeType: "char"
        };
      }
      return null;
    }

    function memoryBytes(value, count) {
      var bytes;
      checkPointerLifetime(value);
      if (isVariablePointer(value)) {
        bytes = variableMemoryRead(value.name, Math.trunc(Number(value.offset) || 0));
      } else if (isHeapPointer(value)) {
        var allocation = heapAllocation(value);
        var offset = Math.max(0, Math.trunc(Number(value.offset) || 0));
        var limit = count == null ? allocation.size - offset : Math.max(0, Math.trunc(Number(count) || 0));
        if (offset + limit > allocation.size) throw new Error("Heap memory read is out of bounds");
        for (var initializedIndex = offset; initializedIndex < offset + limit; initializedIndex += 1) {
          if (!allocation.initialized[initializedIndex]) throw new Error("Read from uninitialized malloc memory");
        }
        bytes = allocation.bytes.slice(offset, offset + limit);
      } else if (value && typeof value === "object" && value.__alicePointer === "literal") {
        var literalBytes = byteArray(value.bytes || value.text || "");
        var literalOffset = Math.max(0, Math.trunc(Number(value.offset) || 0));
        if (literalOffset > literalBytes.length) throw new Error("Literal pointer read is out of bounds");
        bytes = literalBytes.slice(literalOffset);
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
        return isHeapPointer(runtime.variables[name]) || isVariablePointer(runtime.variables[name])
          ? runtime.variables[name]
          : pointerForVariable(name, 0);
      }
      if (kind === "arrayindex") return addressOf(expression);
      var evaluated = evaluate(expression);
      if (isHeapPointer(evaluated) || isVariablePointer(evaluated)) return evaluated;
      throw new Error("Memory destination is not writable");
    }

    function writeMemory(pointer, bytes) {
      var bytePointer = cloneValue(pointer);
      if (isHeapPointer(bytePointer) || isVariablePointer(bytePointer)) {
        bytePointer.elementSize = 1;
        bytePointer.pointeeType = "uint8_t";
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
        unsigned: typeInfo.unsigned !== false,
        pointeeType: typeInfo.pointeeType || (typeInfo.unsigned === false ? "int" : "uint8_t")
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

    function stringByteAt(value, index) {
      index = Math.max(0, Math.trunc(Number(index) || 0));
      if (typeof value === "string") {
        var literalBytes = byteArray(value);
        if (index === literalBytes.length) return 0;
        if (index > literalBytes.length) throw new Error("String literal read is out of bounds");
        return literalBytes[index];
      }

      var pointer = value;
      if (isHeapPointer(pointer) || isVariablePointer(pointer)
          || pointer && typeof pointer === "object" && pointer.__alicePointer === "literal") {
        pointer = cloneValue(pointer);
        pointer.elementSize = 1;
        pointer.pointeeType = "uint8_t";
        pointer.unsigned = true;
        return Number(readPointer(pointerOffset(pointer, index))) & 0xff;
      }

      var bytes = memoryBytes(value);
      if (index >= bytes.length) throw new Error("String read is out of bounds");
      return Number(bytes[index]) & 0xff;
    }

    function boundedCStringBytes(value, count) {
      var maximum = Math.max(0, Math.trunc(Number(count) || 0));
      var bytes = [];
      for (var index = 0; index < maximum; index += 1) {
        var byte = stringByteAt(value, index);
        if (byte === 0) break;
        bytes.push(byte);
      }
      return bytes;
    }

    function compareCStringBytes(left, right, count) {
      var bounded = count != null;
      var maximum = bounded ? Math.max(0, Math.trunc(Number(count) || 0)) : Infinity;
      for (var index = 0; index < maximum; index += 1) {
        var leftByte = stringByteAt(left, index);
        var rightByte = stringByteAt(right, index);
        var difference = leftByte - rightByte;
        if (difference) return difference;
        if (leftByte === 0) return 0;
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
      if (name === "srand") {
        runtime.randomState = Math.trunc(Number(values[0]) || 0) >>> 0;
        if (sharedStore) sharedStore.randomState = runtime.randomState;
        return undefined;
      }
      if (name === "strcmp" || name === "strncmp") {
        return compareCStringBytes(values[0], values[1], name === "strncmp" ? values[2] : null);
      }
      if (name === "memcmp") return compareBytes(values[0], values[1], values[2]);
      if (name === "memchr") {
        var memoryCount = Math.max(0, Math.trunc(Number(values[2]) || 0));
        var memorySource = memoryBytes(values[0], memoryCount);
        var memoryIndex = memorySource.indexOf(Math.trunc(Number(values[1]) || 0) & 0xff);
        return memoryIndex < 0 ? 0 : pointerForBufferValue(values[0], memoryIndex);
      }
      if (name === "strcoll") {
        var leftCollation = byteArray(cString(values[0])).concat([0]);
        var rightCollation = byteArray(cString(values[1])).concat([0]);
        return compareBytes(leftCollation, rightCollation, Math.max(leftCollation.length, rightCollation.length));
      }
      if (name === "strnlen") {
        var maximum = Math.max(0, Math.trunc(Number(values[1]) || 0));
        return boundedCStringBytes(values[0], maximum).length;
      }
      if (name === "strchr" || name === "strrchr") {
        var sourceBytes = cBytes(values[0]).concat([0]);
        var sought = Math.trunc(Number(values[1]) || 0) & 0xff;
        var foundIndex = -1;
        if (name === "strchr") {
          foundIndex = sourceBytes.indexOf(sought);
        } else {
          for (var reverseIndex = sourceBytes.length - 1; reverseIndex >= 0; reverseIndex -= 1) {
            if (sourceBytes[reverseIndex] === sought) { foundIndex = reverseIndex; break; }
          }
        }
        return foundIndex < 0 ? 0 : pointerForBufferValue(values[0], foundIndex);
      }
      if (name === "strstr" || name === "strpbrk") {
        var haystackBytes = cBytes(values[0]);
        var needleBytes = cBytes(values[1]);
        var matchIndex = -1;
        if (name === "strstr") {
          if (!needleBytes.length) matchIndex = 0;
          else outerSearch: for (var hayIndex = 0; hayIndex + needleBytes.length <= haystackBytes.length; hayIndex += 1) {
            for (var needleIndex = 0; needleIndex < needleBytes.length; needleIndex += 1) {
              if (haystackBytes[hayIndex + needleIndex] !== needleBytes[needleIndex]) continue outerSearch;
            }
            matchIndex = hayIndex;
            break;
          }
        } else {
          for (var hayPosition = 0; hayPosition < haystackBytes.length; hayPosition += 1) {
            if (needleBytes.indexOf(haystackBytes[hayPosition]) >= 0) { matchIndex = hayPosition; break; }
          }
        }
        return matchIndex < 0 ? 0 : pointerForBufferValue(values[0], matchIndex);
      }
      if (name === "strcspn" || name === "strspn") {
        var spanSource = cBytes(values[0]);
        var spanSet = cBytes(values[1]);
        var spanIndex = 0;
        for (; spanIndex < spanSource.length; spanIndex += 1) {
          var member = spanSet.indexOf(spanSource[spanIndex]) >= 0;
          if (name === "strcspn" ? member : !member) break;
        }
        return spanIndex;
      }
      if (name === "strtok") {
        var delimiters = cBytes(values[1]);
        var tokenCursor = values[0] == null || values[0] === 0
          ? runtime.internalSlots.__aliceStrtokCursor
          : pointerForBufferValue(values[0], 0);
        if (!tokenCursor) return 0;
        var tokenBytes = cBytes(tokenCursor);
        var tokenStart = 0;
        while (tokenStart < tokenBytes.length && delimiters.indexOf(tokenBytes[tokenStart]) >= 0) tokenStart += 1;
        if (tokenStart >= tokenBytes.length) {
          runtime.internalSlots.__aliceStrtokCursor = null;
          return 0;
        }
        var tokenEnd = tokenStart;
        while (tokenEnd < tokenBytes.length && delimiters.indexOf(tokenBytes[tokenEnd]) < 0) tokenEnd += 1;
        var tokenPointer = pointerOffset(tokenCursor, tokenStart);
        if (tokenEnd < tokenBytes.length) {
          var delimiterPointer = pointerOffset(tokenCursor, tokenEnd);
          delimiterPointer.elementSize = 1;
          delimiterPointer.pointeeType = "char";
          delimiterPointer.unsigned = true;
          writePointer(delimiterPointer, 0);
          runtime.internalSlots.__aliceStrtokCursor = pointerOffset(tokenCursor, tokenEnd + 1);
        } else runtime.internalSlots.__aliceStrtokCursor = null;
        return tokenPointer;
      }
      if (name === "strerror") {
        var errorNumber = Math.trunc(Number(values[0]) || 0);
        var errorMessages = {
          0: "Success",
          2: "No such file or directory",
          5: "Input/output error",
          12: "Cannot allocate memory",
          22: "Invalid argument",
          34: "Result out of range"
        };
        return pointerForBufferValue(errorMessages[errorNumber] || ("Unknown error " + errorNumber), 0);
      }
      function writeStringEndPointer(target, source, offset) {
        if (target == null || target === 0) return;
        var endPointer = pointerForBufferValue(source, offset);
        if (!endPointer) throw new Error("C string conversion source does not have an addressable end pointer");
        if (isVariablePointer(target) && Math.trunc(Number(target.offset) || 0) === 0 && !Array.isArray(runtime.variables[target.name])) {
          runtime.variables[target.name] = coerceCValue(target.name, endPointer);
          return;
        }
        throw new Error("C string conversion end pointer target is unsupported");
      }

      function asciiSpace(character) {
        return character === " " || character === "\t" || character === "\n" ||
          character === "\r" || character === "\f" || character === "\v";
      }

      function parseIntegerPrefix(source, requestedBase) {
        var text = cString(source);
        var cursor = 0;
        while (cursor < text.length && asciiSpace(text[cursor])) cursor += 1;
        var sign = 1;
        if (text[cursor] === "+" || text[cursor] === "-") {
          if (text[cursor] === "-") sign = -1;
          cursor += 1;
        }
        var base = Math.trunc(Number(requestedBase) || 0);
        if (base !== 0 && (base < 2 || base > 36)) throw new Error("strto* base must be 0 or between 2 and 36");
        function digitValue(character) {
          var code = String(character || "").charCodeAt(0);
          if (code >= 48 && code <= 57) return code - 48;
          if (code >= 65 && code <= 90) return code - 65 + 10;
          if (code >= 97 && code <= 122) return code - 97 + 10;
          return -1;
        }
        var hasHexPrefix = text[cursor] === "0" && (text[cursor + 1] === "x" || text[cursor + 1] === "X") && digitValue(text[cursor + 2]) >= 0 && digitValue(text[cursor + 2]) < 16;
        if (base === 0) base = hasHexPrefix ? 16 : text[cursor] === "0" ? 8 : 10;
        if (base === 16 && hasHexPrefix) cursor += 2;
        var digitsStart = cursor;
        var parsed = 0;
        while (cursor < text.length) {
          var digit = digitValue(text[cursor]);
          if (digit < 0 || digit >= base) break;
          parsed = parsed * base + digit;
          cursor += 1;
        }
        if (cursor === digitsStart) return { value: 0, end: 0, converted: false };
        return { value: sign * parsed, end: cursor, converted: true };
      }

      function parseFloatingPrefix(source) {
        var text = cString(source);
        var leading = 0;
        while (leading < text.length && asciiSpace(text[leading])) leading += 1;
        var candidate = text.slice(leading);
        var match = /^[+-]?(?:0[xX](?:[0-9A-Fa-f]+(?:\.[0-9A-Fa-f]*)?|\.[0-9A-Fa-f]+)(?:[pP][+-]?\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan(?:\([^)]*\))?)/i.exec(candidate);
        if (!match) return { value: 0, end: 0, converted: false };
        var token = match[0];
        var normalized = token.toLowerCase();
        var value;
        if (/^[+-]?inf(?:inity)?$/.test(normalized)) value = normalized[0] === "-" ? -Infinity : Infinity;
        else if (/^[+-]?nan(?:\([^)]*\))?$/.test(normalized)) value = NaN;
        else {
          var hex = /^([+-]?)0x([0-9a-f]+(?:\.[0-9a-f]*)?|\.[0-9a-f]+)(?:p([+-]?\d+))?$/i.exec(token);
          if (!hex) value = Number(token);
          else {
            var parts = hex[2].split(".");
            value = parseInt(parts[0] || "0", 16);
            var fractionalDigits = parts[1] || "";
            for (var hexIndex = 0; hexIndex < fractionalDigits.length; hexIndex += 1) {
              value += parseInt(fractionalDigits[hexIndex], 16) / Math.pow(16, hexIndex + 1);
            }
            value *= Math.pow(2, Number(hex[3] || 0));
            if (hex[1] === "-") value = -value;
          }
        }
        return { value: value, end: leading + token.length, converted: true };
      }

      if (["atoi", "atol", "atoll"].indexOf(name) >= 0) return parseIntegerPrefix(values[0], 10).value;
      if (name === "atof") return parseFloatingPrefix(values[0]).value;
      if (name === "strtod" || name === "strtof" || name === "strtold") {
        var floatingResult = parseFloatingPrefix(values[0]);
        writeStringEndPointer(values[1], values[0], floatingResult.end);
        return name === "strtof" ? Math.fround(floatingResult.value) : floatingResult.value;
      }
      if (["strtol", "strtoul", "strtoll", "strtoull"].indexOf(name) >= 0) {
        var integerResult = parseIntegerPrefix(values[0], values[2]);
        writeStringEndPointer(values[1], values[0], integerResult.end);
        if (name === "strtoul") return integerResult.value < 0 ? integerResult.value >>> 0 : Math.min(integerResult.value, 0xffffffff);
        if (name === "strtoull") {
          if (integerResult.value < 0) return Math.pow(2, 64) + integerResult.value;
          return Math.min(integerResult.value, Math.pow(2, 64) - 1);
        }
        if (name === "strtol") return Math.max(-0x80000000, Math.min(integerResult.value, 0x7fffffff));
        return Math.max(-Math.pow(2, 63), Math.min(integerResult.value, Math.pow(2, 63) - 1));
      }
      if (["abs", "labs", "llabs"].indexOf(name) >= 0) return Math.abs(Math.trunc(Number(values[0]) || 0));
      if (["fabs", "fabsf", "fabsl"].indexOf(name) >= 0) return Math.abs(Number(values[0]));
      if (["isalnum", "isalpha", "isblank", "iscntrl", "isdigit", "isgraph", "islower", "isprint", "ispunct", "isspace", "isupper", "isxdigit", "tolower", "toupper"].indexOf(name) >= 0) {
        var rawCharacterCode = Math.trunc(Number(values[0]) || 0);
        if (rawCharacterCode === -1) return name === "tolower" || name === "toupper" ? -1 : 0;
        var characterCode = rawCharacterCode & 0xff;
        var character = String.fromCharCode(characterCode);
        if (name === "tolower") return characterCode >= 65 && characterCode <= 90 ? characterCode + 32 : characterCode;
        if (name === "toupper") return characterCode >= 97 && characterCode <= 122 ? characterCode - 32 : characterCode;
        var patterns = {
          isalnum: /^[A-Za-z0-9]$/, isalpha: /^[A-Za-z]$/, isblank: /^[ \t]$/, iscntrl: /^[\x00-\x1f\x7f]$/,
          isdigit: /^[0-9]$/, isgraph: /^[\x21-\x7e]$/, islower: /^[a-z]$/, isprint: /^[\x20-\x7e]$/,
          ispunct: /^[!-/:-@[-`{-~]$/, isspace: /^[ \t\n\r\f\v]$/, isupper: /^[A-Z]$/, isxdigit: /^[A-Fa-f0-9]$/
        };
        return patterns[name].test(character) ? 1 : 0;
      }
      if (["isnan", "isfinite", "isinf", "signbit"].indexOf(name) >= 0) {
        var checkedNumber = Number(values[0]);
        if (name === "isnan") return Number.isNaN(checkedNumber) ? 1 : 0;
        if (name === "isfinite") return Number.isFinite(checkedNumber) ? 1 : 0;
        if (name === "isinf") return !Number.isFinite(checkedNumber) && !Number.isNaN(checkedNumber) ? 1 : 0;
        return checkedNumber < 0 || Object.is(checkedNumber, -0) ? 1 : 0;
      }
      function roundHalfAwayFromZero(value) {
        value = Number(value);
        if (!Number.isFinite(value) || value === 0) return value;
        return (value < 0 ? -1 : 1) * Math.floor(Math.abs(value) + 0.5);
      }
      function roundTiesToEven(value) {
        value = Number(value);
        if (!Number.isFinite(value) || value === 0) return value;
        var magnitude = Math.abs(value);
        var lower = Math.floor(magnitude);
        var fraction = magnitude - lower;
        var rounded = fraction < 0.5 ? lower : fraction > 0.5 ? lower + 1 : (lower % 2 === 0 ? lower : lower + 1);
        var result = (value < 0 ? -1 : 1) * rounded;
        return result === 0 && value < 0 ? -0 : result;
      }
      var exactMathNames = new Set(["ceil", "floor", "fmod", "frexp", "modf"]);
      var mathName = exactMathNames.has(name) ? name : name.replace(/[fl]$/, "");
      var mathFunctions = {
        sqrt: Math.sqrt, pow: Math.pow, sin: Math.sin, cos: Math.cos, tan: Math.tan,
        asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
        cosh: Math.cosh, sinh: Math.sinh, tanh: Math.tanh,
        floor: Math.floor, ceil: Math.ceil, round: roundHalfAwayFromZero, trunc: Math.trunc,
        nearbyint: roundTiesToEven, rint: roundTiesToEven,
        fmod: function (left, right) { return Number(right) === 0 ? NaN : Number(left) % Number(right); },
        remainder: function (left, right) {
          left = Number(left);
          right = Number(right);
          if (Number.isNaN(left) || Number.isNaN(right) || !Number.isFinite(left) || right === 0) return NaN;
          if (!Number.isFinite(right)) return left;
          var result = left - roundTiesToEven(left / right) * right;
          return result === 0 && (left < 0 || Object.is(left, -0)) ? -0 : result;
        },
        exp: Math.exp, exp2: function (value) { return Math.pow(2, Number(value)); },
        log: Math.log, log10: Math.log10, log2: Math.log2,
        cbrt: Math.cbrt,
        fmin: function (left, right) {
          left = Number(left);
          right = Number(right);
          if (Number.isNaN(left)) return right;
          if (Number.isNaN(right)) return left;
          if (left === 0 && right === 0) return Object.is(left, -0) || Object.is(right, -0) ? -0 : 0;
          return Math.min(left, right);
        },
        fmax: function (left, right) {
          left = Number(left);
          right = Number(right);
          if (Number.isNaN(left)) return right;
          if (Number.isNaN(right)) return left;
          if (left === 0 && right === 0) return Object.is(left, 0) || Object.is(right, 0) ? 0 : -0;
          return Math.max(left, right);
        },
        copysign: function (left, right) {
          var magnitude = Math.abs(Number(left));
          return Number(right) < 0 || Object.is(Number(right), -0) ? -magnitude : magnitude;
        },
        hypot: Math.hypot,
        ldexp: function (value, exponent) { return Number(value) * Math.pow(2, Math.trunc(Number(exponent) || 0)); },
        frexp: function (value, exponentPointer) {
          value = Number(value);
          var exponent = 0;
          var fraction = value;
          if (Number.isFinite(value) && value !== 0) {
            exponent = Math.floor(Math.log2(Math.abs(value))) + 1;
            fraction = value / Math.pow(2, exponent);
          }
          if (exponentPointer != null && exponentPointer !== 0) writePointer(exponentPointer, exponent);
          return fraction;
        },
        modf: function (value, integralPointer) {
          value = Number(value);
          var integral = Number.isNaN(value) ? NaN : Math.trunc(value);
          var fraction = Number.isNaN(value) ? NaN : Number.isFinite(value) ? value - integral : (value < 0 ? -0 : 0);
          if (fraction === 0 && (value < 0 || Object.is(value, -0))) fraction = -0;
          if (integralPointer != null && integralPointer !== 0) writePointer(integralPointer, integral);
          return fraction;
        }
      };
      if (mathFunctions[mathName]) {
        var mathArguments = mathName === "frexp" || mathName === "modf" ? values : values.map(Number);
        return mathFunctions[mathName].apply(Math, mathArguments);
      }
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

    function stablePointerHash(value) {
      var text = String(value == null ? "" : value);
      var hash = 2166136261;
      for (var index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    function syntheticPointerAddress(value) {
      if (value == null || value === 0) return 0;
      if (isVariablePointer(value)) {
        // Keep named storage, heap allocations and literals in separate
        // synthetic address ranges. Offsets remain visible in %p output,
        // which makes the value useful when debugging pointer arithmetic.
        return (0x20000000 + (stablePointerHash(value.name) & 0xffff) * 0x1000 + Math.trunc(Number(value.offset) || 0)) >>> 0;
      }
      if (isHeapPointer(value)) {
        var allocationId = Number(value.id);
        var heapBlock = Number.isFinite(allocationId) ? Math.trunc(allocationId) : stablePointerHash(value.id);
        return (0x30000000 + (heapBlock & 0xfff) * 0x10000 + Math.trunc(Number(value.offset) || 0)) >>> 0;
      }
      if (value && typeof value === "object" && value.__alicePointer === "literal") {
        var literalIdentity = value.id != null ? value.id : value.text != null ? value.text : (value.bytes || []).join(",");
        return (0x08000000 + (stablePointerHash(literalIdentity) & 0x7fff) * 0x100 + Math.trunc(Number(value.offset) || 0)) >>> 0;
      }
      if (Array.isArray(value)) {
        var owner = Object.keys(runtime.variables).find(function (name) { return runtime.variables[name] === value; });
        if (owner) return syntheticPointerAddress(pointerForVariable(owner, 0));
        return (0x08000000 + (stablePointerHash(value.join(",")) & 0x7fff) * 0x100) >>> 0;
      }
      if (typeof value === "string") {
        return (0x08000000 + (stablePointerHash(value) & 0x7fff) * 0x100) >>> 0;
      }
      if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value) >>> 0;
      throw new Error("printf %p requires a pointer or null value");
    }

    function formatHexFloatMagnitude(value, precision, alternate) {
      var requestedDigits = precision == null ? 13 : Math.max(0, Math.trunc(Number(precision) || 0));
      if (value === 0) {
        var zeroDigits = precision == null ? "" : new Array(requestedDigits + 1).join("0");
        return "0x0" + (zeroDigits || alternate ? "." + zeroDigits : "") + "p+0";
      }

      var exponent = Math.floor(Math.log2(value));
      if (exponent > 1023) exponent = 1023;
      var normalized = value / Math.pow(2, exponent);
      // Guard the two extreme IEEE-754 exponents against host rounding in
      // log2/pow while retaining the equivalent normalized representation.
      while (normalized < 1) {
        normalized *= 2;
        exponent -= 1;
      }
      while (normalized >= 2) {
        normalized /= 2;
        exponent += 1;
      }

      var computedDigits = Math.min(13, requestedDigits);
      var scale = Math.pow(16, computedDigits);
      var significand = Math.round(normalized * scale);
      if (significand >= 2 * scale) {
        significand = scale;
        exponent += 1;
      }
      var leadingDigit = Math.floor(significand / scale);
      var fractionValue = significand - leadingDigit * scale;
      var fractionDigits = computedDigits
        ? Math.round(fractionValue).toString(16).padStart(computedDigits, "0")
        : "";
      if (requestedDigits > computedDigits) fractionDigits += new Array(requestedDigits - computedDigits + 1).join("0");
      if (precision == null) fractionDigits = fractionDigits.replace(/0+$/, "");
      return "0x" + leadingDigit.toString(16) +
        (fractionDigits || alternate ? "." + fractionDigits : "") +
        "p" + (exponent >= 0 ? "+" : "") + String(exponent);
    }

    function formatCValue(specifier, flags, width, precision, value, length) {
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
        var floatNegative = floatValue < 0 || Object.is(floatValue, -0);
        var digits = precision == null ? 6 : Math.max(0, precision);
        var magnitude = Math.abs(floatValue);
        var lowerSpecifier = specifier.toLowerCase();
        if (Number.isNaN(floatValue)) {
          text = "nan";
          flags = flags.replace(/0/g, "");
        } else if (!Number.isFinite(floatValue)) {
          text = "inf";
          flags = flags.replace(/0/g, "");
        } else if (lowerSpecifier === "f") {
          text = magnitude.toFixed(digits);
          if (flags.indexOf("#") >= 0 && digits === 0) text += ".";
        } else if (lowerSpecifier === "e") {
          text = magnitude.toExponential(digits);
          if (flags.indexOf("#") >= 0 && digits === 0) text = text.replace(/e/i, ".e");
        } else if (lowerSpecifier === "a") {
          text = formatHexFloatMagnitude(magnitude, precision, flags.indexOf("#") >= 0);
        } else {
          text = magnitude.toPrecision(Math.max(1, digits || 1));
          if (flags.indexOf("#") < 0) text = text.replace(/(?:\.0+|(?:(\.\d*?)0+))(?=e|$)/i, "$1");
        }
        if (specifier === specifier.toUpperCase()) text = text.toUpperCase();
        if (floatNegative) text = "-" + text;
        else if (flags.indexOf("+") >= 0) text = "+" + text;
        else if (flags.indexOf(" ") >= 0) text = " " + text;
        return formatPadding(text, width, flags, text[0] === "+" || text[0] === "-" || text[0] === " " ? 1 : 0);
      }

      if (specifier === "p") {
        var pointerDigits = syntheticPointerAddress(value).toString(16);
        if (precision != null) pointerDigits = new Array(Math.max(0, precision - pointerDigits.length) + 1).join("0") + pointerDigits;
        text = "0x" + pointerDigits;
        return formatPadding(text, width, flags, 2);
      }

      var numeric = Number(value);
      if (!Number.isSafeInteger(numeric)) {
        throw new Error("printf integer argument is outside the exact integer range of the semantic runtime");
      }
      var unsigned = "uoxX".indexOf(specifier) >= 0;
      // STM32 uses ILP32: int, long, size_t and ptrdiff_t are 32-bit.
      // hh/h narrow the promoted argument; ll/j retain 64 bits. BigInt is
      // local to formatting so unsigned 64-bit output of -1 stays exact.
      var integerBits = length === "hh" ? 8 : length === "h" ? 16 : length === "ll" || length === "j" ? 64 : 32;
      var integer = unsigned ? BigInt.asUintN(integerBits, BigInt(numeric)) : BigInt.asIntN(integerBits, BigInt(numeric));
      var base = specifier === "o" ? 8 : "xX".indexOf(specifier) >= 0 ? 16 : 10;
      var negative = integer < BigInt(0);
      var digitsText = (negative ? -integer : integer).toString(base);
      if (specifier === "X") digitsText = digitsText.toUpperCase();
      if (precision != null) {
        if (precision === 0 && integer === BigInt(0)) digitsText = "";
        digitsText = new Array(Math.max(0, precision - digitsText.length) + 1).join("0") + digitsText;
        flags = flags.replace(/0/g, "");
      }
      if (negative) prefix = "-";
      else if (!unsigned && flags.indexOf("+") >= 0) prefix = "+";
      else if (!unsigned && flags.indexOf(" ") >= 0) prefix = " ";
      if (flags.indexOf("#") >= 0 && integer !== BigInt(0) && "xX".indexOf(specifier) >= 0) prefix += specifier === "X" ? "0X" : "0x";
      else if (flags.indexOf("#") >= 0 && specifier === "o" && digitsText[0] !== "0") prefix += "0";
      text = prefix + digitsText;
      return formatPadding(text, width, flags, prefix.length);
    }

    function formatCString(format, values) {
      var argumentIndex = 0;
      var source = String(format);
      var output = "";
      var sourceIndex = 0;
      var supportedSpecifiers = "diuoxXfFeEgGaAcsp%";

      function nextArgument(pattern, purpose) {
        if (argumentIndex >= values.length) throw new Error("Missing printf " + purpose + " argument for " + pattern);
        return values[argumentIndex++];
      }

      while (sourceIndex < source.length) {
        var percentIndex = source.indexOf("%", sourceIndex);
        if (percentIndex < 0) {
          output += source.slice(sourceIndex);
          break;
        }
        output += source.slice(sourceIndex, percentIndex);
        var cursor = percentIndex + 1;
        if (cursor >= source.length) throw new Error("Incomplete printf conversion at end of format string");

        var flags = "";
        while (cursor < source.length && "-+ #0".indexOf(source[cursor]) >= 0) flags += source[cursor++];

        var widthToken = null;
        if (source[cursor] === "*") {
          widthToken = "*";
          cursor += 1;
        } else {
          var widthStart = cursor;
          while (cursor < source.length && /[0-9]/.test(source[cursor])) cursor += 1;
          if (cursor > widthStart) widthToken = source.slice(widthStart, cursor);
        }

        var precisionToken = null;
        if (source[cursor] === ".") {
          cursor += 1;
          if (source[cursor] === "*") {
            precisionToken = "*";
            cursor += 1;
          } else {
            var precisionStart = cursor;
            while (cursor < source.length && /[0-9]/.test(source[cursor])) cursor += 1;
            precisionToken = cursor > precisionStart ? source.slice(precisionStart, cursor) : "0";
          }
        }

        var length = "";
        if (source.slice(cursor, cursor + 2) === "hh" || source.slice(cursor, cursor + 2) === "ll") {
          length = source.slice(cursor, cursor + 2);
          cursor += 2;
        } else if (cursor < source.length && "hljztL".indexOf(source[cursor]) >= 0) {
          length = source[cursor++];
        }

        var specifier = source[cursor];
        var pattern = source.slice(percentIndex, Math.min(source.length, cursor + 1));
        if (!specifier || supportedSpecifiers.indexOf(specifier) < 0) {
          throw new Error("Unsupported printf conversion: " + pattern);
        }
        cursor += 1;

        var integerConversion = "diuoxX".indexOf(specifier) >= 0;
        var floatConversion = "fFeEgGaA".indexOf(specifier) >= 0;
        var validLength = !length ||
          integerConversion && "hh h l ll j z t".split(" ").indexOf(length) >= 0 ||
          floatConversion && (length === "l" || length === "L");
        if (!validLength || (specifier === "%" && (flags || widthToken != null || precisionToken != null))) {
          throw new Error("Unsupported printf conversion: " + pattern);
        }
        if (specifier === "%") {
          output += "%";
          sourceIndex = cursor;
          continue;
        }

        var width = widthToken === "*" ? Math.trunc(Number(nextArgument(pattern, "width")) || 0) : widthToken == null ? 0 : Number(widthToken);
        if (width < 0) {
          width = Math.abs(width);
          if (flags.indexOf("-") < 0) flags += "-";
        }
        var precision = precisionToken === "*" ? Math.trunc(Number(nextArgument(pattern, "precision")) || 0) : precisionToken == null ? null : Number(precisionToken);
        if (precision != null && precision < 0) precision = null;
        output += formatCValue(specifier, flags, width, precision, nextArgument(pattern, "value"), length);
        sourceIndex = cursor;
      }
      return output;
    }

    function writeFormattedString(operation) {
      var buffer = firstDefined(operation, ["buffer", "target", "destination"], null);
      if (buffer == null || buffer === "") throw new Error("Formatted output buffer is missing");
      var format = cString(evaluate(firstDefined(operation, ["format", "template"], "")));
      var values = Array.isArray(operation.arguments) ? operation.arguments.map(function (value) { return evaluate(value); }) : [];
      var renderedBytes = byteArray(formatCString(format, values));
      var hasCapacity = operation.capacity !== undefined && operation.capacity !== null;
      var capacity = hasCapacity ? Math.max(0, Math.trunc(Number(evaluate(operation.capacity)) || 0)) : renderedBytes.length + 1;
      if (capacity > 0) {
        var written = renderedBytes.slice(0, Math.max(0, capacity - 1));
        var output = written.concat([0]);
        if (typeof buffer !== "string" || isHeapPointer(runtime.variables[buffer]) || isVariablePointer(runtime.variables[buffer])) {
          writeMemory(memoryTargetPointer(typeof buffer === "string" ? { kind: "variable", name: buffer } : buffer), output);
        } else if (Array.isArray(runtime.variables[buffer])) {
          var existing = runtime.variables[buffer].slice();
          if (output.length > existing.length) throw new Error("Formatted output write is out of bounds");
          written.forEach(function (byte, index) { existing[index] = byte; });
          existing[written.length] = 0;
          runtime.variables[buffer] = existing;
        } else {
          writeMemory(memoryTargetPointer({ kind: "variable", name: buffer }), output);
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
      } else if (name === "strcpy") {
        output = cBytes(evaluate(args[1])).concat([0]);
      } else if (name === "strncpy") {
        var stringCount = Math.max(0, Math.trunc(Number(evaluate(args[2])) || 0));
        var stringSource = evaluate(args[1]);
        output = [];
        var sourceTerminated = false;
        for (var stringIndex = 0; stringIndex < stringCount; stringIndex += 1) {
          var stringByte = sourceTerminated ? 0 : stringByteAt(stringSource, stringIndex);
          output.push(stringByte);
          if (stringByte === 0) sourceTerminated = true;
        }
      } else {
        var existing = cBytes(evaluate(args[0]));
        var addition = name === "strncat"
          ? boundedCStringBytes(evaluate(args[1]), evaluate(args[2]))
          : cBytes(evaluate(args[1]));
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
      function scanByteString(value) {
        return cBytes(value).map(function (byte) { return String.fromCharCode(byte); }).join("");
      }

      function scanTokenBytes(token) {
        return Array.prototype.map.call(token, function (character) { return character.charCodeAt(0) & 0xff; });
      }

      var input = scanByteString(evaluate(operation.input));
      var format = scanByteString(evaluate(operation.format));
      var targets = Array.isArray(operation.targets) ? operation.targets : [];
      var inputIndex = 0;
      var formatIndex = 0;
      var targetIndex = 0;
      var assigned = 0;
      var completedConversion = false;

      function isScanWhitespace(character) {
        return character === " " || character === "\t" || character === "\n" ||
          character === "\r" || character === "\f" || character === "\v";
      }

      function stopScan(inputFailure) {
        setOperationResult(operation, inputFailure && !completedConversion ? -1 : assigned);
      }

      function nextTarget(specifier) {
        if (targetIndex >= targets.length) throw new Error("Missing sscanf target for %" + specifier);
        return targets[targetIndex++];
      }

      function integerTokenValue(token, specifier) {
        var sign = 1;
        var digits = token;
        if (digits[0] === "+" || digits[0] === "-") {
          if (digits[0] === "-") sign = -1;
          digits = digits.slice(1);
        }
        var base = 10;
        if (specifier === "x" || specifier === "X" || specifier === "p") base = 16;
        else if (specifier === "o") base = 8;
        else if (specifier === "i") {
          if (/^0[xX]/.test(digits)) base = 16;
          else if (/^0/.test(digits)) base = 8;
        }
        if (base === 16 && /^0[xX]/.test(digits)) digits = digits.slice(2);
        return sign * parseInt(digits, base);
      }

      function floatingTokenValue(token) {
        var normalized = token.toLowerCase();
        if (/^[+-]?inf(?:inity)?$/.test(normalized)) return normalized[0] === "-" ? -Infinity : Infinity;
        if (/^[+-]?nan(?:\([^)]*\))?$/.test(normalized)) return NaN;
        var hexMatch = /^([+-]?)0x([0-9a-f]+(?:\.[0-9a-f]*)?|\.[0-9a-f]+)(?:p([+-]?\d+))?$/i.exec(token);
        if (!hexMatch) return Number(token);
        var parts = hexMatch[2].split(".");
        var value = parseInt(parts[0] || "0", 16);
        var fraction = parts[1] || "";
        for (var fractionIndex = 0; fractionIndex < fraction.length; fractionIndex += 1) {
          value += parseInt(fraction[fractionIndex], 16) / Math.pow(16, fractionIndex + 1);
        }
        value *= Math.pow(2, Number(hexMatch[3] || 0));
        return hexMatch[1] === "-" ? -value : value;
      }

      function scanSetAt(start) {
        var cursor = start;
        var negated = format[cursor] === "^";
        if (negated) cursor += 1;
        var characters = [];
        if (format[cursor] === "]") characters.push(format[cursor++]);
        while (cursor < format.length && format[cursor] !== "]") characters.push(format[cursor++]);
        if (cursor >= format.length) throw new Error("Unterminated sscanf scanset");
        var literals = [];
        var ranges = [];
        for (var setIndex = 0; setIndex < characters.length;) {
          if (setIndex + 2 < characters.length && characters[setIndex + 1] === "-" &&
              characters[setIndex].charCodeAt(0) <= characters[setIndex + 2].charCodeAt(0)) {
            ranges.push([characters[setIndex].charCodeAt(0), characters[setIndex + 2].charCodeAt(0)]);
            setIndex += 3;
          } else {
            literals.push(characters[setIndex++]);
          }
        }
        return {
          end: cursor + 1,
          matches: function (character) {
            var included = literals.indexOf(character) >= 0;
            var code = character.charCodeAt(0);
            if (!included) included = ranges.some(function (range) { return code >= range[0] && code <= range[1]; });
            return negated ? !included : included;
          }
        };
      }

      while (formatIndex < format.length) {
        var formatCharacter = format[formatIndex];
        if (isScanWhitespace(formatCharacter)) {
          while (formatIndex < format.length && isScanWhitespace(format[formatIndex])) formatIndex += 1;
          while (inputIndex < input.length && isScanWhitespace(input[inputIndex])) inputIndex += 1;
          continue;
        }

        if (formatCharacter !== "%" || format[formatIndex + 1] === "%") {
          var literalCharacter = formatCharacter === "%" ? "%" : formatCharacter;
          formatIndex += formatCharacter === "%" ? 2 : 1;
          if (inputIndex >= input.length) {
            stopScan(true);
            return;
          }
          if (input[inputIndex] !== literalCharacter) {
            stopScan(false);
            return;
          }
          inputIndex += 1;
          continue;
        }

        formatIndex += 1;
        var suppressed = format[formatIndex] === "*";
        if (suppressed) formatIndex += 1;
        var widthText = "";
        while (formatIndex < format.length && /\d/.test(format[formatIndex])) widthText += format[formatIndex++];
        var width = widthText ? Math.max(0, Number(widthText)) : null;
        while (formatIndex < format.length && /[hlLjzt]/.test(format[formatIndex])) formatIndex += 1;
        var specifier = format[formatIndex++] || "";
        var scanSet = null;
        if (specifier === "[") {
          scanSet = scanSetAt(formatIndex);
          formatIndex = scanSet.end;
        }
        if (!specifier || "diuxXopfFeEgGaAscn[".indexOf(specifier) < 0) {
          throw new Error("Unsupported sscanf conversion: %" + specifier);
        }

        if (specifier === "n") {
          completedConversion = true;
          if (!suppressed) writePointer(evaluate(nextTarget(specifier)), inputIndex);
          continue;
        }

        if (specifier !== "c" && specifier !== "[") {
          while (inputIndex < input.length && isScanWhitespace(input[inputIndex])) inputIndex += 1;
        }
        if (inputIndex >= input.length) {
          stopScan(true);
          return;
        }

        var maximum = width == null ? input.length - inputIndex : width;
        var candidate = input.slice(inputIndex, inputIndex + maximum);
        var token = "";
        if (specifier === "s") {
          while (token.length < candidate.length && !isScanWhitespace(candidate[token.length])) token += candidate[token.length];
        } else if (specifier === "c") {
          var characterCount = width == null ? 1 : width;
          if (input.length - inputIndex < characterCount) {
            stopScan(true);
            return;
          }
          token = input.slice(inputIndex, inputIndex + characterCount);
        } else if (specifier === "[") {
          while (token.length < candidate.length && scanSet.matches(candidate[token.length])) token += candidate[token.length];
        } else {
          var tokenPattern;
          if (specifier === "d" || specifier === "u") tokenPattern = /^[+-]?\d+/;
          else if (specifier === "i") tokenPattern = /^[+-]?(?:0[xX][0-9A-Fa-f]+|0[0-7]*|[1-9]\d*)/;
          else if (specifier === "x" || specifier === "X" || specifier === "p") tokenPattern = /^[+-]?(?:0[xX][0-9A-Fa-f]+|[0-9A-Fa-f]+)/;
          else if (specifier === "o") tokenPattern = /^[+-]?[0-7]+/;
          else tokenPattern = /^[+-]?(?:0[xX](?:[0-9A-Fa-f]+(?:\.[0-9A-Fa-f]*)?|\.[0-9A-Fa-f]+)(?:[pP][+-]?\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan(?:\([^)]*\))?)/i;
          var tokenMatch = tokenPattern.exec(candidate);
          if (tokenMatch) token = tokenMatch[0];
        }

        if (!token.length) {
          stopScan(false);
          return;
        }
        inputIndex += token.length;
        completedConversion = true;
        if (suppressed) continue;

        var target = nextTarget(specifier);
        if (specifier === "s" || specifier === "c" || specifier === "[") {
          var targetPointer = memoryTargetPointer(target);
          var scannedBytes = scanTokenBytes(token);
          if (specifier !== "c") scannedBytes.push(0);
          writeMemory(targetPointer, scannedBytes);
        } else {
          var value = "fFeEgGaA".indexOf(specifier) >= 0
            ? floatingTokenValue(token)
            : integerTokenValue(token, specifier);
          writePointer(evaluate(target), value);
        }
        assigned += 1;
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
      if (operation.i2cExpression) {
        var handle = evaluate(operation.i2cExpression);
        if (isVariablePointer(handle)) handle = handle.name;
        return resolveI2cInstance(resolveAlias(handle, i2cAliases));
      }
      return resolveI2cInstance(operation.instance || operation.i2c || operation.handle || operation.peripheral || "I2C");
    }

    function operationSpiInstance(operation) {
      if (operation.spiExpression) {
        var handle = evaluate(operation.spiExpression);
        if (isVariablePointer(handle)) {
          checkPointerLifetime(handle);
          if (Number(handle.offset || 0) !== 0) return "__invalid_spi_handle__";
          handle = handle.name;
        }
        var instance = resolveAlias(handle, spiAliases);
        return typeof instance === "string" && /^SPI\d+$/i.test(instance) ? instance.toUpperCase() : "__invalid_spi_handle__";
      }
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
      var length = Math.trunc(evaluatedNumber(raw, NaN));
      return Number.isFinite(length) && length >= 0 ? length : null;
    }

    function receiveTarget(operation) {
      return firstDefined(operation, ["target", "buffer", "destination", "variable"], "rx_data");
    }

    function receiveTimeout(operation) {
      var raw = firstDefined(operation, ["timeoutExpression", "timeout", "timeoutMs"], { type: "constant", name: "HAL_MAX_DELAY" });
      var value = evaluatedNumber(raw, NaN);
      if (!Number.isFinite(value) || value >= MAX_DELAY_VALUE) return Infinity;
      return Math.max(0, value);
    }

    function setOperationResult(operation, value) {
      var target = firstDefined(operation, ["result", "resultTarget", "statusTarget"], null);
      if (target) assign(target, value);
    }

    function writeReceiveBufferAt(target, offset, bytes) {
      offset = Math.max(0, Math.trunc(Number(offset) || 0));
      bytes = Array.prototype.slice.call(bytes || []).map(function (byte) { return Number(byte) & 0xff; });

      // A named array is the legacy IR representation for the common case.
      // Keep that representation byte-addressable, but do not use it for a
      // named pointer: a pointer variable denotes storage somewhere else.
      if (typeof target === "string") {
        var pointerTarget = runtime.variables[target];
        if (isHeapPointer(pointerTarget) || isVariablePointer(pointerTarget)) {
          writeMemory(pointerOffset(pointerTarget, offset), bytes);
          return;
        }
        if (hasOwn(runtime.variables, target) && Array.isArray(runtime.variables[target])) {
          var existingArray = runtime.variables[target].slice();
          bytes.forEach(function (byte, index) { existingArray[offset + index] = byte; });
          runtime.variables[target] = existingArray;
          return;
        }
        if (offset === 0 && bytes.length === 1 && hasOwn(runtime.variables, target)) {
          runtime.variables[target] = coerceCValue(target, bytes[0]);
          return;
        }
        if (offset !== 0) throw new Error("Receive buffer is not writable at the requested offset");
        var existing = [];
        bytes.forEach(function (byte, index) { existing[index] = byte; });
        runtime.variables[target] = existing;
        return;
      }

      // The parser preserves expressions such as ``&rx[1]`` or ``p + 2``.
      // Resolve them through the same typed memory abstraction used by libc;
      // this makes IT/DMA receive chunks honor both the initial pointer offset
      // and the offset of subsequent chunks in one transfer.
      if (target && typeof target === "object") {
        var targetPointer = memoryTargetPointer(target);
        writeMemory(pointerOffset(targetPointer, offset), bytes);
        return;
      }
      if (offset !== 0) throw new Error("Receive buffer is not writable at the requested offset");
      assign(target, bytes.slice());
    }

    function writeReceiveBuffer(target, bytes) {
      writeReceiveBufferAt(target, 0, bytes);
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
      if (isVariablePointer(value)) {
        checkPointerLifetime(value);
        value = Number(value.offset || 0) === 0 ? value.name : "";
      }
      var name = String(value == null ? "" : value).trim().replace(/^&/, "").toUpperCase();
      var match = name.match(/^GPIO([A-K])$/) || name.match(/^P([A-K])$/) || name.match(/^([A-K])$/);
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
      var match = name.match(/^P([A-K])(1[0-5]|[0-9])$/) || name.match(/^GPIO([A-K])(1[0-5]|[0-9])$/);
      return match ? "P" + match[1] + Number(match[2]) : "";
    }

    function resolvePinTargets(operation) {
      if (hasOwn(operation, "portExpression") && hasOwn(operation, "pinExpression")) {
        var dynamicPrefix = portPrefix(evaluate(operation.portExpression));
        var dynamicMask = Number(evaluate(operation.pinExpression));
        if (!dynamicPrefix || !Number.isFinite(dynamicMask)) throw new Error("GPIO port and pin expressions must resolve to a valid port and mask");
        dynamicMask = Math.trunc(dynamicMask) & 0xffff;
        var dynamicPins = [];
        for (var bit = 0; bit <= 15; bit += 1) if (dynamicMask & Math.pow(2, bit)) dynamicPins.push(dynamicPrefix + bit);
        return dynamicPins;
      }
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
      var bytes = isPointer(value) ? memoryBytes(value) : byteArray(value);
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

    function cIntegerLiteral(value) {
      if (typeof value !== "string") return null;
      var text = value.trim();
      var match = text.match(/^([+-]?)(0[xX][0-9a-fA-F]+|0[bB][01]+|0[0-7]+|[0-9]+)(?:[uUlL]*)$/);
      if (!match) return null;
      var sign = match[1] === "-" ? -1 : 1;
      var digits = match[2];
      var base = /^0[xX]/.test(digits) ? 16 : /^0[bB]/.test(digits) ? 2 : /^0[0-7]+$/.test(digits) && digits.length > 1 ? 8 : 10;
      var body = base === 16 || base === 2 ? digits.slice(2) : digits;
      var parsed = parseInt(body, base);
      return Number.isFinite(parsed) ? sign * parsed : null;
    }

    function evaluatedNumber(value, fallback) {
      if (value == null) return fallback;
      var evaluated = value && typeof value === "object" ? evaluate(value) : value;
      var numeric = Number(evaluated);
      if (!Number.isFinite(numeric)) numeric = cIntegerLiteral(evaluated);
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
        dma: Boolean(operation.dma),
        interrupt: Boolean(operation.interrupt),
        dmaHandle: operation.dmaHandle || null,
        dmaInstance: operation.dmaInstance || null,
        timeout: evaluatedNumber(firstDefined(operation, ["timeoutExpression", "timeout", "timeoutMs"], null), null),
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
        dma: Boolean(operation.dma),
        interrupt: Boolean(operation.interrupt),
        dmaHandle: operation.dmaHandle || null,
        dmaInstance: operation.dmaInstance || null,
        timeout: evaluatedNumber(firstDefined(operation, ["timeoutExpression", "timeout", "timeoutMs"], null), null),
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

    // HAL_SPI_TransmitReceive* uses one clocked transaction but exposes both
    // directions to the connected schematic device. Keep the two hook events
    // separate so displays/sensors can validate the transmitted bytes and
    // provide verified receive bytes without fabricating input.
    function transmitReceiveSpi(operation) {
      var instance = operationSpiInstance(operation);
      var txOperation = Object.assign({}, operation, {
        buffer: firstDefined(operation, ["txBuffer", "buffer", "source"], null),
        resultTarget: null
      });
      var txAccepted = transmitSpi(txOperation);
      var rxOperation = Object.assign({}, operation, {
        buffer: firstDefined(operation, ["rxBuffer", "target", "destination"], null),
        clockedByTransmit: true,
        resultTarget: null
      });
      var rxAccepted = receiveSpi(rxOperation);
      setOperationResult(operation, txAccepted && rxAccepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR);
      return txAccepted && rxAccepted;
    }

    function receiveResponseBytes(response, length) {
      if (!Number.isInteger(length) || length < 0) return { accepted: false, reason: "invalid-length", bytes: [] };
      if (response == null) return { accepted: false, reason: "no-response", bytes: [] };
      var objectResponse = response && typeof response === "object" && !Array.isArray(response)
        && !(typeof ArrayBuffer !== "undefined" && (response instanceof ArrayBuffer || (ArrayBuffer.isView && ArrayBuffer.isView(response))));
      if (objectResponse && response.accepted === false) return { accepted: false, reason: response.reason || "rejected", bytes: [] };
      var payload;
      if (objectResponse) payload = firstDefined(response, ["bytes", "data", "rxBytes", "value", "buffer"], undefined);
      else payload = response;
      if (payload === undefined) {
        // A successful read needs actual bytes. Treating a connected device
        // with no data as zeroes would fabricate firmware input.
        return { accepted: false, reason: objectResponse && response.reason || "missing-read-data", bytes: [] };
      }
      var bytes = byteArray(payload);
      if (bytes.length < length) return { accepted: false, reason: "short-read", bytes: bytes };
      return { accepted: true, bytes: bytes.slice(0, length) };
    }

    function receiveI2c(operation, memoryRead) {
      var instance = operationI2cInstance(operation);
      var length = operationLength(operation);
      var deviceAddress = evaluatedNumber(firstDefined(operation, ["deviceAddress", "address", "slaveAddress"], null), null);
      var event = {
        kind: memoryRead ? "memRead" : "masterReceive",
        instance: instance,
        i2c: firstDefined(operation, ["i2c", "handle"], instance),
        handle: firstDefined(operation, ["i2c", "handle"], ""),
        deviceAddress: deviceAddress,
        address: deviceAddress,
        buffer: receiveTarget(operation),
        length: length,
        timeout: evaluatedNumber(firstDefined(operation, ["timeoutExpression", "timeout", "timeoutMs"], null), null),
        time: runtime.time,
        timeMs: runtime.time
      };
      if (memoryRead) {
        event.memoryAddress = evaluatedNumber(firstDefined(operation, ["memoryAddress", "memAddress", "register"], null), null);
        event.memoryAddressSize = evaluatedNumber(firstDefined(operation, ["memoryAddressSize", "memAddressSize", "addressSize"], null), null);
      }
      var response = length == null ? null : callHook("onI2cRx", cloneValue(event));
      var result = receiveResponseBytes(response, length);
      event.accepted = result.accepted;
      event.bytes = result.bytes.slice();
      if (!result.accepted) event.reason = result.reason;
      if (response !== undefined) event.response = cloneValue(response);
      if (result.accepted) writeReceiveBuffer(receiveTarget(operation), result.bytes);
      runtime.i2cRxCount += 1;
      appendBoundedHistory(runtime.i2cRx, event);
      setOperationResult(operation, result.accepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR);
      return result.accepted;
    }

    function receiveSpi(operation) {
      var instance = operationSpiInstance(operation);
      var length = operationLength(operation);
      var event = {
        kind: "receive",
        clockedByTransmit: Boolean(operation.clockedByTransmit),
        instance: instance,
        spi: firstDefined(operation, ["spi", "handle"], instance),
        handle: firstDefined(operation, ["spi", "handle"], ""),
        buffer: receiveTarget(operation),
        length: length,
        timeout: evaluatedNumber(firstDefined(operation, ["timeoutExpression", "timeout", "timeoutMs"], null), null),
        time: runtime.time,
        timeMs: runtime.time
      };
      var response = length == null ? null : callHook("onSpiRx", cloneValue(event));
      var result = receiveResponseBytes(response, length);
      event.accepted = result.accepted;
      event.bytes = result.bytes.slice();
      if (!result.accepted) event.reason = result.reason;
      if (response !== undefined) event.response = cloneValue(response);
      if (result.accepted) writeReceiveBuffer(receiveTarget(operation), result.bytes);
      runtime.spiRxCount += 1;
      appendBoundedHistory(runtime.spiRx, event);
      setOperationResult(operation, result.accepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR);
      return result.accepted;
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
      return BUILTIN_CONSTANTS.HAL_OK;
    }

    function stopAdc(operation) {
      var instance = operationAdcInstance(operation);
      var state = adcState(instance);
      state.started = false;
      state.ready = false;
      state.interruptValueReady = false;
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
      return BUILTIN_CONSTANTS.HAL_OK;
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
        timeout: evaluatedNumber(firstDefined(operation, ["timeoutExpression", "timeout", "timeoutMs"], null), null),
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
      var valueTarget = firstDefined(operation, ["result", "resultTarget", "statusTarget", "target", "destination", "variable"], null);
      if (valueTarget) assign(valueTarget, value);
      callHook("onAdcValue", {
        instance: instance,
        value: value,
        voltage: state.voltage,
        sample: cloneValue(sample),
        time: runtime.time,
        timeMs: runtime.time
      });
      return value;
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
      if (!active && (type.indexOf("i2c") === 0 || type.indexOf("spi") === 0)) {
        var bus = type.indexOf("i2c") === 0 ? "i2c" : "spi";
        active = runtime.dma.transfers.find(function (transfer) { return transfer.active && transfer.bus === bus && transfer.instance === instance; })
          || runtime.interrupts.events.find(function (event) { return event.active && event.bus === bus && event.instance === instance; });
      }
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
        if (!predicate(transfer)) return;
        runtime.interrupts.pendingCallbacks = runtime.interrupts.pendingCallbacks.filter(function (pending) {
          return pending.event.id !== transfer.id;
        });
        if (!transfer.active) return;
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
        randomState: runtime.randomState,
        cStorage: cStorage
      };
    }

    function callbackDescriptorSource(descriptor) {
      if (descriptor && descriptor.source && typeof descriptor.source === "object") return cloneValue(descriptor.source);
      var pending = descriptor && Array.isArray(descriptor.operations) ? descriptor.operations.slice() : [];
      while (pending.length) {
        var value = pending.shift();
        if (!value || typeof value !== "object") continue;
        if (Array.isArray(value)) {
          Array.prototype.push.apply(pending, value);
          continue;
        }
        if (value.source && typeof value.source === "object") return cloneValue(value.source);
        Object.keys(value).forEach(function (key) {
          if (key !== "source" && value[key] && typeof value[key] === "object") pending.push(value[key]);
        });
      }
      return null;
    }

    function stopForCallbackFailure(name, callbackState) {
      if (!callbackState || ["error", "budget-exceeded"].indexOf(callbackState.status) < 0) return;
      runtime.running = false;
      runtime.status = callbackState.status;
      runtime.pendingAdvanceMs = 0;
      runtime.error = callbackState.error ? cloneValue(callbackState.error) : {
        code: callbackState.status === "budget-exceeded" ? "OPERATION_BUDGET_EXCEEDED" : "RUNTIME_ERROR",
        message: "Firmware callback " + name + " failed",
        pc: Number(callbackState.pc) || 0,
        source: null
      };
      runtime.error.callback = name;
    }

    function drainPendingCallbacks() {
      var interrupts = runtime.interrupts;
      if (interrupts.primask || interrupts.drainingCallbacks) return;
      interrupts.drainingCallbacks = true;
      try {
        while (runtime.running && !interrupts.primask && interrupts.pendingCallbacks.length) {
          var pending = interrupts.pendingCallbacks.shift();
          var event = Object.assign({}, pending.event, {
            pendingSinceMs: pending.event.timeMs,
            time: runtime.time,
            timeMs: runtime.time,
            deferred: true
          });
          if (pending.interruptEventId) {
            var hardwareEvent = interrupts.events.find(function (item) { return item.id === pending.interruptEventId; });
            if (hardwareEvent && hardwareEvent.active) {
              if (hardwareEvent.type === "uartRx") {
                hardwareEvent.pending = false;
                serviceUartRxInterrupt(hardwareEvent.instance, runtime.time, pending.callbackDescriptors);
              } else completeInterruptEvent(hardwareEvent, runtime.time, true, pending.callbackDescriptors);
            }
          } else runFirmwareCallback(pending.name, event, pending.bindings, pending.hookKind, pending.descriptor);
        }
      } finally {
        interrupts.drainingCallbacks = false;
      }
      if (runtime.running && !interrupts.primask) serviceAllUartRxInterrupts(runtime.time);
    }

    function queuePendingCallback(name, event, bindings, hookKind, descriptor, interruptEventId) {
      // A source has one pending flag. DMA half/full are distinct sources.
      var key = [name, event.instance || event.pin || event.key || "", hookKind].join(":");
      var pending = runtime.interrupts.pendingCallbacks;
      if (!pending.some(function (item) { return item.key === key; })) {
        if (pending.length >= MAX_PENDING_INTERRUPT_CALLBACKS) {
          var overflow = new Error("Too many distinct pending interrupt sources");
          overflow.code = "INTERRUPT_PENDING_OVERFLOW";
          throw overflow;
        }
        pending.push({ key: key, name: name, event: cloneValue(event), bindings: cloneValue(bindings || {}),
          hookKind: hookKind, descriptor: cloneValue(descriptor || null), interruptEventId: interruptEventId || null,
          callbackDescriptors: interruptEventId ? cloneValue(model.callbacks || {}) : null });
      }
      event.pending = true;
      return event;
    }

    function runFirmwareCallback(name, event, bindings, hookKind, deferredDescriptor, synchronous) {
      var callbacks = model.callbacks && typeof model.callbacks === "object" ? model.callbacks : {};
      var descriptor = deferredDescriptor || callbacks[name];
      event = Object.assign({ callback: name, time: runtime.time, timeMs: runtime.time }, event || {});
      hookKind = hookKind || "Interrupt";
      if (runtime.interrupts.primask && !synchronous) {
        return queuePendingCallback(name, event, bindings, hookKind, descriptor);
      }
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
        onI2cRx: function (payload) {
          runtime.i2cRxCount += 1;
          appendBoundedHistory(runtime.i2cRx, payload);
          return callHook("onI2cRx", payload);
        },
        onSpiTx: function (payload) {
          runtime.spiTxCount += 1;
          appendBoundedHistory(runtime.spiTx, payload);
          return callHook("onSpiTx", payload);
        },
        onSpiRx: function (payload) {
          runtime.spiRxCount += 1;
          appendBoundedHistory(runtime.spiRx, payload);
          return callHook("onSpiRx", payload);
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
      var bindingKey = ["hadc", "huart", "hi2c", "hspi", "htim", "GPIO_Pin"].find(function (name) { return hasOwn(bindings, name); }) || Object.keys(bindings)[0];
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
      var callbackState;
      runtime.interrupts.callbackDepth += 1;
      try {
        var callbackRuntime = create(callbackModel, callbackHooks, { sharedStore: callbackSharedStore() });
        callbackRuntime.advanceTimeTo(event.timeMs);
        callbackRuntime.start();
        callbackState = callbackRuntime.step(0);
      } catch (error) {
        callbackState = {
          status: "error",
          pc: 0,
          operationsExecuted: 0,
          error: {
            code: error && error.code ? String(error.code) : "RUNTIME_ERROR",
            message: error && error.message ? error.message : String(error),
            pc: 0,
            source: error && error.source && typeof error.source === "object"
              ? cloneValue(error.source)
              : callbackDescriptorSource(descriptor)
          }
        };
      } finally {
        runtime.interrupts.callbackDepth -= 1;
        Object.keys(previousBindings).forEach(function (bindingName) {
          if (previousBindings[bindingName].present) runtime.variables[bindingName] = previousBindings[bindingName].value;
          else delete runtime.variables[bindingName];
        });
      }
      event.status = callbackState.status;
      event.operationsExecuted = callbackState.operationsExecuted;
      if (callbackState.error && !callbackState.error.source) callbackState.error.source = callbackDescriptorSource(descriptor);
      if (callbackState.error) event.error = cloneValue(callbackState.error);
      stopForCallbackFailure(name, callbackState);
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

    function busCallbackParameter(type) {
      return String(type || "").indexOf("i2c") === 0 ? "hi2c" : String(type || "").indexOf("spi") === 0 ? "hspi" : "huart";
    }

    function busCallbackName(bus, direction, memory, phase, accepted) {
      bus = String(bus || "").toLowerCase();
      direction = String(direction || "").toLowerCase();
      if (!accepted) return bus === "i2c" ? "HAL_I2C_ErrorCallback" : "HAL_SPI_ErrorCallback";
      if (bus === "i2c") {
        if (direction === "tx") return memory ? "HAL_I2C_MemTxCpltCallback" : "HAL_I2C_MasterTxCpltCallback";
        return memory ? "HAL_I2C_MemRxCpltCallback" : "HAL_I2C_MasterRxCpltCallback";
      }
      if (direction === "txrx") return "HAL_SPI_TxRxCpltCallback";
      return direction === "tx" ? "HAL_SPI_TxCpltCallback" : "HAL_SPI_RxCpltCallback";
    }

    function busTransferDuration(operation, bus, length) {
      var count = Math.max(1, Number(length) || 1);
      if (String(bus).toLowerCase() === "i2c") {
        var i2c = peripheralDescriptor(model.i2cs, operation.i2c || operation.handle, operationI2cInstance(operation)) || {};
        var clock = Number(i2c.clockSpeed || i2c.clockHz || 100000);
        return Math.max(0.001, count * 9 * 1000 / Math.max(1, clock));
      }
      var spi = peripheralDescriptor(model.spis, operation.spi || operation.handle, operationSpiInstance(operation)) || {};
      var baud = Number(spi.baudRate || spi.clockHz || spi.frequencyHz || 1000000);
      return Math.max(0.001, count * 8 * 1000 / Math.max(1, baud));
    }

    function busOperationAccepted(operation, bus, direction, eventTime, transferMode) {
      transferMode = transferMode || "interrupt";
      var modeFlags = transferMode === "dma" ? { dma: true, interrupt: false } : { dma: false, interrupt: true };
      var result;
      if (bus === "i2c") {
        if (direction === "tx") result = transmitI2c(Object.assign({}, operation, { resultTarget: null }, modeFlags), Boolean(operation.memoryAddress !== undefined));
        else if (direction === "rx") result = receiveI2c(Object.assign({}, operation, { resultTarget: null }, modeFlags), Boolean(operation.memoryAddress !== undefined));
        else result = false;
      } else if (direction === "tx") result = transmitSpi(Object.assign({}, operation, { resultTarget: null }, modeFlags));
      else if (direction === "rx") result = receiveSpi(Object.assign({}, operation, { resultTarget: null }, modeFlags));
      else result = transmitReceiveSpi(Object.assign({}, operation, { resultTarget: null }, modeFlags));
      return Boolean(result);
    }

    function completeBusInterrupt(event, eventTime) {
      if (!event || !event.bus) return true;
      var accepted = busOperationAccepted(event.operation || {}, event.bus, event.direction, eventTime, "interrupt");
      event.accepted = accepted;
      event.completedAt = eventTime;
      return accepted;
    }

    function startBusInterrupt(operation, bus, direction) {
      var instance = bus === "i2c" ? operationI2cInstance(operation) : operationSpiInstance(operation);
      var type = String(bus).toLowerCase() + String(direction).toLowerCase();
      var length = operationLength(operation);
      if (length == null || length < 1) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      if (interruptBusy(type, instance)) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_BUSY);
        return;
      }
      var duration = busTransferDuration(operation, bus, length);
      var event = startInterruptEvent(type, instance, firstDefined(operation, ["i2c", "spi", "handle"], instance), runtime.time + duration, {
        bus: String(bus).toLowerCase(), direction: direction, memory: operation.memoryAddress !== undefined,
        operation: cloneValue(operation), durationMs: duration
      });
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
      return event;
    }

    function startBusDma(operation, bus, direction) {
      var instance = bus === "i2c" ? operationI2cInstance(operation) : operationSpiInstance(operation);
      var type = String(bus).toLowerCase() + String(direction).toLowerCase();
      var length = operationLength(operation);
      if (length == null || length < 1) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      if (rejectBusyDma(operation, type, instance)) return;
      var duration = busTransferDuration(operation, bus, length);
      var transfer = {
        id: "dma-" + (++runtime.dma.sequence), key: dmaTransferKey(type, instance), type: type,
        bus: String(bus).toLowerCase(), direction: direction, memory: operation.memoryAddress !== undefined, instance: instance,
        handle: firstDefined(operation, ["i2c", "spi", "handle"], instance), operation: cloneValue(operation),
        dmaHandle: operation.dmaHandle || null, dmaInstance: operation.dmaInstance || resolveDmaInstance(operation.dmaHandle || "DMA"),
        buffer: firstDefined(operation, ["buffer", "rxBuffer", "txBuffer"], null),
        length: length, halfLength: Math.floor(length / 2), transferred: 0, active: true, circular: Boolean(operation.circular),
        cycle: 0, halfFired: false, startedAt: runtime.time, durationMs: duration,
        halfAt: length > 1 ? runtime.time + duration * Math.floor(length / 2) / length : null,
        completeAt: runtime.time + duration
      };
      runtime.dma.transfers.push(transfer);
      pruneDmaTransfers();
      dmaHistory({ type: type, phase: "started", id: transfer.id, key: transfer.key, instance: instance,
        dmaHandle: transfer.dmaHandle, dmaInstance: transfer.dmaInstance, buffer: transfer.buffer, length: length,
        time: runtime.time, timeMs: runtime.time });
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
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
        bus: transfer.bus || null,
        direction: transfer.direction || null,
        cycle: transfer.cycle,
        time: eventTime,
        timeMs: eventTime
      }, peripheralCallbackBindings(transfer.type === "adc" ? "hadc" : transfer.type === "uartTx" || transfer.type === "uartRx" ? "huart" : transfer.bus === "i2c" ? "hi2c" : "hspi", transfer), "Dma");
    }

    function dmaCallbackName(transfer, phase) {
      if (transfer.type === "adc") return phase === "half" ? "HAL_ADC_ConvHalfCpltCallback" : "HAL_ADC_ConvCpltCallback";
      if (transfer.type === "uartTx") return phase === "half" ? "HAL_UART_TxHalfCpltCallback" : "HAL_UART_TxCpltCallback";
      if (transfer.type === "uartRx") return phase === "half" ? "HAL_UART_RxHalfCpltCallback" : "HAL_UART_RxCpltCallback";
        if (transfer.bus === "i2c") {
        if (phase !== "complete") return "";
        if (transfer.accepted === false) return "HAL_I2C_ErrorCallback";
        if (transfer.direction === "tx") return transfer.memory ? "HAL_I2C_MemTxCpltCallback" : "HAL_I2C_MasterTxCpltCallback";
        return transfer.memory ? "HAL_I2C_MemRxCpltCallback" : "HAL_I2C_MasterRxCpltCallback";
      }
      if (transfer.bus === "spi") {
        if (phase !== "complete") return "";
        if (transfer.accepted === false) return "HAL_SPI_ErrorCallback";
        if (transfer.direction === "txrx") return "HAL_SPI_TxRxCpltCallback";
        return transfer.direction === "tx" ? "HAL_SPI_TxCpltCallback" : "HAL_SPI_RxCpltCallback";
      }
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
        accepted: transfer.accepted,
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
      var sample = Math.max(0, Math.round(Number(value) || 0));
      index = Math.max(0, Math.trunc(Number(index) || 0));

      // Keep the compact array representation for the usual ``uint16_t
      // samples[N]`` model. A pointer-valued variable must instead be treated
      // as an address; writing its own JavaScript property would silently lose
      // the DMA result.
      if (typeof buffer === "string") {
        var current = runtime.variables[buffer];
        if (isHeapPointer(current) || isVariablePointer(current)) {
          writePointer(pointerElementOffset(current, index), sample);
          return;
        }
        if (Array.isArray(current)) {
          if (index >= current.length) throw new Error("DMA buffer write is out of bounds");
          current[index] = coerceCValue(buffer, sample);
          runtime.variables[buffer] = current;
          return;
        }
      }

      // Address expressions (``&samples[1]``, ``p + 1`` and casts around
      // them) are preserved by hal_model and resolve to typed pointers here.
      if (buffer && typeof buffer === "object") {
        var pointer = memoryTargetPointer(buffer);
        writePointer(pointerElementOffset(pointer, index), sample);
        return;
      }
      throw new Error("DMA buffer is not writable");
    }

    function captureAsyncOperation(operation) {
      // HAL stores the address passed at the call, not the caller's mutable
      // pointer variable. This must also survive a helper returning.
      var captured = Object.assign({}, operation);
      ["buffer", "txBuffer", "rxBuffer"].forEach(function (key) {
        if (captured[key] == null) return;
        var reference = captured[key];
        var value = evaluate(reference);
        if (isPointer(value)) captured[key] = cloneValue(value);
        else if (Array.isArray(value)) {
          var owner = Object.keys(runtime.variables).find(function (name) { return runtime.variables[name] === value; });
          if (owner && (variableTypes[owner] || lifetimes[owner])) captured[key] = pointerForVariable(owner, 0);
        } else if (typeof value === "string" && typeof reference === "object") {
          captured[key] = pointerForBufferValue(value, 0);
        }
      });
      ["length", "deviceAddress", "memoryAddress", "memoryAddressSize"].forEach(function (key) {
        if (captured[key] != null) captured[key] = evaluate(captured[key]);
      });
      return captured;
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
      if (transfer.bus && phase === "complete") {
        transfer.accepted = busOperationAccepted(transfer.operation || {}, transfer.bus, transfer.direction, eventTime, "dma");
      }
      if (phase === "half") {
        transfer.halfFired = true;
        if (transfer.type !== "adc") transfer.transferred = transfer.halfLength;
        transfer.processing = true;
        dmaPhaseEvent(transfer, "half", eventTime);
        transfer.processing = false;
        if (!runtime.running || !transfer.active) {
          transfer.active = false;
          if (transfer.type === "adc") adcState(transfer.instance).dmaActive = false;
          pruneDmaTransfers();
        }
        return;
      }

      transfer.transferred = transfer.length;
      transfer.processing = true;
      dmaPhaseEvent(transfer, "complete", eventTime);
      transfer.processing = false;
      if (!runtime.running || !transfer.active) {
        transfer.active = false;
        if (transfer.type === "adc") adcState(transfer.instance).dmaActive = false;
      } else if (transfer.circular) {
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
        event.pending = false;
        runtime.interrupts.pendingCallbacks = runtime.interrupts.pendingCallbacks.filter(function (pending) {
          return pending.interruptEventId !== event.id && pending.event.id !== event.id;
        });
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
      if (dmaType && activeDmaTransfer(dmaType, instance)) return true;
      if (type.indexOf("i2c") === 0 || type.indexOf("spi") === 0) {
        var bus = type.indexOf("i2c") === 0 ? "i2c" : "spi";
        return runtime.dma.transfers.some(function (transfer) {
          return transfer.active && transfer.bus === bus && transfer.instance === instance;
        }) || runtime.interrupts.events.some(function (event) {
          return event.active && event.bus === bus && event.instance === instance;
        });
      }
      return false;
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
      if (event.bus === "i2c") {
        if (event.accepted === false) return "HAL_I2C_ErrorCallback";
        if (event.direction === "tx") return event.memory ? "HAL_I2C_MemTxCpltCallback" : "HAL_I2C_MasterTxCpltCallback";
        return event.memory ? "HAL_I2C_MemRxCpltCallback" : "HAL_I2C_MasterRxCpltCallback";
      }
      if (event.bus === "spi") {
        if (event.accepted === false) return "HAL_SPI_ErrorCallback";
        if (event.direction === "txrx") return "HAL_SPI_TxRxCpltCallback";
        return event.direction === "tx" ? "HAL_SPI_TxCpltCallback" : "HAL_SPI_RxCpltCallback";
      }
      return "";
    }

    function completeInterruptEvent(event, eventTime, fromPending, callbackDescriptors) {
      if (!event.active) return;
      if (event.type === "adc" && !event.sampled) {
        sampleAdcInterrupt(event, eventTime);
        event.sampled = true;
      }
      if (runtime.interrupts.primask) {
        if (!event.pending) event.pendingSinceMs = eventTime;
        event.pending = true;
        var pendingName = interruptCallbackName(event);
        queuePendingCallback(pendingName, {type: event.type, instance: event.instance, id: event.id, time: eventTime, timeMs: eventTime},
          {}, "Interrupt", null, event.id);
        // Hardware flags may become pending while the HAL handle remains busy.
        // Periodic hardware keeps ticking; a one-shot waits for ISR service.
        if (event.periodic && event.periodMs > 0) {
          event.cycle = Number(event.cycle || 0) + 1;
          event.dueAt += event.periodMs;
        } else event.dueAt = null;
        return;
      }
      event.processing = true;
      event.pending = false;
      // HAL makes a completed one-shot ready before invoking its user callback.
      if (!event.periodic) event.active = false;
      if (event.bus) event.accepted = completeBusInterrupt(event, eventTime);
      var callbackName = interruptCallbackName(event);
      var parameterName = event.type === "adc" ? "hadc" : event.type.indexOf("uart") === 0 ? "huart" : event.bus === "i2c" ? "hi2c" : event.bus === "spi" ? "hspi" : "htim";
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
        }, peripheralCallbackBindings(parameterName, event), "Interrupt",
        callbackDescriptors && callbackDescriptors[callbackName]);
      }
      event.processing = false;
      if (!runtime.running) {
        event.active = false;
        if (event.type === "adc") adcState(event.instance).interruptActive = false;
      } else if (event.periodic && event.periodMs > 0 && !fromPending) {
        event.cycle = Number(event.cycle || 0) + 1;
        event.dueAt += event.periodMs;
      } else if (!event.periodic) {
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
      if (!runtime.interrupts.callbackDepth) serviceUartRxInterrupt(instance, runtime.time);
      return event;
    }

    function serviceUartRxInterrupt(instance, eventTime, callbackDescriptors) {
      // A callback may rearm a one-byte receive. Consume subsequent queued
      // bytes iteratively in the owning engine, without recursive callbacks.
      var guard = 0;
      while (runtime.running && (!runtime.interrupts.callbackDepth || callbackDescriptors) && guard++ < 1024) {
        var event = runtime.interrupts.events.find(function (item) {
          return item.active && !item.pending && !item.processing && item.type === "uartRx" && item.instance === instance;
        });
        if (!event) break;
        var queue = uartQueue(instance);
        var needed = event.length - event.transferred;
        if (needed <= 0 || !queue.length) break;
        if (runtime.interrupts.primask) {
          // UART IT uses CPU ISR code to copy bytes; unlike DMA it cannot
          // update the caller's RAM buffer while interrupts are masked.
          event.pending = true;
          queuePendingCallback("HAL_UART_RxCpltCallback",
            {type: event.type, instance: event.instance, id: event.id, time: eventTime, timeMs: eventTime},
            {}, "Interrupt", null, event.id);
          break;
        }
        var received = queue.splice(0, Math.min(needed, queue.length));
        writeReceiveBufferAt(event.buffer, event.transferred, received);
        event.transferred += received.length;
        if (event.transferred >= event.length) completeInterruptEvent(event, eventTime, false, callbackDescriptors);
      }
    }

    function serviceAllUartRxInterrupts(eventTime) {
      var instances = new Set();
      runtime.interrupts.events.forEach(function (event) {
        if (runtime.running && event.active && event.type === "uartRx") instances.add(event.instance);
      });
      instances.forEach(function (instance) { if (runtime.running) serviceUartRxInterrupt(instance, eventTime); });
    }

    function abortUartInterrupt(operation) {
      var instance = operationInstance(operation);
      var direction = String(operation.direction || "both");
      var hasDma = runtime.dma.transfers.some(function (transfer) {
        return transfer.active && transfer.instance === instance
          && (direction === "both" || transfer.type === (direction === "tx" ? "uartTx" : "uartRx"));
      });
      cancelInterruptEvents(function (event) {
        return event.instance === instance && (direction === "both" || event.type === (direction === "tx" ? "uartTx" : "uartRx"));
      }, runtime.time, "HAL_UART_Abort_IT");
      var callbackName = direction === "tx" ? "HAL_UART_AbortTransmitCpltCallback" : direction === "rx" ? "HAL_UART_AbortReceiveCpltCallback" : "HAL_UART_AbortCpltCallback";
      var handle = firstDefined(operation, ["uart", "handle"], instance);
      runFirmwareCallback(callbackName, { type: "uartAbort", phase: "complete", instance: instance, handle: handle, time: runtime.time, timeMs: runtime.time }, peripheralCallbackBindings("huart", { instance: instance, handle: handle }), "Interrupt", null, !hasDma);
      setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
    }

    function abortBusTransfer(operation, bus) {
      bus = String(bus || "").toLowerCase();
      var instance = bus === "i2c" ? operationI2cInstance(operation) : operationSpiInstance(operation);
      var handle = firstDefined(operation, [bus, "handle"], instance);
      var apiName = bus === "i2c" ? "HAL_I2C_Master_Abort_IT" : "HAL_SPI_Abort_IT";
      var cancelledInterrupts = cancelInterruptEvents(function (event) {
        return event.active && event.bus === bus && event.instance === instance;
      }, runtime.time, apiName);
      var cancelledDmaTransfers = cancelDmaTransfers(function (transfer) {
        return transfer.bus === bus && transfer.instance === instance;
      }, runtime.time, apiName);
      var abortEvent = {
        type: bus + "Abort",
        kind: "abort",
        phase: "complete",
        instance: instance,
        handle: handle,
        interrupt: true,
        cancelledInterrupts: cancelledInterrupts,
        cancelledDmaTransfers: cancelledDmaTransfers,
        time: runtime.time,
        timeMs: runtime.time
      };
      abortEvent[bus] = handle;
      if (bus === "i2c") abortEvent.address = evaluatedNumber(firstDefined(operation, ["deviceAddress", "address"], null), null);

      var history = bus === "i2c" ? runtime.i2cTx : runtime.spiTx;
      appendBoundedHistory(history, abortEvent);
      if (bus === "i2c") runtime.i2cTxCount += 1;
      else runtime.spiTxCount += 1;
      callHook(bus === "i2c" ? "onI2cTx" : "onSpiTx", cloneValue(abortEvent));

      var parameterName = bus === "i2c" ? "hi2c" : "hspi";
      var callbackName = bus === "i2c" ? "HAL_I2C_AbortCpltCallback" : "HAL_SPI_AbortCpltCallback";
      runFirmwareCallback(callbackName, abortEvent, peripheralCallbackBindings(parameterName, {
        instance: instance,
        handle: handle
      }), "Interrupt", null, bus === "spi" && cancelledDmaTransfers === 0);
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
        if (runtime.running) runFirmwareCallback("HAL_GPIO_EXTI_Callback", event, { GPIO_Pin: pinMask }, "Interrupt");
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
      while (runtime.running && eventBudget.remaining > 0) {
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
        while (queue.length && transfer.active && runtime.running && guard++ < 1024) {
          var needed = transfer.length - transfer.transferred;
          var count = Math.min(needed, queue.length);
          var received = queue.splice(0, count);
          writeReceiveBufferAt(transfer.buffer, transfer.transferred, received);
          var previous = transfer.transferred;
          transfer.transferred += count;
          if (!transfer.halfFired && transfer.halfLength > 0 && previous < transfer.halfLength && transfer.transferred >= transfer.halfLength) {
            transfer.halfFired = true;
            dmaPhaseEvent(transfer, "half", eventTime);
            if (!runtime.running) {
              transfer.active = false;
              break;
            }
          }
          if (transfer.transferred >= transfer.length) {
            dmaPhaseEvent(transfer, "complete", eventTime);
            if (!runtime.running) {
              transfer.active = false;
              break;
            }
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
        if (runtime.running && transfer.active && transfer.type === "uartRx") instances.add(transfer.instance);
      });
      instances.forEach(function (instance) { if (runtime.running) serviceUartRxDma(instance, eventTime); });
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
      if (isPointer(buffer)) {
        var dma = dmaDescriptor(operation.dmaHandle || descriptor.dmaHandle) || {};
        var alignment = String(dma.memoryAlignment || "");
        var width = /HALFWORD/.test(alignment) ? 2 : /WORD/.test(alignment) ? 4 : /BYTE/.test(alignment) ? 1 : buffer.storageElementSize || buffer.elementSize;
        buffer = Object.assign({}, buffer, { elementSize: width, pointeeType: "uint" + (width * 8) + "_t", unsigned: true });
      }
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

    function executeAliceDs18b20(operation, kind) {
      if (kind === "aliceds18b20rawtocelsiusx100") {
        var signedRaw = Math.trunc(aliceNumber(operation.raw, 0)) & 0xffff;
        if (signedRaw & 0x8000) signedRaw -= 0x10000;
        setOperationResult(operation, Math.trunc(signedRaw * 100 / 16));
        return;
      }
      var context = alicePeripheralContext("ds18b20", operation, { initialized: false, dataPin: "" });
      if (kind === "aliceds18b20init") {
        var dataPin = String(operation.dataPin || "").toUpperCase();
        var valid = operation.deviceNull !== true && operation.contextValid !== false && operation.bindingValid === true && /^P[A-K](?:[0-9]|1[0-5])$/.test(dataPin);
        if (valid) {
          context.initialized = true;
          context.dataPin = dataPin;
          context.callbacks = Array.isArray(operation.callbacks) ? operation.callbacks.slice() : [];
          context.busContext = operation.busContext;
        }
        setOperationResult(operation, valid ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      var outputPointer = null;
      if (kind === "aliceds18b20readraw" && hasOwn(operation, "outputPointer")) {
        try {
          outputPointer = evaluate(operation.outputPointer);
          if (!isPointer(outputPointer)) throw new Error("DS18B20 output must be a non-null pointer");
          checkPointerLifetime(outputPointer);
        } catch (_) {
          setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
          return;
        }
      } else if (kind === "aliceds18b20readraw" && !operation.target) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      if (!context.initialized || operation.deviceNull === true || operation.contextValid === false || !context.dataPin) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      var response = requestAlicePeripheral("ds18b20", kind === "aliceds18b20startconversion" ? "start-conversion" : "read-raw", context);
      var accepted = response.accepted === true;
      if (accepted && kind === "aliceds18b20readraw") {
        var raw = response.result && response.result.raw;
        accepted = Number.isInteger(raw) && raw >= -32768 && raw <= 32767;
        if (accepted) {
          try {
            if (outputPointer) writePointer(outputPointer, raw);
            else assign(operation.target, raw);
          } catch (_) { accepted = false; }
        }
      }
      setOperationResult(operation, accepted ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR);
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
        else if (kind === "alicetm1637setcolon") {
          response = requestAlicePeripheral("tm1637", "set-colon", context, { colon: Boolean(aliceNumber(operation.enabled, 0)) });
        } else if (kind === "alicetm1637displayraw" || kind === "alicetm1637writesegments") {
          var startPosition = kind === "alicetm1637displayraw" ? 0 : Math.trunc(aliceNumber(operation.startPosition, 0));
          var segmentCount = kind === "alicetm1637displayraw" ? 4 : Math.trunc(aliceNumber(operation.count, 0));
          // Validate before reading a C pointer, just as the physical driver does.
          var segmentBuffer = operation.buffer;
          var bufferValue = typeof segmentBuffer === "string" && hasOwn(runtime.variables, segmentBuffer) ? runtime.variables[segmentBuffer] : evaluate(segmentBuffer);
          if (!context.clkPin || !context.dioPin || bufferValue == null || bufferValue === 0 || startPosition < 0 || startPosition > 3 || segmentCount < 1 || segmentCount > 4 - startPosition) {
            setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
            return;
          }
          var segmentBytes = operationBytes(Object.assign({}, operation, { length: segmentCount }));
          if (segmentBytes.length !== segmentCount) {
            setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
            return;
          }
          var segmentPayload = { startPosition: startPosition, segments: segmentBytes };
          if (kind === "alicetm1637displayraw") {
            segmentPayload.colon = Boolean(aliceNumber(operation.colon, 0));
            segmentBytes[1] = (segmentBytes[1] & 0x7f) | (segmentPayload.colon ? 0x80 : 0);
          }
          response = requestAlicePeripheral("tm1637", "write-segments", context, segmentPayload);
        }
        else {
          context.value = Math.trunc(aliceNumber(operation.value, context.value));
          response = requestAlicePeripheral("tm1637", "display-number", context, { value: context.value, leadingZero: Boolean(aliceNumber(operation.leadingZero, 0)), colon: Boolean(aliceNumber(operation.colon, 0)) });
        }
        if (!response.accepted) status = BUILTIN_CONSTANTS.HAL_ERROR;
      }
      setOperationResult(operation, status);
    }

    function pwmPulseValues(buffer, count) {
      var value = typeof buffer === "string" && hasOwn(runtime.variables, buffer) ? runtime.variables[buffer] : evaluate(buffer);
      if (value == null || value === 0) return [];
      if (Array.isArray(value)) return value.slice(0, count).map(function (item) { return Math.trunc(Number(item) || 0) & 0xffff; });
      if (!isPointer(value)) return [];
      var bytes = memoryBytes(value, count * 2);
      var samples = [];
      for (var i = 0; i + 1 < bytes.length; i += 2) samples.push(bytes[i] | (bytes[i + 1] << 8));
      return samples;
    }

    function sendWs2812Pwm(operation, pulses, context) {
      var descriptor = timerDescriptor(operation.timer || operation.instance) || {};
      var channelNumber = pwmChannelNumber(operation);
      var channel = Array.isArray(descriptor.channels) ? descriptor.channels.find(function (item) { return Number(item.channelNumber) === channelNumber; }) : null;
      var pin = channel && channel.pin;
      var period = Number(descriptor.period);
      var frequencyHz = Number(descriptor.frequencyHz);
      if (!pin || !Number.isFinite(period) || period < 1 || !Number.isFinite(frequencyHz) || frequencyHz <= 0 || !pulses.length) return false;
      var route = Object.assign({}, context || {}, { name: context && context.name || descriptor.instance + ":CH" + channelNumber, dataPin: pin, timer: descriptor.handle || operation.timer, channel: channelNumber });
      var response = requestAlicePeripheral("ws2812", "pwm-frame", route, { pulses: pulses.slice(), period: period, frequencyHz: frequencyHz });
      return Boolean(response.accepted);
    }

    function ws2812PulseCapacity(value) {
      if (Array.isArray(value)) return value.length;
      if (isHeapPointer(value)) return Math.max(0, Math.floor((heapAllocation(value).size - Number(value.offset || 0)) / 2));
      if (isVariablePointer(value)) return Math.max(0, Math.floor((variableMemoryBytes(value.name).length - Number(value.offset || 0)) / 2));
      return 0;
    }

    function executeAliceWs2812(operation, kind) {
      if (kind === "alicews2812requiredpulsecount") {
        setOperationResult(operation, (Math.trunc(aliceNumber(operation.ledCount, 0)) & 0xffff) * 24 + (Math.trunc(aliceNumber(operation.resetSlots, 0)) & 0xffff));
        return;
      }
      var context = alicePeripheralContext("ws2812", operation, { initialized: false });
      if (kind === "alicews2812init") {
        var zero = Math.trunc(aliceNumber(operation.zeroHighTicks, 0)) & 0xffff;
        var one = Math.trunc(aliceNumber(operation.oneHighTicks, 0)) & 0xffff;
        if (!operation.timer || zero < 1 || one <= zero) {
          setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
          return;
        }
        Object.assign(context, { initialized: true, timer: operation.timer, channel: pwmChannelNumber(operation), zeroHighTicks: zero, oneHighTicks: one, resetSlots: (Math.trunc(aliceNumber(operation.resetSlots, 0)) & 0xffff) || 48 });
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
        return;
      }
      var count = Math.trunc(aliceNumber(operation.ledCount, -1));
      var required = count * 24 + Number(context.resetSlots || 0);
      var capacity = Math.trunc(aliceNumber(operation.capacity, 0));
      var buffer = operation.pulseBuffer;
      var pulseValue = typeof buffer === "string" && hasOwn(runtime.variables, buffer) ? runtime.variables[buffer] : evaluate(buffer);
      var rgbValue = typeof operation.buffer === "string" && hasOwn(runtime.variables, operation.buffer) ? runtime.variables[operation.buffer] : evaluate(operation.buffer);
      if (!context.initialized || count < 0 || count > 256 || capacity < required || pulseValue == null || pulseValue === 0 || rgbValue == null || rgbValue === 0 || kind === "alicews2812encode" && !operation.pulseCountTarget) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      var countPointer = null;
      var countVariable = null;
      if (kind === "alicews2812encode") {
        try {
          var countTarget = operation.pulseCountTarget;
          if (typeof countTarget === "string" && hasOwn(runtime.variables, countTarget) && !isPointer(runtime.variables[countTarget]) && !Array.isArray(runtime.variables[countTarget])) countVariable = countTarget;
          else countPointer = memoryTargetPointer(typeof countTarget === "string" ? { kind: "variable", name: countTarget } : countTarget);
        } catch (_) {
          setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
          return;
        }
      }
      var rgb = operationBytes(Object.assign({}, operation, { length: count * 3 }));
      if (rgb.length !== count * 3 || ws2812PulseCapacity(pulseValue) < required) {
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_ERROR);
        return;
      }
      var pulses = [];
      for (var led = 0; led < count; led += 1) {
        var grb = [rgb[led * 3 + 1], rgb[led * 3], rgb[led * 3 + 2]];
        for (var color = 0; color < 3; color += 1) for (var bit = 7; bit >= 0; bit -= 1) pulses.push(grb[color] & (1 << bit) ? context.oneHighTicks : context.zeroHighTicks);
      }
      while (pulses.length < required) pulses.push(0);
      for (var i = 0; i < pulses.length; i += 1) dmaWriteArray(buffer, i, pulses[i]);
      if (kind === "alicews2812encode") {
        if (countVariable) assign(countVariable, required);
        else writePointer(countPointer, required);
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
      } else setOperationResult(operation, sendWs2812Pwm(context, pulses, context) ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR);
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
      if (/^(?:adcstartdma|uart(?:transmit|receive)(?:it|dma)|(?:i2c|spi).*(?:it|dma))$/.test(instruction.kind) && operation) {
        operation = captureAsyncOperation(operation);
      }
      if (instruction.kind === "scopeenter" || instruction.kind === "scopeexit") {
        instruction.names.forEach(function (name) {
          if (instruction.kind === "scopeenter") {
            lifetimes[name] = ++cStorage.sequence;
            runtime.variables[name] = 0;
          } else {
            delete lifetimes[name];
            delete runtime.variables[name];
          }
        });
        runtime.pc += 1;
        return;
      }
      if (operation && operation.cType) {
        var declaredTarget = firstDefined(operation, ["resultTarget", "target"], null);
        if (typeof declaredTarget === "string") {
          variableTypes[declaredTarget] = operation.cType;
          if (operation.static && staticInitialized.has(declaredTarget)) { runtime.pc += 1; return; }
          if (operation.static) staticInitialized.add(declaredTarget);
        }
      }
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
      if (instruction.kind === "irqdisable" || instruction.kind === "irqenable" || instruction.kind === "irqsetmask") {
        runtime.interrupts.primask = instruction.kind === "irqdisable" ? 1
          : instruction.kind === "irqenable" ? 0 : Number(evaluate(operation.value)) & 1;
        runtime.pc += 1;
        if (!runtime.interrupts.primask) drainPendingCallbacks();
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
        runtime.randomState = Math.trunc(Number(evaluate(operation.seed)) || 0) >>> 0;
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
      if (instruction.kind === "expression") {
        // Standalone C expressions (for example ``index++`` or a macro that
        // expands to a comma expression) are real statements. They must be
        // evaluated once and advance the program counter just like an assign.
        var expressionResult = evaluate(firstDefined(operation, ["expression", "value"], null));
        setOperationResult(operation, expressionResult);
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
      if (instruction.kind === "i2ctransmitit") {
        startBusInterrupt(operation, "i2c", "tx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2ctransmitdma") {
        startBusDma(operation, "i2c", "tx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2creceive") {
        receiveI2c(operation, false);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2creceiveit") {
        startBusInterrupt(operation, "i2c", "rx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2creceivedma") {
        startBusDma(operation, "i2c", "rx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2cmemwrite") {
        transmitI2c(operation, true);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2cmemwriteit") {
        startBusInterrupt(operation, "i2c", "tx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2cmemwritedma") {
        startBusDma(operation, "i2c", "tx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2cmemread") {
        receiveI2c(operation, true);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2cmemreadit") {
        startBusInterrupt(operation, "i2c", "rx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2cmemreaddma") {
        startBusDma(operation, "i2c", "rx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "i2cabortit") {
        abortBusTransfer(operation, "i2c");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "spitransmit") {
        transmitSpi(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "spitransmitit") {
        startBusInterrupt(operation, "spi", "tx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "spitransmitdma") {
        startBusDma(operation, "spi", "tx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "spireceive") {
        receiveSpi(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "spireceiveit") {
        startBusInterrupt(operation, "spi", "rx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "spireceivedma") {
        startBusDma(operation, "spi", "rx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "spitransmitreceive") {
        transmitReceiveSpi(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "spitransmitreceiveit") {
        startBusInterrupt(operation, "spi", "txrx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "spitransmitreceivedma") {
        startBusDma(operation, "spi", "txrx");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "spiabortit") {
        abortBusTransfer(operation, "spi");
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "adcstart") {
        startAdc(operation);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "adcstop") {
        stopAdc(operation);
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
        else setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "pwmstartdma") {
        var pulseCount = operationLength(operation);
        var pulseSamples = pulseCount != null && pulseCount > 0 && pulseCount <= 71680 ? pwmPulseValues(operation.buffer, pulseCount) : [];
        setOperationResult(operation, pulseSamples.length === pulseCount && sendWs2812Pwm(operation, pulseSamples) ? BUILTIN_CONSTANTS.HAL_OK : BUILTIN_CONSTANTS.HAL_ERROR);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "pwmstopdma") {
        updatePwm(operation, { active: false });
        setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind === "pwmstop") {
        updatePwm(operation, { active: false });
        if (operation.interrupt) stopTimerInterrupt(operation);
        else setOperationResult(operation, BUILTIN_CONSTANTS.HAL_OK);
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
      if (instruction.kind.indexOf("aliceds18b20") === 0) {
        executeAliceDs18b20(operation, instruction.kind);
        runtime.pc += 1;
        return;
      }
      if (["alicedht11", "alicehcsr04", "alicesg90", "alicebuzzer", "alicetm1637"].some(function (prefix) { return instruction.kind.indexOf(prefix) === 0; })) {
        executeAlicePeripheral(operation, instruction.kind);
        runtime.pc += 1;
        return;
      }
      if (instruction.kind.indexOf("alicews2812") === 0) {
        executeAliceWs2812(operation, instruction.kind);
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
        i2cRx: cloneValue(runtime.i2cRx),
        spiTx: cloneValue(runtime.spiTx),
        spiRx: cloneValue(runtime.spiRx),
        uartTxCount: runtime.uartTxCount,
        i2cTxCount: runtime.i2cTxCount,
        i2cRxCount: runtime.i2cRxCount,
        spiTxCount: runtime.spiTxCount,
        spiRxCount: runtime.spiRxCount,
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
      Object.keys(lifetimes).forEach(function (name) { delete lifetimes[name]; });
      cStorage.sequence = 0;
      storedPointers.clear();
      staticInitialized.clear();
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
        runtime.interrupts.primask = 0;
        runtime.interrupts.pendingCallbacks.splice(0, runtime.interrupts.pendingCallbacks.length);
        runtime.interrupts.drainingCallbacks = false;
        runtime.interrupts.callbackDepth = 0;
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
        runtime.interrupts = { events: [], history: [], sequence: 0, gpioLevels: {}, primask: 0, pendingCallbacks: [], drainingCallbacks: false, callbackDepth: 0 };
        runtime.pwm = {};
        runtime.peripherals = cloneValue(peripheralDefaults);
        runtime.heap = emptyHeap();
        runtime.stdio = [];
        runtime.randomState = 1;
      }
      runtime.uartTx = [];
      initializeCStorage();
      runtime.i2cTx = [];
      runtime.i2cRx = [];
      runtime.spiTx = [];
      runtime.spiRx = [];
      runtime.uartTxCount = 0;
      runtime.i2cTxCount = 0;
      runtime.i2cRxCount = 0;
      runtime.spiTxCount = 0;
      runtime.spiRxCount = 0;
      runtime.stdioCount = 0;
      runtime.internalSlots = {};
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
        if (runtime.running) serviceUartRxInterrupt(resolved, runtime.time);
      }
      return notifyState();
    }

    function advanceTimeTo(targetTime) {
      var target = Number(targetTime);
      if (!Number.isFinite(target) || target < runtime.time) return snapshot();
      if (runtime.running) {
        var advanceResult = processTimedDmaUntil(target, { remaining: MAX_DMA_EVENTS_PER_STEP });
        if (!runtime.running) {
          runtime.pendingAdvanceMs = 0;
          return snapshot();
        }
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
            var resumedAfterPositiveWait = runtime.sleepUntil > runtime.time + 1e-9;
            runtime.time = runtime.sleepUntil;
            // A positive delay/RTOS wait is an explicit firmware yield.  The
            // per-step guard protects only a single run-to-yield slice, so a
            // long simulated time jump may safely execute many delayed loop
            // iterations without being mistaken for a non-yielding loop.
            if (resumedAfterPositiveWait) budget = operationBudget;
            runtime.sleepUntil = null;
            runtime.status = "running";
            continue;
          }

          if (runtime.blocked) {
            var blockedInstruction = instructions[runtime.pc];
            if (blockedInstruction && tryUartReceive(blockedInstruction.operation)) {
              runtime.status = "running";
              budget = operationBudget;
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
              budget = operationBudget;
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
