# ST7789 SPI 彩屏

240 × 240 RGB565 彩屏例程：启动后显示文字和红、绿、蓝色块，每 250 ms 更新一次进度条与百分比。背景只在启动时绘制，循环仅刷新变化区域，不需要在 STM32F103 的 RAM 中存放整屏图像。

在 AliceSIM 中打开本目录的 **ST7789_SPI_Display.alice.json**，点击构建、运行即可。该文件包含源代码、驱动、IOC 配置和已经接好的电路。也可导入整个文件夹；单独导入电路时使用同名 `.alice-sch.json`。

## 接线与 CubeMX 配置

| ST7789 模块 | STM32 / 电源 | 用途 |
| --- | --- | --- |
| VCC | 3.3 V | 模块供电 |
| GND | GND | 共地 |
| SCK | PA5 / SPI1_SCK | SPI 时钟 |
| MOSI | PA7 / SPI1_MOSI | 像素和命令数据 |
| CS | PA4 / GPIO 输出 | 低电平片选 |
| DC | PB0 / GPIO 输出 | 低电平命令、高电平数据 |
| RST | PB1 / GPIO 输出 | 低电平复位 |
| BL | 3.3 V | 背光常亮 |

SPI1 选择 Half-Duplex Master，8 bit，MSB first，软件 NSS；CPOL=Low、CPHA=1 Edge（mode 0）。本例 MCU 使用内部 HSI 8 MHz，SPI 分频为 2，时钟为 4 MHz。不连接 MISO。PA4、PB0、PB1 使用推挽输出，初始状态为 HIGH。BL 必须接电源，只有写入显存而未打开背光时无法看到图像。

本例针对 240 × 240、无偏移的 ST7789 模块。真板使用前核对模块电源和背光限流电路；不同板子的接口顺序、像素偏移和颜色方向可能不同。若在 CubeMX 中重新生成工程，将 `Core/Src/main.c`、`Core/Inc/main.h` 和 `Drivers/AliceSIM` 合并到对应目录，并保留唯一的 SysTick 中断处理函数。包内含 HAL/CMSIS 及其许可证；启动文件和链接脚本由目标 IDE 生成。

## 配套驱动

驱动文件：`Drivers/AliceSIM/Inc/alicesim_st7789.h` 与 `Drivers/AliceSIM/Src/alicesim_st7789.c`。Init 绑定 SPI、CS、DC 和 RST；Fill 填充全屏；FillRect 更新矩形；DrawPixel 绘制单像素；DrawString 使用 5 × 7 字模绘制可缩放的英文字母、数字和常用符号，小写字母按大写显示；SetDisplay 控制显示开关。颜色采用 RGB565，例如 `0xF800` 红、`0x07E0` 绿、`0x001F` 蓝。

驱动通过普通 HAL GPIO 和 SPI 传输发送 ST7789 命令与像素；仿真屏幕根据电路连线和实际传输的数据更新。修改文字、区域或颜色后，必须重新构建。`frame_count` 记录循环刷新次数，`error_count` 记录刷新失败次数。

当前模型覆盖本例需要的复位、休眠、开关显示、地址窗口、RGB565/RGB666 像素、方向和反色指令。未模拟完整 240 × 320 隐藏显存、滚动扫描及时序电气特性；使用其他 ST7789 驱动时，请先核对它使用的指令与偏移设置。

## 开发复验

在 AliceSIM 仓库根目录执行 `node examples/ST7789_SPI_Display/verify.cjs`。`python examples/ST7789_SPI_Display/verify.py --clang` 可使用平台的本地 Clang 检查所有附带源文件。`node examples/ST7789_SPI_Display/build-assets.cjs` 用于重新生成电路和一键打开的项目文件。
