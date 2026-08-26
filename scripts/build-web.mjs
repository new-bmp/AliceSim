import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist", "web");
const sourceFiles = [
  "index.html",
  "desktop-loader.html",
  "manifest.webmanifest",
  "service-worker.js",
  "styles.css",
  "platform-runtime.js",
  "clock-tree.js",
  "envelope-automation.js",
  "app.js",
  "datasheet-import.js",
  "oled-device.js",
  "spi-display-device.js",
  "light-sensor-device.js",
  "libdriver-registry.js",
  "peripheral-catalog.js",
  "peripheral-devices.js",
  "simulation-accel.js",
  "schematic.js",
  "alice-drivers.js",
  "ui-actions.js",
  "panel-resize.js",
  "ioc-viewer.js",
  "project-folder.js",
  "firmware-runtime.js",
  "firmware-worker.js",
  "hal-simulator.js",
  "serial-device-bridge.js"
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const relative of sourceFiles) {
  const source = path.join(root, relative);
  const destination = path.join(output, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

for (const directory of ["assets", "Drivers"]) {
  await cp(path.join(root, directory), path.join(output, directory), { recursive: true });
}

const manifest = JSON.parse(await readFile(path.join(output, "manifest.webmanifest"), "utf8"));
const buildInfo = {
  name: manifest.short_name,
  version: JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version,
  generatedAt: new Date().toISOString(),
  shellFiles: sourceFiles.length
};
await writeFile(path.join(output, "build-info.json"), JSON.stringify(buildInfo, null, 2) + "\n", "utf8");

console.log(`AliceSIM web bundle ready: ${output}`);
