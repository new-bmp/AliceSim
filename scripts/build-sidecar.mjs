import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binaryDirectory = path.join(root, "src-tauri", "binaries");
const stagingDirectory = path.join(root, ".tauri-sidecar");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const triples = {
  "win32:x64": "x86_64-pc-windows-msvc",
  "win32:arm64": "aarch64-pc-windows-msvc",
  "darwin:x64": "x86_64-apple-darwin",
  "darwin:arm64": "aarch64-apple-darwin",
  "linux:x64": "x86_64-unknown-linux-gnu",
  "linux:arm64": "aarch64-unknown-linux-gnu"
};
const targetTriple = process.env.TAURI_TARGET_TRIPLE || triples[`${process.platform}:${process.arch}`];

if (!targetTriple) throw new Error(`Unsupported desktop target: ${process.platform}/${process.arch}`);

const pythonCandidates = [
  process.env.ALICESIM_PYTHON,
  process.platform === "win32" ? path.join(root, ".venv", "Scripts", "python.exe") : path.join(root, ".venv", "bin", "python"),
  process.platform === "win32" ? "python" : "python3",
  "python"
].filter(Boolean);

let python = "";
for (const candidate of pythonCandidates) {
  const probe = spawnSync(candidate, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (probe.status === 0) {
    python = candidate;
    break;
  }
}
if (!python) throw new Error("Python 3.10+ was not found. Set ALICESIM_PYTHON before building the desktop app.");

const pyInstaller = spawnSync(python, ["-c", "import PyInstaller"], { stdio: "ignore" });
if (pyInstaller.status !== 0) {
  throw new Error(`PyInstaller is missing. Install it with: ${python} -m pip install pyinstaller`);
}

await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory, { recursive: true });
await mkdir(binaryDirectory, { recursive: true });

const dataSeparator = process.platform === "win32" ? ";" : ":";
const staticFiles = [
  "index.html", "manifest.webmanifest", "service-worker.js", "styles.css", "platform-runtime.js",
  "clock-tree.js", "envelope-automation.js", "app.js", "datasheet-import.js", "oled-device.js",
  "spi-display-device.js", "light-sensor-device.js", "libdriver-registry.js", "peripheral-catalog.js",
  "peripheral-devices.js", "simulation-accel.js", "schematic.js", "alice-drivers.js", "ui-actions.js",
  "panel-resize.js", "ioc-viewer.js", "project-folder.js", "firmware-runtime.js", "firmware-worker.js",
  "hal-simulator.js", "serial-device-bridge.js"
];
const args = [
  "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--console",
  "--name", "alicesim-backend",
  "--distpath", path.join(stagingDirectory, "dist"),
  "--workpath", path.join(stagingDirectory, "work"),
  "--specpath", stagingDirectory,
  "--hidden-import", "clang.cindex"
];

for (const relative of staticFiles) args.push("--add-data", `${path.join(root, relative)}${dataSeparator}.`);
for (const directory of ["assets", "Drivers"]) args.push("--add-data", `${path.join(root, directory)}${dataSeparator}${directory}`);

const bundledClang = path.join(root, ".vendor", "clang", "native", process.platform === "win32" ? "libclang.dll" : "libclang.so");
try {
  await access(bundledClang, constants.R_OK);
  args.push("--add-data", `${bundledClang}${dataSeparator}.vendor/clang/native`);
} catch (_) {}

args.push(path.join(root, "server.py"));
const result = spawnSync(python, args, { cwd: root, stdio: "inherit" });
if (result.status !== 0) throw new Error(`PyInstaller failed with exit code ${result.status}`);

const built = path.join(stagingDirectory, "dist", `alicesim-backend${executableSuffix}`);
const destination = path.join(binaryDirectory, `alicesim-backend-${targetTriple}${executableSuffix}`);
await copyFile(built, destination);
if (process.platform !== "win32") {
  const { chmod } = await import("node:fs/promises");
  await chmod(destination, 0o755);
}
console.log(`AliceSIM desktop sidecar ready: ${destination}`);
