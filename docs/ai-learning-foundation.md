# AI 学习助手基座

目标：让任何 AliceSIM 工程共用同一个实验上下文、指导标注与讲义接口，不按课程或器件名称编写专用问答。

## 数据和能力

- 按用户提问采集工程快照：当前未保存代码、有限的工程源码与 IOC、元件和引脚、连接网络、运行状态、近期诊断/串口、抽样波形。附采集时间、工程修订标识和裁剪说明。
- 定位目标使用上下文中的 `targetId`。目标可以是元件、端子、导线、源码文件/行范围、波形通道或已注册的界面区域。模型不能提供可执行 JavaScript 或任意 DOM 选择器。
- 统一指导响应为 `{message, annotations, handout}`。标注包含 `{targetId, style, label, startLine?, endLine?}`，style 为 circle/arrow/highlight。讲义包含 title、sections（heading/body）、exercises。所有响应先验证，再渲染。
- 模型网关使用后端环境变量配置兼容 Chat Completions 的服务，提供状态和问答接口。API 密钥仅保留在后端；没有配置时明确提示，不生成假模型回答。
- 学习助手提供可收起面板、解释/排查/讲义入口、请求取消、目标选择与本地标注、上下文预览、讲义查看/Markdown 和 HTML 导出/打印 PDF。
- 对话与讲义进入完整项目快照，随项目保存恢复。标注与电路编辑历史分开；切换工程/修改代码后旧请求不能覆盖当前状态。

## 边界

本阶段只提供教学、观察和文档功能。AI 不运行任意脚本、不自动改电路或固件、不自动启动仿真。结论绑定采集快照，模型建议与实际运行证据有明确区分。截图识别、语音以及自动修改工程可在这些接口上扩展。

## 实现计划（2026-11-04）

1. 核心协议与行为测试：上下文裁剪、目标校验、代码行范围、过期请求、讲义转义及保存恢复。
2. 本地模型网关：配置读取、请求校验、Function Call 响应、错误分类、请求大小与超时；用本地假服务验证真实 HTTP 契约。
3. 工作台接入：通用上下文适配器、跟随画布和窗口的独立标注层、学习面板、讲义和项目持久化。
4. 回归检查：Node 测试、Python 网关测试、Web 打包、桌面/窄屏浏览器交互，最后 Git 提交。

接口以新模块隔离：`learning-core.js` 负责纯数据；`learning-workspace.js` 负责只读快照和目标定位；`learning-assistant.js`/`learning-assistant.css` 负责交互；`learning_service.py` 负责模型网关。

主要验证：变更源码不能重放旧标注；重命名或删除目标不误标其他对象；模型输出及导出讲义不执行 HTML；密钥不进入响应或项目包；没有模型也能查看上下文、标记目标和保存本地实验记录。

## 使用方式

点击顶部“学习助手”。展开“选择指导目标”，搜索并选择元件、端子、导线、文件或观测区域；“定位标注”可直接检查画圈、箭头、高亮效果。代码页先选中几行，再选择当前文件，标注就会使用这段选区。点击回答下面的目标按钮，可重新定位到那处代码或电路。Esc 清除标注。

“查看”展示本次将附带给模型的快照。助手只在发送问题时请求模型，不在每个仿真 tick 调用模型。单次最多附带 20 份 C/C++/头文件/IOC，每份最多 24,000 字符、总共 80,000 字符；当前未保存文件优先。上下文还包含最多 200 个元件、400 根导线、300 个已解算节点、最近 30 条串口/诊断、4 路各 120 个波形点以及最近 20 条外设事件。截取或抽样不会被描述为完整数据。

模型回复使用纯文本渲染。圈选只引用快照里已注册的目标；遇到不存在的目标或越界代码行，会忽略该标注并提示。移动、缩放画布时标注跟随；更改接线、源码或工程时过期请求失效。讲义保留其创建时的数据，不随之后的实验变化而改写。

