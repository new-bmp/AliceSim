# 学习 02：模拟量控制舵机

把 0–3.3 V 模拟输入换算为 0–180°，再用定时器生成 50 Hz PWM，让 SG90 摇臂跟着输入变化。串口同时显示计算出的角度和脉宽，便于核对代码与画面。

## 先运行一次

1. 在 AliceSIM 打开整个 `Learning02_Servo` 工程目录。配套电路若未自动加载，用“打开电路”选择 `Learning02_Servo.alice-sch.json`。
2. 构建并运行。模拟源初始为 1.650 V，舵机约在 90°。
3. 双击 `ADC_KNOB` 打开属性，把电压改为 0 V。舵机转到 0°，USART2 输出 `ANGLE=0.0 DEG PULSE=500 US`。
4. 改为 3.3 V，舵机转到 180°，输出 `ANGLE=180.0 DEG PULSE=2500 US`。
5. 改几个中间电压，比较电压、ADC 量化值、脉宽与舵机位置。也可给模拟源添加包络，让它自动往返变化。

## CubeMX 中配置什么

| 模块 | 引脚/参数 | 用途 |
| --- | --- | --- |
| ADC1 | PA0 / IN0，12 位，软件触发，单次转换 | 读取 0–3.3 V 模拟输入 |
| TIM1 PWM | PA8 / CH1，PWM mode 1，High polarity | SG90 控制信号 |
| TIM1 计数器 | Prescaler = 71，Counter Period = 19999 | 72 MHz / 72 = 1 MHz；20000 个计数 = 20 ms |
| USART2 | PA2 TX / PA3 RX，115200 8N1 | 输出角度与脉宽 |
| 时钟 | HSE 8 MHz，PLL ×9，APB2 = 72 MHz，ADC /6 | 定时器与 ADC 时钟 |

1 MHz 计数时，每增加 1 个比较值就是增加 1 μs 高电平时间。周期保持 20000 μs，因此 PWM 频率为 50 Hz；代码只修改比较值，不修改 PWM 周期。

本目录带有真实 STM32 HAL/CMSIS 头文件和所需 HAL 源。IOC 提供本练习所用引脚与时钟参数；若在 CubeMX 中重新生成可烧录工程，请按表设置，并保留学习代码。

## 电路怎么接

- MCU VDD 接 3.3 V，VSS 接 GND。
- `ADC_KNOB` AO → PA0，GND → 公共 GND。
- SG90 PWM → PA8，VCC → 独立 5 V 电源，GND → 公共 GND。
- 3.3 V 和 5 V 的正端不要连在一起；两路电源共地。PA8 是 MCU 的 3.3 V 控制信号。

模拟源用于重复、精确地输入电压；在真实硬件上可以换成两端接 3.3 V 与 GND、滑动端接 PA0 的电位器。真实舵机的供电电流与机械端点须按器件选型和标定，代码中的 500–2500 μs 对应本平台 SG90 模型的默认范围。

## 读哪几行代码

在 `Core/Src/main.c` 的主循环中依次找：

1. `HAL_ADC_Start` / `HAL_ADC_PollForConversion` / `HAL_ADC_GetValue`：启动、等待、读取一次转换。
2. `angle_x10`：以十分之一度存储角度，既保留一位小数，也不要求浮点运算。
3. `pulse_us`：把 ADC 的 0–4095 线性映射成 500–2500 μs。
4. `__HAL_TIM_SET_COMPARE`：更新 PA8 的 PWM 高电平宽度。
5. `snprintf` 与 `HAL_UART_Transmit`：把同一份计算结果送到串口。

输入电压在 12 位 ADC 中会被量化；中间值出现很小的舍入差别正常。模拟源改变之后，下一次 100 ms 采样会更新舵机。

## 改一处，再验证

- 将动作限制到 30–150°，先算好脉宽上下限，再验证端点。
- 增加死区，让很小的电压变化不造成连续更新。
- 用传感器包络生成三角形输入，观察舵机平滑往返；再把中间节点改成阶跃，比较响应。
- 在串口中加入毫秒时间戳，计算两次采样的间隔。
- 增加最大转动步长，尝试实现软件限速，并讨论“目标角度”与“机械到达角度”的区别。

本平台展示的是固件控制值、PWM 和设备模型的关系；SG90 摇臂位置不包含负载、惯性和电机电流的完整机械仿真。

## 复验

从 AliceSIM 仓库根目录执行：

```powershell
.venv/Scripts/python.exe tutorials/examples/Learning02_Servo/verify.py --clang
node tutorials/examples/Learning02_Servo/verify.cjs
```

检查覆盖模型构建、真实 HAL 头文件下的 C 语法，以及已接线电路中 0 / 3.3 V 输入对应的 ADC、50 Hz PWM、500 / 2500 μs、SG90 0 / 180°与串口文本。


## 教程内副本与开发复验

本目录由 `scripts/sync-tutorial-examples.mjs` 从原例程同步。固件、IOC、库与许可证保持原样；开发辅助脚本会向上寻找 AliceSIM 平台根目录。上文复验命令请在 AliceSIM 仓库根目录执行。

独立下载 ZIP 可以直接导入同名 `.alice.json`，正常学习不依赖 Node.js 或这些复验脚本。若要离线做开发复验，请把完整工程目录放入配套平台源码的 `tutorials/examples/` 后执行；也可设置 `ALICESIM_ROOT` 指向平台源码根、`ALICESIM_PYTHON` 指向 Python 3.10+。Clang 复验还需先完成平台依赖准备。
