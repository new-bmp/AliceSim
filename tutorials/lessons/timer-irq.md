# 定时器中断与主循环协作

## 实验效果与工程

绿灯每 100 ms 翻转，红灯每 250 ms 翻转；串口每次定时器事件输出 `TICK` 计数和已经完成的 `WORK` 次数。定时器回调只积累事件，主循环同时完成 LED、打印和独立任务。

打开 [Learning11_TimerIRQ 完整工程](../projects/Learning11_TimerIRQ.alice.json)，或导入完整 `examples/Learning11_TimerIRQ` 文件夹与同名电路。构建后运行，底部串口选择 USART2。完整代码见 [main.c](../examples/Learning11_TimerIRQ/Core/Src/main.c)。先了解 [EXTI 中断与 NVIC](exti.md) 有助于理解入口和回调的区别。

## 接线和 CubeMX 设置

| 对象 | 配置/接线 |
| --- | --- |
| PB12 | GPIO Output、推挽、初始 Low；330 Ω → 绿 LED 阳极，阴极接地 |
| PB13 | GPIO Output、推挽、初始 Low；330 Ω → 红 LED 阳极，阴极接地 |
| USART2 | PA2 TX、PA3 RX，115200、8N1 |
| TIM2 | Internal Clock，Up，Prescaler=7999，Counter Period=99，Clock Division=DIV1 |
| NVIC | TIM2 global interrupt Enable，优先级 2/0 |
| RCC | HSI 8 MHz、PLL 关闭，AHB /1、APB1 /2、APB2 /1，无外部晶振 |

MCU 供电 3.3 V，所有地相连。TIM2 只用内部计数和更新中断，不需要接一个 TIM2_CHx 输出脚。本例的 LED 是主循环收到事件后用普通 GPIO 翻转。

## 从定时器时钟到更新周期

先确定时钟，再选 PSC 和 ARR。STM32F103 的 TIM2 在 APB1：当 APB1 预分频为 1，定时器时钟等于 PCLK1；当预分频不为 1，定时器时钟等于 2×PCLK1。本例 HCLK=8 MHz，APB1 /2 得到 PCLK1=4 MHz，所以 TIM2 内核仍为 8 MHz，不能直接用 4 MHz 计算。

```text
计数器频率 f_CNT = f_TIM / (PSC+1)
                = 8,000,000 / 8000 = 1000 Hz
更新频率 f_update = f_CNT / (ARR+1)
                 = 1000 / 100 = 10 Hz
更新周期 T_update = 100 ms
```

PSC、ARR 都从 0 开始，因此要加 1。计数器从 0 数到 99，包含 100 个计数；不要把 ARR=100 当作刚好 100 ms。`Clock Division` 的 CKD 设置主要影响数字滤波/死区等采样时钟，不是更新周期公式中的另一个预分频器。

TIM1 在 APB2，换用 TIM1 时应重新检查 PCLK2 和 APB2 分频，不能照搬 APB1 数值。本例有意使用 APB1 /2，便于直接验证“PCLK 减半但定时器内核倍频”的规则。

## 开启、入口、回调与主循环

初始化参数后使能 NVIC，使用带 `_IT` 的启动函数。仅调用 `HAL_TIM_Base_Start` 会让计数器运行，但不启用更新中断。

```c
htim2.Instance = TIM2;
htim2.Init.Prescaler = 7999U;
htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
htim2.Init.Period = 99U;
HAL_TIM_Base_Init(&htim2);
HAL_NVIC_SetPriority(TIM2_IRQn, 2U, 0U);
HAL_NVIC_EnableIRQ(TIM2_IRQn);
HAL_TIM_Base_Start_IT(&htim2);

void TIM2_IRQHandler(void) { HAL_TIM_IRQHandler(&htim2); }
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
  if (htim->Instance == TIM2) timer_ticks++;
}
```

完整工程检查 HAL 返回值。ISR 只写 `volatile uint32_t timer_ticks`；主循环读取快照并逐个处理，避免布尔标志把两次事件合并为一次：

```c
pending_until = timer_ticks;
while (processed_ticks != pending_until) {
  processed_ticks++;
  HAL_GPIO_TogglePin(TICK_LED_GPIO_Port, TICK_LED_Pin);
  /* 主循环中打印该事件。 */
}
```

对齐的 32 位读取在 Cortex-M3 上可用单次访问完成，此例累计计数只有 ISR 写，主循环不做“读后清零”。`volatile` 不等于任意操作都原子；如果以后让主循环也修改累计计数，就要重新考虑竞争。若处理长期慢于中断产生事件的速度，积压仍会增长，计数器并不让程序无限快。

## 独立工作和 PWM 的联系

主循环另外比较 HAL 毫秒计数，每满 250 ms 增加 `work_count` 并翻转红灯。`last_work += 250` 以原计划时间推进，避免把本圈执行耗时不断加进周期；每圈末尾 `HAL_Delay(1)` 仅让出短时间，不在回调中等待。中断计数发生的时刻与主循环实际处理输出的时刻可以有延迟。

绿灯每次更新翻转一次，完整亮灭周期需要两次更新，所以 10 Hz 更新对应 5 Hz 闪烁。红灯 250 ms 翻转对应 2 Hz 闪烁。串口在 300 ms 左右可看到 `TICK=3 WORK=1`，2 秒后累计约 20 次更新和 8 次独立任务。同一毫秒到期的两个任务有处理先后，打印中的 `WORK` 可能在随后那圈才增加。

向上计数、边沿对齐 PWM 的周期也使用 `f_TIM/((PSC+1)×(ARR+1))`；CCR 控制比较点和占空比，不改变固定 PSC/ARR 的周期。PWM 通道由定时器硬件输出，不需要每周期中断来翻转 GPIO。继续阅读 [PWM 与舵机](pwm-servo.md)。中心对齐、重复计数等模式需要另算，不能直接套本页最基本模式。

## 验证、常见故障和练习

工程 `verify.cjs` 导入真实模型与电路，检查 TIM2 时钟 8 MHz、PSC/ARR 和 10 Hz；99 ms 时无更新，101 ms 时一次，1001/2001 ms 时分别 10/20 次，同时完成 4/8 次独立工作。它还检查串口和 LED 电路，并用较大的时间推进检查事件没有丢失。

**周期慢一倍**：检查是否忘记 APB 定时器倍频。不要通过随意把 ARR 减半补偿错误时钟计算。

**计数器配置正确但没有回调**：核对 `_Start_IT`、NVIC、`TIM2_IRQHandler` 是否调用 HAL 入口、回调是否误筛选了别的 `Instance`。

**串口计数正确但灯频率“减半”**：一次翻转只是半周期，完整亮灭周期需要两次翻转。也检查 LED 极性、330 Ω 电阻、PB12/PB13 接线与共地。

1. 只将 ARR 改为 199，计算更新频率和绿灯完整亮灭频率，重新构建验证。
2. 保持 100 ms 中断，将独立工作改为 400 ms，预测 2 秒内的两个计数。
3. 临时把主循环延时改为 350 ms，观察积压事件会在主循环集中处理，随后恢复 1 ms。说明为什么“没有丢计数”与“每个输出动作都准时可见”是两个要求。
