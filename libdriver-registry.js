(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AliceLibDriverRegistry = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CATEGORIES = [
    {
      id: "environment",
      label: "环境、温湿度与气体",
      repositories: [
        "ags02ma", "ags10", "ags10et", "aht10", "aht20", "aht21", "aht25", "aht30", "aht40",
        "am2320", "bme280", "bme680", "bme688", "bme690", "bmp180", "bmp280", "bmp384", "bmp388",
        "bmp390", "ccs811", "dht11", "dht20", "ens160", "gp2y1051au0f", "hdc1080", "hdc2080", "hdc302x",
        "htu21d", "htu31d", "jed1xx", "lm75b", "pms3003", "pmsx003", "scd30", "scd4x", "sen5x",
        "sfa30", "sgp30", "sgp40", "sgp41", "sht2x", "sht30", "sht31", "sht35", "sht4x", "sht85",
        "shtc3", "si7021", "sps30", "sts21", "sts3x", "sts4x", "stts22h"
      ]
    },
    {
      id: "motion",
      label: "运动、姿态、光学与距离",
      repositories: [
        "adxl345", "adxl362", "adxl375", "amg8833", "apds9960", "as3935", "as5600", "bmm150", "hcsr04",
        "hmc5883l", "l3gd20h", "mag3110", "mma7660fc", "mpu6050", "mpu6500", "mpu9250", "opt300x",
        "pmw3901mb", "qmc5883l", "tcs34725", "tsl2561", "uvis25", "veml7700"
      ]
    },
    {
      id: "measurement",
      label: "ADC、DAC、电能与精密测量",
      repositories: [
        "ad7705", "ad9833", "adg728", "ads1110", "ads1115", "ads1118", "hlw8032", "hx711", "ina219",
        "ina226", "max30102", "max30105", "max30205", "max31850", "max31855", "max31856", "max31865",
        "max6675", "mcp3421", "mcp4725", "mcp9600", "mcp9808", "mlx90614", "ms5611", "ms5837", "ntc",
        "pcf8591", "tlc5615", "tpl0501", "x9cxx"
      ]
    },
    {
      id: "storage",
      label: "存储器、RTC 与非易失数据",
      repositories: [
        "at24cxx", "ds1302", "ds1307", "ds18b20", "ds2431", "ds3231", "fm24clxx", "mb85rcxx", "mb85rsxx",
        "pcf8563", "rx8025t", "w25qxx"
      ]
    },
    {
      id: "display",
      label: "显示、灯光、按键与人机输入",
      repositories: [
        "apa102c", "button", "ir_remote", "max7219", "multi_button", "ssd1306", "ssd1309", "ssd1315", "ssd1351",
        "ssd1681", "st7789", "st7920", "tm1621x", "tm1622", "tm1637", "tm1638", "tm1640", "ttp229",
        "ws2812b"
      ]
    },
    {
      id: "communication",
      label: "无线、网络、RFID 与 IO 扩展",
      repositories: [
        "as608", "ch9120", "ch9121", "ch9121x", "em4095", "em4100", "fm11rfxx", "lan8720", "llcc68",
        "mfrc522", "mifare_classic", "mifare_ultralight", "nrf24l01", "nrf905", "ntag21x", "pca9548a",
        "pca9685", "pcf8551a", "pcf8574", "pcf8575", "sx1262", "sx1268"
      ]
    },
    {
      id: "media",
      label: "音频、语音、摄像与专用输出",
      repositories: [
        "gt30l32s4w", "isd17xx", "ld3320", "ov2640", "syn6288", "syn6288e", "syn6658", "syn6988",
        "tea5767", "vs1053b", "wm8978", "wt588e02b"
      ]
    }
  ];

  var FEATURED = Object.freeze([
    "w25qxx", "ssd1306", "mpu6050", "st7789", "mpu9250", "nrf24l01", "ds18b20", "ws2812b", "bmp280",
    "mfrc522", "adxl345", "dht11", "sx1262", "max30102", "pmsx003", "ntc", "pcf8574", "at24cxx",
    "as5600", "ir_remote", "pca9685", "ds3231", "ina226", "bmp180", "max31865", "amg8833", "ads1115",
    "hx711", "ov2640", "sht30"
  ]);

  var STAR_COUNTS = Object.freeze({
    w25qxx: 710, ssd1306: 529, mpu6050: 421, st7789: 362, mpu9250: 323, nrf24l01: 306,
    ds18b20: 223, ws2812b: 201, bmp280: 158, mfrc522: 161, adxl345: 143, dht11: 130,
    sx1262: 112, max30102: 107, pmsx003: 103, ntc: 101, ov2640: 96, llcc68: 94,
    pcf8574: 90, max7219: 88, at24cxx: 87, as5600: 84, ir_remote: 80, nrf905: 78,
    ds1302: 74, ds1307: 73, max31855: 72, pca9685: 70, ds3231: 66, hmc5883l: 65,
    ina226: 64, max31865: 63, bmp180: 62, amg8833: 60, hx711: 58, ads1115: 56
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function displayName(repository) {
    return repository.replace(/_/g, " ").toUpperCase();
  }

  function buildEntries() {
    var seen = Object.create(null);
    var entries = [];
    CATEGORIES.forEach(function (category) {
      category.repositories.forEach(function (repository) {
        if (seen[repository]) return;
        seen[repository] = true;
        entries.push({
          id: "libdriver-" + repository.replace(/_/g, "-"),
          repository: repository,
          name: "libdriver / " + displayName(repository),
          description: category.label + " · 通用 MCU/Linux 成熟驱动上游，等待 AliceSIM STM32 HAL 与仿真适配。",
          category: category.id,
          categoryLabel: category.label,
          featured: FEATURED.indexOf(repository) >= 0,
          stars: STAR_COUNTS[repository] || 0,
          componentTypes: [],
          files: [],
          plannedFiles: [],
          installable: false,
          status: "upstream",
          sourceGroup: "libdriver-upstream",
          attribution: "libdriver 制作 · 待 AliceSIM 适配",
          upstream: {
            author: "libdriver",
            repository: repository,
            url: "https://github.com/libdriver/" + repository,
            license: "MIT"
          }
        });
      });
    });
    entries.sort(function (left, right) {
      if (left.featured !== right.featured) return left.featured ? -1 : 1;
      if (left.stars !== right.stars) return right.stars - left.stars;
      return left.repository.localeCompare(right.repository);
    });
    return entries;
  }

  var ENTRIES = buildEntries();

  function list() { return clone(ENTRIES); }
  function categories() {
    return CATEGORIES.map(function (category) {
      return { id: category.id, label: category.label, count: category.repositories.length };
    });
  }
  function find(repositoryOrId) {
    var key = String(repositoryOrId || "").toLowerCase();
    var found = ENTRIES.find(function (entry) { return entry.repository === key || entry.id === key; });
    return found ? clone(found) : null;
  }

  return Object.freeze({
    schemaVersion: 1,
    source: "https://github.com/libdriver",
    publicRepositoryCount: 181,
    usefulCount: ENTRIES.length,
    list: list,
    find: find,
    categories: categories
  });
}));
