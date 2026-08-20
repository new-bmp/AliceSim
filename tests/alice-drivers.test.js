const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AlicePeripheralDrivers = require("../alice-drivers.js");
const manifest = require("../Drivers/AliceSIM/manifest.json");

test("frontend registrations, manifest entries and installable files stay in sync", () => {
  const registered = AlicePeripheralDrivers.list().filter((driver) => driver.installable);
  assert.deepEqual(manifest.drivers.map((driver) => driver.id), registered.map((driver) => driver.id));
  registered.forEach((driver) => {
    const manifestDriver = manifest.drivers.find((entry) => entry.id === driver.id);
    assert.deepEqual(manifestDriver.componentTypes, driver.componentTypes);
    assert.deepEqual([...manifestDriver.files].sort(), [...driver.files].sort());
    driver.files.forEach((file) => assert.equal(fs.existsSync(path.join(__dirname, "..", file)), true, file));
  });
});

test("peripheral registry exposes one independently installable driver per active component", () => {
  const drivers = AlicePeripheralDrivers.list();
  assert.equal(drivers.length, 27);
  assert.deepEqual(drivers.slice(0, 7).map((driver) => driver.id), [
    "ssd1306", "light-sensor", "dht11", "hcsr04", "sg90", "buzzer", "tm1637"
  ]);
  assert.deepEqual(drivers[0].componentTypes, ["oled"]);
  assert.deepEqual(drivers[1].componentTypes, ["lightSensor"]);
  drivers.forEach((driver) => {
    assert.equal(typeof driver.name, "string");
    assert.equal(typeof driver.description, "string");
    assert.equal(typeof driver.attribution, "string");
    assert.equal(driver.installable, true);
    assert.equal(driver.status, "available");
    assert.ok(driver.files.some((path) => path.endsWith(".h")));
    assert.ok(driver.files.some((path) => path.endsWith(".c")));
  });
});

test("libdriver-based entries preserve upstream attribution and repository metadata", () => {
  const drivers = AlicePeripheralDrivers.list();
  const expected = {
    ssd1306: "ssd1306",
    dht11: "dht11",
    hcsr04: "hcsr04",
    tm1637: "tm1637",
    bmp280: "bmp280",
    mpu6050: "mpu6050",
    bh1750: "bh1750fvi",
    sht30: "sht30",
    w25qxx: "w25qxx",
    ws2812: "ws2812b"
  };
  Object.entries(expected).forEach(([id, repository]) => {
    const driver = drivers.find((entry) => entry.id === id);
    assert.equal(driver.attribution, "libdriver 制作 · AliceSIM 适配");
    assert.equal(driver.upstream.repository, repository);
    assert.equal(driver.upstream.url, `https://github.com/libdriver/${repository}`);
    assert.equal(driver.upstream.license, "MIT");
  });
  assert.equal(drivers.find((entry) => entry.id === "sg90").attribution, "AliceSIM 制作");
});

test("getFiles fetches only requested driver sources and returns project-relative paths", async () => {
  const requested = [];
  const files = await AlicePeripheralDrivers.getFiles("ssd1306", {
    fetch: async (url) => {
      requested.push(String(url));
      return { ok: true, text: async () => `source:${url}` };
    }
  });

  assert.deepEqual(Object.keys(files).sort(), [
    "Drivers/AliceSIM/Inc/alicesim_ssd1306.h",
    "Drivers/AliceSIM/Src/alicesim_ssd1306.c"
  ]);
  assert.equal(requested.length, 2);
  assert.ok(requested.every((url) => url.includes("Drivers/AliceSIM/")));
});

test("getFiles for all peripherals includes the umbrella header", async () => {
  const files = await AlicePeripheralDrivers.getFiles("all", {
    fetch: async (url) => ({ ok: true, text: async () => String(url) })
  });
  assert.ok(Object.hasOwn(files, "Drivers/AliceSIM/Inc/alicesim_peripherals.h"));
  assert.ok(Object.hasOwn(files, "Drivers/AliceSIM/Inc/alicesim_timing.h"));
  assert.equal(Object.keys(files).length, 56);
});

