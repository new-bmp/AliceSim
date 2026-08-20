# 数据手册转器件草稿 API

AliceSIM 的数据手册接口只负责生成和校验可编辑草稿，不会直接修改器件库、驱动清单或用户工程。

## 解析 PDF

`POST /api/datasheet/parse`

```json
{
  "filename": "CS43131.pdf",
  "pdfBase64": "JVBERi0xLj...",
  "hints": {
    "partNumber": "CS43131",
    "manufacturer": "Cirrus Logic",
    "package": "42-WLCSP",
    "interface": "I2C"
  }
}
```

PDF 必须以 Base64 放在 JSON 请求中。接口不接受本机绝对路径或 URL，不读取 PDF 附件，也不执行嵌入脚本。单个 PDF 上限为 24 MiB、600 页，解出的文本同样有独立上限。

专用 Skill 或其他受信任解析器也可以提交结构化文本：

```json
{
  "filename": "device.pdf",
  "pages": [
    {
      "number": 1,
      "text": "提取后的页面文本",
      "tables": [
        [["Address", "Function"], ["0x00", "Device ID"]]
      ]
    }
  ],
  "hints": { "partNumber": "DEVICE123" }
}
```

返回对象的 `kind` 固定为 `AliceSIMPeripheralDraft`，主要包含：

- `identity`：厂商、型号和订货号候选。
- `packages`、`pins`：封装、逻辑引脚及不同封装位置。
- `electrical`：推荐工作条件和绝对最大值。
- `interfaces`：I²C/SPI/I²S/UART 等接口、地址和速率。
- `registerMap`：寄存器地址、名称和位域候选。
- `confidence`：分区置信度，不等同于器件已经验证。
- `review`：未解决字段、必须人工确认的字段和安全提示。
- `driver.plannedFiles`：计划生成的 STM32 HAL `.h/.c` 路径；解析阶段始终不可安装。

## 校验编辑后的草稿

`POST /api/datasheet/validate`

```json
{
  "draft": {
    "schemaVersion": 1,
    "kind": "AliceSIMPeripheralDraft"
  }
}
```

调用者需要在核对后将以下路径写入 `review.confirmedFields`：型号、封装、引脚、工作电压、接口、寄存器和仿真范围。只有格式没有错误、没有未解决字段并且确认项齐全时，返回的 `installable` 才会为 `true`。这仍只代表可以进入“生成驱动并运行测试”阶段，不代表已经自动安装。

## 服务能力检查

`GET /api/health` 的 `datasheetImport` 字段会报告 PDF 解析器是否可用、是否支持表格提取、草稿版本以及两个接口地址。如果 PDF 依赖不可用，结构化文本入口仍然可以工作。

