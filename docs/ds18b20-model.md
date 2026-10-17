# DS18B20 温度模型

`ds18b20-device.js` 提供浏览器全局 `AliceDS18B20Device` 和同名 Node 模块接口。`create({ properties: { temperatureC }, connection })` 创建独立设备；也可直接使用 `temperatureC` 选项。设备提供 `setConnection()`、`setProperties()`、`setTime()`、`reset()`、`getState()` 和 `apply(action, event)`。

设备要求 VCC/GND 连通、3.0–5.5 V 有效供电、`bindingValid: true`、`dataConnected: true` 和明确的 `dataPin`。显式未知或冲突的轨电压会拒绝操作。状态包含 `connection`、`properties`、`raw`、`convertedTemperatureC`、`conversionPending` 和转换截止时间；连接与属性快照不会暴露内部对象。

## 固件行为

已支持随项目提供的 `AliceSIM_DS18B20_Init`、`StartConversion`、`ReadRaw` 和 `RawToCelsiusX100`。编译器从初始化传入的 reset/write/read 回调中查找实际 `HAL_GPIO_WritePin`、`HAL_GPIO_ReadPin` 或 `HAL_GPIO_TogglePin`；可跟随带静态 GPIO 参数的项目辅助函数。三个回调必须各自解析到同一个明确引脚。缺少回调、跨引脚、动态端口、多个引脚掩码和不透明的 `ctx->port` / `ctx->pin` 会产生 `ALICESIM_DS18B20_BINDING_UNRESOLVED` 错误，不能按工程中唯一的温度传感器猜测 DQ。

设备上下文支持命名对象地址和常量数组元素地址，如 `&probe`、`&probes[1]`。无法静态解析的设备指针别名和动态数组下标产生 `ALICESIM_DS18B20_CONTEXT_UNRESOLVED` 错误。用户回调的 `context` 参数允许 `NULL`；设备指针与输出指针为 `NULL` 时返回 `HAL_ERROR`。无效的重新初始化保留上一次有效初始化的配置。读数支持标量、数组元素及指向可写存储的输出指针，失败时保留原输出值。

运行时事件格式为 `{ peripheralType: "ds18b20", action: "start-conversion" | "read-raw", dataPin, timeMs }`。设备返回 `{ accepted, result, reason? }`，成功读取的 `result.raw` 是有符号 16 位、每位 1/16°C 的整数。主线程与 Worker 都按实际 DQ 路由，拒绝同一 DQ 上多个就绪器件，因为当前驱动使用 SKIP ROM，无法选择某一个器件。

上电 scratchpad 是 85°C，即原始值 `1360`。启动转换时采样配置温度，限制在 −55 至 125°C，量化到 1/16°C，750 ms 后更新 scratchpad。提前读取返回上一份 scratchpad；只调整环境温度不会直接改变读回值。断电或无效供电会中止转换并恢复上电值。渲染提前到达帧边界后再回放按时间排序的固件事件，不会清除转换或提前读到未来值。

## 范围

这是上述驱动 API 的语义模型，回调用于解析实际 GPIO 绑定；它不执行回调中的任意 C 控制逻辑或自定义错误分支。可证明始终返回非 `HAL_OK` 的回调会被拒绝，但这不是完整回调验证。直接使用 HAL 手写的 1-Wire 波形、直接寄存器操作、动态函数指针、ROM 搜索/匹配、多器件寻址、CRC、报警、EEPROM、可配置分辨率、寄生供电和上拉电阻电气特性尚未模拟。转换固定为 12 位、750 ms；重新发送转换命令会重新开始计时。

验证：`node --test tests/ds18b20-device.test.js tests/ds18b20-integration.test.js` 和 `python -m unittest tests.test_ds18b20_semantics -v`。
