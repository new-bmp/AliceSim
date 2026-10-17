# 嵌入式 C：数据与指针

## 先运行一份可观察的数据表

打开 [Learning08_CData 完整工程](../projects/Learning08_CData.alice.json)，构建并运行。绿灯亮 200 ms、红灯亮 200 ms、蓝灯亮 400 ms，之后重复。完整 [main.c](../examples/Learning08_CData/Core/Src/main.c) 把顺序、位掩码和保持时间保存为数据，主循环根据数据控制三个固定引脚。

CubeMX 选择 STM32F103C8T6；PB12、PB13、PB14 配置 GPIO_Output、Output Push Pull、No Pull、Low speed、初始 Low。RCC 使用 HSI 8 MHz、HSE Disable、PLL Off，AHB/APB 均不分频。SYS Debug 选择 Serial Wire，保留 PA13/PA14，SysTick 使用 1 ms 时间基准。

PB12、PB13、PB14 分别经各自的 330 Ω 接到绿、红、蓝 LED 阳极，三个阴极接 GND；MCU VDD 接 3.3 V，VSS 共地。三颗灯有三条独立支路，不共用一个限流电阻。

## 数组下标与结构体成员

```c
typedef struct
{
  uint8_t mask;
  uint16_t hold_ms;
} ChaseStep;

const ChaseStep steps[3] = {
  {1U, 200U}, {2U, 200U}, {4U, 400U}
};
```

ChaseStep 是一个结构体类型：mask 表示哪些灯亮，hold_ms 表示保持毫秒数。steps 是包含三个这种元素的数组。steps[0].mask 是 1，steps[2].hold_ms 是 400；数组下标从 0 开始，合法范围为 0～2。

const 表示程序不应通过这个名字修改表的内容；它不自动验证下标。steps[3] 已经越界，即使偶尔还能亮灯，也是错误程序。用 sizeof 统计数组大小时，应在仍然是数组的作用域里使用 `sizeof(steps) / sizeof(steps[0])`；数组传到函数参数后通常变成指针，不能继续用同一个公式求元素数量。

结构体可能有填充，成员大小相加不一定等于 sizeof(ChaseStep)。不要把结构体内存直接当成稳定的串口或文件协议，协议应明确每个字节的含义和顺序。

## 位操作让一份数值表示多盏灯

mask 的最低三位分别对应绿、红、蓝。十进制 1、2、4 的二进制为 001、010、100。三颗灯同时点亮可用 1 | 2 | 4，即 7；只点绿红是 3。

```c
HAL_GPIO_WritePin(GREEN_LED_GPIO_Port, GREEN_LED_Pin,
  (led_mask & (1U << 0U)) != 0U ? GPIO_PIN_SET : GPIO_PIN_RESET);
```

1U << 0U 生成第 0 位的掩码，& 检查这一位是否置位，?: 根据条件选择高或低电平。红、蓝分别检查第 1、2 位。位与 & 和逻辑与 && 不同：前者逐位运算，后者判断两个条件是否同时为真。

用 | 置位，用 & 配合取反掩码清位，用 ^ 翻转位。操作寄存器时还需遵守手册的读写规则，不能把普通变量的所有位操作直接套到“写 1 清除”等特殊寄存器。

## 指针把两个结果写回调用者

```c
static void ReadStep(uint8_t index, uint8_t *mask, uint16_t *hold_ms)
{
  *mask = steps[index].mask;
  *hold_ms = steps[index].hold_ms;
}

/* 主循环中 */
ReadStep(NextIndex(), &led_mask, &hold_time);
```

&led_mask 取得变量地址，传给 mask；函数内 *mask 沿这个地址写入变量。一个函数通常只有一个直接返回值，输出参数让它把“位掩码”和“时间”两个结果分别写回。

本例的三个约束是下标合法、指针非空、指向的目标类型和生命周期正确。不能把 uint16_t 变量的地址随意当成 uint8_t* 输出参数，也不能返回一个普通局部变量的地址供调用结束后继续使用。这里不讲堆分配，指针也不等于动态内存。

## 普通局部、static 和无符号回绕

```c
static uint8_t NextIndex(void)
{
  static uint8_t index = 0U;
  uint8_t current = index;
  index = (index + 1U) % 3U;
  return current;
}
```

普通局部 current 每次调用重新创建；static 局部 index 只初始化一次，在调用之间保留，同时名字仍只在函数内部可见。函数声明前面的 static 又是另一层含义：限制函数在当前 C 文件内使用。作用域说明“哪里能用这个名字”，存储期说明“对象活多久”，不要把两者混为一谈。

index 从 0、1、2 再回到 0，模运算保证不越界。若把 index 的 static 删除，它每次调用都会从 0 开始，流水灯就一直选择第一步。

全局 loop_count 使用 uint8_t 并从 254 开始。第一步加一为 255，下一步赋回 uint8_t 时变成 0，再变成 1。uint8_t 能表示 0～255，转换按模 256 保留结果；不要把这个结论推广为“有符号整数溢出也安全”。中间表达式还涉及整数提升；较大乘法需要提前转成足够宽的类型，例如 `(uint32_t)sample * 3300U`，不能先在窄类型中溢出再补救。

## 修改、观察与故障

1. 将第一步 mask 改成 3，预测绿红同时亮，确认蓝灯不亮。
2. 将蓝灯的 hold_ms 从 400 改成 100，重新构建，验证数据表确实控制保持时间。
3. 在仿真中暂时去掉 index 的 static，观察一直停在绿灯，再恢复并解释原因。
4. 出现“蓝灯根本不亮”时，同时检查 PB14 接线、位编号 2、结构体第三个元素，以及下标是否能到 2。
5. 用逻辑分析仪确认每步只有预期 GPIO 为高，再检查 LED 极性和公共地。

本工程已经通过真实 HAL/CMSIS 的 C 语法检查，电路运行复验同时检查了三灯时序、指针输出参数、static 索引和 8 位回绕。继续学习 [非阻塞计时与状态机](tick-state.md)，把等待一个步骤改成同时检查多个任务。
