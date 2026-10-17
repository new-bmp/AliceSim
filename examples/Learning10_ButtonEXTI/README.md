# Learning10_ButtonEXTI — 按键消抖、短按/长按与 EXTI

STM32F103C8T6 使用内部 HSI 8 MHz，无外部晶振。低有效按键稳定 30 ms 后确认状态：短按在松开后计数一次；稳定按住 1000 ms 清零一次，之后松开不再计数。绿灯表示确认按下，红灯表示计数奇偶，USART2 输出动作与数值。

## 打开与操作

在 AliceSIM 中导入此完整文件夹，打开 `Learning10_ButtonEXTI.ioc`。导入同目录 `.alice-sch.json` 电路，构建后运行；展开串口面板选择 USART2。教程发布包也提供完整 `.alice.json` 工程。

1. 双击 `SW_BUTTON` 闭合，保持约 0.2 秒。绿灯亮，串口出现 `PRESS`。
2. 再次双击松开，30 ms 后出现 `SHORT count=1`，绿灯灭、红灯亮。
3. 再做一次短按，串口为 `SHORT count=2`，红灯灭。
4. 闭合并保持超过 1 秒，出现一次 `LONG RESET count=0`；继续保持不重复输出。松开只输出 `RELEASE after long`。

界面中的开关为保持式交互，需要第二次双击松开。AliceSIM 不会自动产生机械抖动；验证脚本主动注入 5 ms 交替电平和 10 ms 干扰，不能把一次干净点击称为已验证消抖。

## 接线与 CubeMX

| 对象 | 设置/接线 |
| --- | --- |
| PA1 | GPIO_EXTI1，上升沿和下降沿，Pull-up；10 kΩ 上拉至 3.3 V，按键另一端接地 |
| PB12 | 推挽输出，初始 Low；330 Ω → 绿 LED 阳极，阴极接地 |
| PB13 | 推挽输出，初始 Low；330 Ω → 红 LED 阳极，阴极接地 |
| USART2 | PA2 TX、PA3 RX，115200 baud、8N1；外接接收器时 TX 接对方 RX，并共地 |
| NVIC | EXTI line1 interrupt 使能，抢占优先级 2、子优先级 0 |
| 时钟 | RCC HSI On，PLL 不启用，SYSCLK/HCLK/PCLK1/PCLK2 均为 8 MHz |

## 程序结构

`main.h` 定义引脚，`main.c` 包含完整初始化、状态机、中断入口和回调。`EXTI1_IRQHandler` 调用 `HAL_GPIO_EXTI_IRQHandler` 清除挂起位并进入 HAL 回调。回调只写 `edge_tick`、`edge_pending`；主循环读取电平、等待稳定时间、区分按下与松开，再处理 LED 和串口。

每次通知重新开始稳定窗口，主循环也轮询电平作为兜底；用毫秒差值判断，不用 `HAL_Delay(30)` 阻塞消抖。`volatile` 保证共享值被实际读写，但不等于锁。此例两个字段不是严格同步的快照，`last_edge_seen` 仅作观察，消抖窗口从主循环处理通知时开始，避免依赖一对可能更新中的共享值。

短按动作在确认松开时执行，长按动作在确认按住满 1000 ms 时执行。`long_handled` 把同一次长按标记为已处理，阻止持续复位以及松开时再增加一次计数。

## 验证与练习

从仓库根目录执行，`node` 使用可用的 Node.js 运行时：

```powershell
.venv/Scripts/python.exe examples/Learning10_ButtonEXTI/verify.py --clang
.venv/Scripts/python.exe examples/Learning10_ButtonEXTI/verify.py --model
node examples/Learning10_ButtonEXTI/verify.cjs
```

脚本导入真实电路和解析模型，核对低有效接线、18 个受控边沿、30 ms 稳定门限、两次短按、长按只清零一次、松开不重复计数、后续短按可用，以及实际 LED 电路和串口输出。`--clang` 检查工程全部 C 文件；附带 ST 源码可能保留上游警告。

练习：将门限改为 50 ms，并同步修改验证预期；给 500 ms～1000 ms 增加“中按”事件；取消 EXTI 通知，比较轮询仍可工作与中断观察记录的变化。

配套教程：打开 AliceSIM 的教程页，搜索《按键消抖与长按》和《EXTI 外部中断与 NVIC》。单独下载的 ZIP 包不包含教材页面。HAL/CMSIS 依赖与许可证复制自现有学习工程，许可证保留在 `Drivers` 内。
