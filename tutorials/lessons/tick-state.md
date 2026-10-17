# 非阻塞计时与状态机

## 两盏灯有两条自己的时间线

运行 [Learning09_TickTasks 完整工程](../projects/Learning09_TickTasks.alice.json)。绿灯始终每 250 ms 翻转一次，完整亮灭约 500 ms；红灯在开关 ON 时立即亮起，此后每 700 ms 翻转，OFF 时立即熄灭。两个周期互不等待。源码在 [main.c](../examples/Learning09_TickTasks/Core/Src/main.c)。

先在开关 OFF 时观察绿灯，再双击 SW_RUN 置 ON。红灯开始后在它的 700 ms 等待期内切回 OFF，观察它很快熄灭，绿灯继续自己的节奏。这里的“很快”指一个短轮询周期，而不是等满整段闪灯时间。

## CubeMX 与实际接线

MCU 选 STM32F103C8T6。PB12、PB13 设为 GPIO_Output、Output Push Pull、No Pull、Low speed，初始 Low；PA1 设为 GPIO_Input、Pull-up。标签分别是 GREEN_LED、RED_LED、RUN_SWITCH。

RCC 选择 HSI 8 MHz，HSE Disable、PLL Off，SYSCLK/HCLK/PCLK1/PCLK2 全为 8 MHz。SYS Debug 设 Serial Wire、保留 PA13/PA14；时间基准选 SysTick。不要从 72 MHz 工程中只复制一部分时钟初始化。

接线为 PB12 → 330 Ω → 绿 LED 阳极；PB13 → 另一个 330 Ω → 红 LED 阳极。两灯阴极接 GND，MCU VDD 接 3.3 V，VSS 共地。PA1 经 10 kΩ 上拉到 3.3 V，开关闭合时将 PA1 接地。程序中的低电平表示 ON，开路时上拉为 OFF。外部上拉让接线可见，配置中的内部上拉也保留。

## 为什么长延时会拖住所有任务

如果主循环先翻转绿灯、HAL_Delay(250U)，再翻转红灯、HAL_Delay(700U)，一轮已经等待约 950 ms。两盏灯就被绑在相同的循环上，开关也只能等到读输入的语句再次执行。

本例在每轮只读取一次当前时间，分别检查两个时间差：

```c
now = HAL_GetTick();
elapsed_green = now - last_green;
elapsed_red = now - last_red;
if (elapsed_green >= 250U)
{
  last_green = now;
  HAL_GPIO_TogglePin(GREEN_LED_GPIO_Port, GREEN_LED_Pin);
}
```

now、last_green、elapsed_green 都是 uint32_t，单位毫秒。条件未到就立刻继续执行其他语句；到了才更新绿灯的时间戳并翻转。红灯使用自己的 last_red 与 700U。共享一个 last 会让一个任务更新时影响另一个任务。

代码用 last = now，表示从这次实际执行时刻重新计时，循环较慢时会产生相位漂移，也不会补做错过的次数。固定节拍可以考虑 last += period，并明确延误时是追赶还是跳过；本课先保证简单、可观察的行为。

## 状态机把“任务运行”与“灯亮”分开

run_state 只有 STOPPED 和 RUNNING 两种状态：

| 当前状态 | 读到的开关 | 本轮动作 |
| --- | --- | --- |
| STOPPED | ON，低电平 | 进入 RUNNING，点亮红灯，last_red = now |
| RUNNING | ON，低电平 | 到 700 ms 时翻转红灯 |
| RUNNING | OFF，高电平 | 进入 STOPPED，关红灯 |
| STOPPED | OFF，高电平 | 保持关闭 |

RUNNING 不意味着红灯一直亮，它表示红灯的定时任务正在工作。切入 RUNNING 时只初始化一次红灯相位，后面靠时间差控制。

```c
if (switch_level == GPIO_PIN_RESET && run_state == STOPPED)
{
  run_state = RUNNING;
  last_red = now;
  HAL_GPIO_WritePin(RED_LED_GPIO_Port, RED_LED_Pin, GPIO_PIN_SET);
}
```

若只判断开关为低就每轮执行这些语句，last_red 会不断被刷新，时间差始终接近 0，红灯反而不闪。状态转换条件就是为了识别“刚进入运行”，而不是重复执行启动动作。

## uint32_t 差值怎样跨过回绕

HAL 的 32 位毫秒计数约 49.7 天从 4294967295 回到 0。直接比较 now >= last + period 时，右侧可能先回绕，导致提前触发。应计算无符号差：

```c
uint32_t elapsed;
elapsed = now - last;   /* 结果按模 2^32 保存 */
if (elapsed >= period) { /* 到期 */ }
```

例如 last = 4294967200，过了 250 ms 后 now = 154，uint32_t 的差仍然是 250。关键是变量和差值都保持无符号 32 位，不要改成 int，也不要把所有回绕都当成“时间变小、必须重置”。

这种判断要求实际检查间隔不跨越整整一轮 2^32 ms，否则无法知道经过了几轮。本例连续轮询、周期只有几百毫秒，满足这个条件。配套运行检查直接把执行时间放在回绕前 96 ms，再跨过边界验证绿灯不会提前触发，并在差值达到 250 ms 时正确翻转。

## 本例保留的短等待与适用范围

循环末尾仍有 HAL_Delay(1U)，作为名义 1 ms 的轮询间隔。250/700 ms 的周期等待已经由时间比较完成，但主循环不是完全零阻塞。模型中每毫秒采样一次；实物还包含 SysTick 粒度、HAL 的等待保护余量和语句执行时间，不能承诺物理按键总在 1 ms 内响应。

本例使用理想开关电平，没有模拟机械触点抖动，也没有识别长按或单次按下事件。真按键可能产生多个边沿，应继续学习 [按键消抖与长按](button-debounce.md)。短中断通知主循环的方案见 [EXTI 外部中断与 NVIC](exti.md)。

## 观察、排错与练习

1. 把绿灯翻转间隔改成 100U，红灯保持 700U；验证只改变一条时间线。
2. 暂时把循环末尾改成 HAL_Delay(700U)，比较开关响应及绿灯波形，再恢复 1U。
3. 给 STOPPED 状态定义一个不依赖红灯定时器的行为，先写出状态转换表，再实现。
4. 红灯一直亮时，检查 last_red 是否每轮被重置；两灯互相影响时，检查是否误用了同一时间戳。
5. 改完后重新构建，再检查开关 OFF → ON → OFF。不要用串口输出很多行来掩盖状态错误，打印本身也可能改变实物执行时间。
