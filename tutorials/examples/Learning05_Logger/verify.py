"""Build the exact teaching project, optionally check every C source with Clang."""
import json
from pathlib import Path
import sys

PROJECT = Path(__file__).resolve().parent
import os
ROOT = next((candidate for candidate in [Path(os.environ.get("ALICESIM_ROOT", ".")).resolve(), *Path(__file__).resolve().parents] if (candidate / "firmware-runtime.js").is_file() and (candidate / "hal_model.py").is_file() and (candidate / "index.html").is_file()), None)
if ROOT is None:
    raise SystemExit("Verification needs AliceSIM platform source; set ALICESIM_ROOT or place the example under tutorials/examples.")
sys.path.insert(0, str(ROOT))
from hal_model import build_hal_model

paths = sorted(PROJECT.rglob("*.ioc")) + sorted(PROJECT.rglob("*.c")) + sorted(PROJECT.rglob("*.h"))
model = build_hal_model([(p.relative_to(PROJECT), p.read_text(encoding="utf-8", errors="replace")) for p in paths])
errors = [d for d in model["diagnostics"] if d["severity"] == "error"]
assert not errors, json.dumps(errors, ensure_ascii=False, indent=2)
if "--model" in sys.argv:
    print(json.dumps(model, ensure_ascii=False))
elif "--clang" in sys.argv:
    import server
    assert server.CLANG_AVAILABLE, "Local Clang not available"
    checked = server.clang_check_files(
        [(p.relative_to(PROJECT), p.read_text(encoding="utf-8", errors="replace")) for p in paths if p.suffix in (".c", ".h")],
        [p.relative_to(PROJECT) for p in paths if p.suffix == ".c"],
        [Path("Core/Inc"), Path("Drivers/AliceSIM/Inc"), Path("Drivers/STM32F1xx_HAL_Driver/Inc"), Path("Drivers/CMSIS/Include"), Path("Drivers/CMSIS/Device/ST/STM32F1xx/Include")],
        ["USE_HAL_DRIVER", "STM32F103xB"])
    assert not [d for d in checked["diagnostics"] if d["severity"] == "error"], json.dumps(checked, ensure_ascii=False, indent=2)
    print(json.dumps({"clang": "passed", "sources": len([p for p in paths if p.suffix == '.c']), "diagnostics": checked["diagnostics"]}, ensure_ascii=False))
else:
    print(json.dumps({"example": PROJECT.name, "errors": 0, "pins": model["pins"], "adcs": model["adcs"], "timers": model["timers"]}, ensure_ascii=False))
