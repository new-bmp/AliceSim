# 例程 04：ADC 循环 DMA 与独立心跳灯

用一个模拟电压源学习 DMA 和中断回调的分工：ADC1 持续采 PA0，DMA1 Channel1 循环写 64 个半字，半缓冲和满缓冲回调只更新计数/标志。主循环读取完成的半块、换算电压、输出串口，同时独立闪烁 PC13 LED。

## 打开与观察

1. 通过“项目 → 打开工程文件夹”打开整个 `Learning04_DMA` 目录，构建并运行。
2. 默认 PA0 模拟源为 1.100 V。USART2 每约 250 ms 输出一行，例如 `DMA batch=3 half=4 full=3 ADC=1100 mV`。计数由实际 DMA 完成事件推进，启动时的具体编号取决于观察时刻。
3. LED 每约 250 ms 改变一次状态，完整闪烁周期约 500 ms。它由主循环的 tick 判断控制，不靠 DMA 回调切灯。
4. 把模拟源改为 2.200 V，下一批完成数据应显示约 2200 mV；也可设一条电压包络，观察连续数据变化。
5. 在逻辑分析仪选择 PC13，观察独立任务的周期；在运行摘要中观察 DMA 启动、半满完成与循环记录。

## CubeMX 配置对应关系

| 项目 | 本例配置 |
|---|---|
| 芯片与系统 | STM32F103C8T6，HSI 8 MHz |
| ADC1 | PA0 / IN0，右对齐，软件触发开始，连续转换，单通道 |
| ADC 时钟 | PCLK2 8 MHz ÷ 8 = 1 MHz |
| ADC 采样时间 | 239.5 周期；加 12.5 周期转换，共 252 ADC 周期 |
| DMA1 Channel1 | Peripheral-to-Memory，外设地址不递增，内存递增，Half Word → Half Word，Circular，高优先级 |
| NVIC | DMA1 Channel1 中断启用，优先级 1 |
| USART2 | PA2 / PA3，115200、8N1 |
| LED | PC13 → 1 kΩ → LED → GND，独立外接 LED，高电平亮 |

`.ioc` 与 `main.c` 配置一致；`HAL_ADC_MspInit` 通过 `__HAL_LINKDMA` 绑定 `hadc1` 和 `hdma_adc1`，`DMA1_Channel1_IRQHandler` 调用 `HAL_DMA_IRQHandler`。不能省略这些配置后只把函数名换成 `Start_DMA`。

## 程序分工

`HAL_ADC_Start_DMA(&hadc1, (uint32_t *)adc_dma, 64)` 只在初始化后启动一次。数组元素实际为 `uint16_t`，因为 DMA 配置了半字搬运，HAL 接口的指针类型要求显式转换。

`HAL_ADC_ConvHalfCpltCallback` 增加 `dma_half_count`；`HAL_ADC_ConvCpltCallback` 增加 `dma_full_count` 并置 `dma_full_ready`。回调里没有平均值计算、串口等待或显示刷新。

满缓冲事件后 DMA 回头写第一半区，主循环立即读取已经完成的第二半区 32 个数并求平均，再换算为 mV。必须在 DMA 开始覆盖该半区前完成读取；高负载应用应采用专门的双缓冲队列或及时复制快照。本例主循环每 1 ms 让出一次，串口只每 250 ms 输出短报文。

## 时间如何理解

在当前 AliceSIM HAL 语义仿真中，ADC DMA 默认按 **1 ms/样本** 调度：64 样本一轮约 64 ms，半缓冲约在 32 ms，之后继续循环。这里验证的是数据搬运、缓冲区、回调和主循环逻辑。

在本例实机配置中，ADC 时钟为 1 MHz、总转换周期 252，连续采样理论上约 **252 µs/样本**：半缓冲约 8.064 ms，满缓冲约 16.128 ms。当前仿真没有根据 ADC 采样时间自动推导这个速率；不能用模拟运行摘要声称测出了 MCU 的真实吞吐或中断延迟。PC13 与串口的 250 ms 周期按 `HAL_GetTick()` 计算。

## 自己改一改

- 改缓冲区长度，核对半满回调计数怎样改变，并同步修改两个长度宏。
- 增加最大/最小值计算，比较恒定输入与电压包络。
- 给电压设置上下限，在主循环控制另一个独立 GPIO 告警。
- 有实机后测量 DMA 回调和心跳波形，与理论周期比较，记录哪些是语义模型、哪些是硬件时序。

完整 HAL / CMSIS 库已随工程提供。实机编译宏使用 `USE_HAL_DRIVER`、`STM32F103xB`，添加 `Core/Inc`、HAL 与 CMSIS 头文件目录，并由对应 STM32 工具链提供启动文件、链接脚本与标准库。

## 已验证与拍摄建议

`verify.py` 对实际工程调用模型构建器，再用固件运行时分别输入 ADC raw 1365 和 2730，验证至少两个完整 DMA 批次、半满回调、1100/2200 mV 串口结果，以及 PC13 两种电平。运行：`python examples/Learning04_DMA/verify.py`。

拍摄时先对照 `Start_DMA`、两个短回调和主循环，再运行电路，放大串口中的批次计数并保留心跳 LED。把 1.1 V 改为 2.2 V，让观众看到“DMA 数据更新，同时主循环还在工作”。逻辑分析仪使用真实 PC13 波形，不后期添加脉冲或虚构 CPU 性能对比。
