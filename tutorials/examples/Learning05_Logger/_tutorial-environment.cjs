"use strict";
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
