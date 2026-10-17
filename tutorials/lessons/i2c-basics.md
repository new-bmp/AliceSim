# I²C 入门：地址、ACK 与 SSD1306 命令

## 实验目标与入口

打开 [完整工程](../projects/Learning13_I2CBasics.alice.json)，构建运行。SSD1306 左上角的 8 × 8 区域每约 500 ms 改变一次斜线方向，其余像素保持黑色。[完整源码](../examples/Learning13_I2CBasics/Core/Src/main.c) 直接发送 I²C 命令和显存字节，不经过绘图字体库。

本课学习一份外设手册怎样变成总线写入：设备地址、控制字节、命令参数、显示 RAM。仿真能核对接线、地址、接收结果与像素；它不能替代实际总线上升时间和建立保持时间的测量。

## CubeMX、开漏与上拉接线

| 配置项 | 本例设置 |
| --- | --- |
| MCU / 时钟 | STM32F103C8T6，HSI 8 MHz，PLL 关闭 |
| I2C1 | I2C，Standard mode，100 kHz，7-bit addressing |
| PB6 / PB7 | I2C1_SCL / I2C1_SDA，复用开漏 AF_OD |
| 上拉 | SCL 与 SDA 各通过 4.7 kΩ 接 3.3 V |
| OLED | VCC → 3.3 V，GND → 共地，SCL → PB6，SDA → PB7 |

开漏输出主动拉 LOW，输出 HIGH 时实际是释放导线，需要上拉电阻恢复高电平。不能用推挽代替，也不能把模块上拉到 5 V 后假定 MCU 一定兼容。很多 OLED 模块已焊上拉，接真板前看模块原理图；多个上拉并联会改变等效阻值。4.7 kΩ 是本实验起点，真实值应按电压、总线电容和器件灌电流能力计算。

表中接线针对允许 3.3 V 供电的四针 I²C OLED 模块，不能直接套用到裸 SSD1306 面板；裸面板还需要按手册设计供电、复位、升压与外围电容。使用成品模块时也要核对其标注和原理图。

由 CubeMX 生成真板工程时选相同芯片、时钟和引脚，导入本例 `main.c` / `main.h` 与 HAL 配置，并保留一份 SysTick 处理函数。工程包附 HAL/CMSIS 及许可证；芯片启动文件和链接脚本由目标 IDE 生成。

## 先分清 0x3C、0x78 和 ACK

SSD1306 常用 7 位地址为 `0x3C`（由 SA0 接法决定，也可能为 `0x3D`）。总线在线上传送的是“7 位地址 + R/W 位”。因此对 0x3C 写入时，地址阶段字节为 `0x78`。STM32 HAL 的 `DevAddress` 参数要求先左移一位：

```c
#define OLED_ADDRESS_7BIT 0x3CU
#define OLED_HAL_ADDRESS (OLED_ADDRESS_7BIT << 1U)
HAL_I2C_Master_Transmit(&hi2c1, OLED_HAL_ADDRESS, bytes, count, 100U);
```

AliceSIM 器件属性填 7 位地址 0x3C，代码传 HAL 地址 0x78。不要把器件属性也改为 0x78，也不要左移两次。

主机发 START、地址和数据，每个字节后的第 9 个时钟用于 ACK/NACK；停止条件结束本次事务。ACK 表示接收方应答，不等于“画面一定正确”：控制字节或初始化参数错误时，即使器件应答，显示也可能不符合预期。本例检查每次传输的 HAL 返回状态；断开 SDA 后 `error_count` 增加，`initialized` 清零，之后每 500 ms 重试初始化与绘图。

## 从手册找到命令与显存格式

阅读 [SSD1306 手册](https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf) 的 I²C interface、Command Table、GDDRAM 和 AC characteristics 部分，先回答以下问题，再读初始化数组。

| 手册信息 | 本例对应写入 |
| --- | --- |
| 控制字节 Co=0、D/C#=0 | `0x00`，后面为命令及命令参数 |
| 控制字节 Co=0、D/C#=1 | `0x40`，后面为显示 RAM 数据 |
| Memory Addressing Mode | `0x20, 0x02`，选择 page addressing |
| Page start / column address | `0xB0 + page`、`0x00`、`0x10` |
| Display OFF / ON | `0xAE` / `0xAF` |
| Contrast control | `0x81` 后跟一个亮度参数 |

这里命令编号并不是可随意 `HAL_I2C_Mem_Read` 的通用存储器地址。SSD1306 的串行接口用于写命令和显示数据，本实验没有伪造“读寄存器”。阅读其他传感器手册时，另查寄存器是否可读、地址宽度、自增规则，以及是否需要 repeated START，再选择 HAL Mem_Read 或收发组合。

每页 128 列，每个显存字节控制一列中的 8 个垂直像素。初始化先清空 8 页，再选第 0 页、列 0。发送 `0x40, 0x01, 0x02, 0x04, ..., 0x80` 就会画出 8 个斜线像素；第二帧顺序反过来。手册里的 SDA 建立/保持、SCL LOW/HIGH、上升时间都是时间约束；100 kHz 只是时钟频率，不能证明接线满足全部约束。

## 观察、排错与练习

预期：左上角斜线交替，`frame_count` 每约 500 ms 增加，正常接线时 `error_count=0`。可在变量观察中查看这两个计数以及 `initialized`；本例没有 UART 外设，串口无输出是正常现象。自动验证检查两帧精确显存字节，并实际移除 SDA 导线确认传输失败与接回恢复。

**一直黑屏**：先检查电源、共地、SCL/SDA、地址 0x3C/0x3D，再确认初始化中的 charge pump、multiplex、display ON 与模块匹配。地址正确只解决了第一层问题。

**斜线位置不对或花屏**：检查 page/column 命令、`0x00` 与 `0x40` 控制字节，以及每次发送的长度是否含控制字节。

**真板偶发失败**：检查上拉、线长、共地和电源；用逻辑分析仪看 ACK，用示波器看波形边沿。仿真通过不代表真实电气时序已经合格。

练习：把绘图页从 0 改为 2，预测像素向下移动多少行；再通过 `0x81` 修改对比度。最后只把 HAL 地址错写为 0x3C，观察错误计数，再恢复，说明器件的 7 位地址为什么没有改变。
