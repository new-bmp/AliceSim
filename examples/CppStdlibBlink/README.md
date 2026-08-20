# C++ 标准库 + PC13 LED 例程

这是一个可在 AliceSIM 中直接打开的 `STM32F103C8T6` C++ 例程。`PC13` 通过 `R1 (330 Ohm)` 驱动 `D1`，代码与电路使用同一条 `STATUS_LED` 网络。

## 包含内容

- `Core/Src/main.cpp`：使用 `for`、`switch/case/default`、`break`、`continue` 和 `return` 产生四相 LED 波形。
- `Core/Inc/stdc++.h`：兼容头，转发至 GNU 的 `<bits/stdc++.h>`，因此可使用完整的 GNU libstdc++ 头文件集合。
- `standard_library_compile_probe()`：展示 `std::array`、`std::vector`、`std::accumulate` 与 `std::malloc/std::free` 的 C++ 语法检查。
- `CppStdlibBlink.ioc`：将 `PC13` 配置为名为 `STATUS_LED` 的 GPIO 输出。
- `CppStdlibBlink.alice-sch.json`：PC13 → 330 Ohm → LED → GND 的已连线电路。

## 在 AliceSIM 中运行

1. 使用“项目 → 打开工程文件夹”选择本目录 `examples/CppStdlibBlink`。
2. 构建工程；`main.cpp` 将由 GNU Arm `gnu++17` 检查器检查。
3. 使用“打开电路”（或 `Ctrl+Alt+O`）导入 `CppStdlibBlink.alice-sch.json`。
4. 点击运行。LED 按 80 ms、120 ms、180 ms、240 ms 四相循环：第 1、3 相点亮，第 2、4 相熄灭。

## 关于标准库与 malloc

`<stdc++.h>` 在此例中是本地兼容名，实际包含 GNU 的 `<bits/stdc++.h>`。`standard_library_compile_probe()` 用于确认标准库和 `malloc/free` 的 C++ 编译语法；它没有被行为仿真执行。当前 AliceSIM 的运行时重点仿真支持的 HAL 调用与 C 控制流，并不模拟动态堆分配的内存布局。

在真实 STM32 固件中，`malloc`/`free` 还需要工具链提供堆区和 `_sbrk` 等系统调用支撑；长期运行的嵌入式程序应评估内存碎片风险。
