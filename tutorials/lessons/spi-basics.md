# SPI 入门：片选、模式与 MAX7219 寄存器

## 实验目标与入口

打开 [完整工程](../projects/Learning14_SPIBasics.alice.json)，构建运行。MAX7219 的 8 × 8 点阵每约 500 ms 在两条对角线间切换。[完整源码](../examples/Learning14_SPIBasics/Core/Src/main.c) 只包含 SPI 初始化、寄存器写入和逐行像素数据，便于把每次传输与芯片手册对应起来。

先学习“哪根线、什么时刻、哪一个字节”；已有的 [SPI 点阵应用课](./spi-matrix.md) 再把它用于传感器状态图案。本课运行不输出 UART 文本，可查看 `frame_count` 与点阵本身。

## 扩展：ST7789 SPI 彩屏

想用 SPI 显示文字、颜色和动态进度条，可以下载新的 [ST7789 彩屏完整工程](../projects/ST7789_SPI_Display.alice.json) 或 [源码、驱动与电路 ZIP](../downloads/ST7789_SPI_Display.zip)。下载 JSON 后，在工作台选择“项目 → 打开 IOC / 工程包”，构建、运行。包内 README 说明接线和驱动接口。

这块屏幕为 240 × 240，使用 RGB565 颜色。SCK 接 PA5，MOSI 接 PA7，CS 接 PA4，DC 接 PB0，RST 接 PB1；VCC、BL 接 3.3 V，GND 共地。SPI1 为 mode 0、8 bit、MSB first，软件 NSS、半双工发送；HSI 8 MHz、分频 2。DC 为 LOW 时发送命令，为 HIGH 时发送参数和像素；一个 RGB565 像素先发高字节，再发低字节。

配套驱动提供初始化、清屏、填充矩形、单像素和 5 × 7 英文字母、数字与常用符号接口，小写按大写显示，内部使用普通 HAL GPIO/SPI。例程只在启动时填充一次背景，随后仅刷新进度区域。断开背光线屏幕会暗下来；断开数据、时钟或片选，画面不会继续正常更新。可以先改三块色条的颜色，再尝试绘制折线图。

## CubeMX 配置与接线

| 配置项 | 本例设置 |
| --- | --- |
| MCU / 时钟 | STM32F103C8T6，HSI 8 MHz，PLL 关闭 |
| SPI1 | Half-Duplex Master，8-bit，MSB first，软件 NSS |
| 时钟模式 | CPOL=LOW，CPHA=1EDGE，即常称的 mode 0 |
| 分频 | APB2 8 MHz / 16 = 500 kbit/s |
| PA5 / PA7 | SPI1_SCK → CLK，SPI1_MOSI → DIN |
| PB0 | 推挽 GPIO → CS/LOAD，初始 HIGH |
| 模块电源 | MAX7219 模块 +5 V，GND 与 MCU 共地 |

MAX7219 不向 MCU 回传数据，本例不连接 MISO，选半双工单线发送。CS 是由 PB0 显式控制的 GPIO，不是硬件 NSS 管脚。每次写寄存器前拉 LOW，发完两个字节再拉 HIGH。

真板中 MAX7219 通常用 5 V 供电，其输入高电平门限不能保证所有 3.3 V MCU 输出直接满足。应核对模块与芯片手册，并使用合适的 3.3 V → 5 V 逻辑电平转换；AliceSIM 的逻辑连接用于协议学习，不等于已经验证真实电平兼容。模块限流电阻、去耦和峰值电流也要检查。

从 CubeMX 生成真板工程时选择相同配置，导入本例 `main.c`、`main.h` 与 HAL 配置，合并唯一的 SysTick Handler。包内附 HAL/CMSIS 与许可证；启动文件、链接脚本由目标 IDE 为 STM32F103C8T6 生成。

## CPOL、CPHA 与 CS 锁存

