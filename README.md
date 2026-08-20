# AliceSIM

AliceSIM 是面向 STM32 的浏览器仿真工作台原型，当前目标器件为 `STM32F103C8T6`。

## 已实现

- 导入本地 STM32 工程文件夹，保留 `Core`、`Drivers`、CMSIS、源码、头文件和相对目录结构
- 代码独立保存：通过可写目录打开工程时 `Ctrl+S` 原位写回当前源码，普通上传模式则下载当前文件
- 电路独立保存/加载：`.alice-sch.json` 保存元件、数值、位置、旋转、导线拐点及画布视图
- 单独导入并解析 STM32CubeMX `.ioc` 文件
- IOC 只读报告：完整 LQFP48 引脚、时钟、外设、MCU/项目字段及逐行原始配置
- HAL 风格 C 代码编辑与基础结构检查
- VS Code Light+ 风格 C 语法高亮、错误行与问题列表
- 项目内置 Clang 18 多文件前端诊断，自动收集工程头文件和 HAL/CMSIS include 目录
- 浏览器内构建、运行、暂停和复位流程；构建结果来自 Clang 诊断与 HAL 语义模型，不再伪造 ELF、Flash/RAM 占用
- Proteus 风格二维原理图编辑器：元件放置、拖动、选择、删除和端点连线
- 原理图窗格支持拖拽缩放，以及紧凑、标准、宽屏和专注四种布局；标准宽度会按窗口在约 420–600px 间自适应，内部布线画布为 1200×720
- 主界面会按窗口宽高自动调整项目栏、代码区和原理图占比；短屏改用单行横向元件库，并为菜单、状态栏、仿真控制与属性窗口设置可读字号和触控尺寸
- 元件参考标号、型号、实时数值和引脚名分层排版，低缩放时自动补偿文字尺寸，并对电源、MCU 与模块内部标签做避让
- EDA 风格网络端子支持命名、旋转、保存与导入；同名端子按规范化网络名自动并网，可替代跨画布长导线
- 元件库包含 STM32F103C8T6、基础无源器件、OLED、环境/运动/测量/存储器件、电位器和 N 沟道 MOSFET
- 26 个 AliceSIM STM32 HAL 外设驱动均有独立 `.h/.c`、清单登记和一键加入工程入口，不再保留只有界面占位而没有安装文件的器件
- 自有驱动高层 API 可直接进入语义仿真：OLED 绘图/刷新会下发到 I²C 模型，光敏读取会走 ADC/数字 GPIO 网络
- IOC、`main.h` GPIO 宏与 HAL 调用会共同生成物理引脚模型；源码与 IOC 冲突时明确报告，并以实际源码行为为准
- 支持的 HAL 行为包括 GPIO 写入/翻转、`HAL_Delay`、UART 阻塞收发、变量赋值，以及 C 基本控制流：`if/else`、`while`、`for`、`switch/case/default`、`return`、`break`、`continue`
- C++ 工程（`.cc` / `.cpp` / `.cxx`）使用 STM32 GNU Arm 工具链的 `gnu++17` 语法检查，可直接包含 GCC 的 `bits/stdc++.h` 及其完整 libstdc++ 头文件集合；标准库代码通过编译检查，但不会自动变成 HAL 仿真行为
- 原理图使用真实端点网络求解高电平、低电平、悬空与驱动冲突；断线后不会再因为导线名称相同而误触发元件
- 代码输出脚会自动生成对应的 GPIO → 电阻 → LED → GND 支路，并按源码别名显示 RED/GREEN/BLUE 等通道
- MCU 模块仅显示工程实际使用的 GPIO/通信 IO 与 VDD/VSS，默认隐藏 BOOT、NRST、晶振和 SWD/JTAG 调试脚
- 可选仿真时间刻（1 μs / 10 μs / 100 μs / 1 ms / 10 ms）、实际 GPIO 波形和 UART 固件收发事件
- 仿真时间流支持“无限运行”和“包络测试”；FL Studio 风格包络工作台可为多个传感器/旋钮建立关键帧轨道，按统一毫秒时间戳实时写入原理图输入
- 包络测试支持时长、循环、曲线生成、关键帧增删拖动和数值精调；固件模型不可用时会自动进入传感器独立测试，仍保留同一时间轴与真实器件数值更新
- 72 MHz 时钟树配置视图
- 数据手册转器件草稿 API：受限 PDF/结构化文本解析器可提取型号、封装、引脚、电气限制、总线和寄存器；结果必须人工确认并通过校验，接口不会直接安装器件

## 启动

Windows 下直接双击项目根目录的 `AliceSIM.cmd`。启动器会：

