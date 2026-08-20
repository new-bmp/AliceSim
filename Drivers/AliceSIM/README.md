# AliceSIM STM32 HAL 外设驱动库

这套驱动面向 `STM32F103C8T6` 和 STM32Cube HAL。每个 AliceSIM 主动外设都有独立的 `.h/.c`，可以只安装需要的部分，也可以包含 `alicesim_peripherals.h` 一次引入全部驱动。

## 驱动来源与署名

AliceSIM 优先选择成熟、MIT 许可的 [libdriver](https://github.com/libdriver) 外设驱动作为上游参考，并在驱动目录中显示：

> libdriver 制作 · AliceSIM 适配

“AliceSIM 适配”包括 STM32Cube HAL 接口、工程安装结构和 Web 语义仿真桥接。没有对应 libdriver 仓库的器件会明确显示“AliceSIM 制作”，不会错误套用署名。每个采用 libdriver 上游的条目都保留仓库 URL 与 MIT 许可证信息。

根目录的 `libdriver-registry.js` 记录了 libdriver 当前 181 个公开仓库中的 171 个有用外设候选，并按环境、运动、测量、存储、显示、通信和音视频分类。尚未完成 AliceSIM 适配的条目只用于检索和规划，不会伪装成可安装驱动。

## 目录

- 显示与输出：SSD1306、TM1637、MAX7219、WS2812B、SG90、蜂鸣器、继电器、MOSFET。
- 电源：可调 DC-DC 转换模块（输出电压、使能、额定电流和过载状态）。
- 环境与测量：光敏、DHT11、BMP280、BH1750、SHT30、INA219、MQ-2、PIR、HC-SR04。
- 运动与输入：MPU6050、EC11、电位器、双轴摇杆。
- 存储、时钟与扩展：DS18B20、DS3231、PCF8574、PCA9685、W25Qxx。
- 每个器件对应 `Inc/alicesim_<id>.h` 和 `Src/alicesim_<id>.c`；`manifest.json` 是完整且可机器校验的文件清单。
- `Inc/alicesim_timing.h`：需要微秒延时/计时的驱动共用接口。
- `Inc/alicesim_peripherals.h`：总入口。
- `manifest.json`：前端可读取的驱动清单。
- `Examples/oled_light_example.c`：OLED 与光敏传感器联动示例。

## 添加到 STM32Cube 工程

1. 将 `Drivers/AliceSIM/Inc` 加入编译器 include path。
2. 将所需的 `Drivers/AliceSIM/Src/*.c` 加入构建。
3. CubeMX 中启用 I2C1（默认 PB6/PB7）和 ADC1 通道（示例为 PA0 / ADC1_IN0）。
4. 如果使用 DO，再把对应 GPIO 配置为输入；仅使用 AO 时，初始化的 `digital_port` 可传 `NULL`。

## SSD1306

```c
#include "alicesim_ssd1306.h"

AliceSIM_SSD1306 display;

AliceSIM_SSD1306_Init(&display, &hi2c1, 0x3C, 100);
AliceSIM_SSD1306_Clear(&display);
AliceSIM_SSD1306_DrawString(&display, 2, 2, "ALICESIM", 1,
                            ALICESIM_SSD1306_COLOR_WHITE);
AliceSIM_SSD1306_DrawRectangle(&display, 1, 14, 126, 48,
                               ALICESIM_SSD1306_COLOR_WHITE);
AliceSIM_SSD1306_Update(&display);
```

地址参数使用 7 位地址（通常是 `0x3C`），驱动内部会转换成 STM32 HAL 所需的左移地址。显存大小为 1024 字节。内置 5×7 字体支持数字、英文字母和常用标点；小写字母按大写字形显示。

## 光敏传感器

```c
#include "alicesim_light_sensor.h"

AliceSIM_LightSensor light;
AliceSIM_LightSensor_Sample sample;

AliceSIM_LightSensor_Init(&light, &hadc1,
                          LIGHT_DO_GPIO_Port, LIGHT_DO_Pin,
                          0, 3300, 12, 10);
AliceSIM_LightSensor_Read(&light, &sample);
```

`sample` 同时包含 ADC 原始值、毫伏、估算 lux、百分比和 DO 状态。默认标定与 AliceSIM 模型一致：`0 → 0 lux`、满量程 → `100000 lux`。真实传感器可使用 `AliceSIM_LightSensor_SetCalibration()` 做两点线性标定。

AliceSIM 元件默认在照度达到阈值时让 DO 输出高电平，因此 `digital_active_low` 默认传 `0`。如果在元件属性中切换成低有效，则传 `1`。

## 前端驱动入口

根目录的 `alice-drivers.js` 暴露 `window.AlicePeripheralDrivers`：

```js
AlicePeripheralDrivers.list(); // 包含 attribution、upstream、installable
const files = await AlicePeripheralDrivers.getFiles(["ssd1306", "light-sensor"]);
await AlicePeripheralDrivers.install("ssd1306");
```

`getFiles()` 返回 `{ [工程相对路径]: 源码文本 }`。`install()` 优先调用工作区的增量 `addFiles()` 接口；当前工作区没有该接口时，会合并现有文件后重新载入工程，并默认跳过同名文件。当前清单包含 27 个可安装驱动和 56 个去重后的全量安装文件（含总入口与共用计时头）。

## AliceSIM 仿真支持

AliceSIM 会把 `main()` 中直接出现的 `AliceSIM_SSD1306_*` 与 `AliceSIM_LightSensor_*` 调用降低为高层仿真操作：OLED 绘图会写入运行时的 1024 字节显存，`Update()` 再通过现有 I²C 网络发送到已接线的 OLED；光敏读取会通过 ADC/数字网络采样 AO 和 DO。因此同一套 API 可以同时用于真实 STM32 HAL 工程和浏览器电路仿真。

当前模型构建器不会自动内联任意层级的用户自定义 C 包装函数。若希望浏览器仿真观察到驱动行为，请让这些驱动 API 直接出现在 `main()` 或 `main()` 的 `while` 主循环中；真实编译和烧录不受此限制。
