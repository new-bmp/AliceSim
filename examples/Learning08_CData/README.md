# 学习 08：数据与指针驱动流水灯

三颗独立 LED 依次亮：绿 200 ms、红 200 ms、蓝 400 ms，随后回到绿。数组保存三步配置，结构体把位掩码与持续时间放在一起，指针输出参数把两个结果写回主循环。

## 运行

在 AliceSIM 打开整个 `Learning08_CData` 文件夹，确认 `Learning08_CData.alice-sch.json` 已加载，构建并运行。观察每次只亮一颗灯，蓝灯保持时间是前两颗的两倍。重新运行后顺序从绿开始。

## CubeMX 与接线

MCU 选择 STM32F103C8T6。RCC 使用 HSI 8 MHz、HSE Disable、PLL Off；SYSCLK、HCLK、PCLK1、PCLK2 均为 8 MHz。SYS Debug 选择 Serial Wire，保留 PA13/PA14。SysTick 提供 1 ms 时间基准。

PB12、PB13、PB14 都设置为 GPIO_Output、推挽、No Pull、Low speed、初始 Low，标签分别为 GREEN_LED、RED_LED、BLUE_LED。

- PB12 → 独立 330 Ω → 绿 LED 阳极。
- PB13 → 独立 330 Ω → 红 LED 阳极。
- PB14 → 独立 330 Ω → 蓝 LED 阳极。
- 三颗 LED 阴极接 GND，MCU VDD 接 3.3 V，VSS 接公共 GND。

不要用一个公共电阻代替三条支路各自的电阻。实物不同颜色 LED 的压降不同，需按实际型号核算电阻与电流；本例用灯的开关状态学习数据处理。

## 代码顺序

在 `Core/Src/main.c` 先读 `ChaseStep` 和 `steps[3]`，再看 `NextIndex`、`ReadStep` 和主循环。`NextIndex` 的 `static` 局部索引跨调用保留；普通局部变量 `current` 每次调用重新创建。`ReadStep(index, &led_mask, &hold_time)` 通过两个指针把数组元素的成员写回。`led_mask & (1U << n)` 检查第 n 位，每个固定 GPIO 根据一位决定亮灭。

`loop_count` 从 254 开始，每步加一，因此依次得到 255、0、1。这是无符号 8 位赋值转换的回绕，不是有符号整数溢出的一般规则。数组下标始终限制在 0～2；指针只指向本次调用期间仍有效、类型匹配的变量。

## 文件与实物工程

目录包含源码、IOC、独立电路、所需 HAL 源码、CMSIS 头文件与许可证。时钟初始化、GPIO、SysTick 和 SWD 初始化均在 `main.c`。实物烧录须由 CubeMX/CubeIDE 生成启动文件、链接脚本与构建配置，不直接把这份源码目录当成现成 ELF。

## 练习和故障

1. 把蓝灯时间改成 100 ms，验证只改变一个结构体成员就影响可见行为。
2. 将第一步 mask 改成 3，预测绿红同时亮，再运行验证位组合。
3. 若一直只有绿灯，检查 `NextIndex` 中的 index 是否误改成普通局部变量。
4. 若出现随机状态，检查数组越界、指针目标生命周期、每颗灯的独立引脚和接线。

## 复验

```powershell
.venv/Scripts/python.exe examples/Learning08_CData/verify.py --clang
node examples/Learning08_CData/verify.cjs
```

检查全部 C 文件语法，并用真实导入电路验证三灯顺序、200/200/400 ms 时长、指针返回数据、static 索引跨调用保留及 uint8_t 从 255 回绕到 0。