test("previously planned drivers now resolve to installable source files", async () => {
  const bmp280 = AlicePeripheralDrivers.list().find((driver) => driver.id === "bmp280");
  assert.equal(bmp280.installable, true);
  const files = await AlicePeripheralDrivers.getFiles("bmp280", {
    fetch: async (url) => ({ ok: true, text: async () => `source:${url}` })
  });
  assert.deepEqual(Object.keys(files).sort(), [
    "Drivers/AliceSIM/Inc/alicesim_bmp280.h",
    "Drivers/AliceSIM/Src/alicesim_bmp280.c"
  ]);
});

test("potentiometer and mosfet have complete installable registrations", () => {
  const drivers = AlicePeripheralDrivers.list();
  const potentiometer = drivers.find((driver) => driver.id === "potentiometer");
  const mosfet = drivers.find((driver) => driver.id === "mosfet");
  assert.deepEqual(potentiometer.componentTypes, ["potentiometer"]);
  assert.deepEqual(mosfet.componentTypes, ["mosfet"]);
  assert.ok(potentiometer.files.every((path) => /alicesim_potentiometer\.[hc]$/.test(path)));
  assert.ok(mosfet.files.every((path) => /alicesim_mosfet\.[hc]$/.test(path)));
});

test("DC-DC converter has a complete installable power driver", () => {
  const driver = AlicePeripheralDrivers.list().find((entry) => entry.id === "dc-dc-converter");
  assert.deepEqual(driver.componentTypes, ["dcDcConverter"]);
  assert.ok(driver.files.some((path) => path.endsWith("alicesim_dc_dc_converter.h")));
  assert.ok(driver.files.some((path) => path.endsWith("alicesim_dc_dc_converter.c")));
});

test("install merges sources without replacing an existing user driver by default", async () => {
  let loaded = null;
  let reopened = "";
  const workspace = {
    getState() {
      return {
        rootName: "Demo",
        activePath: "Core/Src/main.c",
        files: new Map([
          ["Core/Src/main.c", { content: "int main(void) { return 0; }" }],
          ["Drivers/AliceSIM/Inc/alicesim_ssd1306.h", { content: "user copy" }]
        ])
      };
    },
    async loadFiles(files, rootName) {
      loaded = { files, rootName };
    },
    openFile(path) {
      reopened = path;
    }
  };

  const result = await AlicePeripheralDrivers.install("ssd1306", {
    workspace,
    fetch: async (url) => ({ ok: true, text: async () => `downloaded:${url}` })
  });

  assert.equal(result.mode, "workspace-reload");
  assert.deepEqual(result.skipped, ["Drivers/AliceSIM/Inc/alicesim_ssd1306.h"]);
  assert.equal(loaded.rootName, "Demo");
  assert.equal(loaded.files["Drivers/AliceSIM/Inc/alicesim_ssd1306.h"], "user copy");
  assert.match(loaded.files["Drivers/AliceSIM/Src/alicesim_ssd1306.c"], /^downloaded:/);
  assert.equal(reopened, "Core/Src/main.c");
});

test("install uses the workspace incremental file API when it is available", async () => {
  let received = null;
  const workspace = {
    addFiles(files, options) {
      received = { files, options };
      return { ok: true, added: Object.keys(files), updated: [], skipped: [] };
    }
  };
  const result = await AlicePeripheralDrivers.install("light-sensor", {
    workspace,
    fetch: async (url) => ({ ok: true, text: async () => `downloaded:${url}` })
  });
  assert.equal(result.mode, "incremental");
  assert.equal(result.installed.length, 2);
  assert.equal(received.options.overwrite, false);
  assert.equal(received.options.markDirty, true);
  assert.ok(Object.hasOwn(received.files, "Drivers/AliceSIM/Inc/alicesim_light_sensor.h"));
});

test("unknown driver ids are rejected before fetching", async () => {
  await assert.rejects(
    AlicePeripheralDrivers.getFiles("not-a-driver", { fetch: async () => { throw new Error("should not fetch"); } }),
    /未知的 AliceSIM 外设驱动/
  );
});
