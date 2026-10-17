# UART 接收：用文本命令控制 LED

## 实验目标与入口

运行 本目录的 IOC 与同名 .alice-sch.json，在底部“串口”发送 `LED ON`、`LED OFF` 或 `STATUS`，让真正的接收回调把字节交给主循环。观察 PB12 LED 和回复一起改变。Core/Src/main.c 使用固定容量缓冲，不依赖动态内存，也不把“点击发送”当作一条协议消息。

构建后选择 USART2，面板应显示来自 IOC 的 115200 baud、8N1。输入 `LED ON`，把“行结尾”选为 LF 或 CRLF，再点击“发送”。不需要“实体串口”或电脑端口授权。仿真工作区底部的输入框有行结尾选择；另一处简易输入框默认不添加换行。

## CubeMX 配置与接线

| 配置项 | 本例设置 |
| --- | --- |
| MCU / 时钟 | STM32F103C8T6，HSI 8 MHz，PLL 关闭，APB1/2 不分频 |
| USART2 | Asynchronous，115200，8 位数据，无校验，1 位停止位 |
| PA2 / PA3 | USART2_TX / USART2_RX |
| NVIC | 使能 USART2 global interrupt，优先级 1 |
| PB12 | GPIO_Output，推挽，初始 LOW |

PB12 → 330 Ω 电阻 → LED 阳极 A；LED 阴极 K → GND。保存的电路包含 MCU 电源和共地。这里 LED 是高电平点亮，不能照抄 Blue Pill 板载 PC13 LED 的低电平逻辑。

真板若连接 USB 转串口，应使用 3.3 V 逻辑，适配器 TX → PA3、RX → PA2，并共地。虚拟输入直接送入所选 USART 的 RX，不必为虚拟串口再接一块模块。

在 CubeMX 生成 STM32CubeIDE 工程时保留本例的 `main.c`、`main.h`、HAL 配置；将项目内的 `USART2_IRQHandler` 和 `SysTick_Handler` 合并到生成的中断文件，每个处理函数只能定义一次。包内附带 HAL/CMSIS 源码和许可证；启动文件、链接脚本由目标工具链按芯片生成。

## 字节流怎样变成命令

UART 只提供有序字节，不提供“消息边界”。`LED ` 与 `ON\n` 可以分两次到达；一次到达 `LED ON\nSTATUS\n` 也应处理成两条命令。

`HAL_UART_Receive_IT(&huart2, &rx_byte, 1U)` 每次接收一个字节。接收完成后，`HAL_UART_RxCpltCallback` 只把它放进 128 字节环形队列，再立即启动下一次接收。ISR 不发送串口、不比较字符串、不等待整行；`USART2_IRQHandler` 调用 `HAL_UART_IRQHandler` 才能在真板触发回调。

主循环取出队列中的字节，遇到 LF（`\n`）才执行命令，忽略 CR（`\r`），所以 LF 和 CRLF 都能用。解析器大小写敏感、空格精确匹配，只接受上面三种命令。空行忽略，其他不可打印字符（包括 NUL）使整行无效，避免将带 NUL 的前缀误当成有效命令。

`line[32]` 最多保存 31 个字符，最后一格留给 `\0`。超长行丢弃到 LF，再回复 `ERR TOO_LONG`；不会执行被截断的 `LED ON...`。环形队列溢出时回复 `ERR RX_OVERFLOW` 并清空待处理数据；如果丢失的数据尚未以 LF 结束，继续丢弃到下一个 LF，然后重新发送命令。这个简单协议没有流控，发送方应等待回复后再发下一条。

## 观察结果与拆包实验

| 输入与行结尾 | 预期结果 |
| --- | --- |
| 启动 | `READY: ... finish with LF`；LED 熄灭 |
| `LED ON` + LF | `OK LED=ON`；LED 点亮 |
| `STATUS` + CRLF | `LED=ON` |
| `LED OFF` + LF | `OK LED=OFF`；LED 熄灭 |
| `led on` + LF | `ERR UNKNOWN`；LED 保持原状 |
| `LED ON` + 无结尾 | 等待整行，不立即执行 |

拆包实验：先选择“无结尾”发送 `LED `，再发送 `ON`，LED 应仍不变；最后发送带 LF 的内容才能提交这行。若输入框不允许空文本，直接用第一段 `LED ` 无结尾、第二段 `ON` + LF 即可。

自动验证通过实际 UART 注入和电路 LED 检查：拆包、一次多条命令、CRLF、未知命令、NUL、超长行、队列溢出及恢复。它验证 HAL 事件和程序行为；实际 UART 位时序、HSI 误差和硬件中断吞吐仍需真板测量。

## 故障排查与练习

**只有 HOST → RX，没有回复**：确认正在运行，选择 USART2，并选择 LF 或 CRLF。仅 CR 不会结束本例的行。“清空”只清界面记录，不会重启固件或清掉已接收的半行。

**真板只能收到第一个字节**：检查 NVIC、IRQHandler，以及回调末尾是否重新调用 `HAL_UART_Receive_IT`。不要在回调里加 `HAL_Delay`。

**长数据后报错**：先发送一个 LF 同步边界，再发送 `STATUS`。不要放大缓冲区后就假定不会溢出；真实系统应根据最大突发量选流控或 DMA。

练习：增加 `HELP` 命令，列出可用命令；再增加 `LED TOGGLE`，保持整个字符串精确匹配。分别测试被拆开的命令、一次两条命令、空行与超长行，确认错误输入不会改变 LED。

## 在仓库中复核

在仓库根目录运行：

```powershell
.venv/Scripts/python.exe examples/Learning12_UARTCommand/verify.py --clang
node examples/Learning12_UARTCommand/verify.cjs
```

`verify.py --model` 从 IOC、全部 C/H 源码构建 AliceSIM HAL 模型；`--clang` 检查全部 C 源码。Node 验证使用仓库实际运行时和保存的电路，不靠硬编码模拟输出。单独下载的源码 ZIP 可用于导入 AliceSIM 或放入 CubeMX 生成的工程；上述自动化命令依赖本仓库验证工具。

依赖许可证保存在 `Drivers/STM32F1xx_HAL_Driver/LICENSE.txt`、`Drivers/CMSIS/LICENSE.txt`。未修改的 HAL/CMSIS 来自已有教学工程。
