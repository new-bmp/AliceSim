# 外部中断 EXTI 与 NVIC

## 中断能告诉程序什么

轮询是主循环主动读输入；EXTI 是指定引脚出现边沿时发出中断请求。二者都能处理按键，但 EXTI 不等于“按了一次”：一次机械按键动作可能包含许多上升沿、下降沿，消抖仍要由应用逻辑决定。

本课继续使用 [Learning10_ButtonEXTI 完整工程](../projects/Learning10_ButtonEXTI.alice.json) 和 [main.c](../examples/Learning10_ButtonEXTI/Core/Src/main.c)，先完成 [按键消抖](button-debounce.md) 的接线与短按/长按实验。本课观察中断如何把通知交给主循环。

## 接线、EXTI 线路与 CubeMX

| 项目 | 本例配置 |
| --- | --- |
| PA1 | Pull-up，按钮接地；10 kΩ 外部上拉至 3.3 V，闭合为 0 |
| EXTI | GPIO_EXTI1，Rising/Falling 双边沿；PA1 的引脚编号映射到 EXTI1 |
| NVIC | 使能 EXTI line1 interrupt，抢占优先级 2、子优先级 0 |
| 输出 | PB12 经 330 Ω 接绿灯，PB13 经 330 Ω 接红灯，阴极接地 |
| 串口 | USART2 PA2/PA3，115200、8N1 |
| 时钟电源 | HSI 8 MHz，无 PLL/外部晶振；3.3 V、共地 |

STM32F103 的 EXTI0～15 对应引脚号。PA1、PB1 等共享 EXTI1 的选择资源，不能同时独立映射到同一条 EXTI1。EXTI5～9 共用一个 NVIC 入口，EXTI10～15 共用另一个，换引脚不能只改宏名。

GPIO 的边沿配置、EXTI 映射、NVIC 使能、中断处理函数都需要匹配。数值较小的抢占优先级通常更高；优先级含义还与分组有关。本例沿用 HAL 初始化的默认分组，不需要改动 SysTick 优先级。

## 中断入口和 HAL 回调

本例先启用 AFIO/GPIO 时钟，配置双边沿输入，再设置和使能 NVIC。真实芯片的调用路径是引脚边沿 → EXTI 挂起 → NVIC → 中断入口 → HAL 回调：

```c
void EXTI1_IRQHandler(void) {
  HAL_GPIO_EXTI_IRQHandler(BUTTON_Pin);
}

void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin) {
  if (GPIO_Pin == BUTTON_Pin) {
    edge_tick = HAL_GetTick();
    edge_pending = 1U;
  }
}
```

`HAL_GPIO_EXTI_IRQHandler` 处理挂起位并调用用户回调。不要在真实工程里只写回调却漏掉入口，或在入口中忘记调用 HAL 处理函数。参数 `GPIO_Pin` 是掩码，PA1 对应 `GPIO_PIN_1`，不是数字 1。

AliceSIM 根据解析出的引脚边沿配置触发 HAL 回调，可验证固件响应和电路交互；这不等同于对真实芯片中断延迟、嵌套优先级和电气噪声的周期精确模拟。实物工程仍需正确的启动向量表与上述 NVIC/入口配置。

## 为什么回调必须短

中断里只记录边沿时间和“有变化”的通知。主循环读取实际输入，确认稳定 30 ms，再做 LED、短按计数、长按清零和 UART 输出。不要在回调中 `HAL_Delay(30)` 消抖或调用耗时打印；延时依赖 SysTick 的情况下还可能因优先级而卡住。

```c
volatile uint32_t edge_pending = 0U;
volatile uint32_t edge_tick = 0U;
/* 主循环中： */
if (edge_pending != 0U) {
  edge_pending = 0U;
  raw_state = HAL_GPIO_ReadPin(BUTTON_GPIO_Port, BUTTON_Pin);
  candidate_state = raw_state;
  last_edge_seen = edge_tick;
  candidate_since = HAL_GetTick();
}
```

`volatile` 告诉编译器这些值可能被异步修改，应实际进行读写；它不保证多条读写成为不可打断的事务。此例允许多个边沿合并为“输入有变化”，并重新采样当前电平，所以通知标志足够。`last_edge_seen` 仅用于观察，不与其他共享字段组成严格时间快照；稳定窗口以主循环处理通知的时间为准。必须精确统计每个事件时，可使用单写者累计计数，参见 [定时器中断](timer-irq.md)。

## 观察、故障和练习

短按只产生 `PRESS` 和一次 `SHORT count=...`，长按只有一次清零。一次动作的原始边沿数与确认动作数可以不同；工程验证主动注入 18 个受控边沿，逐次核对回调确实置位通知，最后确认抖动没有造成额外短按。

**轮询能读到按键，但回调不进**：检查 `.ioc` 是否为 EXTI 而非 GPIO Input、HAL 模式是否双边沿、NVIC 是否使能、入口名称是否匹配 EXTI1。真实板上还要查 AFIO 映射和向量表。

**只有按下有通知**：只配置 Falling 会在低有效按下时触发，松开的 Rising 不触发。本例需要双边沿，主循环保留轮询也不代表配置正确；验证会检查真实回调通知。

**在回调里延时后程序卡住**：先移除回调内等待和 UART 操作，将它们交还主循环；不要用提高所有中断优先级掩盖结构问题。

1. 临时改为 Falling，预测松开边沿的中断记录，再恢复双边沿。
2. 在回调中增加累计边沿数，在主循环打印，比较抖动边沿数与短按次数。
3. 把按键迁移到 PB0，写出需要更改的 GPIO 时钟、EXTI 映射、NVIC 入口和导线清单，再验证。