CPOL=0 表示空闲时 SCK 为 LOW；CPHA=第一边沿表示接收方在上升沿采样，发送方在另一边沿改变数据。将 CPHA 改成第二边沿并不是“速度减半”，而是改变采样相位。

```c
packet[0] = address;
packet[1] = value;
HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_RESET);
HAL_SPI_Transmit(&hspi1, packet, 2U, 100U);
HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_SET);
```

这两个 8 位字节组成 MAX7219 的一个 16 位写入字：先地址，再数据，每字节高位先发。手册将 D15..D12 标为 don't care，D11..D8 是寄存器地址，D7..D0 是数据。这里不是把 STM32 本机内存中的 `uint16_t` 直接发送，因此不会把 CPU 小端字节序误当成协议字节顺序。

CS/LOAD 的上升沿把移位寄存器中的 16 位内容锁存到目标寄存器。少一个边沿、每个字节都抬高 CS，或交换两个字节，都可能写错寄存器。SPI 没有 I²C 那样的地址 ACK；`HAL_SPI_Transmit == HAL_OK` 只说明 MCU 发送完成，不能证明外设已接线或接受了数据。

## 从手册选出初始化寄存器

阅读 [MAX7219/MAX7221 手册](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX7219-MAX7221.pdf) 的 Serial-Addressing Modes、Register Address Map、Timing Characteristics 与 Digit/Control Registers 部分。

| 寄存器 | 本例值 | 含义 |
| --- | --- | --- |
| 0x0F Display test | 0 | 退出全亮测试 |
| 0x0C Shutdown | 先 0 后 1 | 配置期间停显示，结束后正常工作 |
| 0x09 Decode mode | 0 | 原始像素，关闭七段数码管 BCD 译码 |
| 0x0B Scan limit | 7 | 扫描全部八行 |
| 0x0A Intensity | 3 | 较低亮度 |
| 0x01..0x08 Digit/row | 一个像素字节 | 8 个行寄存器 |

初始化先关测试、关显示、配置控制寄存器、清空八行，再开显示。每帧向地址 1..8 分别写 `01,02,04,08,10,20,40,80`；下一帧反向写。实际模块行列布线可能让图案旋转或镜像，需要根据模块接线确认方向。

500 kHz 对应时钟周期 2 µs。查手册还要核对时钟 HIGH/LOW 最短时间、DIN 建立/保持、LOAD 脉宽及相对最后一个时钟的间隔。当前仿真检查总线事件、器件连接和显示状态，不按芯片逐时钟电气时序验证这些纳秒级约束；真板应使用逻辑分析仪与示波器验证。

## 观察、排错与练习

预期：点阵两条对角线切换，`frame_count` 持续增加，PB0 在事务后恢复 HIGH。自动验证检查初始化后的可见状态、两组精确行数据、移除 CLK 导线时模型拒绝传输，以及接回后的恢复。固件遇到 HAL 发送失败会释放 CS、增加 `error_count`，再按 500 ms 周期重试初始化。

AliceSIM 的电路模型会把未连接的时钟报告为传输失败；真实 SPI 控制器通常无法检测远端断线，CLK 断开也可能返回 HAL_OK。这两种情形应分别理解。真板的设备故障诊断需要外部观察或额外的应用层机制。

**没有图案**：检查 +5 V、共地、CLK/DIN/CS 接线、shutdown=1 和 display test=0。先确认发送的寄存器地址，再查像素算法。

**全亮或图案像数字段码**：分别检查 0x0F 与 0x09。**每次图案不稳定**：检查 CS 是否围住完整 16 位字，以及 CPOL/CPHA、MSB first 是否符合外设要求。

练习：只改地址 1 的数据为 `0xFF`，预测哪一行会亮；再把亮度 3 改为 1。最后在仿真中断开 CLK，观察错误计数与重试；解释为什么在真板上不能仅靠 HAL_OK 判断外设是否正常。
