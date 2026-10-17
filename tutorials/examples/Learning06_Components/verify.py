"""Build this saved teaching example, optionally syntax-check every C source."""
from pathlib import Path
import json
import sys
import os
ROOT = next((candidate for candidate in [Path(os.environ.get("ALICESIM_ROOT", ".")).resolve(), *Path(__file__).resolve().parents] if (candidate / "firmware-runtime.js").is_file() and (candidate / "hal_model.py").is_file() and (candidate / "index.html").is_file()), None)
if ROOT is None:
    raise SystemExit("Verification needs AliceSIM platform source; set ALICESIM_ROOT or place the example under tutorials/examples.")
PROJECT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from hal_model import build_hal_model

files = [(p.relative_to(PROJECT), p.read_text(encoding="utf-8", errors="replace"))
         for p in PROJECT.rglob("*") if p.suffix.lower() in (".ioc", ".c", ".h")]
model = build_hal_model(files)
errors = [d for d in model["diagnostics"] if d["severity"] == "error"]
assert not errors, json.dumps(errors, ensure_ascii=False, indent=2)
if "--model" in sys.argv:
    print(json.dumps(model, ensure_ascii=False))
elif "--clang" in sys.argv:
    import server
    sources = [p.relative_to(PROJECT) for p in PROJECT.rglob("*.c")]
    checked = server.clang_check_files(files, sources,
        [Path("Core/Inc"), Path("Drivers/AliceSIM/Inc"), Path("Drivers/STM32F1xx_HAL_Driver/Inc"),
         Path("Drivers/CMSIS/Include"), Path("Drivers/CMSIS/Device/ST/STM32F1xx/Include")],
        ["USE_HAL_DRIVER", "STM32F103xB"])
    errors = [d for d in checked["diagnostics"] if d["severity"] == "error"]
    assert not errors, json.dumps(errors, ensure_ascii=False, indent=2)
    print(json.dumps({"model_errors": 0, "clang_errors": 0, "sources": len(sources),
        "warnings": [d for d in checked["diagnostics"] if d["severity"] == "warning"]}, ensure_ascii=False))
else:
    print(json.dumps({"model_errors": 0, "pins": list(model["pins"]), "spis": model["spis"], "timers": model["timers"]}, ensure_ascii=False))