- 检查 64 位 Python 3.10+ 与项目内置 Clang 18 运行库
- 复用已经运行的同一 AliceSIM 实例
- 从 `4173` 开始自动选择可用的本机端口
- 等待 `/api/health` 确认服务就绪后再打开浏览器
- 保持后端窗口可见，按 `Ctrl+C` 或关闭窗口即可停止服务

也可以在 PowerShell 中运行：

```powershell
.\start.ps1
```

常用选项：

```powershell
.\start.ps1 -Port 4300        # 指定首选端口
.\start.ps1 -NoBrowser        # 不自动打开浏览器
.\start.ps1 -SkipDependencies # 跳过 Clang 依赖准备
```

首次启动时脚本会自动在项目的 `.vendor` 目录准备 Clang 18、PDF 数据手册解析器，以及可选的 PySpice 1.5 / NGSpice 34 直流校验器，不会修改系统 LLVM、Python 包或 SPICE 环境。
如果依赖下载失败，后端仍会启动，编辑器会明确降级到浏览器端基础检查和内置实时直流求解。

可以使用 [`examples/BluePill_Blinky.ioc`](examples/BluePill_Blinky.ioc) 测试 IOC 导入。
[`examples/STM32F103_HAL_Init`](examples/STM32F103_HAL_Init) 是由真实 STM32CubeMX 工程整理出的完整 HAL 初始化示例，包含 72 MHz 时钟、ADC2、I²C1、TIM1 PWM 以及 USART2/USART3，可直接以工程文件夹方式导入。
[`examples/CppStdlibBlink`](examples/CppStdlibBlink) 是一套可运行的 C++ LED 示例：`main.cpp` 包含 `<stdc++.h>`，同时演示 `for`、`switch`、`break`、`continue`、`return` 与 `malloc/free` 的 C++ 语法检查；配套电路文件已连接 PC13 → 330 Ohm → LED → GND。打开工程后通过“打开电路”导入 [`CppStdlibBlink.alice-sch.json`](examples/CppStdlibBlink/CppStdlibBlink.alice-sch.json)，即可与代码联动运行。
仓库还包含 [`tests/fixtures/uart_rgb`](tests/fixtures/uart_rgb) 工程夹具，用于验证 USART2 与 PA6/PA7/PB0 三路 RGB 控制的一致性。

面向“种子杯”嵌入式赛道的题面、验收场景和评分细则见 [`docs/seed-cup-embedded-dual-adc-task.md`](docs/seed-cup-embedded-dual-adc-task.md)，对应的 Word 发布稿为 [`docs/seed-cup-embedded-dual-adc-task.docx`](docs/seed-cup-embedded-dual-adc-task.docx)。

数据手册草稿接口及安全边界见 [`docs/datasheet-import-api.md`](docs/datasheet-import-api.md)。

## 保存与外设驱动

- `Ctrl+S`：保存当前代码。可写工程会写回原文件；否则下载当前活动文件。
- `Ctrl+Alt+S`：保存电路为独立的 `.alice-sch.json`。
- `Ctrl+Alt+O`：打开已保存的电路；IOC 控制的 MCU 型号和当前有效 IO 不会被旧电路覆盖。
- “项目 → 添加 AliceSIM 驱动”：可选择全部 26 个已登记器件驱动，复制到工程的 `Drivers/AliceSIM` 目录。默认保留已有同名源码，可显式选择更新。

驱动源码与使用示例见 [`Drivers/AliceSIM/README.md`](Drivers/AliceSIM/README.md)。

## 当前边界

当前版本属于可验证的 **HAL 语义级数字仿真**：Clang 对工程 C 文件执行真实的 GNU11 / ARM Cortex-M3 词法、语法及类型诊断，AliceSIM 再把已支持的 HAL 与 AliceSIM 外设驱动调用编译为确定性操作，并将 GPIO、I²C 和 ADC 行为送入原理图网络与设备模型。通过可写目录选择器打开工程时，当前源码可以原位写回；不支持该接口的浏览器仍使用工作区副本和下载保存。

它目前不是完整的 ARM ELF/Cortex-M3 指令级仿真器。电压与电流探针会先由浏览器内置求解器实时刷新，再由 PySpice / NGSpice 对受支持的电源、电阻和探针网络执行直流工作点复核；电容、电感、二极管、晶体管和开关电源的完整瞬态 SPICE 模型仍属于下一阶段。UART 已按工程实例、波特率、收发长度和阻塞语义执行，但串口监视器目前仍直接向固件 UART 队列送入字节，尚未按波特率在 TX/RX 导线上逐位采样。
