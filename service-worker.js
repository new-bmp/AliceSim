"use strict";

const CACHE_NAME = "alicesim-shell-20260826-2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./assets/alicesim-app-icon.svg",
  "./assets/pwa/192x192.png",
  "./assets/pwa/512x512.png",
  "./platform-runtime.js",
  "./clock-tree.js",
  "./envelope-automation.js",
  "./app.js",
  "./datasheet-import.js",
  "./oled-device.js",
  "./spi-display-device.js",
  "./light-sensor-device.js",
  "./libdriver-registry.js",
  "./peripheral-catalog.js",
  "./peripheral-devices.js",
  "./simulation-accel.js",
  "./schematic.js",
  "./alice-drivers.js",
  "./ui-actions.js",
  "./panel-resize.js",
  "./ioc-viewer.js",
  "./project-folder.js",
  "./firmware-runtime.js",
  "./firmware-worker.js",
  "./hal-simulator.js",
  "./serial-device-bridge.js",
  "./Drivers/AliceSIM/manifest.json",
  "./assets/components/blue-pill.svg",
  "./assets/components/buzzer.svg",
  "./assets/components/current-probe.svg",
  "./assets/components/dc-dc-converter.svg",
  "./assets/components/dht11.svg",
  "./assets/components/generic-module.svg",
  "./assets/components/hcsr04.svg",
  "./assets/components/light-sensor.svg",
  "./assets/components/mosfet.svg",
  "./assets/components/oled-ssd1306.svg",
  "./assets/components/potentiometer.svg",
  "./assets/components/sg90.svg",
  "./assets/components/tm1637.svg",
  "./assets/components/voltage-probe.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("alicesim-shell-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("./index.html");
        throw new Error("AliceSIM asset is unavailable offline");
      })
  );
});
