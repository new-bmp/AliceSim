# STM32F103 双路 ADC、OLED 与串口示例

这是一个可直接导入 AliceSIM 的 STM32Cube HAL 工程，目标芯片为
`STM32F103C8T6`。示例同时采集两个模拟电压源，并把结果显示在 SSD1306
OLED 和 USART2 串口终端中。

## 示例功能

- ADC1 通道 0：PA0，默认模拟输入 1.100 V。
- ADC2 通道 8：PB0，默认模拟输入 2.200 V。
- SSD1306：I²C1，PB6 为 SCL，PB7 为 SDA，地址为 `0x3C`。
- USART2：PA2 为 TX，PA3 为 RX，配置为 115200 8N1。
- 运行开关：PA1 上拉输入；开关 ON 时接地并开始采集，OFF 时进入待机。
- 状态灯：只使用 PB12 一个输出脚，同时驱动红、绿两只反向支路。
- 开关 ON 时每 100 ms 采集并更新一次 OLED，同时发送一行串口数据。

PB12 输出高电平时，电流从 PB12 经绿灯支路流向 GND，只有绿灯亮；PB12
输出低电平时，电流从 3.3 V 经红灯支路流入 PB12，只有红灯亮。因此这不是
两个 GPIO 分别控制两只灯，而是一个 GPIO 的高、低电平分别选择绿灯和红灯。

OLED 不显示 ADC raw 数值，而是显示带一位小数的毫伏值：

```text
DUAL ADC INPUT
PA0 1100.0 mV
PB0 2200.0 mV
UART2 115200
```

USART2 输出格式：

```text
PA0=1100.0mV PB0=2200.0mV
```

实际显示值会随原理图中两个“ADC 采集源”的电压设置实时变化。

开关为 OFF 时，OLED 只显示：

```text
READY
```

此时红灯亮、绿灯灭，并暂停 ADC 采集与串口发送。

## 在 AliceSIM 中运行

1. 选择“项目 → 打开工程文件夹”。
2. 打开整个 `examples/STM32F103_HAL_Init` 文件夹。
3. 构建工程并切换到仿真页面。
4. 双击 `SW_RUN` 将开关切换到 ON，观察绿灯、OLED 和 USART2 输出。
5. 修改两个 ADC 采集源的电压，观察显示值实时变化。
6. 再次双击开关切换到 OFF，确认 OLED 显示 `READY` 且红灯亮。

配套原理图 `STM32F103_HAL_Init.alice-sch.json` 会随工程自动加载，已经连接：

- 1.100 V 模拟源 AO → PA0 / ADC1_IN0。
- 2.200 V 模拟源 AO → PB0 / ADC2_IN8。
- OLED SCL → PB6，SDA → PB7，并连接 3.3 V 和 GND。
- 两个模拟源均连接 GND。
- PA1 由 10 kΩ 上拉到 3.3 V，`SW_RUN` 导通时将 PA1 接地。
- 绿灯支路：PB12 → 330 Ω → 绿灯 → GND。
- 红灯支路：3.3 V → 330 Ω → 红灯 → PB12。

## 主要文件

- `STM32F103_HAL_Init.ioc`：CubeMX 引脚、时钟和外设配置。
- `STM32F103_HAL_Init.alice-sch.json`：双 ADC 源、OLED、开关和单脚双色状态灯电路。
- `Core/Src/main.c`：开关判断、状态灯控制、采样、毫伏格式化、OLED 显示和串口输出。
- `Drivers/AliceSIM`：SSD1306 的 AliceSIM HAL 驱动。
