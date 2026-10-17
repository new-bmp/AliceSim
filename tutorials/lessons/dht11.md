# DHT11 温湿度采集

## 能观察到什么

DHT11 把环境温度和相对湿度送给单片机，程序再决定怎样显示。本文与 TM1637 教程共用 [Learning03_Climate 完整工程](../projects/Learning03_Climate.alice.json)，它还包含数码管、串口和高温灯，并非独立的纯传感器工程。

![DHT11 环境输入与显示电路](../assets/lesson-climate-normal.png)

## 打开并读取一次

打开完整工程，构建、运行，等待仿真时间超过约 1.1 秒。展开虚拟串口，选择 USART2，核对 115200、8N1，应先后看到 `TEMP=25.0 C` 和 `HUM=50.0 %RH`。数码管交替显示 25 和 50，冒号分别为灭、亮。

双击 DHT11，在属性中将温度设为 31、湿度设为 72并应用。等待下一轮读取，串口应变为 31.0与 72.0，PB12 红灯亮。每轮成功读取后，两种显示各停留约一秒，所以不会在属性修改瞬间更新。

## 接线和 CubeMX

| 项目 | 本工程设置 |
| --- | --- |
| DATA | PB0，外接 4.7 kΩ 上拉到 3.3 V |
| 电源 | VCC 接 3.3 V，GND 接公共地 |
| GPIO | PB0 初始推挽输出、高电平、上拉 |
| 时钟 | HSI 8 MHz，驱动使用微秒计时函数 |
| 核对输出 | USART2 PA2 / PA3，115200、8N1 |

DATA 不是始终只读的输入。驱动先输出启动信号，再切成输入接收脉冲；外部上拉帮助线路保持空闲高电平。不要把所有微秒等待直接替换成毫秒延时。

## 状态与数值分开处理

[main.c](../examples/Learning03_Climate/Core/Src/main.c) 中初始化绑定端口、引脚和计时函数。

```c
AliceSIM_DHT11_Init(&climate, GPIOB, GPIO_PIN_0,
                   Timing_DelayUs, Timing_Micros);
HAL_Delay(1100);
```

读取函数返回操作状态，通过指针写入结构体。以下片段只在成功时使用新温度控制灯，完整工程另有失败分支。

```c
climate_status = AliceSIM_DHT11_Read(
    &climate, &climate_sample);
if (climate_status == ALICESIM_DHT11_OK)
{
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12,
      climate_sample.temperature_x10 >= 300
      ? GPIO_PIN_SET : GPIO_PIN_RESET);
}
```

`temperature_x10` 是有符号温度乘十，253表示 25.3 °C；`humidity_x10` 是相对湿度乘十。300表示 30.0 °C，不能误写成 30。驱动限制两次读取至少间隔 1000 ms，也会报告超时和校验错误。

## 测试与排错

依次输入 29.9、30.0、30.1 °C，等待新串口记录后看灯，预期为灭、亮、亮。停止并另存副本，断开 DATA 再构建运行，预期为 `DHT11 ERROR` 且数码管清空，不继续把旧值当作新测量。

一直超时先查 VCC、GND、PB0 与上拉；出现读取过早先查调用间隔。仿真允许小数和更宽环境输入用于边界练习，不表示真实 DHT11 具有同等精度或量程，实物规格需要查手册。

## 动手修改

把告警线改为 28.0 °C，测试 27.9 / 28.0 / 28.1；增加成功样本的最高温统计；再增加高湿独立灯。修改时保留状态判断，并说明错误读取是否应更新统计。
