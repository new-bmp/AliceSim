# 学习 06：超声波泊车提示台

这是一套把输入、显示、声音和触点负载接起来的仿真实验。它使用 HC-SR04 超声波测距、MAX7219 8×8 点阵、PWM 无源蜂鸣器和继电器模块。改变传感器的目标距离后，程序自己决定图案、音调与负载状态。

AliceSIM 是嵌入式仿真学习平台。请先预测结果，再调整输入、观察电路与串口，最后修改程序验证自己的判断。

## 打开与观察

1. 导入此文件夹（包含 IOC、Core、Drivers），在电路页打开同目录的 `Learning06_Components.alice-sch.json`；也可以直接打开配套的 `Learning06_Components.alice.json` 完整项目文件。
2. 编译并运行，打开 USART2 虚拟串口，115200、8N1。
3. 双击 HC-SR04，把“目标距离”先设为 150 cm，再改成 75 cm、25 cm。
4. 对照点阵图案、蜂鸣器状态、继电器触点和两只负载灯。声音是否可听还取决于浏览器声音权限和系统音量；电路中的 PWM 频率/启停状态可以直接观察。

| 距离 | 点阵 | 蜂鸣器 | 继电器 | 负载灯 |
| --- | --- | --- | --- | --- |
| ≥100 cm | 笑脸 | 停止 | 释放，COM→NC | 绿亮、红灭 |
| 50～不足100 cm | 感叹号 | 1 kHz，50%占空比 | 释放，COM→NC | 绿亮、红灭 |
| <50 cm | 大 X | 2 kHz，50%占空比 | 吸合，COM→NO | 红亮、绿灭 |
| 测距失败 | 大 X | 2 kHz | 吸合 | 红亮 |

MAX7219 是单色红点阵，图案颜色不会随距离变绿。红/绿状态由继电器接到两个独立 LED 负载体现。串口例如输出 `DIST=25.0 cm ZONE=STOP RELAY=ON`，每 100 ms 更新一次。

## 模块分别怎么用

### HC-SR04：把回波变成距离

TRIG 需要短脉冲，ECHO 的高电平持续时间代表往返飞行时间。本工程用 `AliceSIM_HCSR04_Init` 绑定 PB1/PB10，再调用 `AliceSIM_HCSR04_MeasureMm` 得到毫米值。100 ms 的触发间隔大于传感器建议的 60 ms。

驱动源码在 [alicesim_hcsr04.c](Drivers/AliceSIM/Src/alicesim_hcsr04.c)。真实硬件的微秒计时由 DWT 周期计数器提供；AliceSIM 用相同驱动接口读取已接线传感器的模型，不会在未供电或未接线时编造测距结果。

### MAX7219：SPI 寄存器变成像素

`Matrix_WriteRegister` 是本工程的普通 C 函数。它拉低 PB0 片选，通过 `HAL_SPI_Transmit` 发送“寄存器地址+数据”，再拉高片选锁存。寄存器 1～8 对应八行，每一位对应一个像素。

初始化关闭显示测试和 BCD 译码，打开全部八行，设置亮度后进入正常显示。`picture[8]` 保存图案，循环发送八行；只有区域改变时重画，避免反复发送相同内容。仿真画面来自真正的 SPI 数据与片选边沿，不是按变量名称匹配预设动画。

### PWM 蜂鸣器：定时器控制音调

TIM2 的时钟为 8 MHz，预分频 7，得到 1 MHz 计数频率。`AliceSIM_Buzzer_Set` 调整周期和比较值：1000 Hz 对应周期 1000 个计数，2000 Hz 对应 500 个计数。`AliceSIM_Buzzer_Stop` 停止 PWM。不要把要求不同频率的其他负载接到同一定时器的另一个通道。

### 继电器：输入和负载回路分开

本例是**带驱动电路的继电器模块**，不是 MCU 直接驱动裸线圈。PB12 接 IN，低电平有效。VCC/GND 给模块供电；COM 接独立 3.3 V 负载电源，NC/NO 分别经过 330 Ω 电阻接绿灯/红灯，再回到地。

继电器真的切换 COM 与 NO/NC 的连通关系。两只灯不共用一个 MCU 输出作反向接法，灯的能量也不由 PB12 提供。

## CubeMX 对照配置

本工程采用内部 HSI 8 MHz，便于不依赖外部晶振完成实验。IOC 与代码保持一致。

| 引脚 | CubeMX 配置 | 接到哪里 |
| --- | --- | --- |
| PA0 | TIM2_CH1，PWM Generation CH1 | 蜂鸣器 SIG |
| PA2 / PA3 | USART2 TX / RX，115200 8N1 | 虚拟串口；电路可不放外部串口器件 |
| PA5 / PA7 | SPI1 SCK / MOSI，主机，8位，Mode 0，分频16 | 点阵 CLK / DIN |
| PB0 | GPIO Output，初始 High | 点阵 CS |
| PB1 | GPIO Output，初始 Low | 超声波 TRIG |
| PB10 | GPIO Input，No Pull | 超声波 ECHO |
| PB12 | GPIO Output，初始 High | 低有效继电器 IN |

TIM2 预分频 7、初始 ARR 499、PWM Pulse 0；驱动运行时按音调重新配置 ARR/CCR。SPI 片选由 GPIO 管理，使用 Software NSS。

## 试着修改

1. 把 50 cm 停止线改为 30 cm，验证 29.9/30.0/30.1 cm 三个边界。
2. 改变 `picture` 数组，画一个箭头；先在纸上把八行二进制点出来，再观察实际显示。
3. 增加“距离越近，提示间隔越短”的节奏。用 `HAL_GetTick` 调度，避免长时间 `HAL_Delay` 挡住采样。
4. 在阈值处反复输入 49.9/50.1 cm，观察区域切换，再加入 2 cm 迟滞，比较两种控制方法。
5. 停止仿真，断开 HC-SR04 电源后重新运行。确认屏幕和串口能表示测距失败，不能把错误数值误认为安全。

## 仿真与硬件的区别

仿真用于学习数据流、引脚配置、SPI 协议、PWM 参数与控制逻辑，不等同于真实超声回波、电源纹波或 CPU 周期精确仿真。实物超声波测距会受到目标材质、角度和声速影响。

HC-SR04、MAX7219 和继电器模块采用 5 V，MCU 与蜂鸣器采用 3.3 V，共地。PB10 是 STM32F103C8T6 的 FT 数字输入；ECHO 只有在 MCU 已供电且引脚保持数字输入模式时才能按相应数据手册条件使用。连接其他型号 MCU 时应采用电平转换或分压。真实 MAX7219 模块的 5 V 输入高阈值可能高于 3.3 V，应加 74AHCT 等合适的单向电平转换器；本学习电路只验证逻辑连接和 SPI 行为，未模拟这类输入电平裕量。不要据此直接省略实物电平转换。

## 验证

在 AliceSIM 仓库根目录运行：

```powershell
.venv/Scripts/python.exe examples/Learning06_Components/verify.py --clang
node examples/Learning06_Components/verify.cjs
node examples/Learning06_Components/verify-layout.cjs
```

验证覆盖三种区域、50/100 cm 边界、49.9 cm、小数串口、远近恢复、SPI 八行像素、PWM 音调、继电器实际触点负载与断开传感器电源的错误分支。要重新生成有序布局，可运行 `node examples/Learning06_Components/build-circuit.cjs`。

HAL SPI 源码来自 STMicroelectronics `stm32f1xx-hal-driver` v1.1.10，其余 HAL/CMSIS 沿用已有学习工程，许可证保留在 Drivers 子目录。
