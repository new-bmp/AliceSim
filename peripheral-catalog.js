(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.AlicePeripheralCatalog = api;
    if (root.document) {
      if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", function () { api.mountLibrary(root.document); }, { once: true });
      else api.mountLibrary(root.document);
    }
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LIBDRIVER_UPSTREAM = Object.freeze({
    dht11: "dht11",
    hcsr04: "hcsr04",
    tm1637: "tm1637",
    bmp280: "bmp280",
    mpu6050: "mpu6050",
    bh1750: "bh1750fvi",
    sht30: "sht30",
    ds3231: "ds3231",
    pcf8574: "pcf8574",
    pca9685: "pca9685",
    ina219: "ina219",
    ds18b20: "ds18b20",
    max7219: "max7219",
    w25qxx: "w25qxx",
    ws2812: "ws2812b"
  });

  var INSTALLABLE_DRIVER_IDS = Object.freeze([
    "dht11", "hcsr04", "sg90", "buzzer", "tm1637", "bmp280", "mpu6050", "bh1750", "sht30",
    "ds3231", "pcf8574", "pca9685", "ina219", "ds18b20", "max7219", "w25qxx", "ws2812",
    "rotary-encoder", "potentiometer", "relay", "pir", "mq2", "joystick", "mosfet", "dc-dc-converter"
  ]);
  var EXTRA_DRIVER_FILES = Object.freeze({
    dht11: ["Drivers/AliceSIM/Inc/alicesim_timing.h"],
    hcsr04: ["Drivers/AliceSIM/Inc/alicesim_timing.h"]
  });

  var ITEMS = [
    { type: "dht11", id: "dht11", prefix: "TH", title: "DHT11 温湿度传感器", value: "25.0 °C · 50.0 %RH", bus: "1-Wire", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["DATA", "right", "data"]], controls: [{ key: "temperatureC", label: "环境温度", min: -20, max: 60, step: 0.1, value: 25, unit: "°C" }, { key: "humidityPercent", label: "相对湿度", min: 0, max: 100, step: 0.1, value: 50, unit: "%RH" }] },
    { type: "hcsr04", id: "hcsr04", prefix: "US", title: "HC-SR04 超声波测距", value: "100.0 cm", bus: "Pulse", nominalVoltage: 5, pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["TRIG", "right", "trigger"], ["ECHO", "right", "echo"]], controls: [{ key: "distanceCm", label: "目标距离", min: 2, max: 400, step: 0.1, value: 100, unit: "cm" }] },
    { type: "sg90", id: "sg90", prefix: "SV", title: "SG90 舵机", value: "90°", bus: "PWM", nominalVoltage: 5, pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["PWM", "right", "pwm"]], controls: [{ key: "angle", label: "初始角度", min: 0, max: 180, step: 1, value: 90, unit: "°" }] },
    { type: "buzzer", id: "buzzer", prefix: "BZ", title: "PWM 无源蜂鸣器", value: "2.0 kHz", bus: "PWM", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["SIG", "right", "signal"]], controls: [{ key: "frequencyHz", label: "初始频率", min: 20, max: 20000, step: 10, value: 2000, unit: "Hz" }, { key: "dutyPermille", label: "占空比", min: 0, max: 1000, step: 10, value: 500, unit: "‰" }] },
    { type: "tm1637", id: "tm1637", prefix: "DISP", title: "TM1637 四位数码管", value: "1234", bus: "2-Wire", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["CLK", "right", "clk"], ["DIO", "right", "dio"]], controls: [{ key: "displayValue", label: "初始数字", min: -999, max: 9999, step: 1, value: 1234, unit: "" }, { key: "brightness", label: "亮度", min: 0, max: 7, step: 1, value: 7, unit: "/7" }] },
    { type: "bmp280", id: "bmp280", prefix: "BARO", title: "BMP280 气压温度传感器", value: "101325 Pa", bus: "I²C/SPI", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["SCL", "right", "clk"], ["SDA", "right", "dio"]], controls: [{ key: "pressurePa", label: "气压", min: 30000, max: 110000, step: 10, value: 101325, unit: "Pa" }, { key: "temperatureC", label: "温度", min: -40, max: 85, step: 0.1, value: 25, unit: "°C" }] },
    { type: "mpu6050", id: "mpu6050", prefix: "IMU", title: "MPU6050 六轴 IMU", value: "±2g · ±250°/s", bus: "I²C", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["SCL", "right", "clk"], ["SDA", "right", "dio"], ["INT", "right", "interrupt"]], controls: [{ key: "accelX", label: "X 轴加速度", min: -16, max: 16, step: 0.01, value: 0, unit: "g" }, { key: "gyroZ", label: "Z 轴角速度", min: -2000, max: 2000, step: 0.1, value: 0, unit: "°/s" }] },
    { type: "bh1750", id: "bh1750", prefix: "LUX", title: "BH1750 数字照度传感器", value: "500 lux", bus: "I²C", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["SCL", "right", "clk"], ["SDA", "right", "dio"]], controls: [{ key: "lux", label: "照度", min: 0, max: 65535, step: 1, value: 500, unit: "lux" }] },
    { type: "sht30", id: "sht30", prefix: "SHT", title: "SHT30 高精度温湿度", value: "25.0 °C · 50.0 %RH", bus: "I²C", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["SCL", "right", "clk"], ["SDA", "right", "dio"]], controls: [{ key: "temperatureC", label: "温度", min: -40, max: 125, step: 0.1, value: 25, unit: "°C" }, { key: "humidityPercent", label: "湿度", min: 0, max: 100, step: 0.1, value: 50, unit: "%RH" }] },
    { type: "ds3231", id: "ds3231", prefix: "RTC", title: "DS3231 高精度实时时钟", value: "2026-07-31 12:00:00", bus: "I²C", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["SCL", "right", "clk"], ["SDA", "right", "dio"], ["SQW", "right", "signal"]], controls: [{ key: "unixTime", label: "Unix 时间", min: 0, max: 4102444800, step: 1, value: 1785470400, unit: "s" }] },
    { type: "pcf8574", id: "pcf8574", prefix: "IOX", title: "PCF8574 八位 IO 扩展", value: "ADDR 0x20", bus: "I²C", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["SCL", "right", "clk"], ["SDA", "right", "dio"], ["INT", "right", "interrupt"]], controls: [{ key: "inputMask", label: "输入电平掩码", min: 0, max: 255, step: 1, value: 255, unit: "" }] },
    { type: "pca9685", id: "pca9685", prefix: "PWM", title: "PCA9685 16 路 PWM 控制器", value: "50 Hz · 16 CH", bus: "I²C", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["SCL", "right", "clk"], ["SDA", "right", "dio"], ["PWM0", "right", "pwm"]], controls: [{ key: "frequencyHz", label: "PWM 频率", min: 24, max: 1526, step: 1, value: 50, unit: "Hz" }, { key: "channel0", label: "通道 0", min: 0, max: 4095, step: 1, value: 0, unit: "/4095" }] },
    { type: "ina219", id: "ina219", prefix: "MON", title: "INA219 电压电流监测", value: "12.00 V · 0.50 A", bus: "I²C", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["SCL", "right", "clk"], ["SDA", "right", "dio"]], controls: [{ key: "busVoltageV", label: "总线电压", min: 0, max: 26, step: 0.01, value: 12, unit: "V" }, { key: "currentA", label: "电流", min: -3.2, max: 3.2, step: 0.001, value: 0.5, unit: "A" }] },
    { type: "ds18b20", id: "ds18b20", prefix: "TEMP", title: "DS18B20 单总线温度传感器", value: "25.00 °C", bus: "1-Wire", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["DQ", "right", "data"]], controls: [{ key: "temperatureC", label: "温度", min: -55, max: 125, step: 0.0625, value: 25, unit: "°C" }] },
    { type: "max7219", id: "max7219", prefix: "MAT", title: "MAX7219 8×8 LED 点阵", value: "8×8 MATRIX", bus: "SPI", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["DIN", "right", "data"], ["CLK", "right", "clk"], ["CS", "right", "signal"]], controls: [{ key: "intensity", label: "亮度", min: 0, max: 15, step: 1, value: 8, unit: "/15" }] },
    { type: "w25qxx", id: "w25qxx", prefix: "FLASH", title: "W25Qxx SPI Flash", value: "W25Q64 · 8 MiB", bus: "SPI", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["MOSI", "right", "data"], ["MISO", "right", "dio"], ["SCK", "right", "clk"], ["CS", "right", "signal"]], controls: [{ key: "capacityKiB", label: "容量", min: 512, max: 32768, step: 512, value: 8192, unit: "KiB" }] },
    { type: "ws2812", id: "ws2812", prefix: "RGB", title: "WS2812B 可编程 RGB 灯带", value: "8 LEDs · #00AEEF", bus: "NRZ", nominalVoltage: 5, pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["DIN", "right", "data"]], controls: [{ key: "count", label: "灯珠数量", min: 1, max: 256, step: 1, value: 8, unit: "颗" }, { key: "color", label: "RGB 颜色值", min: 0, max: 16777215, step: 1, value: 44783, unit: "" }] },
    { type: "rotaryEncoder", id: "rotary-encoder", prefix: "ENC", title: "EC11 旋转编码器", value: "0 steps", bus: "GPIO", pins: [["GND", "left", "ground"], ["A", "right", "data"], ["B", "right", "dio"], ["SW", "right", "signal"]], controls: [{ key: "position", label: "编码位置", min: -1000, max: 1000, step: 1, value: 0, unit: "steps" }, { key: "pressed", label: "按键电平", min: 0, max: 1, step: 1, value: 0, unit: "" }] },
    { type: "potentiometer", id: "potentiometer", prefix: "RV", title: "电位器模拟输入", value: "50 %", bus: "ADC", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["AO", "right", "analog"]], controls: [{ key: "percent", label: "旋钮位置", min: 0, max: 100, step: 0.1, value: 50, unit: "%" }] },
    { type: "relay", id: "relay", prefix: "K", title: "单路继电器模块", value: "5 V · NO", bus: "GPIO", nominalVoltage: 5, pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["IN", "right", "signal"], ["COM", "right", "passive"], ["NO", "right", "passive"], ["NC", "right", "passive"]], controls: [{ key: "activeLow", label: "低电平触发", min: 0, max: 1, step: 1, value: 1, unit: "" }] },
    { type: "pir", id: "pir", prefix: "PIR", title: "HC-SR501 人体红外传感器", value: "NO MOTION", bus: "GPIO", nominalVoltage: 5, pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["OUT", "right", "signal"]], controls: [{ key: "motion", label: "检测到运动", min: 0, max: 1, step: 1, value: 0, unit: "" }] },
    { type: "mq2", id: "mq2", prefix: "GAS", title: "MQ-2 烟雾可燃气体传感器", value: "300 ppm", bus: "ADC/GPIO", nominalVoltage: 5, pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["AO", "right", "analog"], ["DO", "right", "signal"]], controls: [{ key: "ppm", label: "气体浓度", min: 0, max: 10000, step: 1, value: 300, unit: "ppm" }, { key: "thresholdPpm", label: "数字阈值", min: 0, max: 10000, step: 1, value: 1000, unit: "ppm" }] },
    { type: "joystick", id: "joystick", prefix: "JOY", title: "双轴摇杆模块", value: "X 50% · Y 50%", bus: "2×ADC", pins: [["VCC", "left", "power"], ["GND", "left", "ground"], ["VRX", "right", "analog"], ["VRY", "right", "analog2"], ["SW", "right", "signal"]], controls: [{ key: "xPercent", label: "X 轴", min: 0, max: 100, step: 0.1, value: 50, unit: "%" }, { key: "yPercent", label: "Y 轴", min: 0, max: 100, step: 0.1, value: 50, unit: "%" }, { key: "pressed", label: "按键", min: 0, max: 1, step: 1, value: 0, unit: "" }] },
    { type: "mosfet", id: "mosfet", prefix: "Q", title: "N 沟道 MOSFET", value: "N-MOS · VTH 2.0 V", bus: "GPIO/SW", pins: [["G", "left", "signal"], ["D", "right", "passive"], ["S", "right", "passive"]], controls: [{ key: "gateThresholdV", label: "栅极阈值", min: 0.5, max: 5, step: 0.1, value: 2, unit: "V" }, { key: "rdsOnMilliohm", label: "导通电阻", min: 1, max: 1000, step: 1, value: 35, unit: "mΩ" }] },
    { type: "dcDcConverter", id: "dc-dc-converter", prefix: "PSU", title: "可调 DC-DC 电源转换模块", value: "5.0 V · 2.0 A · 90%", bus: "POWER", nominalVoltage: 12, minOperatingVoltage: 3, maxOperatingVoltage: 36, pins: [["VIN", "left", "power"], ["GND", "left", "ground"], ["EN", "left", "signal"], ["VOUT", "right", "analog"]], controls: [{ key: "outputVoltageV", label: "输出电压", min: 0.8, max: 24, step: 0.1, value: 5, unit: "V" }, { key: "maxOutputCurrentA", label: "最大输出电流", min: 0.05, max: 10, step: 0.05, value: 2, unit: "A" }, { key: "efficiencyPercent", label: "转换效率", min: 50, max: 99, step: 1, value: 90, unit: "%" }, { key: "quiescentCurrentMa", label: "静态电流", min: 0, max: 100, step: 0.5, value: 5, unit: "mA" }, { key: "enabled", label: "模块使能", min: 0, max: 1, step: 1, value: 1, unit: "" }] }
  ];

  var LIBRARY_LABELS = Object.freeze({
    dht11: "DHT11 温湿度",
    hcsr04: "HC-SR04 距离",
    sg90: "SG90 舵机",
    buzzer: "PWM 蜂鸣器",
    tm1637: "TM1637 数码管",
    bmp280: "BMP280 气压",
    mpu6050: "MPU6050 六轴",
    bh1750: "BH1750 照度",
    sht30: "SHT30 温湿度",
    ds3231: "DS3231 时钟",
    pcf8574: "PCF8574 IO",
    pca9685: "PCA9685 PWM",
    ina219: "INA219 电流",
    ds18b20: "DS18B20 温度",
    max7219: "MAX7219 点阵",
    w25qxx: "W25Qxx Flash",
    ws2812: "WS2812 灯带",
    rotaryEncoder: "EC11 编码器",
    potentiometer: "电位器",
    relay: "单路继电器",
    pir: "HC-SR501 红外",
    mq2: "MQ-2 气体",
    joystick: "双轴摇杆",
    mosfet: "N-MOSFET",
    dcDcConverter: "DC-DC 电源"
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function driverName(item) {
    return "AliceSIM " + item.title;
  }

  function fileStem(item) {
    return item.id.replace(/-/g, "_").replace(/[^a-z0-9_]/gi, "").toLowerCase();
  }

  function driverEntry(item) {
    var stem = fileStem(item);
    var upstreamRepository = LIBDRIVER_UPSTREAM[item.id] || "";
    var plannedFiles = ["Drivers/AliceSIM/Inc/alicesim_" + stem + ".h", "Drivers/AliceSIM/Src/alicesim_" + stem + ".c"];
    var installable = INSTALLABLE_DRIVER_IDS.indexOf(item.id) >= 0;
    var files = installable ? plannedFiles.concat(EXTRA_DRIVER_FILES[item.id] || []) : [];
    return {
      id: item.id,
      name: driverName(item),
      description: item.title + " 的 STM32 HAL 驱动与 AliceSIM 可安装工程接口。",
      componentTypes: [item.type],
      files: files,
      plannedFiles: plannedFiles,
      bus: item.bus,
      installable: installable,
      status: installable ? "available" : "adapting",
      attribution: upstreamRepository ? "libdriver 制作 · AliceSIM 适配" : "AliceSIM 制作",
      upstream: upstreamRepository ? {
        author: "libdriver",
        repository: upstreamRepository,
        url: "https://github.com/libdriver/" + upstreamRepository,
        license: "MIT"
      } : null
    };
  }

  function pinDefinitions(item, width, height) {
    var left = item.pins.filter(function (pin) { return pin[1] === "left"; });
    var right = item.pins.filter(function (pin) { return pin[1] !== "left"; });
    function yFor(index, total) { return total <= 1 ? Math.round(height / 2) : Math.round(16 + index * (height - 32) / (total - 1)); }
    return item.pins.map(function (pin) {
      var isLeft = pin[1] === "left";
      var group = isLeft ? left : right;
      var index = group.indexOf(pin);
      return { name: pin[0], x: isLeft ? 0 : width, y: yFor(index, group.length), side: isLeft ? "left" : "right", role: pin[2] };
    });
  }

  var FLAT_COMPONENT_ASSETS = Object.freeze({
    dht11: "dht11.svg",
    hcsr04: "hcsr04.svg",
    sg90: "sg90.svg",
    buzzer: "buzzer.svg",
    tm1637: "tm1637.svg",
    potentiometer: "potentiometer.svg",
    mosfet: "mosfet.svg",
    dcDcConverter: "dc-dc-converter.svg"
  });

  function flatAssetFor(item) {
    return "./assets/components/" + (FLAT_COMPONENT_ASSETS[item.type] || "generic-module.svg");
  }

  function symbolMarkup(item, width, height) {
    return '<svg class="component-symbol component-flat-symbol catalog-module-symbol" viewBox="0 0 ' + width + " " + height + '" aria-hidden="true">' +
      '<image class="component-flat-image" href="' + flatAssetFor(item) + '" x="7" y="5" width="' + (width - 14) + '" height="' + (height - 10) + '" preserveAspectRatio="none"/></svg>';
  }

  function schematicDefinition(item) {
    var width = item.type === "tm1637" || item.type === "max7219" ? 132 : 116;
    var pinCount = Math.max(item.pins.filter(function (pin) { return pin[1] === "left"; }).length, item.pins.filter(function (pin) { return pin[1] !== "left"; }).length);
    var height = Math.max(88, 28 + pinCount * 18);
    return {
      width: width,
      height: height,
      prefix: item.prefix,
      value: item.value,
      title: item.title,
      pins: pinDefinitions(item, width, height),
      symbol: symbolMarkup(item, width, height),
      catalog: clone(item),
      controls: clone(item.controls || []),
      bus: item.bus
    };
  }

  function libraryIconMarkup(item) {
    var type = item.type;
    if (FLAT_COMPONENT_ASSETS[type]) return '<img class="catalog-library-image" src="' + flatAssetFor(item) + '" alt=""/>';
    if (type === "bmp280") return '<svg viewBox="0 0 36 30"><rect x="5" y="4" width="26" height="22" rx="2"/><path d="M10 10h7v7h-7zM21 9c4 3 4 9 0 12M7 26v3m7-3v3m7-3v3m7-3v3"/></svg>';
    if (type === "mpu6050") return '<svg viewBox="0 0 36 30"><rect x="5" y="4" width="26" height="22" rx="2"/><path d="M18 15h9m-3-3 3 3-3 3M18 15V7m-3 3 3-3 3 3M18 15l-6 6m0-5v5h5"/></svg>';
    if (type === "bh1750") return '<svg viewBox="0 0 36 30"><rect x="4" y="5" width="28" height="20" rx="2"/><circle cx="18" cy="15" r="5"/><path d="M18 7V4M18 26v-3M10 15H7m22 0h-3M12 9l-2-2m14 2 2-2m-14 14-2 2m14-2 2 2"/></svg>';
    if (type === "sht30") return '<svg viewBox="0 0 36 30"><rect x="5" y="4" width="26" height="22" rx="2"/><path d="M13 9v9a4 4 0 1 0 4 0V9a2 2 0 0 0-4 0Zm10 2c5 4 5 8 0 12m0-8c2 2 2 3 0 5"/></svg>';
    if (type === "ds3231") return '<svg viewBox="0 0 36 30"><rect x="4" y="4" width="28" height="22" rx="2"/><circle cx="18" cy="15" r="7"/><path d="M18 10v6l4 2M9 4V1m6 3V1m6 3V1m6 3V1"/></svg>';
    if (type === "pcf8574") return '<svg viewBox="0 0 36 30"><rect x="9" y="4" width="18" height="22" rx="1"/><path d="M9 8H3m6 5H3m6 5H3m6 5H3m24-15h6m-6 5h6m-6 5h6m-6 5h6M14 11h8v8h-8z"/></svg>';
    if (type === "pca9685") return '<svg viewBox="0 0 36 30"><rect x="5" y="4" width="26" height="22" rx="2"/><path d="M8 18h4v-7h5v7h5v-7h6M9 26v3m6-3v3m6-3v3m6-3v3"/></svg>';
    if (type === "ina219") return '<svg viewBox="0 0 36 30"><rect x="4" y="4" width="28" height="22" rx="2"/><circle cx="18" cy="15" r="7"/><path d="M13 18l3-7 3 7 3-7M7 26v3m7-3v3m7-3v3m7-3v3"/></svg>';
    if (type === "ds18b20") return '<svg viewBox="0 0 36 30"><path d="M15 4v13a6 6 0 1 0 6 0V4a3 3 0 0 0-6 0Z"/><path d="M18 8v13m7-13h5m-5 5h3"/></svg>';
    if (type === "max7219") return '<svg viewBox="0 0 36 30"><rect x="4" y="2" width="28" height="26" rx="2"/><g fill="currentColor" stroke="none"><circle cx="10" cy="8" r="1.5"/><circle cx="18" cy="8" r="1.5"/><circle cx="26" cy="8" r="1.5"/><circle cx="10" cy="15" r="1.5"/><circle cx="18" cy="15" r="1.5"/><circle cx="26" cy="15" r="1.5"/><circle cx="10" cy="22" r="1.5"/><circle cx="18" cy="22" r="1.5"/><circle cx="26" cy="22" r="1.5"/></g></svg>';
    if (type === "w25qxx") return '<svg viewBox="0 0 36 30"><rect x="8" y="5" width="20" height="20" rx="1"/><path d="M8 9H3m5 5H3m5 5H3m5 5H3m25-15h5m-5 5h5m-5 5h5m-5 5h5M13 12h10v6H13z"/></svg>';
    if (type === "ws2812") return '<svg viewBox="0 0 36 30"><rect x="3" y="7" width="30" height="16" rx="3"/><circle cx="10" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><circle cx="26" cy="15" r="4"/><path d="M1 15h3m28 0h3"/></svg>';
    if (type === "rotaryEncoder") return '<svg viewBox="0 0 36 30"><circle cx="18" cy="15" r="11"/><circle cx="18" cy="15" r="5"/><path d="M18 4v7M9 24l4-5m14 5-4-5M18 26v3"/></svg>';
    if (type === "potentiometer") return '<svg viewBox="0 0 36 30"><circle cx="18" cy="15" r="9"/><path d="M18 15l6-6M3 15h6m18 0h6M18 24v5"/></svg>';
    if (type === "relay") return '<svg viewBox="0 0 36 30"><rect x="3" y="5" width="30" height="20" rx="2"/><path d="M7 10c5-4 5 12 10 8s5-12 10-8M24 20l6-7m-6 7h-4"/></svg>';
    if (type === "pir") return '<svg viewBox="0 0 36 30"><rect x="6" y="5" width="24" height="20" rx="2"/><path d="M11 20a7 7 0 0 1 14 0M14 20a4 4 0 0 1 8 0M18 20v5"/></svg>';
    if (type === "mq2") return '<svg viewBox="0 0 36 30"><path d="M11 5h14l3 7-3 13H11L8 12l3-7Z"/><path d="M12 10h12M11 14h14M11 18h14M12 22h12M14 5V2m8 3V2"/></svg>';
    if (type === "joystick") return '<svg viewBox="0 0 36 30"><rect x="4" y="10" width="28" height="16" rx="3"/><circle cx="18" cy="11" r="5"/><path d="M18 6V2M9 22h5m8 0h5"/></svg>';
    if (type === "mosfet") return '<svg viewBox="0 0 36 30"><path d="M4 15h9m0-8v16m5-13v10m0-8h7V4m-7 14h7v8m0-14 5-3m-5 9 5 3"/><path d="m21 15 4-3v6z"/></svg>';
    return '<svg viewBox="0 0 36 30"><rect x="5" y="5" width="26" height="20" rx="2"/><path d="M9 10h18M9 15h12M9 20h16"/></svg>';
  }

  function catalogEntry(item) {
    var entry = clone(item);
    var driver = driverEntry(item);
    entry.driver = {
      installable: driver.installable,
      status: driver.status,
      attribution: driver.attribution,
      upstream: driver.upstream
    };
    return entry;
  }
  function list() { return ITEMS.map(catalogEntry); }
  function find(typeOrId) {
    var key = String(typeOrId || "");
    var found = ITEMS.find(function (item) { return item.type === key || item.id === key; });
    return found ? catalogEntry(found) : null;
  }
  function schematicDefinitions() {
    var output = {};
    ITEMS.forEach(function (item) { output[item.type] = schematicDefinition(item); });
    return output;
  }
  function drivers() { return ITEMS.map(driverEntry); }

  function audit() {
    var errors = [];
    var warnings = [];
    var types = new Set();
    var ids = new Set();
    ITEMS.forEach(function (item, itemIndex) {
      var label = "item[" + itemIndex + "]";
      if (!item || typeof item !== "object") { errors.push(label + " is not an object"); return; }
      ["type", "id", "prefix", "title", "bus"].forEach(function (key) {
        if (!String(item[key] || "").trim()) errors.push(label + "." + key + " is empty");
      });
      if (types.has(item.type)) errors.push("duplicate component type: " + item.type);
      if (ids.has(item.id)) errors.push("duplicate driver id: " + item.id);
      types.add(item.type);
      ids.add(item.id);
      var pinNames = new Set();
      (item.pins || []).forEach(function (pin, pinIndex) {
        if (!Array.isArray(pin) || pin.length < 3) { errors.push(label + ".pins[" + pinIndex + "] is invalid"); return; }
        if (!String(pin[0] || "").trim()) errors.push(label + ".pins[" + pinIndex + "] has no name");
        if (pinNames.has(pin[0])) errors.push(item.type + " has duplicate pin " + pin[0]);
        pinNames.add(pin[0]);
        if (pin[1] !== "left" && pin[1] !== "right") errors.push(item.type + "." + pin[0] + " has invalid side " + pin[1]);
      });
      if (!pinNames.size) errors.push(item.type + " has no pins");
      var controlKeys = new Set();
      (item.controls || []).forEach(function (control, controlIndex) {
        var controlLabel = item.type + ".controls[" + controlIndex + "]";
        if (!control || !String(control.key || "").trim()) { errors.push(controlLabel + " has no key"); return; }
        if (controlKeys.has(control.key)) errors.push(item.type + " has duplicate control " + control.key);
        controlKeys.add(control.key);
        var minimum = Number(control.min);
        var maximum = Number(control.max);
        var step = Number(control.step);
        var value = Number(control.value);
        if (![minimum, maximum, step, value].every(Number.isFinite)) errors.push(controlLabel + " has non-finite limits");
        else {
          if (minimum >= maximum) errors.push(controlLabel + " min must be lower than max");
          if (step <= 0) errors.push(controlLabel + " step must be positive");
          if (value < minimum || value > maximum) errors.push(controlLabel + " default value is out of range");
        }
      });
      var driver = driverEntry(item);
      if (!driver.installable) warnings.push(item.id + " is not installable");
      if (driver.installable && driver.files.length < 2) errors.push(item.id + " has no complete header/source pair");
      if (driver.componentTypes[0] !== item.type) errors.push(item.id + " component type registration mismatch");
    });
    INSTALLABLE_DRIVER_IDS.forEach(function (id) { if (!ids.has(id)) errors.push("installable driver has no catalog item: " + id); });
    return { valid: errors.length === 0, count: ITEMS.length + 2, catalogCount: ITEMS.length, errors: errors, warnings: warnings };
  }

  function mountLibrary(documentObject) {
    var documentRef = documentObject && typeof documentObject.querySelector === "function" ? documentObject : null;
    var container = documentRef && documentRef.querySelector(".library-items");
    if (!container) return 0;
    var added = 0;
    ITEMS.forEach(function (item) {
      if (container.querySelector('[data-component-type="' + item.type + '"]')) return;
      var button = documentRef.createElement("button");
      button.type = "button";
      button.dataset.componentType = item.type;
      var driver = driverEntry(item);
      button.title = "放置 " + item.title + " · 驱动：" + driver.attribution + (driver.installable ? "" : "（适配中）");
      button.setAttribute("aria-label", item.title);
      var symbol = documentRef.createElement("span");
      symbol.className = "library-symbol catalog-library-symbol";
      symbol.setAttribute("aria-hidden", "true");
      symbol.innerHTML = libraryIconMarkup(item);
      var label = documentRef.createElement("b");
      label.textContent = LIBRARY_LABELS[item.type] || item.title;
      button.appendChild(symbol);
      button.appendChild(label);
      container.appendChild(button);
      added += 1;
    });
    return added;
  }

  return Object.freeze({
    schemaVersion: 1,
    count: ITEMS.length + 2,
    list: list,
    find: find,
    drivers: drivers,
    audit: audit,
    schematicDefinitions: schematicDefinitions,
    mountLibrary: mountLibrary
  });
}));
