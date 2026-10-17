"""本例程的模型/Clang 检查入口；在仓库根目录执行 README 中的命令。"""
import json
from pathlib import Path
import sys

EXAMPLE = Path(__file__).resolve().parent
import os
ROOT = next((candidate for candidate in [Path(os.environ.get("ALICESIM_ROOT", ".")).resolve(), *Path(__file__).resolve().parents] if (candidate / "firmware-runtime.js").is_file() and (candidate / "hal_model.py").is_file() and (candidate / "index.html").is_file()), None)
if ROOT is None:
    raise SystemExit("Verification needs AliceSIM platform source; set ALICESIM_ROOT or place the example under tutorials/examples.")
sys.path.insert(0, str(ROOT))
from hal_model import build_hal_model

paths = sorted(EXAMPLE.glob("*.ioc")) + sorted((EXAMPLE / "Core").rglob("*.c")) + sorted((EXAMPLE / "Core").rglob("*.h"))
files = [(path.relative_to(EXAMPLE), path.read_text(encoding="utf-8", errors="replace")) for path in paths]
model = build_hal_model(files)
errors = [item for item in model["diagnostics"] if item["severity"] == "error"]
if errors:
    raise SystemExit(json.dumps(errors, ensure_ascii=False))
if "--model" in sys.argv:
    print(json.dumps(model, ensure_ascii=False))
elif "--clang" in sys.argv:
    import server
    if not server.CLANG_AVAILABLE:
        raise SystemExit("本地 Clang 不可用；请先启动 AliceSIM 完成依赖准备。")
    source_paths = sorted(EXAMPLE.rglob("*.c"))
    all_paths = sorted(EXAMPLE.rglob("*.c")) + sorted(EXAMPLE.rglob("*.h"))
    checked = server.clang_check_files(
        [(path.relative_to(EXAMPLE), path.read_text(encoding="utf-8", errors="replace")) for path in all_paths],
        [path.relative_to(EXAMPLE) for path in source_paths],
        [Path("Core/Inc"), Path("Drivers/STM32F1xx_HAL_Driver/Inc"), Path("Drivers/CMSIS/Include"), Path("Drivers/CMSIS/Device/ST/STM32F1xx/Include")],
        ["USE_HAL_DRIVER", "STM32F103xB"],
    )
    errors = [item for item in checked["diagnostics"] if item["severity"] == "error"]
    if errors:
        raise SystemExit(json.dumps(errors, ensure_ascii=False))
    print(json.dumps({"example": EXAMPLE.name, "model_errors": 0, "clang_errors": 0, "checked_sources": len(source_paths), "warnings": [item for item in checked["diagnostics"] if item["severity"] == "warning"]}, ensure_ascii=False))
else:
    print(json.dumps({"example": EXAMPLE.name, "model_errors": 0, "pins": list(model["pins"]), "timers": model["timers"]}, ensure_ascii=False))
