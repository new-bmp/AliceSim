# 学习 09：时间差与开关状态机

绿灯不依赖开关，名义每 250 ms 翻转。开关 ON 时红灯立即点亮，随后每 700 ms 翻转；切回 OFF 时红灯立即熄灭。两个任务各保存自己的时间戳，主循环持续检查输入。

## 打开与观察

在 AliceSIM 打开整个 `Learning09_TickTasks` 文件夹，确认配套电路已加载，构建并运行。先观察只有绿灯闪烁，再双击 SW_RUN 置 ON。红灯开始以另一周期闪烁，绿灯继续按自己的周期运行。红灯亮起后立刻将开关拨回 OFF，观察它不必等满 700 ms 才熄灭。

## CubeMX 与接线

| 对象 | 设置 |
| --- | --- |
| MCU/时钟 | STM32F103C8T6；HSI 8 MHz，HSE Disable，PLL Off，AHB/APB 全不分频 |
| PB12/PB13 | GPIO_Output，推挽、No Pull、Low speed、初始 Low |
| PA1 | GPIO_Input、Pull-up，标签 RUN_SWITCH |
| SYS | Serial Wire，PA13/PA14 留给 SWD；SysTick 1 ms |

PB12 → 330 Ω → 绿 LED 阳极；PB13 → 另一个 330 Ω → 红 LED 阳极。LED 阴极接 GND，VDD 接 3.3 V，VSS 共地。PA1 经 10 kΩ 上拉到 3.3 V，同时连接开关的一端；开关另一端接 GND。闭合为低有效 ON。硬件中内部与外部上拉并存，此处保留外部电阻让接线关系可见。

## 时间和状态分别保存

`now = HAL_GetTick()` 取得毫秒 tick。`elapsed_green` 与 `elapsed_red` 是 uint32_t，把 `now - last_x` 的结果保存为无符号 32 位，再分别比较 250U 和 700U。达到周期后更新对应时间戳并翻转那颗灯。

STOPPED 和 RUNNING 表示红灯任务是否启用，与红灯此刻亮灭是两件事。STOPPED → RUNNING 时只执行一次红灯点亮和相位重置；RUNNING 状态继续计时；回到 STOPPED 时关红灯。若每轮都重置 `last_red`，红灯永远等不到 700 ms。

循环末尾仍有名义 `HAL_Delay(1U)`，用于一个短轮询间隔。周期任务不使用 250/700 ms 的阻塞等待，但这不是零阻塞循环。模型中每毫秒检查一次；实物还受 SysTick 粒度、HAL 延时保护余量和代码执行时间影响。这里没有机械按键消抖。

## tick 回绕

uint32_t 毫秒计数约 49.7 天回绕。先做无符号差再判断持续时间，可以跨过一次回绕。例如 `last=4294967200`、`now=154`，无符号 32 位差是 250 ms。必须保证检查间隔不跨越整个 2^32 ms；本例的短周期和连续轮询满足条件。不要使用 `now >= last + period` 作为通用回绕处理。

## 练习与排错

- 把绿灯翻转间隔改成 100 ms，确认红灯仍使用 700 ms。
- 暂时把循环末尾改为 `HAL_Delay(700U)`，观察输入响应与绿灯周期被拖慢，然后恢复 1U。
- 红灯一直亮时检查是否每轮都重置 last_red；响应相反时检查 PA1 的低有效接线。
- 真按键多次触发需学习消抖；本例持续开关电平不等于已经识别单次按下事件。

## 工程和复验

包含正确的 HSI/GPIO/SysTick/SWD 初始化、IOC、独立电路、HAL/CMSIS 依赖和许可证。实物烧录时由 CubeMX/CubeIDE 生成启动文件、链接脚本与工具链工程。

```powershell
.venv/Scripts/python.exe tutorials/examples/Learning09_TickTasks/verify.py --clang
node tutorials/examples/Learning09_TickTasks/verify.cjs
```

运行检查覆盖真实电路两条独立定时任务、开关响应以及把模型时间置于 2^32 毫秒前后时的回绕边界。


## 教程内副本与开发复验

本目录由 `scripts/sync-tutorial-examples.mjs` 从原例程同步。固件、IOC、库与许可证保持原样；开发辅助脚本会向上寻找 AliceSIM 平台根目录。上文复验命令请在 AliceSIM 仓库根目录执行。

独立下载 ZIP 可以直接导入同名 `.alice.json`，正常学习不依赖 Node.js 或这些复验脚本。若要离线做开发复验，请把完整工程目录放入配套平台源码的 `tutorials/examples/` 后执行；也可设置 `ALICESIM_ROOT` 指向平台源码根、`ALICESIM_PYTHON` 指向 Python 3.10+。Clang 复验还需先完成平台依赖准备。
