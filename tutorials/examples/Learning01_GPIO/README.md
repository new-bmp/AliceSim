# 学习 01：开关与两个独立状态灯

这堂练习把输入、条件判断和输出连成一条可观察的链：拨动开关，程序读取 PA1，随后分别控制 PB12 和 PB13。两只灯由两个独立 GPIO 驱动。

## 先运行一次

1. 在 AliceSIM 选择“项目 → 打开工程文件夹”，打开整个 `Learning01_GPIO` 目录。
2. 配套 `Learning01_GPIO.alice-sch.json` 应随工程加载；若没有，使用“打开电路”选择它。
3. 构建并运行，切换到电路页。初始开关 OFF，红灯亮、绿灯灭。
4. 双击 `SW_RUN` 切换到 ON：绿灯亮、红灯灭。再切回 OFF，确认输出反转。
5. 打开串口面板，选择 USART2、115200 8N1。每次状态变化会出现一行记录，保持状态时不会持续刷屏。

## CubeMX 中配置什么

| 模块 | 引脚/参数 | 用途 |
| --- | --- | --- |
| GPIO 输入 | PA1，Pull-up，标签 RUN_SWITCH | 开关 ON 时接地，读到低电平 |
| GPIO 输出 | PB12，Push-pull，标签 GREEN_LED | 高电平点亮绿灯 |
| GPIO 输出 | PB13，Push-pull，标签 RED_LED | 高电平点亮红灯 |
| USART2 | Asynchronous，PA2 TX / PA3 RX，115200 8N1 | 报告状态变化 |
| 时钟 | 外部 HSE 8 MHz，PLL ×9，SYSCLK 72 MHz | 普通 F103 学习板时钟配置 |

本目录带有真实 STM32 HAL/CMSIS 头文件、所需 HAL 源文件和初始化代码。这里的 IOC 是供配置阅读和 AliceSIM 导入的引脚/时钟文件；若使用 CubeMX 重新生成硬件工程，请按表设置，并把主循环保留在 USER CODE 区域。

## 电路怎么接

- MCU VDD 接 3.3 V，VSS 接 GND。
- PA1 经 10 kΩ 电阻上拉到 3.3 V，开关另一端接地。
- PB12 → 330 Ω → 绿灯阳极，绿灯阴极 → GND。
- PB13 → 330 Ω → 红灯阳极，红灯阴极 → GND。

USART2 串口面板直接观察固件发送事件，无需另放一个串口器件。PA2/PA3 留给需要物理连线的扩展实验。

## 读哪几行代码

在 `Core/Src/main.c` 找到 `while (1)`。先看 `HAL_GPIO_ReadPin` 如何得到开关值，再看 `if/else` 两条分支中分别对 PB12、PB13 调用 `HAL_GPIO_WritePin`。最后一段比较当前值与上一次值，仅在变化时调用 `HAL_UART_Transmit`。

20 ms 轮询让界面变化容易观察。本例没有模拟机械触点抖动，因此不要把这个轮询写法当作已经完成了硬件消抖。

## 改一处，再验证

- 把 ON 状态改成红、绿同时亮，检查两个输出是否互不依赖。
- 将延时改为 200 ms，体会轮询周期对响应的影响。
- 给 ON 状态增加一次短闪，再改成不阻塞主循环的定时闪烁。
- 在逻辑分析仪中观察 PB12、PB13，解释为什么两条电平相反。
- 将外部电阻改为下拉、开关改为接 3.3 V，再调整判断条件，检查输入有效电平改变后程序怎样配合。

AliceSIM 用 HAL 语义与电路网络联动来练习代码、引脚和接线；它不把这个例程宣称为 MCU 指令周期或电磁过程的完整重现。

## 复验

从 AliceSIM 仓库根目录执行：

```powershell
.venv/Scripts/python.exe tutorials/examples/Learning01_GPIO/verify.py --clang
node tutorials/examples/Learning01_GPIO/verify.cjs
```

检查覆盖模型构建、真实 HAL 头文件下的 C 语法，以及已接线电路 OFF → ON → OFF 时两个独立 GPIO 和串口输出。


## 教程内副本与开发复验

本目录由 `scripts/sync-tutorial-examples.mjs` 从原例程同步。固件、IOC、库与许可证保持原样；开发辅助脚本会向上寻找 AliceSIM 平台根目录。上文复验命令请在 AliceSIM 仓库根目录执行。

独立下载 ZIP 可以直接导入同名 `.alice.json`，正常学习不依赖 Node.js 或这些复验脚本。若要离线做开发复验，请把完整工程目录放入配套平台源码的 `tutorials/examples/` 后执行；也可设置 `ALICESIM_ROOT` 指向平台源码根、`ALICESIM_PYTHON` 指向 Python 3.10+。Clang 复验还需先完成平台依赖准备。
