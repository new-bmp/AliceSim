# ADC 循环 DMA 与回调

## 实验效果

ADC 持续采样，DMA 把结果搬进 64 项数组，回调报告半满和满缓冲，主循环计算电压，同时 PC13 心跳灯继续闪烁。重点是数据搬运、事件通知和处理任务如何分工。

![DMA 完成计数与电压记录](../assets/lesson-dma-serial.png)

[下载 Learning04_DMA 完整工程](../projects/Learning04_DMA.alice.json) · [阅读 main.c](../examples/Learning04_DMA/Core/Src/main.c)

## 如何使用

1. 在 AliceSIM 打开完整工程，构建、运行。
2. 展开串口，选择 USART2，确认显示 115200 baud、8N1。观察 half、full 计数持续增长。
3. 电路页双击模拟源，将电压从 1.100 V改为 2.200 V并应用。新数据块处理后，输出应接近 2200 mV。
4. 在逻辑分析仪添加 PC13，观察约每 250 ms 翻转，完整周期约 500 ms。改变输入不应让灯停止。

## 工程配置

| 项目 | CubeMX 设置 |
| --- | --- |
| 时钟 | HSI 8 MHz，ADC 时钟 APB2 ÷8=1 MHz |
| ADC1 | PA0 IN0、连续转换、软件启动、239.5 Cycles |
| DMA1 Channel1 | Peripheral to Memory、Circular |
| 地址和宽度 | 外设不递增、内存递增，两端 Half Word |
| NVIC | 启用 DMA1 Channel1 IRQ，优先级 1 |
| 输出 | PC13 推挽，经 1 kΩ 接 LED 到地；USART2 115200 8N1 |

生成代码后核对 `__HAL_LINKDMA` 和 IRQ 中的 `HAL_DMA_IRQHandler`，只有启动调用还不够。

输入源 AO 接 PA0，接地端与 MCU 共地。数组长度、半区长度与 DMA 传输长度是一组约定，改动时一起核对。传输宽度要匹配内存元素；强制转换指针不会自动扩大数组。实验先保持单通道，确认这一条链路工作后再增加外设，容易定位问题。

## 关键代码解释

```c
volatile uint16_t adc_dma[ADC_BUFFER_LENGTH];
HAL_ADC_Start_DMA(&hadc1, (uint32_t *)adc_dma,
                  ADC_BUFFER_LENGTH);
```

总长度为 64，半区长度为 32。HAL 形参是 `uint32_t *`，所以有强制转换；实际每次写入仍由 DMA Half Word 配置决定，元素依然占两字节。

```c
void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *hadc)
{
  if (hadc->Instance == ADC1)
  {
    dma_full_count++;
    dma_full_ready = 1;
  }
}
```

回调只计数、置标志。主循环看到标志后处理下标 32～63 的已完成第二半区；此时 DMA 正回到第一半区。必须在它再次写到第二半区前完成读取。`volatile` 不等于锁，标志也不能累计所有事件，主循环处理过慢会漏批次。

本例求 32 个值的平均再换算 mV。串口每约 250 ms报告一次，不是每个 DMA 事件都发送；这能避免通信把处理任务拖住。

## 预期输入输出

| 条件 | 预期 |
| --- | --- |
| 1.100 V稳定输入 | 约 1100 mV，half/full 增长 |
| 改为 2.200 V | 新批次约 2200 mV，心跳继续 |
| 0 V或 3.3 V | 约 0 或 3300 mV，无负数和溢出 |

当前模型默认每 1 ms 一个样本，半满、满缓冲约为 32、64 ms。实机按 1 MHz ADC 时钟、252 周期计算，64 次理论约 16.128 ms；不能用仿真帧率衡量硬件加速倍数。

## 故障排查

**计数不变**：沿 ADC、DMA 句柄关联、NVIC、IRQ、HAL 回调逐段检查。

**偶发读数不一致**：检查是否在置标志后先做长延时或刷新屏幕；应及时处理或复制缓冲区，再执行耗时任务。

## 练习

1. 把总长度改为 128、半区改为 64，预测事件间隔后验证。
2. 为第二半区增加最大值、最小值，比较它们与均值。
3. 故意增加主循环耗时，记录处理批次是否跳号，提出快照或双缓冲方案。
