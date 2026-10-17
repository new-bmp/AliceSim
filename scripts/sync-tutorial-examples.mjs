/** Synchronize self-contained tutorial projects without touching lesson/UI files.
 * Run: node scripts/sync-tutorial-examples.mjs
 * Optional: ALICESIM_PYTHON=/path/to/python node ... --verify-only
 * Source projects remain in examples/. No output/ file is a runtime dependency.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tutorials = path.join(root, "tutorials");
const exampleDefinitions = [
  ["Learning01_GPIO", "开关与两个独立状态灯"],
  ["Learning02_Servo", "模拟量控制舵机"],
  ["Learning03_Climate", "温湿度与数码管"],
  ["Learning04_DMA", "ADC 循环 DMA"],
  ["Learning05_Logger", "双通道滤波记录仪"],
  ["Learning06_Components", "超声波多元件联动"],
  ["Learning07_Blink", "从零开始闪灯"],
  ["Learning08_CData", "数组、指针与流水灯"],
  ["Learning09_TickTasks", "独立计时与开关状态机"],
  ["Learning10_ButtonEXTI", "按键消抖、长按与外部中断"],
  ["Learning11_TimerIRQ", "定时器更新中断与主循环"],
  ["Learning12_UARTCommand", "串口接收与命令解析"],
  ["Learning13_I2CBasics", "I²C 地址与 OLED 命令"],
  ["Learning14_SPIBasics", "SPI 寄存器与点阵像素"]
];
const names = exampleDefinitions.map(([name]) => name);
const titles = exampleDefinitions.map(([, title]) => title);
const ignoredParts = new Set(["__pycache__", ".git", ".pytest_cache", "node_modules", "build", "dist", "output", "verification", ".venv", ".vendor"]);
const ignoredSuffixes = new Set([".pyc", ".pyo", ".log", ".tmp", ".bak", ".png", ".jpg", ".jpeg", ".mp4", ".wav", ".mp3"]);
const sourceSuffixes = new Set([".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".inc", ".s", ".asm", ".ld", ".ioc", ".mk", ".mak", ".make", ".cmake", ".project", ".cproject", ".mxproject"]);
const licensePaths = ["Drivers/STM32F1xx_HAL_Driver/LICENSE.txt", "Drivers/CMSIS/LICENSE.txt", "Drivers/CMSIS/Device/ST/STM32F1xx/LICENSE.txt"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const posix = value => value.split(path.sep).join("/");
const text = bytes => bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
const sorted = values => [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const verifyOnly = process.argv.includes("--verify-only");
if (process.argv.some(arg => arg.startsWith("--") && !["--verify-only", "--check-baseline"].includes(arg))) throw new Error("Unknown option");

async function exists(target) { try { return (await fs.stat(target)).isFile(); } catch { return false; } }
async function list(directory, filter = () => true) {
  const result = [];
  async function visit(parent) {
    for (const entry of (await fs.readdir(parent, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed in tutorial assets: ${path.join(parent, entry.name)}`);
      if (ignoredParts.has(entry.name.toLowerCase())) continue;
      const target = path.join(parent, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && filter(target)) result.push(posix(path.relative(directory, target)));
    }
  }
  await visit(directory);
  return sorted(result);
}
function within(target, allowed) {
  const relative = path.relative(path.resolve(allowed), path.resolve(target));
  assert(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `Unsafe sync target: ${target}`);
}
async function write(relative, content) {
  const target = path.join(tutorials, relative);
  within(target, tutorials);
  assert(["examples/", "projects/", "assets/", "downloads/"].some(prefix => relative.startsWith(prefix)) || relative === "example-manifest.json");
  if (verifyOnly) assert.deepEqual(await fs.readFile(target), Buffer.from(content), `Tutorial file is stale: ${relative}`);
  else { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); }
}
async function pruneFiles(directory, expected) {
  // Only this script's declared generated example directories are mirrored. Never
  // remove tutorials itself, lesson files, pages, or hand-authored site assets.
  within(directory, path.join(tutorials, "examples"));
  let files;
  try { files = await list(directory); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const relative of files) if (!expected.has(relative)) {
    const target = path.join(directory, relative);
    within(target, directory);
    if (verifyOnly) throw new Error(`Stale file in generated example: ${target}`);
    await fs.unlink(target);
  }
}
function pythonCommand() {
  const candidates = [[process.env.ALICESIM_PYTHON, []], [process.platform === "win32" ? "python" : "python3", []], ["python", []], ["py", ["-3"]]].filter(([command]) => command);
  for (const [command, prefix] of candidates) {
    const result = spawnSync(command, [...prefix, "-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return { command, prefix };
  }
  throw new Error("Python 3.10+ is required to build/verify downloads; set ALICESIM_PYTHON to its executable.");
}
const python = pythonCommand();
function runPython(program, payload) {
  return JSON.parse(execFileSync(python.command, [...python.prefix, "-c", program], { input: JSON.stringify(payload), encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true }));
}

const environmentHelper = `"use strict";
// Generated tutorial compatibility helper. Firmware sources remain unchanged.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
function locateRoot() {
  const starts = [process.env.ALICESIM_ROOT, __dirname, process.cwd()].filter(Boolean);
  for (const start of starts) {
    let current = path.resolve(start);
    for (;;) {
      if (fs.existsSync(path.join(current, "firmware-runtime.js")) && fs.existsSync(path.join(current, "hal_model.py")) && fs.existsSync(path.join(current, "index.html"))) return current;
      const parent = path.dirname(current); if (parent === current) break; current = parent;
    }
  }
  throw new Error("Verification needs AliceSIM platform source. Place this example under tutorials/examples in the platform root, or set ALICESIM_ROOT.");
}
const root = locateRoot();
const candidates = [process.env.ALICESIM_PYTHON, path.join(root, ".venv", "Scripts", "python.exe"), path.join(root, ".venv", "bin", "python"), process.platform === "win32" ? "python" : "python3", "python"].filter(Boolean);
const python = candidates.find(candidate => cp.spawnSync(candidate, ["-c", "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)"], {windowsHide:true}).status === 0);
if (!python) throw new Error("Python 3.10+ not found. Set ALICESIM_PYTHON.");
module.exports = {root, python};
`;

function adaptAuxiliary(relative, bytes, name) {
  const lower = relative.toLowerCase();
  if (lower === "readme.md") {
    const note = "\n\n## 教程内副本与开发复验\n\n本目录由 `scripts/sync-tutorial-examples.mjs` 从原例程同步。固件、IOC、库与许可证保持原样；开发辅助脚本会向上寻找 AliceSIM 平台根目录。上文复验命令请在 AliceSIM 仓库根目录执行。\n\n独立下载 ZIP 可以直接导入同名 `.alice.json`，正常学习不依赖 Node.js 或这些复验脚本。若要离线做开发复验，请把完整工程目录放入配套平台源码的 `tutorials/examples/` 后执行；也可设置 `ALICESIM_ROOT` 指向平台源码根、`ALICESIM_PYTHON` 指向 Python 3.10+。Clang 复验还需先完成平台依赖准备。\n";
    const readme = text(bytes).replaceAll(`examples/${name}`, `tutorials/examples/${name}`)
      .replaceAll("../../tutorials/lessons/", "../../lessons/");
    return { content: Buffer.from(readme + note), reason: "tutorial verification paths and standalone download instructions" };
  }
  if (!/\.(?:cjs|js|py)$/.test(lower) || relative.includes("/")) return { content: bytes, reason: null };
  let source = text(bytes);
  if (/\.(?:cjs|js)$/.test(lower)) {
    source = source.replace(/const\s+root\s*=\s*path\.resolve\(__dirname,\s*['"]\.\.\/\.\.['"]\);/g, 'const {root} = require("./_tutorial-environment.cjs");');
    source = source.replace(/path\.join\(root,\s*["']\.venv["'],\s*["']Scripts["'],\s*["']python\.exe["']\)/g, 'require("./_tutorial-environment.cjs").python');
    source = source.replace(/path\.join\(root,\s*["']\.venv\/Scripts\/python\.exe["']\)/g, 'require("./_tutorial-environment.cjs").python');
  } else {
    const resolver = 'import os\nROOT = next((candidate for candidate in [Path(os.environ.get("ALICESIM_ROOT", ".")).resolve(), *Path(__file__).resolve().parents] if (candidate / "firmware-runtime.js").is_file() and (candidate / "hal_model.py").is_file() and (candidate / "index.html").is_file()), None)\nif ROOT is None:\n    raise SystemExit("Verification needs AliceSIM platform source; set ALICESIM_ROOT or place the example under tutorials/examples.")';
    source = source.replace(/^ROOT\s*=\s*(?:EXAMPLE\.parents\[1\]|PROJECT\.parents\[1\]|Path\(__file__\)\.resolve\(\)\.parents\[2\])\s*$/m, resolver);
  }
  return source === text(bytes) ? { content: bytes, reason: null } : { content: Buffer.from(source), reason: "portable AliceSIM root/Python discovery for tutorial migration" };
}

function envelopePreset(name) {
  if (name !== "Learning05_Logger") return { mode: "infinite", durationMs: 10000, loop: false, lanes: [] };
  const curves = [
    ["adc-a", "PA0 · 输入 A", "#2E56D4", [[0, 1.1], [800, 1.1], [1900, 2], [2800, 2.8], [4200, 2.8], [5000, 2.4], [5700, 2.4], [6700, 1.8], [8000, 1.1]]],
    ["adc-b", "PB0 · 输入 B", "#27865C", [[0, 2.2], [800, 2.2], [1900, 0.6], [2800, 0.6], [4200, 1.7], [5000, 2], [5700, 2], [6700, 1.3], [8000, 2.2]]]
  ];
  return { mode: "envelope", durationMs: 8000, loop: true, lanes: curves.map(([target, label, color, points], index) => ({ id: `lane-${index + 1}`, targetId: target + ":voltage", label, unit: "V", min: 0, max: 3.3, step: 0.001, color, points: points.map(([timeMs, value], point) => ({ id: `logger-${index}-${point}`, timeMs, value })) })) };
}
function acceptedSource(relative) {
  const lower = relative.toLowerCase(), base = path.posix.basename(lower), extension = path.posix.extname(lower);
  return sourceSuffixes.has(extension) || lower.endsWith(".alice-sch.json") || /^(license|copying|notice)(?:[._-]|$)/.test(base) || ["makefile", "gnumakefile", "cmakelists.txt"].includes(base) || [".json", ".yaml", ".yml"].includes(extension) && /compile_commands|cmakepresets|settings|project/.test(base);
}
function makeSnapshot(name, records) {
  const files = Object.fromEntries(records.filter(item => acceptedSource(item.relative)).map(item => [item.relative, text(item.original)]));
  const circuitPath = `${name}.alice-sch.json`, iocPath = `${name}.ioc`;
  for (const file of ["Core/Src/main.c", circuitPath, iocPath, ...licensePaths]) assert.equal(typeof files[file], "string", `${name}: missing ${file}`);
  const circuit = JSON.parse(files[circuitPath]);
  assert.equal(circuit.kind, "AliceSIMCircuit");
  const ids = new Set(circuit.components.map(component => component.id));
  for (const wire of circuit.wires) {
    assert(wire.route?.length >= 2, `${name}: missing wire route`);
    assert(ids.has(wire.from?.componentId) && ids.has(wire.to?.componentId), `${name}: wire has missing component`);
  }
  const includeDirs = ["Core/Inc", "Drivers/STM32F1xx_HAL_Driver/Inc", "Drivers/CMSIS/Include", "Drivers/CMSIS/Device/ST/STM32F1xx/Include"];
  if (records.some(item => item.relative.startsWith("Drivers/AliceSIM/Inc/"))) includeDirs.push("Drivers/AliceSIM/Inc");
  return { format: "AliceSIM Project", version: 3, project: { name, mcu: "STM32F103C8T6" }, currentFile: "Core/Src/main.c", files, circuitPath, circuit,
    pageState: { workspacePage: "simulation", simulationSpeed: 1, powerCalculationEnabled: true, componentLabelsVisible: true, envelope: envelopePreset(name), layout: { workbench: { active: "serial", collapsed: false, compare: false, height: 220 } } },
    workspace: { entryPath: "Core/Src/main.c", iocPath, includeDirs, defines: ["USE_HAL_DRIVER", "STM32F103xB"] }, ioc: { path: iocPath, content: files[iocPath] } };
}

const zipProgram = String.raw`
import hashlib,json,sys
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
p=json.load(sys.stdin)
out=Path(p["output"])
expected={entry["name"]:Path(entry["file"]).read_bytes() for entry in p["entries"]}
if not p["verifyOnly"]:
    out.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(out,"w",ZIP_DEFLATED,compresslevel=9) as z:
        for name,data in sorted(expected.items()):
            i=ZipInfo(name,(2026,1,1,0,0,0));i.compress_type=ZIP_DEFLATED;i.external_attr=0o100644<<16
            z.writestr(i,data)
with ZipFile(out) as z:
    assert z.testzip() is None
    assert set(z.namelist())==set(expected)
    assert len(z.namelist())==len(expected)
    for name,data in expected.items(): assert z.read(name)==data,name
b=out.read_bytes()
print(json.dumps({"files":len(expected),"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest()}))
`;

const projectResults = [];
let previousSnapshotsMatched = 0;
for (const [index, name] of names.entries()) {
  const originalDirectory = path.join(root, "examples", name);
  const relatives = await list(originalDirectory, target => !ignoredSuffixes.has(path.extname(target).toLowerCase()));
  const records = [];
  for (const relative of relatives) {
    const original = await fs.readFile(path.join(originalDirectory, relative));
    const { content, reason } = adaptAuxiliary(relative, original, name);
    await write(`examples/${name}/${relative}`, content);
    records.push({ relative, original, content, reason });
  }
  await write(`examples/${name}/_tutorial-environment.cjs`, environmentHelper);
  await pruneFiles(path.join(tutorials, "examples", name), new Set([...relatives, "_tutorial-environment.cjs"]));
  const snapshot = makeSnapshot(name, records);
  const packageRelative = `projects/${name}.alice.json`;
  const packageContent = Buffer.from(JSON.stringify(snapshot, null, 2) + "\n");
  await write(packageRelative, packageContent);
  const baseline = path.join(root, "output", "alicesim-learning", "projects", `${name}.alice.json`);
  if (process.argv.includes("--check-baseline") && await exists(baseline)) {
    assert.deepEqual(snapshot, JSON.parse(await fs.readFile(baseline, "utf8")), `${name}: regenerated project disagrees with previous verified snapshot`);
    previousSnapshotsMatched += 1;
  }
  for (const [relative, content] of Object.entries(snapshot.files)) {
    assert.equal(text(await fs.readFile(path.join(tutorials, "examples", name, relative))), content, `${name}: physical project/snapshot mismatch at ${relative}`);
  }
  const downloadRelative = `downloads/${name}.zip`;
  const zipEntries = [...records.map(item => ({ name: `${name}/${item.relative}`, file: path.join(tutorials, "examples", name, item.relative) })),
    { name: `${name}/_tutorial-environment.cjs`, file: path.join(tutorials, "examples", name, "_tutorial-environment.cjs") },
    { name: `${name}.alice.json`, file: path.join(tutorials, packageRelative) }];
  const archive = runPython(zipProgram, { output: path.join(tutorials, downloadRelative), entries: zipEntries, verifyOnly });
  const sourceFiles = records.map(item => ({ path: item.relative, bytes: item.original.length, sourceSha256: hash(item.original), copiedBytes: item.content.length, sha256: hash(item.content), modified: Boolean(item.reason), adaptation: item.reason }));
  projectResults.push({ id: name, name, number: index + 1, title: titles[index], sourceDirectory: `examples/${name}`, main: `examples/${name}/Core/Src/main.c`, entryPath: `examples/${name}/Core/Src/main.c`,
    ioc: `examples/${name}/${name}.ioc`, circuit: `examples/${name}/${name}.alice-sch.json`, project: packageRelative, file: packageRelative, download: downloadRelative, zip: downloadRelative,
    bytes: packageContent.length, sha256: hash(packageContent), downloadBytes: archive.bytes, downloadSha256: archive.sha256,
    sourceSha256: hash(JSON.stringify(sourceFiles.map(item => ({ path: item.path, sha256: item.sourceSha256 })))), sourceFileCount: records.length, snapshotFileCount: Object.keys(snapshot.files).length,
    components: snapshot.circuit.components.length, wires: snapshot.circuit.wires.length, licenses: licensePaths.map(relative => `examples/${name}/${relative}`),
    checks: { firmwareAndHeadersByteIdentical: records.filter(item => acceptedSource(item.relative)).every(item => item.original.equals(item.content)), snapshotMatchesPhysicalSources: true, archiveMatchesPhysicalFiles: true },
    verification: { pythonCommand: `python tutorials/examples/${name}/verify.py`, requiresPlatformRoot: true, environmentHelper: `examples/${name}/_tutorial-environment.cjs`, environmentHelperSha256: hash(environmentHelper) }, sourceFiles });
}

const guide = text(await fs.readFile(path.join(root, "examples", "学习例程指南.md")))
  .replace("# AliceSIM 仿真学习例程\n", "# AliceSIM 仿真学习例程\n\n按模块阅读教材、查看学习路线和配套工程入口，请先打开上级的[教程目录](../README.md)。\n")
  .replace("发布下载包中的这些文件放在 `projects/` 目录；仓库中由 `output/alicesim-learning/package-examples.py` 生成。", "完整工程包位于 `tutorials/projects/` 目录；由 `scripts/sync-tutorial-examples.mjs` 同步生成。");
await write("examples/学习例程指南.md", guide);
// PNG originals are bootstrapped once from previously captured teaching media.
// Later source distributions are self-contained: existing tutorials/assets is
// sufficient, and output/ is not consulted by the browser or required to sync.
const assetsDirectory = path.join(tutorials, "assets");
const bootstrapAssets = path.join(root, "output", "alicesim-learning", "assets");
let assetNames = [];
try { assetNames = (await fs.readdir(bootstrapAssets)).filter(name => name.endsWith(".png")); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (assetNames.length && !verifyOnly) for (const name of assetNames) await write(`assets/${name}`, await fs.readFile(path.join(bootstrapAssets, name)));
const imageNames = (await list(assetsDirectory, target => path.extname(target).toLowerCase() === ".png")).filter(name => !name.includes("/"));
assert(imageNames.length >= 54, "Teaching images are incomplete: bootstrap output/alicesim-learning/assets once or retain tutorials/assets.");
const assets = [];
for (const name of imageNames) {
  const content = await fs.readFile(path.join(assetsDirectory, name));
  const png = content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = content[0] === 255 && content[1] === 216 && content[2] === 255;
  // One historic capture (overview.png) is a JPEG despite its filename. Retain
  // original pixels/bytes; browsers decode it normally, and report its real type.
  assert(png || jpeg, `Unknown teaching image format: ${name}`);
  assets.push({ path: `assets/${name}`, mimeType: png ? "image/png" : "image/jpeg", bytes: content.length, sha256: hash(content) });
}
const manifest = { format: "AliceSIM Tutorial Examples", version: 1, source: "../examples", generator: "../scripts/sync-tutorial-examples.mjs", runtimeRequiresOutputDirectory: false,
  policy: { firmware: "byte-for-byte copies of examples; only README and verification helpers are adapted", verification: "helpers locate the platform root; generated ZIP imports do not require development tools", images: "real teaching captures, retained under tutorials/assets" },
  projects: projectResults, assets };
await write("example-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
const reread = JSON.parse(await fs.readFile(path.join(tutorials, "example-manifest.json"), "utf8"));
assert.equal(reread.projects.length, exampleDefinitions.length);
assert.equal(reread.assets.length, imageNames.length);
console.log(JSON.stringify({ mode: verifyOnly ? "verified" : "synchronized", projects: projectResults.length, sourceFiles: projectResults.reduce((sum, item) => sum + item.sourceFileCount, 0), licenses: projectResults.reduce((sum, item) => sum + item.licenses.length, 0), images: assets.length,
  adaptedHelpers: projectResults.reduce((sum, item) => sum + item.sourceFiles.filter(file => file.modified).length, 0), previousSnapshotsMatched, downloads: projectResults.map(item => ({ path: item.download, bytes: item.downloadBytes, sha256: item.downloadSha256 })), outputRequiredAtRuntime: false }, null, 2));
