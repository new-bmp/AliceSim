# AliceSIM 组件包格式

AliceSIM 使用 `.alice-component.json` 保存可复用组件。组件包与普通 `.alice-sch.json` 电路文件相互独立：普通电路描述一张正在编辑的原理图，组件包则在完整内部电路之外增加可复用模块所需的身份、版本和外部端口契约。

## 顶层结构

```json
{
  "schemaVersion": 1,
  "kind": "AliceSIMComponent",
  "component": {
    "id": "sensor-front-end",
    "name": "Sensor Front End",
    "prefix": "AFE",
    "version": "1.0.0",
    "description": "传感器信号调理模块",
    "ports": [],
    "bounds": { "x": 80, "y": 40, "width": 620, "height": 330 },
    "componentCount": 8,
    "wireCount": 10
  },
  "circuit": {
    "schemaVersion": 1,
    "kind": "AliceSIMCircuit",
    "mcu": "STM32F103C8T6",
    "components": [],
    "wires": [],
    "view": {}
  }
}
```

## 外部端口

保存时，电路中的 EDA 网络端子会被提取为组件端口。同名端子只生成一个端口，并在 `terminalIds` 中保留所有内部端子 ID。

```json
{
  "id": "port-1",
  "name": "SENSOR_OUT",
  "role": "analog",
  "direction": "output",
  "terminalIds": ["terminal-a", "terminal-b"]
}
```

`role` 支持 `power`、`ground`、`analog`、`signal`；`direction` 支持 `input`、`output`、`bidirectional`。AliceSIM 会校验端口名称与内部网络端子名称是否一致，避免组件文件只改接口声明却没有对应内部网络。

没有网络端子的电路仍可保存为组件，但不会产生外部端口。若组件需要与其他电路连接，应先在原理图中放置并命名网络端子。
