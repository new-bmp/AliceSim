# 学习 07：第一个闪灯程序

本例仅用一个输出引脚和一条 LED 支路。PB12 由低电平开始，进入主循环后点亮绿灯，名义每 500 ms 翻转一次，亮灭一轮约 1 s。HSI 内部振荡器提供 8 MHz 系统时钟，不要求外部晶振。

## 打开与观察

1. 在 AliceSIM 中打开整个 `Learning07_Blink` 文件夹，或打开教程下载的完整工程包。
2. 若电路没有随工程打开，导入 `Learning07_Blink.alice-sch.json`。
3. 构建并运行，观察一只绿灯亮 0.5 s、灭 0.5 s。
4. 在逻辑分析仪观察 PB12，比较高、低电平保持时间。停止、重新构建、再运行可以重新观察启动过程。

## CubeMX 配置与接线

| 配置项 | 本例设置 |
| --- | --- |
| MCU | STM32F103C8T6，LQFP48 |
| RCC | HSI On、HSE Disable、PLL Off |
| 时钟树 | SYSCLK/HCLK/PCLK1/PCLK2 全为 8 MHz，所有总线不分频 |
| PB12 | GPIO_Output、Output Push Pull、No Pull、Low speed，初始 Low，标签 GREEN_LED |
| SYS | Debug = Serial Wire，保留 PA13/SWDIO、PA14/SWCLK |
| 时间基准 | SysTick，1 ms |

接线为 PB12 → 330 Ω → 绿 LED 阳极 A；LED 阴极 K → GND。MCU VDD 接 3.3 V，VSS 接同一 GND。灯不能直接跨接 GPIO 与 GND而省略限流电阻。电路中的电源符号代表仿真电源；实物还需按芯片手册连接全部电源、去耦、复位和 BOOT 引脚。

## 从代码找到现象

`Core/Src/main.c` 中依次调用 `HAL_Init()`、`SystemClock_Config()`、`MX_GPIO_Init()`，随后进入 `while (1)`。`HAL_GPIO_TogglePin` 翻转 PB12，`HAL_Delay(500U)` 等待后再执行下一轮。`Core/Inc/main.h` 绑定标签与实际引脚；`.ioc` 记录配置；独立电路文件保存接线。

程序包含真实的 HSI 时钟初始化、GPIO 初始化、`HAL_MspInit` 与 `SysTick_Handler`，并带本例使用的 HAL 源码、CMSIS 头文件和原始许可证。若要烧录真实板，请在 CubeMX/CubeIDE 重新生成目标工程的启动文件、链接脚本和构建配置，再保留本例业务逻辑；当前目录不提供预编译 ELF。

HAL 延时单位是毫秒；实物还受 SysTick 粒度与函数开销影响。本例适合看懂顺序执行；等待期间主循环不能处理别的输入。下一步可学习教程的非阻塞计时与状态机。

## 修改与排错

- 把 500U 改成 100U，重新构建，观察每秒完整亮灭次数。
- 用两次 `HAL_GPIO_WritePin` 分别保持亮 100 ms、灭 900 ms，比较周期与亮灯占比。
- 灯一直灭时依次查运行状态、PB12 引脚、LED 极性、330 Ω 和公共地。
- 程序能在仿真运行不等于已经验证实物电源、电流或下载连接。

## 复验

在仓库根目录执行：

```powershell
.venv/Scripts/python.exe examples/Learning07_Blink/verify.py --clang
node examples/Learning07_Blink/verify.cjs
```

第一项检查模型与真实 HAL/CMSIS 下的全部 13 个 C 源文件；第二项实际导入电路，并检查 LED 在 0、499、500、1000 ms 的亮灭。
