# Learning11_TimerIRQ — 定时器中断与独立主循环任务

STM32F103C8T6 使用内部 HSI 8 MHz，无外部晶振。TIM2 每 100 ms 产生一次更新中断，回调只增加计数。主循环逐个处理事件、翻转绿灯并打印；同时每 250 ms 翻转红灯，展示两个不同周期的任务。

## 打开与观察

在 AliceSIM 导入完整目录，打开 `.ioc` 并导入同名 `.alice-sch.json`，构建后运行。在底部串口面板选择 USART2，观察 `TICK=1 WORK=0`、`TICK=2 WORK=0`、`TICK=3 WORK=1` 等记录。`WORK` 是处理该中断事件时已经完成的独立工作次数，恰好同时到期时可先打印再做工作。

绿灯每 100 ms 翻转一次，所以完整亮灭周期为 200 ms，即 5 Hz；红灯每 250 ms 翻转一次，完整周期 500 ms，即 2 Hz。中断更新频率与翻转输出的完整周期频率相差两倍。

## 接线和 CubeMX

| 对象 | 配置/接线 |
| --- | --- |
| PB12 | 推挽输出，Low；330 Ω → 绿 LED 阳极，阴极接地 |
| PB13 | 推挽输出，Low；330 Ω → 红 LED 阳极，阴极接地 |
| USART2 | PA2 TX、PA3 RX，115200 baud、8N1 |
| TIM2 | Internal Clock，向上计数，PSC=7999，Counter Period/ARR=99，Clock Division=DIV1 |
| NVIC | TIM2 global interrupt 使能，抢占优先级 2、子优先级 0 |
| RCC | HSI On、PLL 不启用；HCLK=8 MHz、APB1 /2、APB2 /1 |

所有器件共地，MCU 供电为 3.3 V。TIM2 使用内部时钟不需要外接时钟输入线，也不需要配置 PWM 通道输出。

## 时钟计算与事件处理

本例 PCLK1=4 MHz，但 STM32F103 的 APB 预分频不为 1 时，该总线上定时器内核时钟为 PCLK×2，所以 TIM2 时钟仍为 8 MHz。

```text
f_update = f_TIM / ((PSC+1) × (ARR+1))
         = 8,000,000 / (8000 × 100) = 10 Hz
T_update = 100 ms
```

`TIM_CLOCKDIVISION_DIV1` 不是这里 PSC 的另一个分频器；它关联数字滤波/死区等使用的采样时钟，不能拿来再除更新频率。TIM2 位于 APB1，TIM1 位于 APB2，换定时器时须重新核对总线。

`TIM2_IRQHandler` 调用 `HAL_TIM_IRQHandler`，然后进入 `HAL_TIM_PeriodElapsedCallback`。回调只累加 `volatile uint32_t timer_ticks`，主循环读取一次快照，比较 `processed_ticks`，逐个消费事件。单个布尔标志可能把两次中断合并为一次，计数器可以保留积压事件。对齐的 32 位读取在 Cortex-M3 上是单次访问；本例只有中断写累计计数，主循环从不清零它。

## 验证与练习

从仓库根目录执行：

```powershell
.venv/Scripts/python.exe tutorials/examples/Learning11_TimerIRQ/verify.py --clang
.venv/Scripts/python.exe tutorials/examples/Learning11_TimerIRQ/verify.py --model
node tutorials/examples/Learning11_TimerIRQ/verify.cjs
```

脚本核对真实解析模型的 APB 倍频、PSC/ARR 与 10 Hz；99 ms 时尚无更新，约 101 ms 时一次，1001/2001 ms 时分别累计 10/20 次。主循环同时完成 4/8 次独立工作，且真实 LED 电路与 UART 输出吻合。大步推进也不会丢失计数。Clang 会检查附带 HAL/CMSIS 的全部 C 源文件，可能显示 ST 上游警告。

练习：只把 ARR 改成 199，使更新为 5 Hz，预测绿灯完整闪烁频率；将独立工作改为 400 ms；临时给主循环增加 350 ms 延时，观察事件累计与显示的延迟，随后恢复 1 ms。延时实验可能让 LED 短时间连续翻转，计数保留并不意味着每个可见动作都能准时完成。

配套教程：打开 AliceSIM 的教程页，搜索《定时器基础与更新中断》和《PWM 控制舵机》。单独下载的 ZIP 包不包含教材页面。HAL/CMSIS 依赖及其许可证复制自现有工程并保留在 `Drivers` 目录。


## 教程内副本与开发复验

本目录由 `scripts/sync-tutorial-examples.mjs` 从原例程同步。固件、IOC、库与许可证保持原样；开发辅助脚本会向上寻找 AliceSIM 平台根目录。上文复验命令请在 AliceSIM 仓库根目录执行。

独立下载 ZIP 可以直接导入同名 `.alice.json`，正常学习不依赖 Node.js 或这些复验脚本。若要离线做开发复验，请把完整工程目录放入配套平台源码的 `tutorials/examples/` 后执行；也可设置 `ALICESIM_ROOT` 指向平台源码根、`ALICESIM_PYTHON` 指向 Python 3.10+。Clang 复验还需先完成平台依赖准备。
