"""Declarative teaching tasks. The model describes checks; only the client measures them."""
INTERACTION_SCHEMA = {
    "type": "object", "properties": {
        "question": {"type": "string", "maxLength": 600},
        "choices": {"type": "array", "maxItems": 4, "items": {"type": "string", "maxLength": 180}},
    }, "required": ["question", "choices"], "additionalProperties": False,
}

CHECK_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["build", "connected", "voltage", "gpio", "adc-raw", "pwm-frequency", "pwm-duty", "pwm-pulse", "serial-contains"]},
        "label": {"type": "string"}, "targetId": {"type": "string"}, "peerTargetId": {"type": "string"},
        "min": {"type": "number"}, "max": {"type": "number"}, "contains": {"type": "string"}, "instance": {"type": "string"},
    }, "required": ["kind", "label"], "additionalProperties": False,
}
LESSON_SCHEMA = {
    "type": "object", "properties": {
        "title": {"type": "string"}, "goal": {"type": "string"},
        "steps": {"type": "array", "minItems": 1, "maxItems": 8, "items": {
            "type": "object", "properties": {
                "title": {"type": "string"}, "instruction": {"type": "string"}, "prediction": {"type": "string"},
                "targetIds": {"type": "array", "maxItems": 6, "items": {"type": "string"}},
                "hints": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
                "checks": {"type": "array", "maxItems": 8, "items": CHECK_SCHEMA},
                "cases": {"type": "array", "maxItems": 4, "items": {
                    "type": "object", "properties": {
                        "label": {"type": "string"}, "waitMs": {"type": "number", "minimum": 100, "maximum": 5000},
                        "stimuli": {"type": "array", "maxItems": 4, "items": {
                            "type": "object", "properties": {"controlId": {"type": "string"}, "value": {"type": "number"}},
                            "required": ["controlId", "value"], "additionalProperties": False,
                        }}, "checks": {"type": "array", "minItems": 1, "maxItems": 8, "items": CHECK_SCHEMA},
                    }, "required": ["label", "waitMs", "stimuli", "checks"], "additionalProperties": False,
                }},
            }, "required": ["title", "instruction", "targetIds", "hints", "checks", "cases"], "additionalProperties": False,
        }},
    }, "required": ["title", "goal", "steps"], "additionalProperties": False,
}
LESSON_PROMPT = """
在 coach 或 challenge 模式必须返回 lesson。根据当前工程和学生目标生成 3–6 个可执行步骤，禁止把现有工程当成已经通过验收。
coach 模式逐步指导；challenge 模式描述任务与目标，具体修改放到 hints。每步 hints 按“看哪里、原理、具体修改”递进，最多 3 条。
数值解释必须代入当前源码中的公式、时钟与元件参数逐项核对，不套用其他器件的经验值。例如执行器的输入范围和角度关系应以当前模型/工程为准，未知时只讲可确认的电压、频率或脉宽。
描述外设引脚时说“当前工程配置为”，不要把默认复用当作所有芯片、所有重映射下的唯一引脚。提示应能帮助学生排查错误，不能仅因任务生成时工程正确就断言“不需要修改”。
可提供 prediction，让学生先写预期再实验。targetIds 只能取 context.targets 中的真实 id。
checks 是本地确定性验收规则，不是你的评分：
- build：当前工程已构建；connected：targetId、peerTargetId 都必须是已有 pin 目标。
- voltage / gpio：真实 pin 的网络电压 V / 电平 0或1；adc-raw：MCU ADC pin 的实际读取值。
- pwm-frequency / pwm-duty / pwm-pulse：MCU 输出 pin 的运行 PWM 频率 Hz / 占空比百分数（0–100）/ 高电平宽度微秒。
- 数值规则必须提供 min 和 max，包括合理容差。只用用户要求或根据工程原理可计算的目标，绝不照抄当前错误输出作为目标。
- serial-contains：contains 是待查找的普通字符串，可填 instance，如 USART2。不支持正则。
若要自动改变输入验证，使用 steps[].cases：label、waitMs（100–5000，模拟毫秒）、stimuli、checks。
stimuli 的 controlId 必须从 context.controls 原样选取，value 必须在该控件 min/max 内。没有控件时 stimuli=[]。
适合时至少提供一个含两个不同输入的 cases 步骤；每个情境检查稳态结果，等待时间要覆盖程序的采样/输出周期。
用户指定只检查当前快照的步骤时 cases=[]；自动改变输入的步骤才安排 cases。同一验收条件不要同时重复在 checks 与 cases 中。
客户端仅在学生点“运行验收”后运行 cases，并恢复临时输入。不要把输入设置写成操作代码或命令。
checks=[] 且 cases=[] 表示需要学生观察或解释的步骤，由学生记录完成，不能声称已自动验证。
范围外的能力（比如完整 CPU 周期分析）只能设为人工观察，不能虚构检查类型。
不要给出可执行 JavaScript、任意属性路径或运行命令。返回 lesson 时其他 message 简洁，不在 message 中泄露所有 hints。
"""
