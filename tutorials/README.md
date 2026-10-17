# AliceSIM 教程与例程

教程以可浏览的文档页提供，按入门、基础模块、传感器、显示、输出与综合实验分类。例程放在本文件夹的 `examples/` 中，包含源码、IOC、驱动、独立电路和说明。

启动 AliceSIM 后，打开“帮助中心 → 教程与例程”，或在实际服务地址后加 `/tutorials/`。例如服务运行在 4173 端口时使用 [教程首页](http://127.0.0.1:4173/tutorials/)。请以启动器显示的实际端口为准。不要直接双击 index.html，浏览器会限制本地文件读取。

每篇顶部提供完整 `.alice.json` 和源码 ZIP。下载 JSON 后从工作台“项目 → 打开 IOC / 工程包”打开；也可导入 `tutorials/examples` 中的完整工程目录。

## 教程目录

- [从这里开始](lessons/start.md)
- [下载、启动与打开工程](lessons/setup.md)
- [工作台操作与保存](lessons/workspace.md)
- [电路与电平基础](lessons/electrical.md)
- [单片机与第一个闪灯程序](lessons/mcu-first.md)
- [CubeMX 引脚与外设配置](lessons/cubemx.md)
- [读懂 C 和 HAL 调用](lessons/c-hal.md)
- [嵌入式 C：数据与指针](lessons/c-data.md)
- [GPIO 开关与状态灯](lessons/gpio.md)
- [非阻塞计时与状态机](lessons/tick-state.md)
- [按键消抖与长按](lessons/button-debounce.md)
- [EXTI 外部中断与 NVIC](lessons/exti.md)
- [定时器基础与更新中断](lessons/timer-irq.md)
- [ADC 单次采样](lessons/adc.md)
- [PWM 控制舵机](lessons/pwm-servo.md)
- [UART 输出状态和测量记录](lessons/uart.md)
- [UART 接收与命令解析](lessons/uart-rx.md)
- [I²C 总线与数据手册](lessons/i2c-basics.md)
- [SPI 总线与寄存器](lessons/spi-basics.md)
- [DHT11 温湿度采集](lessons/dht11.md)
- [HC-SR04 超声波测距](lessons/hcsr04.md)
- [TM1637 四位数码管](lessons/tm1637.md)
- [SSD1306 OLED 文字与曲线](lessons/oled.md)
- [SPI 与 MAX7219 点阵](lessons/spi-matrix.md)
- [PWM 蜂鸣器与音调参数](lessons/buzzer.md)
- [继电器触点与负载回路](lessons/relay.md)
- [从现象定位问题](lessons/debugging.md)
- [把程序放到真实开发板](lessons/hardware.md)
- [ADC 循环 DMA 与回调](lessons/dma.md)
- [双路采集与趋势记录](lessons/logger.md)
- [自主练习与创新](lessons/practice.md)

## 十四套配套工程

零基础按教程顺序从 07 闪灯开始；01～06 保留原编号，作为模块与综合实验。例程带有 HAL/CMSIS 源码与许可证，实机开发另按实机课用 CubeMX 生成目标工具链工程。

| 源码目录 | 工程包 | 内容 |
| --- | --- | --- |
| [Learning01_GPIO](examples/Learning01_GPIO/README.md) | [打开用 JSON](projects/Learning01_GPIO.alice.json) · [ZIP](downloads/Learning01_GPIO.zip) | 开关、独立状态灯与串口 |
| [Learning02_Servo](examples/Learning02_Servo/README.md) | [JSON](projects/Learning02_Servo.alice.json) · [ZIP](downloads/Learning02_Servo.zip) | ADC 与 PWM 舵机 |
| [Learning03_Climate](examples/Learning03_Climate/README.md) | [JSON](projects/Learning03_Climate.alice.json) · [ZIP](downloads/Learning03_Climate.zip) | DHT11 与 TM1637 |
| [Learning04_DMA](examples/Learning04_DMA/README.md) | [JSON](projects/Learning04_DMA.alice.json) · [ZIP](downloads/Learning04_DMA.zip) | ADC 循环 DMA |
| [Learning05_Logger](examples/Learning05_Logger/README.md) | [JSON](projects/Learning05_Logger.alice.json) · [ZIP](downloads/Learning05_Logger.zip) | 双路滤波、趋势、报警和 CSV |
| [Learning06_Components](examples/Learning06_Components/README.md) | [JSON](projects/Learning06_Components.alice.json) · [ZIP](downloads/Learning06_Components.zip) | 测距、点阵、蜂鸣器与继电器 |
| [Learning07_Blink](examples/Learning07_Blink/README.md) | [JSON](projects/Learning07_Blink.alice.json) · [ZIP](downloads/Learning07_Blink.zip) | 电路基础与最小闪灯 |
| [Learning08_CData](examples/Learning08_CData/README.md) | [JSON](projects/Learning08_CData.alice.json) · [ZIP](downloads/Learning08_CData.zip) | 数组、结构体、指针和位操作 |
| [Learning09_TickTasks](examples/Learning09_TickTasks/README.md) | [JSON](projects/Learning09_TickTasks.alice.json) · [ZIP](downloads/Learning09_TickTasks.zip) | 独立计时与开关状态机 |
| [Learning10_ButtonEXTI](examples/Learning10_ButtonEXTI/README.md) | [JSON](projects/Learning10_ButtonEXTI.alice.json) · [ZIP](downloads/Learning10_ButtonEXTI.zip) | 消抖、长按与外部中断 |
| [Learning11_TimerIRQ](examples/Learning11_TimerIRQ/README.md) | [JSON](projects/Learning11_TimerIRQ.alice.json) · [ZIP](downloads/Learning11_TimerIRQ.zip) | 定时器更新回调与主循环 |
| [Learning12_UARTCommand](examples/Learning12_UARTCommand/README.md) | [JSON](projects/Learning12_UARTCommand.alice.json) · [ZIP](downloads/Learning12_UARTCommand.zip) | 串口接收与命令解析 |
| [Learning13_I2CBasics](examples/Learning13_I2CBasics/README.md) | [JSON](projects/Learning13_I2CBasics.alice.json) · [ZIP](downloads/Learning13_I2CBasics.zip) | I²C 地址与 OLED 命令 |
| [Learning14_SPIBasics](examples/Learning14_SPIBasics/README.md) | [JSON](projects/Learning14_SPIBasics.alice.json) · [ZIP](downloads/Learning14_SPIBasics.zip) | SPI 寄存器与点阵像素 |

多个模块页共享同一完整工程，各页会明确说明。网页只读教程和下载文件，不会自动覆盖工作台中的编辑内容。

## 维护教材

正文在 `lessons/`，目录信息在 `catalog.json`，截图在 `assets/`。根目录 `examples/` 是维护例程的源，教程副本通过下列命令同步：

```powershell
node scripts/sync-tutorial-examples.mjs
node scripts/sync-tutorial-examples.mjs --verify-only
```

同步会更新教程内的工程副本、JSON、ZIP 和校验清单，不依赖 `output/`。不要直接在教程镜像修改固件后再执行同步。每个工程的 README 给出开发验证方法；学生阅读和导入无需运行验证脚本。HAL、CMSIS 等第三方代码的许可证保留在各工程目录中。
