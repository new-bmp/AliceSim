# 按键消抖、短按与长按

## 实验目标与打开工程

按住亮绿灯，短按松开计一次，长按超过 1 秒清零，长按松开不会多计一次。红灯表示计数奇偶，串口显示准确数值。先学习按键电平，再读状态机，最后结合 [外部中断 EXTI](exti.md) 理解通知机制。

打开 [Learning10_ButtonEXTI 完整工程](../projects/Learning10_ButtonEXTI.alice.json)，或将 `examples/Learning10_ButtonEXTI` 完整文件夹导入 AliceSIM。关键代码在 [main.c](../examples/Learning10_ButtonEXTI/Core/Src/main.c)。构建后运行，展开串口选择 USART2。开关的双击操作会保持闭合，需要再次双击松开。

## 接线与 CubeMX 设置

| 对象 | 设置与接线 |
| --- | --- |
| PA1 / BUTTON | GPIO_EXTI1，Rising/Falling 双边沿，Pull-up；10 kΩ 接 3.3 V，按钮另一端接地 |
| PB12 / PRESS_LED | 推挽输出、初始 Low，经 330 Ω 接绿灯阳极，阴极接地 |
| PB13 / COUNT_LED | 推挽输出、初始 Low，经 330 Ω 接红灯阳极，阴极接地 |
| USART2 | PA2 TX、PA3 RX，115200、8N1 |
| NVIC | EXTI line1 interrupt Enable，优先级 2/0 |
| RCC | 内部 HSI 8 MHz，PLL 关闭，所有总线 /1，无外部晶振 |

按钮断开时，PA1 被上拉为高电平 1；闭合接地时读到低电平 0，称为低有效。上拉给断开状态一个确定电平，消抖处理的是触点反复通断，两者解决不同问题。

## 从轮询到稳定状态

直接在 `HAL_GPIO_ReadPin(...) == GPIO_PIN_RESET` 时执行 `press_count++`，会在每圈都增加，按住 1 秒可能计上百次。即使只判断电平变化，实物触点在数毫秒内反复通断也可能产生多个边沿。

本例区分三个值：原始电平 `raw_state`、正在等待确认的 `candidate_state`、已经确认的 `stable_state`。原始电平变化就重新开始计时，持续稳定 30 ms 才更新确认状态：

```c
if (raw_state != candidate_state) {
  candidate_state = raw_state;
  candidate_since = HAL_GetTick();
}
now = HAL_GetTick();
if (candidate_state != stable_state &&
    (uint32_t)(now - candidate_since) >= DEBOUNCE_MS) {
  stable_state = candidate_state;
  /* 在这里分别处理确认按下和确认松开。 */
}
```

完整工程还在 EXTI 通知到达后重启窗口，并保留每圈电平采样。中断提供变化通知，消抖状态机决定动作；中断并不会自动滤除机械抖动。每圈末尾仅等待 1 ms，稳定窗口期间主循环仍能处理别的工作。

`now - candidate_since` 使用无符号差值，跨越 HAL 毫秒计数回绕仍能判断本例的短时间间隔。不要改成 `now >= candidate_since + 30`。前者也要求间隔合理短，并不是无限时间的绝对时钟。

## 一次按下和松开如何组成动作

确认低电平后记下 `press_started` 并点亮绿灯。若在确认保持按下满 1000 ms 前松开，则执行短按计数；若达到长按门限，立即清零并设 `long_handled=1`。后续仍按住不再清零，确认松开时也不计短按。

```c
if (pressed && !long_handled &&
    (uint32_t)(now - press_started) >= LONG_PRESS_MS) {
  long_handled = 1U;
  press_count = 0U;
  /* 关计数灯，输出 LONG RESET。 */
}
```

这里“长按 1 秒”从消抖确认按下时开始，不是从第一次触点接通开始。短按在确认松开后计数，所以等待中的按住不会先增加、再被长按清除。

## 实际观察与消抖验证

| 操作 | 绿灯 | 计数与串口 |
| --- | --- | --- |
| 初始断开 | 灭 | count=0 |
| 闭合稳定超过 30 ms | 亮 | `PRESS`，仍不增加计数 |
| 在 1 秒内松开且稳定 30 ms | 灭 | `SHORT count=1`，红灯亮 |
| 再完成一次短按 | 灭 | `SHORT count=2`，红灯灭 |
| 持续确认按下超过 1 秒 | 亮 | 一次 `LONG RESET count=0` |
| 长按后松开 | 灭 | `RELEASE after long`，计数仍为 0 |

AliceSIM 的按钮模型不自动制造机械抖动。界面实验验证交互流程，工程内 `verify.cjs` 额外主动注入 5 ms 通断序列，核对确认前不动作、短按只计一次、10 ms 干扰被忽略，以及长按释放不多计。验证使用真实电路输入、EXTI 回调、LED 网络和串口，不以“没有看到重复输出”代替受控抖动测试。

## 常见故障与练习

**闭合后仍读高**：核对按钮两端分别接 PA1 和 GND，所有地相连，外部上拉接 3.3 V。按钮两脚接在同一网络不会改变输入。

**一次按住持续计数**：把动作放到确认状态变化处。若只检测电平为低，每圈都会重复执行；若只做边沿检测而没有稳定窗口，实物仍可能重复。

**长按松开又加一**：检查 `long_handled` 是否只在新一轮确认按下时清零，松开分支是否检查它。

1. 将 `DEBOUNCE_MS` 改为 50，预测短脉冲的处理结果，并同步更新验证门限。
2. 增加第二个按钮，只用轮询实现相同状态机，比较两种触发方式。
3. 为 count=5 加一种提示；保证长按清零仍只发生一次。继续阅读 [EXTI 与 NVIC](exti.md)。
