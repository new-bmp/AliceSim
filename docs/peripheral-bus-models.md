# 外设总线模型

`peripheral-bus-devices.js` 提供浏览器的 `AlicePeripheralBusDevices` 和 Node 模块。`supports(type)`、`supportedTypes`、`create(type, options)` 用于发现并创建设备；不支持的类型返回 `null`。设备之间没有共享寄存器、时钟或 Flash 数据。

每个设备提供 `setConnection(connection)`、`setProperties(properties)`、`setTime(timeMs)`、`getState()`、`transmit(event)` 和 `receive(event)`。I²C 设备另有 `accepts(address7Bit)`；PCF8574 另有 `setPortInputs(mask)`。

事件使用 `bytes`、`memoryAddress`、`length` 和仿真毫秒数 `timeMs`。省略 `memoryAddress` 的寄存器写操作把首字节作为寄存器指针，后续字节作为数据；只写指针后可以分开读取。`address7Bit` 和 `address` 是七位地址，`deviceAddress` 是 STM32 HAL 左移后的地址。发送返回 `{ accepted, byteCount, reason? }`，接收返回 `{ accepted, bytes, reason? }`。失败不会伪造全零读回数据。

| 器件 | 默认七位地址 | 已实现的行为 |
| --- | --- | --- |
| BMP280 | `0x76` | 芯片 ID、Bosch 标定参数、20 位温度/气压测量、控制/配置寄存器、强制/连续采样、软复位；原始值可由标准补偿公式还原为配置的环境量 |
| MPU6050 | `0x68` | WHO_AM_I、睡眠/唤醒、14 字节六轴与温度采样、四档加速度/陀螺仪量程、软复位 |
| BH1750 | `0x23` | 连续/单次高低分辨率测量、MTreg 灵敏度、转换等待、关机、16 位照度数据 |
| SHT30 | `0x44` | 单次高/中/低重复性测量、转换等待、温湿度原始值及 CRC8、状态读取、加热控制、软复位 |
| DS3231 | `0x68` | BCD 日期时间读写、12/24 小时制、星期、世纪位、温度寄存器；按仿真时间走时并跨月/闰年进位 |
| INA219 | `0x40` | 16 位大端配置、分流电压、总线电压、电流、功率、校准寄存器、复位；有符号电流依校准值换算 |
| PCF8574 | `0x20` | 准双向八位锁存器、配置输入与实体引脚低电平共同决定读回值、输入变化中断、读取清除中断 |
| PCA9685 | `0x40` | 16 路 ON/OFF 计数、自动递增、预分频、睡眠、全开/全关、OE 输出使能、各通道脉宽与当前相位 |
| W25Qxx | SPI | JEDEC ID、顺序/快速读取、WREN/WRDI、状态、页编程、4 KiB/64 KiB/整片擦除；CS 上升沿提交写入、NOR 按位与、页内回卷 |

I²C 操作要求供电正常、SCL/SDA 都已接线且绑定到正确的 MCU 总线。SPI Flash 还要求 MOSI/MISO/SCK/CS 连通及 CS 拉低。默认电压范围按芯片设定；例如直接给 BMP280、BH1750 或 W25Qxx 供 5 V 会拒绝操作。

Flash 使用按页分配的稀疏存储，最大容量 32 MiB，不会在 `getState()` 中复制整个芯片。断电清除命令状态与写使能并保留已经提交的数据；尚未提交的页写入作废。分开的发送/接收和 HAL 全双工均可使用：全双工接收事件加上 `clockedByTransmit: true`，取回上次发送每个时钟产生的响应，命令/地址阶段返回 `0xFF`。

INA219 驱动的 `Init()` 默认按常见模块的 100 mΩ 分流电阻写入校准值。`current_lsb_ua = 100` 对应校准值 `4096`；零值、校准溢出或下溢会返回 `HAL_ERROR`。使用其他分流电阻时，应按头文件公式重新写入校准寄存器。

DS18B20 单独由 `ds18b20-device.js` 提供 `AliceDS18B20Device.create(options)`，通过 `apply(action, event)` 执行 `start-conversion` 和 `read-raw`。事件须带具体 `dataPin` 和仿真 `timeMs`；正常供电范围 3–5.5 V。12 位转换耗时 750 ms，读取返回带符号的 1/16°C 原始值。转换期间保留上次采样，上电初值为 85°C；启动时锁定环境温度，断电取消待完成转换。支持随附驱动回调绑定到唯一 GPIO 的用法，未实现任意单总线位操作解码、ROM 搜索和寄生供电。多器件 Skip ROM 读取会拒绝，失败不会覆盖调用者输出。

这些模型覆盖当前 HAL 驱动与常用寄存器操作，不是完整芯片或电气时序仿真。BMP280 转换即时完成；MPU6050 未模拟 FIFO/DMP/中断；SHT30 未模拟周期采样；DS3231 暂不产生闹钟/SQW 波形并按有后备电源的时钟处理断电；INA219 不模拟 ADC 噪声/转换时间；Flash 写入/擦除在 CS 上升沿即时完成，未模拟 WIP 延时、保护位、掉电指令和四字节地址模式。Flash 数据保留在同一运行中的设备实例中，尚未另行存为工程文件；32 MiB 型号的高于 16 MiB 区域需要未来的四字节寻址支持。

验证：`node --test tests/peripheral-bus-devices.test.js`；INA219 的实际 C 初始化语句另由 `python -m unittest discover -s tests -p test_ina219_calibration.py` 在 Clang 常量求值器中检查。