生成讲义后，在“讲义与记录”中再次打开。支持下载 Markdown、独立 HTML，或在打印窗口另存 PDF。HTML 包含基于元件与实际连线生成的连接关系简图、接线表、代码节选、串口和诊断记录；该简图不是实机照片或屏幕截图。“保存本地实验记录”不需要模型，会明确标为尚未经过 AI 分析。

Ctrl+S 保存完整工程时，会一起保存对话和最近 8 份讲义；Ctrl+Shift+S 导出的完整工程包也包含这些内容。单独“电路另存为”不包含对话和讲义。API 密钥不进入项目包。

## 连接模型

后台提供 `GET /api/learning/status` 与 `POST /api/learning/respond`。支持使用标准 `messages`、`tools`、`tool_calls` 的 Chat Completions 接口。可配置华为云 MaaS 的兼容接口或其他兼容服务；具体模型要支持工具调用，且使用服务控制台给出的完整接口地址与模型 ID。

在启动 AliceSIM 的 PowerShell 中设置下面三个环境变量，然后启动服务。若服务已运行，先在原服务窗口按 Ctrl+C 停止再重启，避免启动器复用旧服务。

```powershell
$env:ALICESIM_AI_URL = 'https://你的服务主机/完整路径/chat/completions'
$env:ALICESIM_AI_MODEL = '服务提供的模型ID'
$env:ALICESIM_AI_KEY = '你的API密钥'
.\AliceSIM.cmd -Windowed
```

本地兼容服务可用 `http://127.0.0.1:端口/v1/chat/completions`，无需密钥时不设置 `ALICESIM_AI_KEY`。远程服务必须使用 HTTPS。服务要求的路径不同，不能把控制台网址或仅有域名的地址填在这里。

若模型不支持工具调用，设置 `$env:ALICESIM_AI_TOOLS = '0'`。模型仍被要求返回同一 JSON 协议；普通文字回答也能显示，但不会被伪造成带标注的指导或讲义。状态“已配置”只表示配置有效，实际连通性在发送问题时验证。

后端单次连接等待上限 60 秒，最多两个并发调用，不会自动重试造成重复计费。前端可取消并丢弃结果；取消浏览器请求不保证上游服务立即停止计算或计费。模型拒绝认证、限流、无效响应和缺失配置分别显示错误。

## 扩展接口

- `AliceLearningAssistant.capture()` 返回只读教学快照。
- `AliceSchematic.getLearningSnapshot()` 提供元件、真实端子、导线和缓存的节点状态，不执行固件或推进仿真。
- `AliceLearningCore.normalizeGuidance(response, context)` 校验模型响应。
- `AliceLearningWorkspace.rectFor(target, annotation)` 将语义目标映射到当前可见位置，处理页面 90% 缩放、画布缩放、代码滚动和波形分行。
- `AliceLearningAssistant.exportState()` / `restore(state)` 接入工程保存；版本为 1。

新增元件只要在现有元件定义中声明引脚，就会自动成为指导目标。新增观测区域可在 `learning-workspace.js` 的受控区域表中注册。新增模型供应商可适配 `learning_service.py`；前端协议不依赖模型品牌。后续的截图、语音、课程检索等能力可复用工程快照和目标定位。

## 验证命令

```powershell
node --test tests/*.test.js
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_learning_service.py
node scripts/build-web.mjs
```

真实浏览器回归使用单独的测试浏览器上下文，覆盖未配置提示、真实目标圈选、缩放跟随、讲义转义、取消/过期回答、Ctrl+S 后刷新恢复和窄屏布局。需要已经安装的 Playwright 与 Edge，并启动本地服务：

```powershell
$env:ALICESIM_QA_URL = 'http://127.0.0.1:4325'
# Playwright 未在当前项目安装时，将该变量设置到已有 playwright 包的绝对目录。
$env:ALICESIM_PLAYWRIGHT_PATH = '已有Playwright包目录'
node tests/learning-browser.cjs
```

测试中的模型响应由本地固定测试数据提供，生产模式没有演示模型或假回答。真实供应商的质量与兼容性需要在提供凭据后验证。
