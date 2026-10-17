# AliceSIM STM32 HAL 外设驱动库

这套驱动面向 `STM32F103C8T6` 和 STM32Cube HAL。每个 AliceSIM 主动外设都有独立的 `.h/.c`，可以只安装需要的部分，也可以包含 `alicesim_peripherals.h` 一次引入全部驱动。

## 驱动来源与署名

AliceSIM 优先选择成熟、MIT 许可的 [libdriver](https://github.com/libdriver) 外设驱动作为上游参考，并在驱动目录中显示：

> libdriver 制作 · AliceSIM 适配

“AliceSIM 适配”包括 STM32Cube HAL 接口、工程安装结构和 Web 语义仿真桥接。没有对应 libdriver 仓库的器件会明确显示“AliceSIM 制作”，不会错误套用署名。每个采用 libdriver 上游的条目都保留仓库 URL 与 MIT 许可证信息。

根目录的 `libdriver-registry.js` 记录了 libdriver 当前 181 个公开仓库中的 171 个有用外设候选，并按环境、运动、测量、存储、显示、通信和音视频分类。尚未完成 AliceSIM 适配的条目只用于检索和规划，不会伪装成可安装驱动。

## 目录

- 显示与输出：SSD1306、ST7789 SPI 彩屏、TM1637、MAX7219、WS2812B、SG90、蜂鸣器、继电器、MOSFET。
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

## ST7789 SPI 彩屏

适用规格是 240×240、RGB565、零偏移的 ST7789 模块。驱动由 AliceSIM 编写，使用标准 `HAL_SPI_Transmit()` 和 GPIO 发送真实的 CASET、RASET、RAMWR 指令及像素数据，不依赖仿真专用显示接口。

CubeMX 中将 SPI1 配为主机、8 位、MSB first、软件 NSS、CPOL=Low / CPHA=1 Edge（Mode 0）。示例中 PA5 接 SCK、PA7 接 MOSI/SDA；PA4、PB0、PB1 分别作为推挽输出接 CS、DC、RST。屏幕接 3.3V 并共地，BL 接 3.3V；MISO 不需要连接。CS 和 RST 低有效，DC 低为命令、高为数据。

```c
#include "alicesim_st7789.h"

AliceSIM_ST7789 screen;

HAL_StatusTypeDef status = AliceSIM_ST7789_Init(&screen, &hspi1,
  GPIOA, GPIO_PIN_4, GPIOB, GPIO_PIN_0, GPIOB, GPIO_PIN_1, 100);
if (status == HAL_OK) {
  status = AliceSIM_ST7789_Fill(&screen, ALICESIM_ST7789_COLOR_BLACK);
}
if (status == HAL_OK) {
  status = AliceSIM_ST7789_DrawString(&screen, 12, 12, "SPI DISPLAY", 2,
    ALICESIM_ST7789_COLOR_WHITE, ALICESIM_ST7789_COLOR_BLACK);
}
if (status == HAL_OK) {
  status = AliceSIM_ST7789_FillRect(&screen, 12, 48, 120, 16,
    ALICESIM_ST7789_COLOR_CYAN);
}
```

`Fill()`、`FillRect()`、`DrawPixel()` 和 `DrawString()` 直接更新屏幕，不需要另调 `Update()`。坐标范围为 0～239，矩形和文本会裁剪越界部分；空矩形不发送数据。`DrawString()` 使用 6×8 字符单元、1～8 倍缩放，带前景色和背景色；支持数字、英文字母、常用标点与换行，小写按大写显示，其他字形显示问号。所有接口返回 `HAL_StatusTypeDef`，通信失败立即停止后续传输并释放 CS。

驱动不申请 115200 字节的整屏显存；最大像素缓冲为栈上的 128 字节，适合 STM32F103C8T6 的 RAM。填充每发送 64 个数据块让出 1 ms，文本每字符让出 1 ms，放大的字符每 8 行也让出 1 ms，避免长绘制连续占用主循环。屏幕刷新会消耗 SPI 带宽，动态效果应只更新发生变化的矩形，不要在每次循环中整屏重绘。此版本不提供旋转、中文字体、DMA 或带面板偏移的其他分辨率配置；真实模块若采用不同像素偏移、扫描方向或反色设置，需要按面板规格调整初始化。

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

`getFiles()` 返回 `{ [工程相对路径]: 源码文本 }`。`install()` 优先调用工作区的增量 `addFiles()` 接口；当前工作区没有该接口时，会合并现有文件后重新载入工程，并默认跳过同名文件。当前清单包含 28 个可安装驱动和 58 个去重后的全量安装文件（含总入口与共用计时头）。

## AliceSIM 仿真支持

AliceSIM 会把 `main()` 中直接出现的 `AliceSIM_SSD1306_*` 与 `AliceSIM_LightSensor_*` 调用降低为高层仿真操作：OLED 绘图会写入运行时的 1024 字节显存，`Update()` 再通过现有 I²C 网络发送到已接线的 OLED；光敏读取会通过 ADC/数字网络采样 AO 和 DO。因此同一套 API 可以同时用于真实 STM32 HAL 工程和浏览器电路仿真。

ST7789 安装后会把驱动源码加入工程，编译器执行其中的普通 C 函数并输出实际 GPIO/SPI 操作；可以在自定义函数中封装调用。显示内容取决于电路接线、供电与控制器收到的指令，不会因调用某个绘图 API 就凭空出现。
