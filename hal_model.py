"""Build a small, JSON-serializable STM32 HAL behaviour model.

The parser intentionally supports a constrained, explicit subset of STM32Cube
projects.  It never executes project text.  Unsupported or ambiguous source is
reported through diagnostics instead of being replaced by a fabricated board
behaviour.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import re
from typing import Iterable, Mapping, Sequence


SCHEMA_VERSION = 1
C_SOURCE_SUFFIXES = (".c", ".cc", ".cpp", ".cxx")
C_HEADER_SUFFIXES = (".h", ".hh", ".hpp", ".hxx")


@dataclass(frozen=True)
class _ProjectFile:
    path: str
    content: str


@dataclass(frozen=True)
class _Macro:
    name: str
    expression: str
    file: str
    line: int
    priority: int


@dataclass(frozen=True)
class _Token:
    value: str
    kind: str
    start: int
    line: int
    column: int


def _diagnostic(
    severity: str,
    code: str,
    message: str,
    *,
    file: str | None = None,
    line: int | None = None,
    column: int | None = None,
    details: Mapping[str, object] | None = None,
) -> dict:
    item: dict[str, object] = {
        "severity": severity,
        "code": code,
        "message": message,
    }
    if file is not None:
        item["file"] = file
    if line is not None:
        item["line"] = line
    if column is not None:
        item["column"] = column
    if details:
        item["details"] = dict(details)
    return item


def _normalise_path(value: object) -> str:
    raw = str(value).replace("\\", "/").replace("\x00", "").strip()
    while raw.startswith("./"):
        raw = raw[2:]
    raw = raw.lstrip("/")
    parts = [part for part in raw.split("/") if part and part != "."]
    if not parts or any(part == ".." for part in parts):
        raise ValueError(f"invalid normalised project path: {value!r}")
    return PurePosixPath(*parts).as_posix()


def _normalise_files(files: Iterable[object]) -> list[_ProjectFile]:
    records: list[_ProjectFile] = []
    seen: set[str] = set()
    for item in files:
        path_value: object
        content_value: object
        if isinstance(item, Mapping):
            path_value = item.get("path", item.get("name", ""))
            content_value = item.get("content", "")
        elif isinstance(item, Sequence) and not isinstance(item, (str, bytes)) and len(item) == 2:
            path_value, content_value = item
        else:
            raise TypeError("project files must be (path, content) pairs or mappings")
        path = _normalise_path(path_value)
        folded = path.casefold()
        if folded in seen:
            raise ValueError(f"duplicate project path: {path}")
        seen.add(folded)
        if not isinstance(content_value, str):
            raise TypeError(f"project file content must be text: {path}")
        records.append(_ProjectFile(path=path, content=content_value.lstrip("\ufeff")))
    return records


def _strip_comments(source: str) -> str:
    """Remove comments while preserving offsets, line breaks, and literals."""

    output = list(source)
    index = 0
    state = "code"
    while index < len(source):
        char = source[index]
        following = source[index + 1] if index + 1 < len(source) else ""
        if state == "code":
            if char == '"':
                state = "string"
            elif char == "'":
                state = "char"
            elif char == "/" and following == "/":
                output[index] = output[index + 1] = " "
                index += 1
                state = "line-comment"
            elif char == "/" and following == "*":
                output[index] = output[index + 1] = " "
                index += 1
                state = "block-comment"
        elif state == "line-comment":
            if char == "\n":
                state = "code"
            else:
                output[index] = " "
        elif state == "block-comment":
            if char == "*" and following == "/":
                output[index] = output[index + 1] = " "
                index += 1
                state = "code"
            elif char not in "\r\n":
                output[index] = " "
        elif state in {"string", "char"}:
            delimiter = '"' if state == "string" else "'"
            if char == "\\":
                index += 1
            elif char == delimiter:
                state = "code"
        index += 1
    return "".join(output)


def _logical_lines(source: str) -> Iterable[tuple[int, str]]:
    lines = source.splitlines()
    index = 0
    while index < len(lines):
        start = index + 1
        current = lines[index]
        while current.rstrip().endswith("\\") and index + 1 < len(lines):
            current = current.rstrip()[:-1] + " " + lines[index + 1].lstrip()
            index += 1
        yield start, current
        index += 1


def _macro_priority(path: str) -> int:
    lower = path.casefold()
    if lower == "core/inc/main.h":
        return 100
    if lower.endswith("/core/inc/main.h"):
        return 95
    if lower == "main.h" or lower.endswith("/main.h"):
        return 90
    if "/drivers/" in f"/{lower}":
        return 20
    return 40


def _collect_macros(
    records: Sequence[_ProjectFile], diagnostics: list[dict]
) -> dict[str, _Macro]:
    macros: dict[str, _Macro] = {}
    macro_pattern = re.compile(
        r"^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)[ \t]+(.+?)[ \t]*$"
    )
    for record in records:
        if not record.path.casefold().endswith((".h", ".inc")):
            continue
        cleaned = _strip_comments(record.content)
        priority = _macro_priority(record.path)
        for line_number, line in _logical_lines(cleaned):
            match = macro_pattern.match(line)
            if not match:
                continue
            name, expression = match.group(1), match.group(2).strip()
            candidate = _Macro(name, expression, record.path, line_number, priority)
            existing = macros.get(name)
            if existing is None or candidate.priority > existing.priority:
                macros[name] = candidate
            elif (
                candidate.priority == existing.priority
                and candidate.expression != existing.expression
                and (name.endswith("_Pin") or name.endswith("_GPIO_Port"))
            ):
                diagnostics.append(
                    _diagnostic(
                        "warning",
                        "MACRO_REDEFINITION",
                        f"GPIO macro {name} has multiple definitions; using {existing.file}",
                        file=candidate.file,
                        line=candidate.line,
                        details={
                            "selected": existing.expression,
                            "ignored": candidate.expression,
                        },
                    )
                )
    return macros


_INTEGER_TOKEN = re.compile(
    r"\s*(?:(0[xX][0-9A-Fa-f]+|0[bB][01]+|\d+)(?:[uUlL]+)?|([A-Za-z_]\w*)|(<<|>>|[()|&^+\-~*/%]))"
)
_CAST_PATTERN = re.compile(
    r"\(\s*(?:(?:const|volatile|signed|unsigned|long|short)\s+)*"
    r"(?:u?int(?:8|16|32|64)_t|size_t|char|short|int|long)\s*\*?\s*\)"
)


class _IntegerParser:
    def __init__(self, tokens: list[tuple[str, str]], resolver) -> None:
        self.tokens = tokens
        self.index = 0
        self.resolver = resolver

    def _peek(self, value: str | None = None) -> bool:
        if self.index >= len(self.tokens):
            return False
        return value is None or self.tokens[self.index][1] == value

    def _take(self, value: str | None = None) -> tuple[str, str]:
        if not self._peek(value):
            raise ValueError("unexpected integer-expression token")
        token = self.tokens[self.index]
        self.index += 1
        return token

    def parse(self) -> int:
        value = self._parse_or()
        if self.index != len(self.tokens):
            raise ValueError("trailing integer-expression token")
        return value

    def _parse_or(self) -> int:
        value = self._parse_xor()
        while self._peek("|"):
            self._take()
            value |= self._parse_xor()
        return value

    def _parse_xor(self) -> int:
        value = self._parse_and()
        while self._peek("^"):
            self._take()
            value ^= self._parse_and()
        return value

    def _parse_and(self) -> int:
        value = self._parse_shift()
        while self._peek("&"):
            self._take()
            value &= self._parse_shift()
        return value

    def _parse_shift(self) -> int:
        value = self._parse_additive()
        while self._peek("<<") or self._peek(">>"):
            operator = self._take()[1]
            amount = self._parse_additive()
            if amount < 0 or amount > 63:
                raise ValueError("invalid shift")
            value = value << amount if operator == "<<" else value >> amount
        return value

    def _parse_additive(self) -> int:
        value = self._parse_product()
        while self._peek("+") or self._peek("-"):
            operator = self._take()[1]
            right = self._parse_product()
            value = value + right if operator == "+" else value - right
        return value

    def _parse_product(self) -> int:
        value = self._parse_unary()
        while self._peek("*") or self._peek("/") or self._peek("%"):
            operator = self._take()[1]
            right = self._parse_unary()
            if operator == "*":
                value *= right
            elif operator == "/":
                if right == 0:
                    raise ValueError("division by zero")
                value //= right
            else:
                if right == 0:
                    raise ValueError("division by zero")
                value %= right
        return value

    def _parse_unary(self) -> int:
        if self._peek("+"):
            self._take()
            return self._parse_unary()
        if self._peek("-"):
            self._take()
            return -self._parse_unary()
        if self._peek("~"):
            self._take()
            return ~self._parse_unary()
        return self._parse_primary()

    def _parse_primary(self) -> int:
        if self._peek("("):
            self._take()
            value = self._parse_or()
            self._take(")")
            return value
        kind, value = self._take()
        if kind == "number":
            return int(value, 0)
        if kind == "identifier":
            resolved = self.resolver(value)
            if resolved is None:
                raise ValueError(f"unknown integer macro {value}")
            return resolved
        raise ValueError("integer value expected")


def _tokenise_integer(expression: str) -> list[tuple[str, str]] | None:
    stripped = expression
    previous = None
    while stripped != previous:
        previous = stripped
        stripped = _CAST_PATTERN.sub("", stripped)
    tokens: list[tuple[str, str]] = []
    index = 0
    while index < len(stripped):
        match = _INTEGER_TOKEN.match(stripped, index)
        if not match:
            if stripped[index:].strip() == "":
                break
            return None
        number, identifier, operator = match.groups()
        if number is not None:
            tokens.append(("number", number))
        elif identifier is not None:
            tokens.append(("identifier", identifier))
        else:
            tokens.append(("operator", operator))
        index = match.end()
    return tokens


def _make_integer_resolver(macros: Mapping[str, _Macro]):
    cache: dict[str, int | None] = {}
    resolving: set[str] = set()

    def resolve_identifier(name: str) -> int | None:
        pin_match = re.fullmatch(r"GPIO_PIN_(\d{1,2})", name)
        if pin_match:
            pin_number = int(pin_match.group(1))
            return 1 << pin_number if pin_number < 32 else None
        if name == "GPIO_PIN_ALL":
            return 0xFFFF
        if name in cache:
            return cache[name]
        macro = macros.get(name)
        if macro is None or name in resolving:
            return None
        resolving.add(name)
        value = resolve_expression(macro.expression)
        resolving.remove(name)
        cache[name] = value
        return value

    def resolve_expression(expression: str) -> int | None:
        tokens = _tokenise_integer(expression)
        if not tokens:
            return None
        try:
            return _IntegerParser(tokens, resolve_identifier).parse()
        except (ValueError, OverflowError):
            return None

    return resolve_expression, resolve_identifier


def _resolve_port(expression: str, macros: Mapping[str, _Macro]) -> str | None:
    visited: set[str] = set()

    def walk(text: str) -> str | None:
        direct = re.search(r"\bGPIO([A-K])\b", text)
        if direct:
            return "GPIO" + direct.group(1)
        identifiers = re.findall(r"\b[A-Za-z_]\w*\b", text)
        for identifier in identifiers:
            if identifier in visited:
                continue
            macro = macros.get(identifier)
            if macro is None:
                continue
            visited.add(identifier)
            resolved = walk(macro.expression)
            if resolved:
                return resolved
        return None

    return walk(expression)


def _empty_pin(physical_pin: str) -> dict:
    return {
        "physicalPin": physical_pin,
        "label": "",
        "iocSignal": "",
        "mode": "",
        "configured": False,
        "aliases": [],
    }


def _parse_ioc(records: Sequence[_ProjectFile], diagnostics: list[dict]) -> tuple[dict, dict]:
    candidates = [record for record in records if record.path.casefold().endswith(".ioc")]
    if not candidates:
        diagnostics.append(
            _diagnostic("warning", "IOC_NOT_FOUND", "No STM32CubeMX IOC file was provided")
        )
        return {}, {
            "mcu": "Unknown STM32",
            "pins": {},
            "labelPins": {},
            "uartInstances": {},
            "i2cInstances": {},
            "spiInstances": {},
            "adcInstances": {},
            "timerInstances": {},
            "values": {},
            "file": None,
        }

    def score(record: _ProjectFile) -> tuple[int, int, str]:
        depth = record.path.count("/")
        archive = bool(re.search(r"(?:backup|copy|old|archive)", record.path, re.I))
        return (100 if depth == 0 else 0, -50 if archive else 0, record.path)

    selected = sorted(candidates, key=score, reverse=True)[0]
    if len(candidates) > 1:
        diagnostics.append(
            _diagnostic(
                "warning",
                "MULTIPLE_IOC_FILES",
                f"Multiple IOC files were supplied; using {selected.path}",
                file=selected.path,
                details={"candidates": [item.path for item in candidates]},
            )
        )

    values: dict[str, str] = {}
    value_lines: dict[str, int] = {}
    for line_number, line in enumerate(selected.content.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        values[key] = value.strip()
        value_lines[key] = line_number

    shared_signal_targets: dict[str, str] = {}
    for key, value in values.items():
        shared_match = re.fullmatch(r"SH\.(.+)\.\d+", key, re.I)
        if not shared_match or not value:
            continue
        resolved = value.split(",", 1)[0].strip()
        if resolved:
            shared_signal_targets.setdefault(shared_match.group(1).casefold(), resolved)

    configured_items: list[tuple[int, str]] = []
    for key, value in values.items():
        configured_match = re.fullmatch(r"Mcu\.Pin(\d+)", key)
        if configured_match:
            configured_items.append((int(configured_match.group(1)), value))
    configured_ids = [value for _, value in sorted(configured_items, key=lambda item: item[0])]
    prefixes: set[str] = set(configured_ids)
    for key in values:
        match = re.match(r"^(P[A-K]\d{1,2}(?:-[^.]*)?)\.", key, re.I)
        if match:
            prefixes.add(match.group(1))

    pins: dict[str, dict] = {}
    label_pins: dict[str, str] = {}
    for prefix in sorted(prefixes):
        physical_match = re.match(r"^(P[A-K]\d{1,2})", prefix, re.I)
        if not physical_match:
            continue
        physical_pin = physical_match.group(1).upper()
        pin = pins.setdefault(physical_pin, _empty_pin(physical_pin))
        signal_alias = values.get(prefix + ".Signal", "")
        signal = shared_signal_targets.get(signal_alias.casefold(), signal_alias)
        mode = values.get(prefix + ".Mode", "")
        label = values.get(prefix + ".GPIO_Label", values.get(prefix + ".UserLabel", ""))
        pin.update(
            {
                "label": label,
                "iocSignal": signal,
                "iocSignalAlias": signal_alias if signal_alias != signal else "",
                "mode": mode,
                "configured": bool(signal or label or prefix in configured_ids),
                "source": {
                    "file": selected.path,
                    "line": value_lines.get(prefix + ".Signal", value_lines.get(prefix + ".GPIO_Label", 1)),
                },
            }
        )
        if label:
            label_pins[label.casefold()] = physical_pin

    uart_instances: dict[str, dict] = {}
    i2c_instances: dict[str, dict] = {}
    spi_instances: dict[str, dict] = {}
    adc_instances: dict[str, dict] = {}
    timer_instances: dict[str, dict] = {}
    for physical_pin, pin in pins.items():
        signal_match = re.fullmatch(r"((?:USART|UART)\d+)_(TX|RX)", pin["iocSignal"], re.I)
        if signal_match:
            instance = signal_match.group(1).upper()
            direction = signal_match.group(2).lower()
            uart_instances.setdefault(instance, {})[direction + "Pin"] = physical_pin
        i2c_match = re.fullmatch(r"(I2C\d+)_(SCL|SDA)", pin["iocSignal"], re.I)
        if i2c_match:
            instance = i2c_match.group(1).upper()
            direction = i2c_match.group(2).lower()
            i2c_instances.setdefault(instance, {})[direction + "Pin"] = physical_pin
        spi_match = re.fullmatch(r"(SPI\d+)_(SCK|MOSI|MISO|NSS)", pin["iocSignal"], re.I)
        if spi_match:
            instance = spi_match.group(1).upper()
            direction = spi_match.group(2).lower()
            spi_instances.setdefault(instance, {})[direction + "Pin"] = physical_pin
        adc_match = re.fullmatch(r"(ADC\d+)_IN(\d+)", pin["iocSignal"], re.I)
        if adc_match:
            instance = adc_match.group(1).upper()
            channel_number = int(adc_match.group(2))
            adc_instances.setdefault(instance, {}).setdefault("channels", []).append(
                {
                    "channel": f"ADC_CHANNEL_{channel_number}",
                    "channelNumber": channel_number,
                    "pin": physical_pin,
                    "rank": None,
                }
            )
        timer_match = re.fullmatch(r"(TIM\d+)_(CH\d+)(N)?", pin["iocSignal"], re.I)
        if timer_match:
            instance = timer_match.group(1).upper()
            channel_name = timer_match.group(2).upper()
            channel_number = int(re.search(r"\d+", channel_name).group(0))
            timer_instances.setdefault(instance, {}).setdefault("channels", []).append(
                {
                    "channel": f"TIM_CHANNEL_{channel_number}",
                    "channelName": channel_name + ("N" if timer_match.group(3) else ""),
                    "channelNumber": channel_number,
                    "pin": physical_pin,
                    "complementary": bool(timer_match.group(3)),
                    "pulse": None,
                }
            )
    for key, value in values.items():
        parameter_match = re.fullmatch(
            r"((?:USART|UART)\d+)\.(BaudRate|WordLength|Parity|StopBits|Mode)", key, re.I
        )
        if not parameter_match:
            continue
        instance = parameter_match.group(1).upper()
        parameter = parameter_match.group(2)
        uart_instances.setdefault(instance, {})[parameter] = value
    i2c_parameter_names = {
        "clockspeed": "ClockSpeed",
        "dutycycle": "DutyCycle",
        "addressingmode": "AddressingMode",
        "ownaddress1": "OwnAddress1",
        "ownaddress2": "OwnAddress2",
        "dualaddressmode": "DualAddressMode",
        "generalcallmode": "GeneralCallMode",
        "nostretchmode": "NoStretchMode",
        "timing": "Timing",
        "i2c_speed_mode": "SpeedMode",
    }
    for key, value in values.items():
        parameter_match = re.fullmatch(
            r"(I2C\d+)\.(ClockSpeed|DutyCycle|AddressingMode|OwnAddress1|OwnAddress2|DualAddressMode|GeneralCallMode|NoStretchMode|Timing|I2C_Speed_Mode)",
            key,
            re.I,
        )
        if not parameter_match:
            continue
        instance = parameter_match.group(1).upper()
        raw_parameter = parameter_match.group(2)
        parameter = i2c_parameter_names[raw_parameter.casefold()]
        i2c_instances.setdefault(instance, {})[parameter] = value

    spi_parameter_names = {
        "mode": "Mode",
        "direction": "Direction",
        "datasize": "DataSize",
        "clkpolarity": "CLKPolarity",
        "clkphase": "CLKPhase",
        "nss": "NSS",
        "baudrateprescaler": "BaudRatePrescaler",
        "firstbit": "FirstBit",
    }
    for key, value in values.items():
        parameter_match = re.fullmatch(
            r"(SPI\d+)\.(Mode|Direction|DataSize|CLKPolarity|CLKPhase|NSS|BaudRatePrescaler|FirstBit)",
            key,
            re.I,
        )
        if not parameter_match:
            continue
        instance = parameter_match.group(1).upper()
        raw_parameter = parameter_match.group(2)
        parameter = spi_parameter_names[raw_parameter.casefold()]
        spi_instances.setdefault(instance, {})[parameter] = value

    adc_slots: dict[str, dict[int, dict]] = {}
    for key, value in values.items():
        channel_match = re.fullmatch(r"(ADC\d+)\.Channel-(\d+)(?:\\?#ChannelRegularConversion)?", key, re.I)
        rank_match = re.fullmatch(r"(ADC\d+)\.Rank-(\d+)(?:\\?#ChannelRegularConversion)?", key, re.I)
        sampling_match = re.fullmatch(r"(ADC\d+)\.SamplingTime-(\d+)(?:\\?#ChannelRegularConversion)?", key, re.I)
        matched = channel_match or rank_match or sampling_match
        if not matched:
            continue
        instance = matched.group(1).upper()
        slot = int(matched.group(2))
        descriptor = adc_slots.setdefault(instance, {}).setdefault(slot, {})
        if channel_match:
            descriptor["channel"] = value
        elif rank_match:
            try:
                descriptor["rank"] = int(value, 0)
            except ValueError:
                descriptor["rank"] = value
        else:
            descriptor["samplingTime"] = value
    for instance, slots in adc_slots.items():
        model = adc_instances.setdefault(instance, {"channels": []})
        channels = model.setdefault("channels", [])
        channels_by_name = {str(item.get("channel", "")).upper(): item for item in channels}
        for slot, descriptor in sorted(slots.items()):
            channel_name = str(descriptor.get("channel") or "")
            channel = channels_by_name.get(channel_name.upper())
            if channel is None:
                channel = {"channel": channel_name, "channelNumber": None, "pin": None, "rank": None}
                number_match = re.search(r"(\d+)$", channel_name)
                if number_match:
                    channel["channelNumber"] = int(number_match.group(1))
                channels.append(channel)
                channels_by_name[channel_name.upper()] = channel
            channel["slot"] = slot
            if "rank" in descriptor:
                channel["rank"] = descriptor["rank"]
            if "samplingTime" in descriptor:
                channel["samplingTime"] = descriptor["samplingTime"]
    for model in adc_instances.values():
        model["channels"] = sorted(
            model.get("channels", []),
            key=lambda item: (
                item.get("rank") if isinstance(item.get("rank"), int) else 1_000_000,
                item.get("channelNumber") if isinstance(item.get("channelNumber"), int) else 1_000_000,
            ),
        )

    timer_parameter_names = {
        "prescaler": "Prescaler",
        "period": "Period",
        "countermode": "CounterMode",
        "clockdivision": "ClockDivision",
        "repetitioncounter": "RepetitionCounter",
    }
    for key, value in values.items():
        parameter_match = re.fullmatch(r"(TIM\d+)\.(Prescaler|Period|CounterMode|ClockDivision|RepetitionCounter)", key, re.I)
        if parameter_match:
            instance = parameter_match.group(1).upper()
            parameter = timer_parameter_names[parameter_match.group(2).casefold()]
            timer_instances.setdefault(instance, {}).setdefault("channels", [])
            timer_instances[instance][parameter] = value
            continue
        pulse_match = re.fullmatch(r"(TIM\d+)\.Pulse(?:-PWM Generation\d+)? CH(\d+)", key, re.I)
        if pulse_match:
            instance = pulse_match.group(1).upper()
            channel_number = int(pulse_match.group(2))
            model = timer_instances.setdefault(instance, {"channels": []})
            channel = next((item for item in model["channels"] if item.get("channelNumber") == channel_number), None)
            if channel is None:
                channel = {"channel": f"TIM_CHANNEL_{channel_number}", "channelName": f"CH{channel_number}", "channelNumber": channel_number, "pin": None, "complementary": False}
                model["channels"].append(channel)
            channel["pulse"] = value
    for model in timer_instances.values():
        model["channels"] = sorted(model.get("channels", []), key=lambda item: int(item.get("channelNumber") or 0))

    return values, {
        "mcu": values.get("Mcu.CPN") or values.get("Mcu.Name") or "Unknown STM32",
        "pins": pins,
        "labelPins": label_pins,
        "uartInstances": uart_instances,
        "i2cInstances": i2c_instances,
        "spiInstances": spi_instances,
        "adcInstances": adc_instances,
        "timerInstances": timer_instances,
        "values": values,
        "file": selected.path,
    }


def _build_gpio_aliases(
    macros: Mapping[str, _Macro], ioc: Mapping[str, object], diagnostics: list[dict]
) -> dict[str, dict]:
    aliases: dict[str, dict] = {}
    resolve_integer, _ = _make_integer_resolver(macros)
    label_pins: Mapping[str, str] = ioc["labelPins"]  # type: ignore[assignment]
    pins: dict[str, dict] = ioc["pins"]  # type: ignore[assignment]

    for name, pin_macro in sorted(macros.items()):
        match = re.fullmatch(r"(.+)_Pin", name)
        if not match:
            continue
        alias = match.group(1)
        port_macro_name = alias + "_GPIO_Port"
        port_macro = macros.get(port_macro_name)
        if port_macro is None:
            continue
        port = _resolve_port(port_macro.expression, macros)
        mask = resolve_integer(pin_macro.expression)
        if port is None or mask is None or mask <= 0:
            diagnostics.append(
                _diagnostic(
                    "warning",
                    "GPIO_ALIAS_UNRESOLVED",
                    f"Could not resolve GPIO alias {alias}",
                    file=pin_macro.file,
                    line=pin_macro.line,
                    details={
                        "portExpression": port_macro.expression,
                        "pinExpression": pin_macro.expression,
                    },
                )
            )
            continue
        if mask & (mask - 1):
            diagnostics.append(
                _diagnostic(
                    "warning",
                    "GPIO_ALIAS_MULTIPLE_PINS",
                    f"GPIO alias {alias} resolves to more than one pin",
                    file=pin_macro.file,
                    line=pin_macro.line,
                    details={"mask": mask},
                )
            )
            continue
        pin_number = mask.bit_length() - 1
        physical_pin = f"P{port[-1]}{pin_number}"
        ioc_pin = label_pins.get(alias.casefold())
        confidence = "verified" if ioc_pin == physical_pin else "source"
        if ioc_pin and ioc_pin != physical_pin:
            confidence = "conflict"
            diagnostics.append(
                _diagnostic(
                    "error",
                    "GPIO_IOC_MACRO_CONFLICT",
                    f"GPIO alias {alias} is {physical_pin} in main.h but {ioc_pin} in the IOC",
                    file=pin_macro.file,
                    line=pin_macro.line,
                    details={
                        "alias": alias,
                        "sourcePhysicalPin": physical_pin,
                        "iocPhysicalPin": ioc_pin,
                        "iocFile": ioc.get("file"),
                    },
                )
            )
        alias_model = {
            "alias": alias,
            "port": port,
            "mask": mask,
            "pinNumber": pin_number,
            "physicalPin": physical_pin,
            "iocPhysicalPin": ioc_pin,
            "confidence": confidence,
            "sources": {
                "port": {"file": port_macro.file, "line": port_macro.line, "macro": port_macro_name},
                "pin": {"file": pin_macro.file, "line": pin_macro.line, "macro": name},
            },
        }
        aliases[alias] = alias_model
        pin = pins.setdefault(physical_pin, _empty_pin(physical_pin))
        if alias not in pin["aliases"]:
            pin["aliases"].append(alias)

    for label_key, physical_pin in label_pins.items():
        pin = pins[physical_pin]
        alias = pin["label"]
        if not alias or any(name.casefold() == label_key for name in aliases):
            continue
        pin_number_match = re.fullmatch(r"P([A-K])(\d{1,2})", physical_pin)
        if not pin_number_match:
            continue
        port_letter, number_text = pin_number_match.groups()
        pin_number = int(number_text)
        aliases[alias] = {
            "alias": alias,
            "port": "GPIO" + port_letter,
            "mask": 1 << pin_number,
            "pinNumber": pin_number,
            "physicalPin": physical_pin,
            "iocPhysicalPin": physical_pin,
            "confidence": "ioc-only",
            "sources": {"ioc": pin.get("source")},
        }
        if alias not in pin["aliases"]:
            pin["aliases"].append(alias)
    return aliases


def _source_line(source: str, position: int) -> tuple[int, int]:
    line = source.count("\n", 0, position) + 1
    last_break = source.rfind("\n", 0, position)
    return line, position - last_break


def _lex_c(source: str) -> list[_Token]:
    cleaned = _strip_comments(source)
    tokens: list[_Token] = []
    index = 0
    line = 1
    column = 1
    multi_operators = ("<<=", ">>=", "...", "==", "!=", "<=", ">=", "&&", "||", "->", "++", "--", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=")

    def advance(text: str) -> None:
        nonlocal line, column
        breaks = text.count("\n")
        if breaks:
            line += breaks
            column = len(text.rsplit("\n", 1)[-1]) + 1
        else:
            column += len(text)

    while index < len(cleaned):
        char = cleaned[index]
        if char.isspace():
            advance(char)
            index += 1
            continue
        if char == "#" and (index == 0 or cleaned[index - 1] == "\n"):
            end = cleaned.find("\n", index)
            if end < 0:
                break
            text = cleaned[index:end]
            advance(text)
            index = end
            continue
        start, token_line, token_column = index, line, column
        if char.isalpha() or char == "_":
            index += 1
            while index < len(cleaned) and (cleaned[index].isalnum() or cleaned[index] == "_"):
                index += 1
            text = cleaned[start:index]
            tokens.append(_Token(text, "identifier", start, token_line, token_column))
            advance(text)
            continue
        if char.isdigit():
            index += 1
            while index < len(cleaned) and (cleaned[index].isalnum() or cleaned[index] in "._"):
                index += 1
            text = cleaned[start:index]
            tokens.append(_Token(text, "number", start, token_line, token_column))
            advance(text)
            continue
        if char in {'"', "'"}:
            delimiter = char
            index += 1
            while index < len(cleaned):
                if cleaned[index] == "\\":
                    index += 2
                    continue
                if cleaned[index] == delimiter:
                    index += 1
                    break
                index += 1
            text = cleaned[start:index]
            tokens.append(_Token(text, "string" if delimiter == '"' else "char", start, token_line, token_column))
            advance(text)
            continue
        operator = next((item for item in multi_operators if cleaned.startswith(item, index)), None)
        text = operator or char
        tokens.append(_Token(text, "operator", start, token_line, token_column))
        index += len(text)
        advance(text)
    return tokens


def _matching(tokens: Sequence[_Token], start: int, opening: str, closing: str) -> int | None:
    if start >= len(tokens) or tokens[start].value != opening:
        return None
    depth = 0
    for index in range(start, len(tokens)):
        if tokens[index].value == opening:
            depth += 1
        elif tokens[index].value == closing:
            depth -= 1
            if depth == 0:
                return index
    return None


def _strip_wrapping_parentheses(tokens: Sequence[_Token]) -> list[_Token]:
    output = list(tokens)
    while len(output) >= 2 and output[0].value == "(":
        match = _matching(output, 0, "(", ")")
        if match != len(output) - 1:
            break
        output = output[1:-1]
    return output


def _tokens_text(tokens: Sequence[_Token]) -> str:
    return " ".join(token.value for token in tokens)


def _decode_c_char(token: str) -> str | None:
    if len(token) < 2 or token[0] != "'" or token[-1] != "'":
        return None
    body = token[1:-1]
    if len(body) == 1:
        return body
    escapes = {
        r"\0": "\0",
        r"\a": "\a",
        r"\b": "\b",
        r"\t": "\t",
        r"\n": "\n",
        r"\v": "\v",
        r"\f": "\f",
        r"\r": "\r",
        r"\\": "\\",
        r"\'": "'",
        r'\"': '"',
    }
    if body in escapes:
        return escapes[body]
    hex_match = re.fullmatch(r"\\x([0-9A-Fa-f]{1,2})", body)
    if hex_match:
        return chr(int(hex_match.group(1), 16))
    octal_match = re.fullmatch(r"\\([0-7]{1,3})", body)
    if octal_match:
        return chr(int(octal_match.group(1), 8))
    return None


def _parse_c_integer(text: str) -> int | None:
    match = re.fullmatch(r"(0[xX][0-9A-Fa-f]+|0[bB][01]+|\d+)(?:[uUlL]+)?", text)
    if not match:
        return None
    try:
        return int(match.group(1), 0)
    except ValueError:
        return None


def _decode_c_string_literal(text: str) -> list[int] | None:
    value = text.strip()
    if len(value) < 2 or value[0] != '"' or value[-1] != '"':
        return None
    body = value[1:-1]
    output: list[int] = []
    index = 0
    escapes = {
        "0": 0,
        "a": 7,
        "b": 8,
        "t": 9,
        "n": 10,
        "v": 11,
        "f": 12,
        "r": 13,
        "\\": 92,
        "'": 39,
        '"': 34,
    }
    while index < len(body):
        char = body[index]
        if char != "\\":
            output.extend(char.encode("utf-8"))
            index += 1
            continue
        index += 1
        if index >= len(body):
            return None
        escaped = body[index]
        if escaped in escapes:
            output.append(escapes[escaped])
            index += 1
            continue
        if escaped in "xX":
            match = re.match(r"[0-9A-Fa-f]{1,2}", body[index + 1 :])
            if not match:
                return None
            output.append(int(match.group(0), 16) & 0xFF)
            index += 1 + len(match.group(0))
            continue
        if escaped in "01234567":
            match = re.match(r"[0-7]{1,3}", body[index:])
            if not match:
                return None
            output.append(int(match.group(0), 8) & 0xFF)
            index += len(match.group(0))
            continue
        output.append(ord(escaped) & 0xFF)
        index += 1
    return output


def _parse_initial_variables(
    records: Sequence[_ProjectFile], macros: Mapping[str, _Macro]
) -> dict[str, object]:
    """Collect simple C scalar/array initializers used by HAL buffer calls.

    This is deliberately not a C evaluator.  It accepts fixed-size integer
    arrays, flat brace initializers, string literals, and integer expressions
    already supported by the macro resolver.  Unknown expressions are skipped
    instead of being invented.
    """

    resolve_expression, _ = _make_integer_resolver(macros)
    declaration_pattern = re.compile(
        r"\b(?P<qualifiers>(?:(?:static|const|volatile|register)\s+)*)"
        r"(?P<type>(?:u?int(?:8|16|32|64)_t|size_t|char|short|int|long|unsigned\s+char|unsigned\s+short|unsigned\s+int|unsigned\s+long))"
        r"\s+(?P<name>[A-Za-z_]\w*)\s*"
        r"(?:\[\s*(?P<size>[^\]]*)\s*\])?\s*"
        r"(?:=\s*(?P<initializer>\{[^;]*\}|\"(?:\\.|[^\"\\])*\"|[^;]+?))?\s*;",
        re.MULTILINE | re.DOTALL,
    )
    variables: dict[str, object] = {}

    def integer_value(expression: str) -> int | None:
        text = expression.strip()
        parsed = _parse_c_integer(text)
        if parsed is not None:
            return parsed
        if len(text) >= 2 and text[0] == "'" and text[-1] == "'":
            decoded = _decode_c_char(text)
            return ord(decoded) if decoded is not None else None
        return resolve_expression(text)

    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _strip_comments(record.content)
        for match in declaration_pattern.finditer(cleaned):
            name = match.group("name")
            size_text = match.group("size")
            initializer = (match.group("initializer") or "").strip()
            is_array = size_text is not None
            if is_array:
                size = resolve_expression(size_text.strip()) if size_text and size_text.strip() else None
                values: list[int] | None = None
                if initializer.startswith("{") and initializer.endswith("}"):
                    values = []
                    for item in initializer[1:-1].split(","):
                        if not item.strip():
                            continue
                        resolved = integer_value(item)
                        if resolved is None:
                            values = None
                            break
                        values.append(resolved & 0xFF)
                elif initializer.startswith('"'):
                    values = _decode_c_string_literal(initializer)
                    if values is not None:
                        values.append(0)
                elif not initializer and size is not None:
                    values = []
                if values is None:
                    continue
                if size is None:
                    size = len(values)
                if size < 0 or size > 1_000_000:
                    continue
                values = values[:size] + [0] * max(0, size - len(values))
                variables[name] = values
                continue

            if not initializer:
                continue
            scalar = integer_value(initializer)
            if scalar is not None:
                variables[name] = scalar
    return variables


def _parse_variable_types(records: Sequence[_ProjectFile]) -> dict[str, str]:
    """Collect scalar/array integer declarations for runtime C-width coercion.

    The behaviour model remains value-oriented, but preserving the declared C
    type lets the browser runtime apply the width/sign rules when assigning a
    result back to a variable.  Unknown declarations are intentionally omitted.
    """
    declaration_pattern = re.compile(
        r"\b(?P<qualifiers>(?:(?:static|const|volatile|register)\s+)*)"
        r"(?P<type>(?:u?int(?:8|16|32|64)_t|size_t|_Bool|bool|char|signed\s+char|short|signed\s+short|int|signed\s+int|long|signed\s+long|"
        r"unsigned\s+(?:char|short|int|long)))"
        r"\s+(?P<name>[A-Za-z_]\w*)\s*"
        r"(?:\[[^\]]*\])?\s*"
        r"(?:=\s*(?:\{[^;]*\}|\"(?:\\.|[^\"\\])*\"|[^;]+?))?\s*;",
        re.MULTILINE | re.DOTALL,
    )
    variable_types: dict[str, str] = {}
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _strip_comments(record.content)
        for match in declaration_pattern.finditer(cleaned):
            variable_types[match.group("name")] = re.sub(r"\s+", " ", match.group("type").strip().lower())
    return variable_types


def _expression_model(tokens: Sequence[_Token], resolve_integer) -> dict:
    cleaned = _strip_wrapping_parentheses(tokens)
    while cleaned and cleaned[0].value in {"&", "*", "+"}:
        cleaned = cleaned[1:]
    if not cleaned:
        return {"kind": "unknown", "text": ""}

    binary_names = {
        "|": "bitOr",
        "^": "bitXor",
        "&": "bitAnd",
        "<<": "shiftLeft",
        ">>": "shiftRight",
        "+": "add",
        "-": "sub",
        "*": "mul",
        "/": "div",
        "%": "mod",
    }

    def rightmost_top_level_operator(operators: set[str]) -> int | None:
        depth = 0
        selected = None
        for index, token in enumerate(cleaned):
            if token.value in {"(", "["}:
                depth += 1
                continue
            if token.value in {")", "]"}:
                depth -= 1
                continue
            if depth != 0 or token.value not in operators:
                continue
            if token.value in {"+", "-", "*", "&"} and (
                index == 0 or cleaned[index - 1].value in {"(", "[", ",", "=", "+", "-", "*", "/", "%", "&", "|", "^", "<<", ">>"}
            ):
                continue
            selected = index
        return selected

    for operators in ({"|"}, {"^"}, {"&"}, {"<<", ">>"}, {"+", "-"}, {"*", "/", "%"}):
        operator_index = rightmost_top_level_operator(operators)
        if operator_index is None:
            continue
        operator = cleaned[operator_index].value
        return {
            "kind": binary_names[operator],
            "left": _expression_model(cleaned[:operator_index], resolve_integer),
            "right": _expression_model(cleaned[operator_index + 1 :], resolve_integer),
        }
    if len(cleaned) == 1:
        token = cleaned[0]
        if token.kind == "string":
            decoded = _decode_c_string_literal(token.value)
            if decoded is not None:
                try:
                    value = bytes(decoded).decode("utf-8")
                except UnicodeDecodeError:
                    value = bytes(decoded).decode("latin-1")
                return {"kind": "string", "value": value, "bytes": decoded}
        if token.kind == "char":
            value = _decode_c_char(token.value)
            if value is not None:
                return {"kind": "char", "value": value, "code": ord(value)}
        if token.kind == "number":
            value = _parse_c_integer(token.value)
            if value is not None:
                return {"kind": "literal", "value": value}
        if token.kind == "identifier":
            constants = {
                "HAL_OK": 0,
                "HAL_ERROR": 1,
                "HAL_BUSY": 2,
                "HAL_TIMEOUT": 3,
                "GPIO_PIN_RESET": 0,
                "GPIO_PIN_SET": 1,
                "RESET": 0,
                "SET": 1,
            }
            if token.value in constants:
                return {"kind": "constant", "name": token.value, "value": constants[token.value]}
            resolved = resolve_integer(token.value)
            if resolved is not None:
                return {"kind": "constant", "name": token.value, "value": resolved}
            return {"kind": "variable", "name": token.value}
    if len(cleaned) >= 4 and cleaned[0].kind == "identifier" and cleaned[1].value == "[":
        close_bracket = _matching(cleaned, 1, "[", "]")
        if close_bracket == len(cleaned) - 1:
            index_model = _expression_model(cleaned[2:close_bracket], resolve_integer)
            index_value = index_model.get("value") if index_model.get("kind") == "literal" else index_model
            return {"kind": "arrayIndex", "name": cleaned[0].value, "index": index_value}
    if (
        len(cleaned) == 3
        and cleaned[0].kind == "identifier"
        and cleaned[1].value in {".", "->"}
        and cleaned[2].kind == "identifier"
    ):
        return {
            "kind": "member",
            "object": {"kind": "variable", "name": cleaned[0].value},
            "member": cleaned[2].value,
            "pointer": cleaned[1].value == "->",
        }
    text = _tokens_text(cleaned)
    resolved = resolve_integer(text)
    if resolved is not None:
        return {"kind": "literal", "value": resolved, "text": text}
    return {"kind": "expression", "text": text}


def _runtime_expression_supported(expression: Mapping[str, object]) -> bool:
    """Return whether the browser runtime can evaluate this expression model.

    Some HAL arguments are intentionally dynamic.  They cannot be folded by
    the compile-time macro resolver, but the firmware runtime can evaluate
    variables, array subscripts, and the same integer operators used by the
    semantic model.  Keeping this check separate prevents valid code such as
    ``HAL_Delay(table[index])`` from being rejected merely because its value
    is only known while the simulated program is running.
    """

    kind = str(expression.get("kind") or "")
    if kind in {"literal", "constant", "variable", "char", "string"}:
        return True
    if kind == "arrayIndex":
        index = expression.get("index")
        return not isinstance(index, Mapping) or _runtime_expression_supported(index)
    if kind == "member":
        object_model = expression.get("object")
        return not isinstance(object_model, Mapping) or _runtime_expression_supported(object_model)
    if kind in {"add", "sub", "mul", "div", "mod", "bitOr", "bitXor", "bitAnd", "shiftLeft", "shiftRight"}:
        left = expression.get("left")
        right = expression.get("right")
        return (
            isinstance(left, Mapping)
            and isinstance(right, Mapping)
            and _runtime_expression_supported(left)
            and _runtime_expression_supported(right)
        )
    return False


def _condition_model(tokens: Sequence[_Token], resolve_integer) -> dict:
    cleaned = _strip_wrapping_parentheses(tokens)
    operator_names = {
        "==": "eq",
        "!=": "ne",
        "&&": "and",
        "||": "or",
        "<": "lt",
        ">": "gt",
        "<=": "le",
        ">=": "ge",
    }

    def top_level_operator(operators: set[str]) -> int | None:
        depth = 0
        for index, token in enumerate(cleaned):
            if token.value in {"(", "["}:
                depth += 1
            elif token.value in {")", "]"}:
                depth -= 1
            elif depth == 0 and token.value in operators:
                return index
        return None

    # Split in C precedence order so compound conditions become a nested tree
    # the browser runtime can short-circuit correctly.
    for operators, logical in (({"||"}, True), ({"&&"}, True), ({"==", "!=", "<", ">", "<=", ">="}, False)):
        index = top_level_operator(operators)
        if index is None:
            continue
        token = cleaned[index]
        left_tokens = cleaned[:index]
        right_tokens = cleaned[index + 1 :]
        return {
            "op": operator_names[token.value],
            "left": _condition_model(left_tokens, resolve_integer) if logical else _expression_model(left_tokens, resolve_integer),
            "right": _condition_model(right_tokens, resolve_integer) if logical else _expression_model(right_tokens, resolve_integer),
        }
    expression = _expression_model(cleaned, resolve_integer)
    return expression


def _split_arguments(tokens: Sequence[_Token]) -> list[list[_Token]]:
    if not tokens:
        return []
    arguments: list[list[_Token]] = []
    start = 0
    depths = {"(": 0, "[": 0, "{": 0}
    closing = {")": "(", "]": "[", "}": "{"}
    for index, token in enumerate(tokens):
        if token.value in depths:
            depths[token.value] += 1
        elif token.value in closing:
            key = closing[token.value]
            depths[key] = max(0, depths[key] - 1)
        elif token.value == "," and not any(depths.values()):
            arguments.append(list(tokens[start:index]))
            start = index + 1
    arguments.append(list(tokens[start:]))
    return arguments


def _first_identifier(tokens: Sequence[_Token], *, ignore: set[str] | None = None) -> str | None:
    ignored = ignore or set()
    for token in tokens:
        if token.kind == "identifier" and token.value not in ignored:
            return token.value
    return None


class _StatementParser:
    _UNSUPPORTED_CONTROL = {"do", "goto"}
    _DECLARATION_PREFIXES = {
        "auto", "bool", "char", "const", "double", "enum", "extern", "float", "inline", "int", "long",
        "register", "short", "signed", "size_t", "static", "struct", "typedef", "union", "unsigned",
        "void", "volatile", "_bool", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "int8_t", "int16_t",
        "int32_t", "int64_t",
    }

    def __init__(
        self,
        tokens: Sequence[_Token],
        file: str,
        macros: Mapping[str, _Macro],
        aliases: Mapping[str, dict],
        uart_instances: Mapping[str, dict],
        i2c_instances: Mapping[str, dict],
        spi_instances: Mapping[str, dict],
        adc_instances: Mapping[str, dict],
        diagnostics: list[dict],
    ) -> None:
        self.tokens = list(tokens)
        self.file = file
        self.macros = macros
        self.aliases = aliases
        self.uart_instances = uart_instances
        self.i2c_instances = i2c_instances
        self.spi_instances = spi_instances
        self.adc_instances = adc_instances
        self.diagnostics = diagnostics
        self.resolve_expression, self.resolve_identifier = _make_integer_resolver(macros)

    def _source(self, token: _Token) -> dict:
        return {"file": self.file, "line": token.line, "column": token.column}

    def _unsupported(self, tokens: Sequence[_Token], code: str, message: str | None = None) -> dict:
        token = tokens[0] if tokens else _Token("", "operator", 0, 1, 1)
        source = self._source(token)
        text = _tokens_text(tokens).strip()
        self.diagnostics.append(
            _diagnostic(
                "error",
                code,
                message or f"Unsupported C statement: {text[:160]}",
                **source,
                details={"statement": text},
            )
        )
        return {"op": "unsupported", "statement": text, "source": source}

    def parse(self, start: int = 0, end: int | None = None) -> list[dict]:
        end = len(self.tokens) if end is None else end
        operations: list[dict] = []
        index = start
        while index < end:
            value = self.tokens[index].value
            if value in {";", "}"}:
                index += 1
                continue
            if value == "if":
                operation, index = self._parse_if(index, end)
                if operation:
                    operations.append(operation)
                continue
            if value == "while":
                operation, index = self._parse_while(index, end)
                if operation:
                    operations.append(operation)
                continue
            if value == "for":
                operation, index = self._parse_for(index, end)
                if operation:
                    operations.append(operation)
                continue
            if value == "switch":
                operation, index = self._parse_switch(index, end)
                if operation:
                    operations.append(operation)
                continue
            if value == "return":
                operation, index = self._parse_return(index, end)
                if operation:
                    operations.append(operation)
                continue
            if value in {"break", "continue"}:
                statement_end = self._statement_end(index, end)
                next_index = statement_end + (
                    1 if statement_end < end and self.tokens[statement_end].value == ";" else 0
                )
                operations.append({
                    "op": value,
                    "source": self._source(self.tokens[index]),
                })
                index = next_index
                continue
            if value in self._UNSUPPORTED_CONTROL:
                next_index = self._skip_unsupported_control(index, end)
                operations.append(self._unsupported(self.tokens[index:next_index], "C_UNSUPPORTED_STATEMENT", f"C control statement '{value}' is not supported by the semantic model"))
                index = next_index
                continue
            if value == "{":
                close = _matching(self.tokens, index, "{", "}")
                if close is None or close > end:
                    break
                operations.extend(self.parse(index + 1, close))
                index = close + 1
                continue
            statement_end = self._statement_end(index, end)
            if statement_end <= index:
                index += 1
                continue
            operation = self._parse_simple(self.tokens[index:statement_end])
            if operation:
                operations.append(operation)
            index = statement_end + (1 if statement_end < end and self.tokens[statement_end].value == ";" else 0)
        return operations

    def _skip_unsupported_control(self, start: int, end: int) -> int:
        cursor = start + 1
        if cursor < end and self.tokens[cursor].value == "(":
            close = _matching(self.tokens, cursor, "(", ")")
            if close is not None and close < end:
                cursor = close + 1
        if cursor < end and self.tokens[cursor].value == "{":
            close = _matching(self.tokens, cursor, "{", "}")
            if close is not None and close < end:
                cursor = close + 1
                if start < end and self.tokens[start].value == "do" and cursor < end and self.tokens[cursor].value == "while":
                    statement_end = self._statement_end(cursor, end)
                    return min(end, statement_end + (1 if statement_end < end and self.tokens[statement_end].value == ";" else 0))
                return cursor
        statement_end = self._statement_end(cursor, end)
        return min(end, statement_end + (1 if statement_end < end and self.tokens[statement_end].value == ";" else 0))

    def _statement_end(self, start: int, end: int) -> int:
        depths = {"(": 0, "[": 0, "{": 0}
        closing = {")": "(", "]": "[", "}": "{"}
        for index in range(start, end):
            value = self.tokens[index].value
            if value in depths:
                depths[value] += 1
            elif value in closing:
                key = closing[value]
                if depths[key] == 0 and value == "}":
                    return index
                depths[key] = max(0, depths[key] - 1)
            elif value == ";" and not any(depths.values()):
                return index
        return end

    def _body(self, start: int, end: int) -> tuple[list[dict], int]:
        if start >= end:
            return [], start
        if self.tokens[start].value == "{":
            close = _matching(self.tokens, start, "{", "}")
            if close is None or close > end:
                return [], end
            return self.parse(start + 1, close), close + 1
        if self.tokens[start].value == "if":
            operation, next_index = self._parse_if(start, end)
            return ([operation] if operation else []), next_index
        if self.tokens[start].value == "while":
            operation, next_index = self._parse_while(start, end)
            return ([operation] if operation else []), next_index
        if self.tokens[start].value == "for":
            operation, next_index = self._parse_for(start, end)
            return ([operation] if operation else []), next_index
        if self.tokens[start].value == "switch":
            operation, next_index = self._parse_switch(start, end)
            return ([operation] if operation else []), next_index
        if self.tokens[start].value == "return":
            operation, next_index = self._parse_return(start, end)
            return ([operation] if operation else []), next_index
        if self.tokens[start].value in {"break", "continue"}:
            statement_end = self._statement_end(start, end)
            next_index = statement_end + (
                1 if statement_end < end and self.tokens[statement_end].value == ";" else 0
            )
            return ([{"op": self.tokens[start].value, "source": self._source(self.tokens[start])}], next_index)
        statement_end = self._statement_end(start, end)
        operation = self._parse_simple(self.tokens[start:statement_end])
        next_index = statement_end + (
            1 if statement_end < end and self.tokens[statement_end].value == ";" else 0
        )
        return ([operation] if operation else []), next_index

    def _parse_if(self, start: int, end: int) -> tuple[dict | None, int]:
        if start + 1 >= end or self.tokens[start + 1].value != "(":
            return None, start + 1
        condition_end = _matching(self.tokens, start + 1, "(", ")")
        if condition_end is None or condition_end >= end:
            return None, end
        then_ops, next_index = self._body(condition_end + 1, end)
        else_ops: list[dict] = []
        if next_index < end and self.tokens[next_index].value == "else":
            if next_index + 1 < end and self.tokens[next_index + 1].value == "if":
                nested, next_index = self._parse_if(next_index + 1, end)
                if nested:
                    else_ops.append(nested)
            else:
                else_ops, next_index = self._body(next_index + 1, end)
        return {
            "op": "if",
            "condition": _condition_model(
                self.tokens[start + 2 : condition_end], self.resolve_expression
            ),
            "then": then_ops,
            "else": else_ops,
            "source": self._source(self.tokens[start]),
        }, next_index

    def _parse_while(self, start: int, end: int) -> tuple[dict | None, int]:
        if start + 1 >= end or self.tokens[start + 1].value != "(":
            return None, start + 1
        condition_end = _matching(self.tokens, start + 1, "(", ")")
        if condition_end is None:
            return None, end
        body, next_index = self._body(condition_end + 1, end)
        return {
            "op": "while",
            "condition": _condition_model(
                self.tokens[start + 2 : condition_end], self.resolve_expression
            ),
            "body": body,
            "source": self._source(self.tokens[start]),
        }, next_index

    def _split_for_header(self, tokens: Sequence[_Token]) -> list[list[_Token]]:
        parts: list[list[_Token]] = []
        start = 0
        depths = {"(": 0, "[": 0, "{": 0}
        closing = {")": "(", "]": "[", "}": "{"}
        for index, token in enumerate(tokens):
            if token.value in depths:
                depths[token.value] += 1
            elif token.value in closing:
                depths[closing[token.value]] = max(0, depths[closing[token.value]] - 1)
            elif token.value == ";" and not any(depths.values()):
                parts.append(list(tokens[start:index]))
                start = index + 1
        parts.append(list(tokens[start:]))
        return parts

    def _parse_for_clause(self, tokens: Sequence[_Token]) -> list[dict]:
        if not tokens:
            return []
        # C permits comma-separated expressions in all three for clauses.
        clauses = _split_arguments(tokens)
        operations: list[dict] = []
        for clause in clauses:
            operation = self._parse_simple(clause)
            if operation:
                operations.append(operation)
        return operations

    def _parse_for(self, start: int, end: int) -> tuple[dict | None, int]:
        if start + 1 >= end or self.tokens[start + 1].value != "(":
            return None, start + 1
        header_end = _matching(self.tokens, start + 1, "(", ")")
        if header_end is None or header_end >= end:
            return None, end
        header = self._split_for_header(self.tokens[start + 2 : header_end])
        while len(header) < 3:
            header.append([])
        init_ops = self._parse_for_clause(header[0])
        increment_ops = self._parse_for_clause(header[2])
        condition = _condition_model(header[1], self.resolve_expression) if header[1] else {"kind": "literal", "value": True}
        body, next_index = self._body(header_end + 1, end)
        return {
            "op": "for",
            "init": init_ops,
            "condition": condition,
            "increment": increment_ops,
            "body": body,
            "source": self._source(self.tokens[start]),
        }, next_index

    def _parse_return(self, start: int, end: int) -> tuple[dict, int]:
        statement_end = self._statement_end(start, end)
        value_tokens = self.tokens[start + 1 : statement_end]
        operation: dict = {"op": "return", "source": self._source(self.tokens[start])}
        if value_tokens:
            operation["value"] = _expression_model(value_tokens, self.resolve_expression)
        next_index = statement_end + (
            1 if statement_end < end and self.tokens[statement_end].value == ";" else 0
        )
        return operation, next_index

    def _parse_switch(self, start: int, end: int) -> tuple[dict | None, int]:
        if start + 1 >= end or self.tokens[start + 1].value != "(":
            return None, start + 1
        expression_end = _matching(self.tokens, start + 1, "(", ")")
        if expression_end is None or expression_end + 1 >= end or self.tokens[expression_end + 1].value != "{":
            return None, end
        body_end = _matching(self.tokens, expression_end + 1, "{", "}")
        if body_end is None or body_end > end:
            return None, end

        cases: list[dict] = []
        default_body: list[dict] = []
        entries: list[dict] = []
        current: dict | None = None
        body_start = expression_end + 2
        nested_braces = 0
        cursor = body_start
        while cursor < body_end:
            token = self.tokens[cursor]
            if token.value == "{" :
                nested_braces += 1
            elif token.value == "}":
                nested_braces = max(0, nested_braces - 1)
            if nested_braces == 0 and token.value in {"case", "default"}:
                if current is not None:
                    current["body"] = self.parse(body_start, cursor)
                    entries.append(current)
                    if current.get("default"):
                        default_body = current["body"]
                    else:
                        cases.append(current)
                colon = cursor + 1
                label_start = colon
                label_value: dict | None = None
                if token.value == "case":
                    while colon < body_end and self.tokens[colon].value != ":":
                        colon += 1
                    if colon >= body_end:
                        return None, end
                    label_value = _expression_model(self.tokens[label_start:colon], self.resolve_expression)
                else:
                    while colon < body_end and self.tokens[colon].value != ":":
                        colon += 1
                    if colon >= body_end:
                        return None, end
                current = {
                    "value": label_value,
                    "default": token.value == "default",
                    "source": self._source(token),
                    "body": [],
                }
                body_start = colon + 1
                cursor = body_start
                continue
            cursor += 1
        if current is not None:
            current["body"] = self.parse(body_start, body_end)
            entries.append(current)
            if current.get("default"):
                default_body = current["body"]
            else:
                cases.append(current)
        elif body_start < body_end:
            default_body = self.parse(body_start, body_end)
            entries.append({"value": None, "default": True, "body": default_body})
        return {
            "op": "switch",
            "expression": _expression_model(self.tokens[start + 2 : expression_end], self.resolve_expression),
            "cases": cases,
            "default": default_body,
            "entries": entries,
            "source": self._source(self.tokens[start]),
        }, body_end + 1

    def _parse_simple(self, tokens: Sequence[_Token]) -> dict | None:
        if not tokens:
            return None
        depth = 0
        assignment_index: int | None = None
        compound_assignment_index: int | None = None
        for index, token in enumerate(tokens):
            if token.value in {"(", "["}:
                depth += 1
            elif token.value in {")", "]"}:
                depth = max(0, depth - 1)
            elif token.value == "=" and depth == 0:
                assignment_index = index
                break
            elif token.value in {"+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="} and depth == 0:
                compound_assignment_index = index
                break
        if compound_assignment_index is not None:
            left = list(tokens[:compound_assignment_index])
            target = next((token.value for token in reversed(left) if token.kind == "identifier"), None)
            if not target or any(token.value in {".", "->", "[", "]"} for token in left):
                return self._unsupported(tokens, "C_UNSUPPORTED_COMPOUND_ASSIGNMENT", "Compound assignment target is not supported by the semantic model")
            operator = tokens[compound_assignment_index].value[:-1]
            binary_names = {"+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod", "&": "bitAnd", "|": "bitOr", "^": "bitXor", "<<": "shiftLeft", ">>": "shiftRight"}
            return {
                "op": "assign",
                "target": target,
                "value": {"kind": binary_names[operator], "left": {"kind": "variable", "name": target}, "right": _expression_model(tokens[compound_assignment_index + 1 :], self.resolve_expression)},
                "source": self._source(tokens[0]),
            }
        if len(tokens) == 2 and tokens[0].kind == "identifier" and tokens[1].value in {"++", "--"}:
            return {"op": "assign", "target": tokens[0].value, "value": {"kind": "add" if tokens[1].value == "++" else "sub", "left": {"kind": "variable", "name": tokens[0].value}, "right": {"kind": "literal", "value": 1}}, "source": self._source(tokens[0])}
        if len(tokens) == 2 and tokens[1].kind == "identifier" and tokens[0].value in {"++", "--"}:
            return {"op": "assign", "target": tokens[1].value, "value": {"kind": "add" if tokens[0].value == "++" else "sub", "left": {"kind": "variable", "name": tokens[1].value}, "right": {"kind": "literal", "value": 1}}, "source": self._source(tokens[0])}
        for index, token in enumerate(tokens[:-1]):
            is_hal_call = token.kind == "identifier" and (token.value.startswith("HAL_") or token.value.startswith("__HAL_"))
            is_alice_call = token.kind == "identifier" and token.value.startswith("AliceSIM_")
            is_middleware_call = token.kind == "identifier" and token.value in {
                "vTaskDelay", "vTaskDelayUntil", "taskYIELD", "osDelay", "osDelayUntil", "osThreadYield",
                "xQueueReceive", "xSemaphoreTake", "osMessageQueueGet", "osSemaphoreAcquire",
            }
            if (is_hal_call or is_alice_call or is_middleware_call) and tokens[index + 1].value == "(":
                close = _matching(tokens, index + 1, "(", ")")
                if close is not None:
                    arguments = _split_arguments(tokens[index + 2 : close])
                    if is_hal_call:
                        operation = self._parse_hal_call(token, arguments)
                    elif is_alice_call:
                        operation = self._parse_alicesim_call(token, arguments)
                    else:
                        operation = self._parse_middleware_call(token, arguments)
                    if operation is None and is_hal_call:
                        return None
                    if operation and operation.get("op") == "adcGetValue" and assignment_index is not None and assignment_index < index:
                        left = list(tokens[:assignment_index])
                        target = next((item.value for item in reversed(left) if item.kind == "identifier"), None)
                        if target and not any(item.value in {".", "->"} for item in left):
                            operation["target"] = target
                    elif operation and assignment_index is not None and assignment_index < index:
                        left = list(tokens[:assignment_index])
                        target = next((item.value for item in reversed(left) if item.kind == "identifier"), None)
                        if target and not any(item.value in {".", "->"} for item in left):
                            operation["resultTarget"] = target
                    return operation

        if assignment_index is None:
            call_index = next((index for index, token in enumerate(tokens[:-1]) if token.kind == "identifier" and tokens[index + 1].value == "("), None)
            if call_index is not None:
                # CubeMX-generated peripheral init wrappers are validated by
                # clang and their HAL calls are modeled separately when they
                # appear in the selected program. They do not need a runtime
                # instruction of their own.
                call_name = tokens[call_index].value
                if call_name.startswith("MX_") or call_name == "SystemClock_Config":
                    return None
                if call_name == "Error_Handler":
                    return {
                        "op": "fault",
                        "message": "Firmware entered Error_Handler()",
                        "source": self._source(tokens[call_index]),
                    }
                return self._unsupported(tokens, "C_UNSUPPORTED_FUNCTION_CALL", f"Function call '{call_name}' is outside the supported HAL/driver subset")
            first = next((token.value.lower() for token in tokens if token.kind == "identifier"), "")
            if first in self._DECLARATION_PREFIXES or first.startswith(("uint", "int")) and first.endswith("_t"):
                return None
            if len(tokens) >= 2 and tokens[0].kind == "identifier" and tokens[0].value.startswith("AliceSIM_") and tokens[1].kind == "identifier":
                return None
            return self._unsupported(tokens, "C_UNSUPPORTED_STATEMENT")
        left = list(tokens[:assignment_index])
        if any(token.value in {".", "->"} for token in left):
            # Peripheral handle/configuration writes are compile-valid C but
            # are not needed by the value-oriented HAL behavior model.
            return None
        target: str | dict | None = None
        bracket_index = next((index for index, token in enumerate(left) if token.value == "["), None)
        if bracket_index is not None and bracket_index > 0 and left[bracket_index - 1].kind == "identifier":
            target_model = _expression_model(left[bracket_index - 1 :], self.resolve_expression)
            if target_model.get("kind") == "arrayIndex":
                target = target_model
        if target is None:
            target = next((token.value for token in reversed(left) if token.kind == "identifier"), None)
        if not target:
            return None
        return {
            "op": "assign",
            "target": target,
            "value": _expression_model(tokens[assignment_index + 1 :], self.resolve_expression),
            "source": self._source(tokens[0]),
        }

    def _parse_middleware_call(self, call: _Token, arguments: Sequence[Sequence[_Token]]) -> dict | None:
        source = self._source(call)
        name = call.value

        def tick_model(tokens: Sequence[_Token]) -> tuple[dict, dict | None]:
            cleaned = _strip_wrapping_parentheses(tokens)
            if len(cleaned) >= 4 and cleaned[0].value == "pdMS_TO_TICKS" and cleaned[1].value == "(":
                close = _matching(cleaned, 1, "(", ")")
                if close == len(cleaned) - 1:
                    milliseconds = _expression_model(cleaned[2:close], self.resolve_expression)
                    return milliseconds, milliseconds
            return _expression_model(tokens, self.resolve_expression), None

        if name in {"vTaskDelay", "osDelay"}:
            ticks = arguments[0] if arguments else []
            ticks_model, milliseconds = tick_model(ticks)
            operation = {
                "op": "rtosDelay",
                "api": name,
                "ticks": ticks_model,
                "source": source,
            }
            if milliseconds is not None:
                operation["milliseconds"] = milliseconds
            return operation
        if name in {"vTaskDelayUntil", "osDelayUntil"}:
            ticks = arguments[-1] if arguments else []
            ticks_model, milliseconds = tick_model(ticks)
            operation = {
                "op": "rtosDelay",
                "api": name,
                "ticks": ticks_model,
                "source": source,
            }
            if milliseconds is not None:
                operation["milliseconds"] = milliseconds
            return operation
        if name in {"taskYIELD", "osThreadYield"}:
            return {"op": "rtosYield", "api": name, "source": source}
        if name in {"xQueueReceive", "xSemaphoreTake", "osMessageQueueGet", "osSemaphoreAcquire"}:
            wait_object = _first_identifier(arguments[0]) if arguments else None
            timeout_tokens = arguments[-1] if arguments else []
            return {
                "op": "rtosWait",
                "api": name,
                "waitObject": wait_object,
                "ticks": _expression_model(timeout_tokens, self.resolve_expression),
                "source": source,
            }
        return None

    def _resolve_gpio(self, port_tokens: Sequence[_Token], pin_tokens: Sequence[_Token]) -> dict:
        port_expression = _tokens_text(port_tokens)
        pin_expression = _tokens_text(pin_tokens)
        port = _resolve_port(port_expression, self.macros)
        mask = self.resolve_expression(pin_expression)
        port_macro = next(
            (token.value for token in port_tokens if token.kind == "identifier" and token.value.endswith("_GPIO_Port")),
            None,
        )
        pin_macro = next(
            (token.value for token in pin_tokens if token.kind == "identifier" and token.value.endswith("_Pin")),
            None,
        )
        alias = None
        if port_macro:
            alias = port_macro[: -len("_GPIO_Port")]
        if pin_macro:
            pin_alias = pin_macro[: -len("_Pin")]
            if alias is None:
                alias = pin_alias
            elif alias != pin_alias:
                alias = None
        physical_pin = None
        if port and mask and not (mask & (mask - 1)):
            physical_pin = f"P{port[-1]}{mask.bit_length() - 1}"
        if alias and alias in self.aliases:
            alias_model = self.aliases[alias]
            physical_pin = alias_model["physicalPin"]
            port = alias_model["port"]
            mask = alias_model["mask"]
        return {
            "pin": physical_pin,
            "alias": alias,
            "port": port,
            "mask": mask,
            "portExpression": port_expression,
            "pinExpression": pin_expression,
        }

    def _alicesim_expression(self, tokens: Sequence[_Token]) -> dict:
        model = _expression_model(tokens, self.resolve_expression)
        identifier = _first_identifier(tokens)
        enum_values = {
            "ALICESIM_SSD1306_COLOR_BLACK": 0,
            "ALICESIM_SSD1306_COLOR_WHITE": 1,
            "ALICESIM_SSD1306_COLOR_XOR": 2,
        }
        if identifier in enum_values:
            return {"kind": "constant", "name": identifier, "value": enum_values[identifier]}
        return model

    def _parse_alicesim_call(self, call: _Token, arguments: Sequence[Sequence[_Token]]) -> dict | None:
        source = self._source(call)
        name = call.value

        def require(count: int) -> bool:
            if len(arguments) >= count:
                return True
            self.diagnostics.append(
                _diagnostic(
                    "error",
                    "ALICESIM_DRIVER_ARGUMENTS",
                    f"{name} has fewer than {count} arguments",
                    **source,
                )
            )
            return False

        def identifier(index: int) -> str | None:
            return _first_identifier(arguments[index]) if index < len(arguments) else None

        def expression(index: int) -> dict:
            return self._alicesim_expression(arguments[index]) if index < len(arguments) else {"kind": "unknown", "text": ""}

        if name == "AliceSIM_SSD1306_Init":
            if not require(4):
                return {"op": "unsupported", "call": name, "source": source}
            context = identifier(0)
            handle = identifier(1)
            return {
                "op": "aliceOledInit",
                "context": context,
                "i2c": handle,
                "instance": self.i2c_instances.get(handle, {}).get("instance") if handle else None,
                "address": expression(2),
                "timeout": expression(3),
                "source": source,
            }

        oled_simple = {
            "AliceSIM_SSD1306_Update": "aliceOledUpdate",
            "AliceSIM_SSD1306_Clear": "aliceOledClear",
        }
        if name in oled_simple:
            if not require(1):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": oled_simple[name], "context": identifier(0), "source": source}

        oled_buffer_calls = {
            "AliceSIM_SSD1306_WriteCommand": "aliceOledCommand",
            "AliceSIM_SSD1306_WriteData": "aliceOledData",
        }
        if name in oled_buffer_calls:
            if not require(3):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": oled_buffer_calls[name],
                "context": identifier(0),
                "buffer": identifier(1),
                "length": expression(2),
                "source": source,
            }

        oled_value_calls = {
            "AliceSIM_SSD1306_SetDisplay": "aliceOledSetDisplay",
            "AliceSIM_SSD1306_SetInvert": "aliceOledSetInvert",
            "AliceSIM_SSD1306_SetContrast": "aliceOledSetContrast",
            "AliceSIM_SSD1306_Fill": "aliceOledFill",
        }
        if name in oled_value_calls:
            if not require(2):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": oled_value_calls[name],
                "context": identifier(0),
                "value": expression(1),
                "source": source,
            }

        if name in {"AliceSIM_SSD1306_DrawPixel", "AliceSIM_SSD1306_GetPixel"}:
            if not require(3 if name.endswith("GetPixel") else 4):
                return {"op": "unsupported", "call": name, "source": source}
            operation = {
                "op": "aliceOledGetPixel" if name.endswith("GetPixel") else "aliceOledDrawPixel",
                "context": identifier(0),
                "x": expression(1),
                "y": expression(2),
                "source": source,
            }
            if name.endswith("DrawPixel"):
                operation["color"] = expression(3)
            return operation

        oled_line_calls = {
            "AliceSIM_SSD1306_DrawHorizontalLine": "aliceOledDrawHorizontalLine",
            "AliceSIM_SSD1306_DrawVerticalLine": "aliceOledDrawVerticalLine",
        }
        if name in oled_line_calls:
            if not require(5):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": oled_line_calls[name],
                "context": identifier(0),
                "x": expression(1),
                "y": expression(2),
                "length": expression(3),
                "color": expression(4),
                "source": source,
            }

        if name == "AliceSIM_SSD1306_DrawRectangle":
            if not require(6):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": "aliceOledDrawRectangle",
                "context": identifier(0),
                "x": expression(1),
                "y": expression(2),
                "width": expression(3),
                "height": expression(4),
                "color": expression(5),
                "source": source,
            }

        if name == "AliceSIM_SSD1306_DrawBitmap":
            if not require(7):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": "aliceOledDrawBitmap",
                "context": identifier(0),
                "x": expression(1),
                "y": expression(2),
                "width": expression(3),
                "height": expression(4),
                "buffer": identifier(5),
                "color": expression(6),
                "source": source,
            }

        if name == "AliceSIM_SSD1306_DrawChar":
            if not require(6):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": "aliceOledDrawChar",
                "context": identifier(0),
                "x": expression(1),
                "y": expression(2),
                "character": expression(3),
                "scale": expression(4),
                "color": expression(5),
                "source": source,
            }

        if name == "AliceSIM_SSD1306_DrawString":
            if not require(6):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": "aliceOledDrawString",
                "context": identifier(0),
                "x": expression(1),
                "y": expression(2),
                "text": expression(3),
                "scale": expression(4),
                "color": expression(5),
                "source": source,
            }

        if name == "AliceSIM_LightSensor_Init":
            if not require(8):
                return {"op": "unsupported", "call": name, "source": source}
            context = identifier(0)
            handle = identifier(1)
            port_identifier = identifier(2)
            gpio = self._resolve_gpio(arguments[2], arguments[3]) if port_identifier not in {None, "NULL"} else {}
            return {
                "op": "aliceLightInit",
                "context": context,
                "adc": handle,
                "instance": self.adc_instances.get(handle, {}).get("instance") if handle else None,
                "digitalPin": gpio.get("pin"),
                "digitalPort": gpio.get("port"),
                "digitalMask": gpio.get("mask"),
                "digitalActiveLow": expression(4),
                "referenceMv": expression(5),
                "adcBits": expression(6),
                "timeout": expression(7),
                "source": source,
            }

        if name == "AliceSIM_LightSensor_SetCalibration":
            if not require(5):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": "aliceLightSetCalibration",
                "context": identifier(0),
                "rawAtMinLux": expression(1),
                "minLux": expression(2),
                "rawAtMaxLux": expression(3),
                "maxLux": expression(4),
                "source": source,
            }

        light_single_reads = {
            "AliceSIM_LightSensor_ReadRaw": "aliceLightReadRaw",
            "AliceSIM_LightSensor_ReadMillivolts": "aliceLightReadMillivolts",
            "AliceSIM_LightSensor_ReadLux": "aliceLightReadLux",
            "AliceSIM_LightSensor_Read": "aliceLightRead",
        }
        if name in light_single_reads:
            if not require(2):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": light_single_reads[name],
                "context": identifier(0),
                "target": identifier(1),
                "source": source,
            }

        if name == "AliceSIM_LightSensor_ReadDigital":
            if not require(3):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": "aliceLightReadDigital",
                "context": identifier(0),
                "levelTarget": identifier(1),
                "triggeredTarget": identifier(2),
                "source": source,
            }

        if name == "AliceSIM_DHT11_Init":
            if not require(5):
                return {"op": "unsupported", "call": name, "source": source}
            gpio = self._resolve_gpio(arguments[1], arguments[2])
            return {
                "op": "aliceDht11Init",
                "context": identifier(0),
                "dataPin": gpio.get("pin"),
                "dataPort": gpio.get("port"),
                "dataMask": gpio.get("mask"),
                "source": source,
            }

        if name == "AliceSIM_DHT11_Read":
            if not require(2):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": "aliceDht11Read", "context": identifier(0), "target": identifier(1), "source": source}

        if name == "AliceSIM_HCSR04_Init":
            if not require(8):
                return {"op": "unsupported", "call": name, "source": source}
            trigger = self._resolve_gpio(arguments[1], arguments[2])
            echo = self._resolve_gpio(arguments[3], arguments[4])
            return {
                "op": "aliceHcsr04Init",
                "context": identifier(0),
                "triggerPin": trigger.get("pin"),
                "triggerPort": trigger.get("port"),
                "echoPin": echo.get("pin"),
                "echoPort": echo.get("port"),
                "timeout": expression(7),
                "source": source,
            }

        if name == "AliceSIM_HCSR04_MeasureMm":
            if not require(2):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": "aliceHcsr04Measure", "context": identifier(0), "target": identifier(1), "source": source}

        if name == "AliceSIM_SG90_Init":
            if not require(4):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": "aliceSg90Init",
                "context": identifier(0),
                "timer": identifier(1),
                "channel": expression(2),
                "channelExpression": _tokens_text(arguments[2]),
                "timerTickHz": expression(3),
                "source": source,
            }

        sg90_values = {
            "AliceSIM_SG90_SetAngle": ("aliceSg90SetAngle", "angle"),
            "AliceSIM_SG90_SetAngleX10": ("aliceSg90SetAngleX10", "angleX10"),
            "AliceSIM_SG90_SetPulseUs": ("aliceSg90SetPulse", "pulseUs"),
        }
        if name in sg90_values:
            if not require(2):
                return {"op": "unsupported", "call": name, "source": source}
            operation_name, field = sg90_values[name]
            return {"op": operation_name, "context": identifier(0), field: expression(1), "source": source}

        if name in {"AliceSIM_SG90_Start", "AliceSIM_SG90_Stop"}:
            if not require(1):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": "aliceSg90Start" if name.endswith("Start") else "aliceSg90Stop", "context": identifier(0), "source": source}

        if name == "AliceSIM_Buzzer_Init":
            if not require(4):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": "aliceBuzzerInit",
                "context": identifier(0),
                "timer": identifier(1),
                "channel": expression(2),
                "channelExpression": _tokens_text(arguments[2]),
                "timerTickHz": expression(3),
                "source": source,
            }

        if name == "AliceSIM_Buzzer_Set":
            if not require(3):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": "aliceBuzzerSet", "context": identifier(0), "frequencyHz": expression(1), "dutyPermille": expression(2), "source": source}

        if name == "AliceSIM_Buzzer_Tone":
            if not require(3):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": "aliceBuzzerTone", "context": identifier(0), "frequencyHz": expression(1), "durationMs": expression(2), "source": source}

        if name == "AliceSIM_Buzzer_Stop":
            if not require(1):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": "aliceBuzzerStop", "context": identifier(0), "source": source}

        if name == "AliceSIM_TM1637_Init":
            if not require(6):
                return {"op": "unsupported", "call": name, "source": source}
            clk = self._resolve_gpio(arguments[1], arguments[2])
            dio = self._resolve_gpio(arguments[3], arguments[4])
            return {
                "op": "aliceTm1637Init",
                "context": identifier(0),
                "clkPin": clk.get("pin"),
                "clkPort": clk.get("port"),
                "dioPin": dio.get("pin"),
                "dioPort": dio.get("port"),
                "source": source,
            }

        if name == "AliceSIM_TM1637_SetBrightness":
            if not require(3):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": "aliceTm1637SetBrightness", "context": identifier(0), "brightness": expression(1), "enabled": expression(2), "source": source}

        if name == "AliceSIM_TM1637_DisplayNumber":
            if not require(4):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": "aliceTm1637DisplayNumber", "context": identifier(0), "value": expression(1), "leadingZero": expression(2), "colon": expression(3), "source": source}

        if name == "AliceSIM_TM1637_Clear":
            if not require(1):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": "aliceTm1637Clear", "context": identifier(0), "source": source}

        light_conversions = {
            "AliceSIM_LightSensor_RawToMillivolts": "aliceLightRawToMillivolts",
            "AliceSIM_LightSensor_RawToLux": "aliceLightRawToLux",
            "AliceSIM_LightSensor_RawToPercentX100": "aliceLightRawToPercent",
        }
        if name in light_conversions:
            if not require(2):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": light_conversions[name],
                "context": identifier(0),
                "raw": expression(1),
                "source": source,
            }

        self.diagnostics.append(
            _diagnostic(
                "error",
                "ALICESIM_DRIVER_UNSUPPORTED",
                f"{name} is outside the current AliceSIM driver semantic subset",
                **source,
            )
        )
        return {"op": "unsupported", "call": name, "source": source}

    def _parse_hal_call(self, call: _Token, arguments: Sequence[Sequence[_Token]]) -> dict | None:
        source = self._source(call)
        name = call.value
        if name in {"HAL_TIM_PWM_Start", "HAL_TIM_PWM_Start_IT", "HAL_TIM_PWM_Stop", "HAL_TIM_PWM_Stop_IT", "__HAL_TIM_SET_COMPARE"}:
            if len(arguments) < (3 if name == "__HAL_TIM_SET_COMPARE" else 2):
                self.diagnostics.append(
                    _diagnostic("error", "HAL_CALL_ARGUMENTS", f"{name} has too few arguments", **source)
                )
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            channel_expression = _tokens_text(arguments[1])
            channel_match = re.search(r"(?:TIM_CHANNEL_|CH)?(\d+)", channel_expression, re.I)
            channel_number = int(channel_match.group(1)) if channel_match else None
            suffix = re.search(r"(\d+)$", str(handle or ""))
            instance = "TIM" + suffix.group(1) if suffix else None
            if name == "__HAL_TIM_SET_COMPARE":
                return {
                    "op": "pwmSetCompare",
                    "timer": handle,
                    "instance": instance,
                    "channel": channel_number,
                    "channelExpression": channel_expression,
                    "compare": _expression_model(arguments[2], self.resolve_expression),
                    "compareExpression": _tokens_text(arguments[2]),
                    "source": source,
                }
            return {
                "op": "pwmStart" if "Start" in name else "pwmStop",
                "timer": handle,
                "instance": instance,
                "channel": channel_number,
                "channelExpression": channel_expression,
                "interrupt": name.endswith("_IT"),
                "source": source,
            }
        if name in {"HAL_UART_Receive", "HAL_UART_Transmit", "HAL_UART_Receive_DMA", "HAL_UART_Transmit_DMA"}:
            is_dma = name.endswith("_DMA")
            required = 3 if is_dma else 4
            if len(arguments) < required:
                self.diagnostics.append(
                    _diagnostic(
                        "error",
                        "HAL_CALL_ARGUMENTS",
                        f"{name} has fewer than {required} arguments",
                        **source,
                    )
                )
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            buffer = _first_identifier(arguments[1])
            length_expression = _tokens_text(arguments[2])
            length = self.resolve_expression(length_expression)
            timeout = None if is_dma else _tokens_text(arguments[3])
            instance = None
            if handle and handle in self.uart_instances:
                instance = self.uart_instances[handle].get("instance")
            receiving = "Receive" in name
            operation_name = ("uartReceiveDma" if receiving else "uartTransmitDma") if is_dma else ("uartReceive" if receiving else "uartTransmit")
            blocking = not is_dma and timeout != "0"
            operation = {
                "op": operation_name,
                "uart": handle,
                "instance": instance,
                "buffer": buffer,
                "length": length,
                "lengthExpression": length_expression,
                "timeout": timeout,
                "blocking": blocking,
                "dma": is_dma,
                "source": source,
            }
            if length is None:
                self.diagnostics.append(
                    _diagnostic(
                        "error",
                        "UART_LENGTH_UNRESOLVED",
                        f"Could not resolve transfer length for {name}",
                        **source,
                        details={"expression": length_expression},
                    )
                )
            return operation

        if name == "HAL_UART_DMAStop":
            if len(arguments) < 1:
                self.diagnostics.append(_diagnostic("error", "HAL_CALL_ARGUMENTS", f"{name} has too few arguments", **source))
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            return {
                "op": "uartDmaStop",
                "uart": handle,
                "instance": self.uart_instances.get(handle, {}).get("instance") if handle else None,
                "source": source,
            }

        if name in {"HAL_I2C_Master_Transmit", "HAL_I2C_Mem_Write"}:
            required = 5 if name == "HAL_I2C_Master_Transmit" else 7
            if len(arguments) < required:
                self.diagnostics.append(
                    _diagnostic(
                        "error",
                        "HAL_CALL_ARGUMENTS",
                        f"{name} has fewer than {required} arguments",
                        **source,
                    )
                )
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            instance = self.i2c_instances.get(handle, {}).get("instance") if handle else None
            device_address_expression = _tokens_text(arguments[1])
            device_address = _expression_model(arguments[1], self.resolve_expression)
            if name == "HAL_I2C_Master_Transmit":
                buffer_arguments = arguments[2]
                length_arguments = arguments[3]
                timeout_arguments = arguments[4]
                operation_name = "i2cMasterTransmit"
            else:
                buffer_arguments = arguments[4]
                length_arguments = arguments[5]
                timeout_arguments = arguments[6]
                operation_name = "i2cMemWrite"
            buffer = _first_identifier(buffer_arguments)
            length_expression = _tokens_text(length_arguments)
            length = self.resolve_expression(length_expression)
            timeout = _tokens_text(timeout_arguments)
            operation = {
                "op": operation_name,
                "i2c": handle,
                "instance": instance,
                "deviceAddress": device_address,
                "deviceAddressExpression": device_address_expression,
                "buffer": buffer,
                "length": length,
                "lengthExpression": length_expression,
                "timeout": timeout,
                "blocking": timeout.strip() != "0",
                "source": source,
            }
            if name == "HAL_I2C_Mem_Write":
                operation.update(
                    {
                        "memoryAddress": _expression_model(arguments[2], self.resolve_expression),
                        "memoryAddressExpression": _tokens_text(arguments[2]),
                        "memoryAddressSize": _expression_model(arguments[3], self.resolve_expression),
                        "memoryAddressSizeExpression": _tokens_text(arguments[3]),
                    }
                )
            if length is None:
                self.diagnostics.append(
                    _diagnostic(
                        "error",
                        "I2C_LENGTH_UNRESOLVED",
                        f"Could not resolve transfer length for {name}",
                        **source,
                        details={"expression": length_expression},
                    )
                )
            return operation

        if name == "HAL_SPI_Transmit":
            if len(arguments) < 4:
                self.diagnostics.append(
                    _diagnostic(
                        "error",
                        "HAL_CALL_ARGUMENTS",
                        f"{name} has fewer than four arguments",
                        **source,
                    )
                )
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            buffer = _first_identifier(arguments[1])
            length_expression = _tokens_text(arguments[2])
            length = self.resolve_expression(length_expression)
            timeout = _tokens_text(arguments[3])
            instance = self.spi_instances.get(handle, {}).get("instance") if handle else None
            operation = {
                "op": "spiTransmit",
                "spi": handle,
                "instance": instance,
                "buffer": buffer,
                "length": length,
                "lengthExpression": length_expression,
                "timeout": timeout,
                "blocking": timeout.strip() != "0",
                "source": source,
            }
            if length is None:
                self.diagnostics.append(
                    _diagnostic(
                        "error",
                        "SPI_LENGTH_UNRESOLVED",
                        f"Could not resolve transfer length for {name}",
                        **source,
                        details={"expression": length_expression},
                    )
                )
            return operation

        if name in {"HAL_ADC_Start_DMA", "HAL_ADC_Stop_DMA"}:
            required = 3 if name == "HAL_ADC_Start_DMA" else 1
            if len(arguments) < required:
                self.diagnostics.append(
                    _diagnostic("error", "HAL_CALL_ARGUMENTS", f"{name} has fewer than {required} arguments", **source)
                )
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            operation = {
                "op": "adcStartDma" if name == "HAL_ADC_Start_DMA" else "adcStopDma",
                "adc": handle,
                "instance": self.adc_instances.get(handle, {}).get("instance") if handle else None,
                "source": source,
            }
            if name == "HAL_ADC_Start_DMA":
                buffer = _first_identifier(arguments[1])
                length_expression = _tokens_text(arguments[2])
                length = self.resolve_expression(length_expression)
                operation.update({
                    "buffer": buffer,
                    "length": length,
                    "lengthExpression": length_expression,
                })
                if length is None:
                    self.diagnostics.append(
                        _diagnostic(
                            "error",
                            "ADC_DMA_LENGTH_UNRESOLVED",
                            f"Could not resolve transfer length for {name}",
                            **source,
                            details={"expression": length_expression},
                        )
                    )
            return operation

        if name in {"HAL_ADC_Start", "HAL_ADC_PollForConversion", "HAL_ADC_GetValue"}:
            required = 2 if name == "HAL_ADC_PollForConversion" else 1
            if len(arguments) < required:
                self.diagnostics.append(
                    _diagnostic(
                        "error",
                        "HAL_CALL_ARGUMENTS",
                        f"{name} has fewer than {required} arguments",
                        **source,
                    )
                )
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            instance = self.adc_instances.get(handle, {}).get("instance") if handle else None
            operation_names = {
                "HAL_ADC_Start": "adcStart",
                "HAL_ADC_PollForConversion": "adcPollForConversion",
                "HAL_ADC_GetValue": "adcGetValue",
            }
            operation = {
                "op": operation_names[name],
                "adc": handle,
                "instance": instance,
                "source": source,
            }
            if name == "HAL_ADC_PollForConversion":
                timeout = _tokens_text(arguments[1])
                operation["timeout"] = timeout
                operation["blocking"] = timeout.strip() != "0"
            return operation

        if name in {"HAL_GPIO_WritePin", "HAL_GPIO_ReadPin", "HAL_GPIO_TogglePin"}:
            required = 3 if name == "HAL_GPIO_WritePin" else 2
            if len(arguments) < required:
                self.diagnostics.append(
                    _diagnostic(
                        "error",
                        "HAL_CALL_ARGUMENTS",
                        f"{name} has fewer than {required} arguments",
                        **source,
                    )
                )
                return {"op": "unsupported", "call": name, "source": source}
            gpio = self._resolve_gpio(arguments[0], arguments[1])
            if gpio["pin"] is None:
                self.diagnostics.append(
                    _diagnostic(
                        "error",
                        "GPIO_CALL_UNRESOLVED",
                        f"Could not resolve the physical pin used by {name}",
                        **source,
                        details={
                            "portExpression": gpio["portExpression"],
                            "pinExpression": gpio["pinExpression"],
                        },
                    )
                )
            operation = {
                "op": {
                    "HAL_GPIO_WritePin": "gpioWrite",
                    "HAL_GPIO_ReadPin": "gpioRead",
                    "HAL_GPIO_TogglePin": "gpioToggle",
                }[name],
                "pin": gpio["pin"],
                "alias": gpio["alias"],
                "port": gpio["port"],
                "mask": gpio["mask"],
                "source": source,
            }
            if name == "HAL_GPIO_WritePin":
                operation["value"] = _expression_model(arguments[2], self.resolve_expression)
            return operation

        if name == "HAL_Delay":
            expression = _tokens_text(arguments[0]) if arguments else ""
            milliseconds = self.resolve_expression(expression)
            expression_model = _expression_model(arguments[0] if arguments else [], self.resolve_expression)
            if milliseconds is None and not _runtime_expression_supported(expression_model):
                self.diagnostics.append(
                    _diagnostic(
                        "error",
                        "DELAY_UNRESOLVED",
                        "Could not resolve HAL_Delay duration",
                        **source,
                        details={"expression": expression},
                    )
                )
            return {
                "op": "delay",
                "milliseconds": milliseconds,
                "expression": expression_model,
                "source": source,
            }

        if name in {"HAL_Init", "HAL_IncTick", "HAL_UART_Init", "HAL_I2C_Init", "HAL_ADC_Init", "HAL_DMA_Init", "HAL_DMA_DeInit", "HAL_DMA_IRQHandler", "HAL_GPIO_Init", "HAL_TIM_PWM_Init", "HAL_TIM_PWM_ConfigChannel", "HAL_TIM_Base_Init"}:
            return None
        self.diagnostics.append(
            _diagnostic(
                "error",
                "HAL_CALL_UNSUPPORTED",
                f"{name} is outside the current HAL semantic subset",
                **source,
            )
        )
        return {"op": "unsupported", "call": name, "source": source}


def _find_function(tokens: Sequence[_Token], name: str) -> tuple[int, int] | None:
    for index, token in enumerate(tokens[:-1]):
        if token.value != name or tokens[index + 1].value != "(":
            continue
        close_paren = _matching(tokens, index + 1, "(", ")")
        if close_paren is None:
            continue
        cursor = close_paren + 1
        while cursor < len(tokens) and tokens[cursor].value in {"__attribute__", "(" , ")"}:
            cursor += 1
        if cursor < len(tokens) and tokens[cursor].value == "{":
            close_brace = _matching(tokens, cursor, "{", "}")
            if close_brace is not None:
                return cursor + 1, close_brace
    return None


def _parse_source_uart_configuration(
    records: Sequence[_ProjectFile],
    macros: Mapping[str, _Macro],
    ioc: Mapping[str, object],
    diagnostics: list[dict],
) -> dict[str, dict]:
    resolve_expression, _ = _make_integer_resolver(macros)
    handles: dict[str, dict] = {}
    declaration_pattern = re.compile(r"\bUART_HandleTypeDef\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;")
    assignment_patterns = {
        "instance": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Instance\s*=\s*((?:USART|UART)\d+)\s*;"),
        "baudRate": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*BaudRate\s*=\s*([^;]+);"),
        "wordLength": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*WordLength\s*=\s*([^;]+);"),
        "stopBits": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*StopBits\s*=\s*([^;]+);"),
        "parity": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*Parity\s*=\s*([^;]+);"),
    }
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _strip_comments(record.content)
        for match in declaration_pattern.finditer(cleaned):
            line, column = _source_line(cleaned, match.start(1))
            handle = match.group(1)
            handles.setdefault(handle, {"handle": handle, "sources": {}})["sources"]["declaration"] = {
                "file": record.path,
                "line": line,
                "column": column,
            }
        for field, pattern in assignment_patterns.items():
            for match in pattern.finditer(cleaned):
                handle, raw_value = match.group(1), match.group(2).strip()
                line, column = _source_line(cleaned, match.start(1))
                model = handles.setdefault(handle, {"handle": handle, "sources": {}})
                if field == "instance":
                    model[field] = raw_value.upper()
                elif field == "baudRate":
                    model[field] = resolve_expression(raw_value)
                    model["baudRateExpression"] = raw_value
                else:
                    model[field] = raw_value
                model["sources"][field] = {"file": record.path, "line": line, "column": column}

    ioc_instances: Mapping[str, dict] = ioc["uartInstances"]  # type: ignore[assignment]
    for handle, model in handles.items():
        instance = model.get("instance")
        if not instance:
            suffix = re.search(r"(\d+)$", handle)
            inferred = ("USART" + suffix.group(1)) if suffix else None
            if inferred and inferred in ioc_instances:
                instance = inferred
                model["instance"] = instance
                model["instanceConfidence"] = "inferred"
        ioc_uart = ioc_instances.get(instance, {}) if instance else {}
        source_baud = model.get("baudRate")
        ioc_baud_raw = ioc_uart.get("BaudRate")
        ioc_baud = resolve_expression(str(ioc_baud_raw)) if ioc_baud_raw is not None else None
        if source_baud is None:
            model["baudRate"] = ioc_baud
        elif ioc_baud is not None and source_baud != ioc_baud:
            source = model.get("sources", {}).get("baudRate", {})
            diagnostics.append(
                _diagnostic(
                    "error",
                    "UART_BAUD_CONFLICT",
                    f"{handle} uses {source_baud} baud in source but {ioc_baud} in the IOC",
                    file=source.get("file"),
                    line=source.get("line"),
                    column=source.get("column"),
                    details={"handle": handle, "instance": instance, "sourceBaud": source_baud, "iocBaud": ioc_baud},
                )
            )
        model["txPin"] = ioc_uart.get("txPin")
        model["rxPin"] = ioc_uart.get("rxPin")
        word_length = str(model.get("wordLength") or ioc_uart.get("WordLength") or "UART_WORDLENGTH_8B")
        stop_bits = str(model.get("stopBits") or ioc_uart.get("StopBits") or "UART_STOPBITS_1")
        parity = str(model.get("parity") or ioc_uart.get("Parity") or "UART_PARITY_NONE")
        word_match = re.search(r"(?:WORDLENGTH_)?(\d+)", word_length)
        stop_match = re.search(r"(?:STOPBITS_)?([12])", stop_bits)
        model["frame"] = {
            "dataBits": int(word_match.group(1)) if word_match else 8,
            "stopBits": int(stop_match.group(1)) if stop_match else 1,
            "parity": "none" if parity.upper().endswith("NONE") else parity.lower().replace("uart_parity_", ""),
        }
        model["receiveCalls"] = []
        model["transmitCalls"] = []
    return handles


def _parse_source_i2c_configuration(
    records: Sequence[_ProjectFile],
    macros: Mapping[str, _Macro],
    ioc: Mapping[str, object],
    diagnostics: list[dict],
) -> dict[str, dict]:
    resolve_expression, _ = _make_integer_resolver(macros)
    handles: dict[str, dict] = {}
    declaration_pattern = re.compile(r"\bI2C_HandleTypeDef\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;")
    assignment_patterns = {
        "instance": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Instance\s*=\s*(I2C\d+)\s*;"), False),
        "clockSpeed": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*ClockSpeed\s*=\s*([^;]+);"), True),
        "dutyCycle": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*DutyCycle\s*=\s*([^;]+);"), False),
        "ownAddress1": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*OwnAddress1\s*=\s*([^;]+);"), True),
        "addressingMode": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*AddressingMode\s*=\s*([^;]+);"), False),
        "dualAddressMode": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*DualAddressMode\s*=\s*([^;]+);"), False),
        "ownAddress2": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*OwnAddress2\s*=\s*([^;]+);"), True),
        "generalCallMode": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*GeneralCallMode\s*=\s*([^;]+);"), False),
        "noStretchMode": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*NoStretchMode\s*=\s*([^;]+);"), False),
    }
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _strip_comments(record.content)
        for match in declaration_pattern.finditer(cleaned):
            line, column = _source_line(cleaned, match.start(1))
            handle = match.group(1)
            handles.setdefault(handle, {"handle": handle, "sources": {}})["sources"]["declaration"] = {
                "file": record.path,
                "line": line,
                "column": column,
            }
        for field, (pattern, numeric) in assignment_patterns.items():
            for match in pattern.finditer(cleaned):
                handle, raw_value = match.group(1), match.group(2).strip()
                line, column = _source_line(cleaned, match.start(1))
                model = handles.setdefault(handle, {"handle": handle, "sources": {}})
                if field == "instance":
                    model[field] = raw_value.upper()
                elif numeric:
                    model[field] = resolve_expression(raw_value)
                    model[field + "Expression"] = raw_value
                else:
                    model[field] = raw_value
                model["sources"][field] = {"file": record.path, "line": line, "column": column}

    ioc_instances: Mapping[str, dict] = ioc["i2cInstances"]  # type: ignore[assignment]
    ioc_field_names = {
        "DutyCycle": "dutyCycle",
        "OwnAddress1": "ownAddress1",
        "AddressingMode": "addressingMode",
        "DualAddressMode": "dualAddressMode",
        "OwnAddress2": "ownAddress2",
        "GeneralCallMode": "generalCallMode",
        "NoStretchMode": "noStretchMode",
        "Timing": "timing",
        "SpeedMode": "speedMode",
    }
    for handle, model in handles.items():
        instance = model.get("instance")
        if not instance:
            suffix = re.search(r"(\d+)$", handle)
            inferred = ("I2C" + suffix.group(1)) if suffix else None
            if inferred and inferred in ioc_instances:
                instance = inferred
                model["instance"] = instance
                model["instanceConfidence"] = "inferred"
        ioc_i2c = ioc_instances.get(instance, {}) if instance else {}
        source_clock = model.get("clockSpeed")
        ioc_clock_raw = ioc_i2c.get("ClockSpeed")
        ioc_clock = resolve_expression(str(ioc_clock_raw)) if ioc_clock_raw is not None else None
        if source_clock is None:
            model["clockSpeed"] = ioc_clock
        elif ioc_clock is not None and source_clock != ioc_clock:
            source = model.get("sources", {}).get("clockSpeed", {})
            diagnostics.append(
                _diagnostic(
                    "error",
                    "I2C_CLOCK_CONFLICT",
                    f"{handle} uses {source_clock} Hz in source but {ioc_clock} in the IOC",
                    file=source.get("file"),
                    line=source.get("line"),
                    column=source.get("column"),
                    details={"handle": handle, "instance": instance, "sourceClock": source_clock, "iocClock": ioc_clock},
                )
            )
        model["sclPin"] = ioc_i2c.get("sclPin")
        model["sdaPin"] = ioc_i2c.get("sdaPin")
        for ioc_name, model_name in ioc_field_names.items():
            if model.get(model_name) is not None:
                continue
            raw_value = ioc_i2c.get(ioc_name)
            if raw_value is None:
                continue
            if model_name in {"ownAddress1", "ownAddress2", "timing"}:
                model[model_name] = resolve_expression(str(raw_value))
                model[model_name + "Expression"] = str(raw_value)
            else:
                model[model_name] = raw_value
        addressing_mode = str(model.get("addressingMode") or "I2C_ADDRESSINGMODE_7BIT")
        model["addressBits"] = 10 if "10BIT" in addressing_mode.upper() else 7
        model["masterTransmitCalls"] = []
        model["memWriteCalls"] = []
    return handles


def _parse_source_spi_configuration(
    records: Sequence[_ProjectFile],
    macros: Mapping[str, _Macro],
    ioc: Mapping[str, object],
) -> dict[str, dict]:
    resolve_expression, _ = _make_integer_resolver(macros)
    handles: dict[str, dict] = {}
    declaration_pattern = re.compile(r"\bSPI_HandleTypeDef\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;")
    assignment_patterns = {
        "instance": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Instance\s*=\s*(SPI\d+)\s*;"), False),
        "mode": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*Mode\s*=\s*([^;]+);"), False),
        "direction": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*Direction\s*=\s*([^;]+);"), False),
        "dataSize": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*DataSize\s*=\s*([^;]+);"), False),
        "clockPolarity": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*CLKPolarity\s*=\s*([^;]+);"), False),
        "clockPhase": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*CLKPhase\s*=\s*([^;]+);"), False),
        "baudRatePrescaler": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*BaudRatePrescaler\s*=\s*([^;]+);"), False),
        "firstBit": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*FirstBit\s*=\s*([^;]+);"), False),
    }
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _strip_comments(record.content)
        for match in declaration_pattern.finditer(cleaned):
            line, column = _source_line(cleaned, match.start(1))
            handle = match.group(1)
            handles.setdefault(handle, {"handle": handle, "sources": {}})["sources"]["declaration"] = {
                "file": record.path,
                "line": line,
                "column": column,
            }
        for field, (pattern, numeric) in assignment_patterns.items():
            for match in pattern.finditer(cleaned):
                handle, raw_value = match.group(1), match.group(2).strip()
                line, column = _source_line(cleaned, match.start(1))
                model = handles.setdefault(handle, {"handle": handle, "sources": {}})
                if field == "instance":
                    model[field] = raw_value.upper()
                elif numeric:
                    model[field] = resolve_expression(raw_value)
                else:
                    model[field] = raw_value
                model["sources"][field] = {"file": record.path, "line": line, "column": column}

    ioc_instances: Mapping[str, dict] = ioc["spiInstances"]  # type: ignore[assignment]
    for handle, model in handles.items():
        if not model.get("instance"):
            suffix = re.search(r"(\d+)$", handle)
            inferred = ("SPI" + suffix.group(1)) if suffix else None
            if inferred:
                model["instance"] = inferred
                model["instanceConfidence"] = "inferred"
        ioc_spi = ioc_instances.get(model.get("instance"), {}) if model.get("instance") else {}
        model["sckPin"] = ioc_spi.get("sckPin")
        model["mosiPin"] = ioc_spi.get("mosiPin")
        model["misoPin"] = ioc_spi.get("misoPin")
        model["nssPin"] = ioc_spi.get("nssPin")
        for ioc_name, model_name in {
            "Mode": "mode",
            "Direction": "direction",
            "DataSize": "dataSize",
            "CLKPolarity": "clockPolarity",
            "CLKPhase": "clockPhase",
            "BaudRatePrescaler": "baudRatePrescaler",
            "FirstBit": "firstBit",
        }.items():
            if model.get(model_name) is None and ioc_spi.get(ioc_name) is not None:
                model[model_name] = ioc_spi[ioc_name]
        model["transmitCalls"] = []
    return handles


def _parse_source_adc_configuration(
    records: Sequence[_ProjectFile], ioc: Mapping[str, object]
) -> dict[str, dict]:
    handles: dict[str, dict] = {}
    declaration_pattern = re.compile(r"\bADC_HandleTypeDef\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;")
    instance_pattern = re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Instance\s*=\s*(ADC\d+)\s*;")
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _strip_comments(record.content)
        for match in declaration_pattern.finditer(cleaned):
            line, column = _source_line(cleaned, match.start(1))
            handle = match.group(1)
            handles.setdefault(handle, {"handle": handle, "sources": {}})["sources"]["declaration"] = {
                "file": record.path,
                "line": line,
                "column": column,
            }
        for match in instance_pattern.finditer(cleaned):
            line, column = _source_line(cleaned, match.start(1))
            handle = match.group(1)
            model = handles.setdefault(handle, {"handle": handle, "sources": {}})
            model["instance"] = match.group(2).upper()
            model["sources"]["instance"] = {"file": record.path, "line": line, "column": column}
    ioc_instances: Mapping[str, dict] = ioc["adcInstances"]  # type: ignore[assignment]
    for handle, model in handles.items():
        if not model.get("instance"):
            suffix = re.search(r"(\d+)$", handle)
            if suffix:
                model["instance"] = "ADC" + suffix.group(1)
                model["instanceConfidence"] = "inferred"
        ioc_adc = ioc_instances.get(model.get("instance"), {}) if model.get("instance") else {}
        model["channels"] = [dict(channel) for channel in ioc_adc.get("channels", [])]
        model["startCalls"] = []
        model["pollCalls"] = []
        model["getValueCalls"] = []
        model["dmaCalls"] = []
    return handles


def _parse_source_dma_configuration(
    records: Sequence[_ProjectFile],
) -> tuple[dict[str, dict], list[dict]]:
    """Collect CubeMX DMA channel settings and __HAL_LINKDMA relationships."""

    handles: dict[str, dict] = {}
    links: list[dict] = []
    declaration_pattern = re.compile(r"\bDMA_HandleTypeDef\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;")
    assignment_patterns = {
        "instance": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Instance\s*=\s*((?:DMA\d+_Channel|DMA\d+_Stream)\d+)\s*;"),
        "direction": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*Direction\s*=\s*([^;]+);"),
        "peripheralIncrement": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*PeriphInc\s*=\s*([^;]+);"),
        "memoryIncrement": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*MemInc\s*=\s*([^;]+);"),
        "peripheralAlignment": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*PeriphDataAlignment\s*=\s*([^;]+);"),
        "memoryAlignment": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*MemDataAlignment\s*=\s*([^;]+);"),
        "mode": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*Mode\s*=\s*([^;]+);"),
        "priority": re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*Priority\s*=\s*([^;]+);"),
    }
    link_pattern = re.compile(
        r"__HAL_LINKDMA\s*\(\s*&?\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)"
    )

    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _strip_comments(record.content)
        for match in declaration_pattern.finditer(cleaned):
            line, column = _source_line(cleaned, match.start(1))
            handle = match.group(1)
            handles.setdefault(handle, {"handle": handle, "sources": {}, "links": []})["sources"]["declaration"] = {
                "file": record.path,
                "line": line,
                "column": column,
            }
        for field, pattern in assignment_patterns.items():
            for match in pattern.finditer(cleaned):
                handle, raw_value = match.group(1), match.group(2).strip()
                line, column = _source_line(cleaned, match.start(1))
                model = handles.setdefault(handle, {"handle": handle, "sources": {}, "links": []})
                model[field] = raw_value
                model["sources"][field] = {"file": record.path, "line": line, "column": column}
        for match in link_pattern.finditer(cleaned):
            line, column = _source_line(cleaned, match.start(1))
            peripheral_handle, field, dma_handle = match.group(1), match.group(2), match.group(3)
            context_pattern = re.compile(
                rf"\b{re.escape(peripheral_handle)}\s*->\s*Instance\s*==\s*((?:ADC|USART|UART)\d+)",
                re.IGNORECASE,
            )
            context_matches = list(context_pattern.finditer(cleaned[: match.start()]))
            peripheral_instance = context_matches[-1].group(1).upper() if context_matches else None
            link = {
                "peripheral": peripheral_handle,
                "peripheralInstance": peripheral_instance,
                "field": field,
                "dma": dma_handle,
                "source": {"file": record.path, "line": line, "column": column},
            }
            links.append(link)
            handles.setdefault(dma_handle, {"handle": dma_handle, "sources": {}, "links": []})["links"].append(link)

    for model in handles.values():
        mode = str(model.get("mode") or "DMA_NORMAL").upper()
        model["circular"] = "CIRCULAR" in mode
    return handles, links


def _parse_source_timer_configuration(
    records: Sequence[_ProjectFile], macros: Mapping[str, _Macro], ioc: Mapping[str, object]
) -> dict[str, dict]:
    resolve_expression, _ = _make_integer_resolver(macros)
    handles: dict[str, dict] = {}
    declaration_pattern = re.compile(r"\bTIM_HandleTypeDef\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;")
    assignment_patterns = {
        "instance": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Instance\s*=\s*(TIM\d+)\s*;"), False),
        "prescaler": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*Prescaler\s*=\s*([^;]+);"), True),
        "period": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*Period\s*=\s*([^;]+);"), True),
        "counterMode": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*CounterMode\s*=\s*([^;]+);"), False),
        "clockDivision": (re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Init\s*\.\s*ClockDivision\s*=\s*([^;]+);"), False),
    }

    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _strip_comments(record.content)
        for match in declaration_pattern.finditer(cleaned):
            line, column = _source_line(cleaned, match.start(1))
            handle = match.group(1)
            handles.setdefault(handle, {"handle": handle, "sources": {}, "channels": [], "pwmCalls": []})["sources"]["declaration"] = {
                "file": record.path,
                "line": line,
                "column": column,
            }
        for field, (pattern, numeric) in assignment_patterns.items():
            for match in pattern.finditer(cleaned):
                handle, raw_value = match.group(1), match.group(2).strip()
                line, column = _source_line(cleaned, match.start(1))
                model = handles.setdefault(handle, {"handle": handle, "sources": {}, "channels": [], "pwmCalls": []})
                if field == "instance":
                    model[field] = raw_value.upper()
                elif numeric:
                    model[field] = resolve_expression(raw_value)
                    model[field + "Expression"] = raw_value
                else:
                    model[field] = raw_value
                model["sources"][field] = {"file": record.path, "line": line, "column": column}

        pulse_by_config: dict[str, tuple[int | None, str]] = {}
        event_pattern = re.compile(
            r"(?P<pulse>\b(?P<pulse_config>[A-Za-z_]\w*)\s*\.\s*Pulse\s*=\s*(?P<pulse_value>[^;]+);)"
            r"|(?P<call>\bHAL_TIM_PWM_ConfigChannel\s*\(\s*&?(?P<timer>[A-Za-z_]\w*)\s*,\s*&?(?P<config>[A-Za-z_]\w*)\s*,\s*(?P<channel>TIM_CHANNEL_\d+)\s*\))"
        )
        for match in event_pattern.finditer(cleaned):
            if match.group("pulse"):
                raw_pulse = match.group("pulse_value").strip()
                pulse_by_config[match.group("pulse_config")] = (resolve_expression(raw_pulse), raw_pulse)
                continue
            handle = match.group("timer")
            channel_name = match.group("channel")
            channel_number = int(re.search(r"\d+", channel_name).group(0))
            pulse, pulse_expression = pulse_by_config.get(match.group("config"), (None, ""))
            model = handles.setdefault(handle, {"handle": handle, "sources": {}, "channels": [], "pwmCalls": []})
            channel = next((item for item in model["channels"] if item.get("channelNumber") == channel_number), None)
            if channel is None:
                channel = {"channel": channel_name, "channelName": f"CH{channel_number}", "channelNumber": channel_number, "pin": None, "complementary": False}
                model["channels"].append(channel)
            if pulse is not None:
                channel["pulse"] = pulse
                channel["pulseExpression"] = pulse_expression

    ioc_instances: Mapping[str, dict] = ioc["timerInstances"]  # type: ignore[assignment]
    values: Mapping[str, str] = ioc.get("values", {})  # type: ignore[assignment]

    def ioc_value(*keys: str) -> str | None:
        index = {key.casefold().replace("_", ""): value for key, value in values.items()}
        for key in keys:
            value = index.get(key.casefold().replace("_", ""))
            if value is not None:
                return value
        return None

    def number_value(value: object) -> int | None:
        resolved = resolve_expression(str(value)) if value is not None else None
        if resolved is not None:
            return resolved
        match = re.search(r"(-?\d+)", str(value or ""))
        return int(match.group(1)) if match else None

    hclk = number_value(ioc_value("RCC.HCLKFreq_Value", "RCC.AHBFreq_Value"))
    pclk1 = number_value(ioc_value("RCC.APB1Freq_Value", "RCC.PCLK1Freq_Value")) or hclk
    pclk2 = number_value(ioc_value("RCC.APB2Freq_Value", "RCC.PCLK2Freq_Value")) or hclk
    apb1_div = number_value(ioc_value("RCC.APB1CLKDivider")) or 1
    apb2_div = number_value(ioc_value("RCC.APB2CLKDivider")) or 1
    timer_pclk1 = pclk1 * (1 if apb1_div == 1 else 2) if pclk1 else None
    timer_pclk2 = pclk2 * (1 if apb2_div == 1 else 2) if pclk2 else None

    all_instances = set(ioc_instances)
    for handle in handles:
        suffix = re.search(r"(\d+)$", handle)
        if suffix:
            all_instances.add("TIM" + suffix.group(1))
    for instance in sorted(all_instances):
        matching_handle = next((handle for handle, model in handles.items() if model.get("instance") == instance), None)
        if matching_handle is None:
            suffix = re.search(r"(\d+)$", instance)
            inferred_handle = "htim" + suffix.group(1) if suffix else instance.lower()
            matching_handle = inferred_handle
        model = handles.setdefault(matching_handle, {"handle": matching_handle, "sources": {}, "channels": [], "pwmCalls": []})
        model.setdefault("instance", instance)
        ioc_timer = ioc_instances.get(instance, {})
        if model.get("prescaler") is None:
            model["prescaler"] = number_value(ioc_timer.get("Prescaler")) or 0
        if model.get("period") is None:
            model["period"] = number_value(ioc_timer.get("Period"))
        for field, ioc_name in (("counterMode", "CounterMode"), ("clockDivision", "ClockDivision")):
            if model.get(field) is None and ioc_timer.get(ioc_name) is not None:
                model[field] = ioc_timer[ioc_name]
        existing_channels = {int(channel.get("channelNumber") or 0): channel for channel in model.get("channels", [])}
        for ioc_channel in ioc_timer.get("channels", []):
            number = int(ioc_channel.get("channelNumber") or 0)
            channel = existing_channels.get(number)
            if channel is None:
                channel = dict(ioc_channel)
                model["channels"].append(channel)
                existing_channels[number] = channel
            else:
                channel["pin"] = channel.get("pin") or ioc_channel.get("pin")
                if channel.get("pulse") is None:
                    channel["pulse"] = number_value(ioc_channel.get("pulse"))
        timer_number = int(re.search(r"\d+", instance).group(0))
        apb2 = timer_number in {1, 8, 9, 10, 11, 15, 16, 17}
        model["bus"] = "APB2" if apb2 else "APB1"
        model["clockHz"] = timer_pclk2 if apb2 else timer_pclk1
        prescaler = int(model.get("prescaler") or 0)
        period = model.get("period")
        model["frequencyHz"] = model["clockHz"] / ((prescaler + 1) * (int(period) + 1)) if model.get("clockHz") and period is not None else None
        model["channels"] = sorted(model.get("channels", []), key=lambda item: int(item.get("channelNumber") or 0))
    return handles


def _walk_operations(operations: Sequence[dict]) -> Iterable[dict]:
    for operation in operations:
        yield operation
        if operation.get("op") == "while":
            yield from _walk_operations(operation.get("body", []))
        elif operation.get("op") == "for":
            yield from _walk_operations(operation.get("init", []))
            yield from _walk_operations(operation.get("body", []))
            yield from _walk_operations(operation.get("increment", []))
        elif operation.get("op") == "if":
            yield from _walk_operations(operation.get("then", []))
            yield from _walk_operations(operation.get("else", []))
        elif operation.get("op") == "switch":
            for case in operation.get("cases", []):
                yield from _walk_operations(case.get("body", []))
            yield from _walk_operations(operation.get("default", []))


def _assign_operation_ids(operations: Sequence[dict], prefix: str = "op") -> None:
    counter = 0

    def visit(items: Sequence[dict]) -> None:
        nonlocal counter
        for item in items:
            counter += 1
            item["id"] = f"{prefix}-{counter}"
            if item.get("op") == "while":
                visit(item.get("body", []))
            elif item.get("op") == "for":
                visit(item.get("init", []))
                visit(item.get("body", []))
                visit(item.get("increment", []))
            elif item.get("op") == "if":
                visit(item.get("then", []))
                visit(item.get("else", []))
            elif item.get("op") == "switch":
                for case in item.get("cases", []):
                    visit(case.get("body", []))
                visit(item.get("default", []))

    visit(operations)


def _parse_named_function_program(
    records: Sequence[_ProjectFile],
    name: str,
    macros: Mapping[str, _Macro],
    aliases: Mapping[str, dict],
    uarts: Mapping[str, dict],
    i2cs: Mapping[str, dict],
    spis: Mapping[str, dict],
    adcs: Mapping[str, dict],
    diagnostics: list[dict],
) -> tuple[str | None, list[dict]]:
    candidates: list[tuple[_ProjectFile, list[_Token], tuple[int, int]]] = []
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES):
            continue
        tokens = _lex_c(record.content)
        body = _find_function(tokens, name)
        if body:
            candidates.append((record, tokens, body))
    if not candidates:
        return None, []
    candidates.sort(
        key=lambda item: (
            100 if re.search(r"(?:^|/)core/src/", item[0].path.casefold()) else 0,
            -100 if re.search(r"(?:^|/)drivers?/", item[0].path.casefold()) else 0,
            -item[0].path.count("/"),
        ),
        reverse=True,
    )
    selected, tokens, body = candidates[0]
    parser = _StatementParser(tokens, selected.path, macros, aliases, uarts, i2cs, spis, adcs, diagnostics)
    operations = parser.parse(body[0], body[1])
    _assign_operation_ids(operations, "task-" + re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower())
    return selected.path, operations


def _parse_hal_callbacks(
    records: Sequence[_ProjectFile],
    macros: Mapping[str, _Macro],
    aliases: Mapping[str, dict],
    uarts: Mapping[str, dict],
    i2cs: Mapping[str, dict],
    spis: Mapping[str, dict],
    adcs: Mapping[str, dict],
    diagnostics: list[dict],
) -> dict[str, dict]:
    callback_names = (
        "HAL_ADC_ConvHalfCpltCallback",
        "HAL_ADC_ConvCpltCallback",
        "HAL_ADC_ErrorCallback",
        "HAL_UART_TxHalfCpltCallback",
        "HAL_UART_TxCpltCallback",
        "HAL_UART_RxHalfCpltCallback",
        "HAL_UART_RxCpltCallback",
        "HAL_UART_ErrorCallback",
    )
    callbacks: dict[str, dict] = {}
    for name in callback_names:
        has_project_definition = any(
            record.path.casefold().endswith(C_SOURCE_SUFFIXES)
            and not re.search(r"(?:^|/)drivers?/", record.path.casefold())
            and _find_function(_lex_c(record.content), name) is not None
            for record in records
        )
        if not has_project_definition:
            continue
        source_path, operations = _parse_named_function_program(
            records, name, macros, aliases, uarts, i2cs, spis, adcs, diagnostics
        )
        if source_path is None:
            continue
        callbacks[name] = {
            "entry": name,
            "source": source_path,
            "operations": operations,
        }
    return callbacks


def _string_argument(tokens: Sequence[_Token]) -> str | None:
    for token in tokens:
        if token.kind == "string":
            decoded = _decode_c_string_literal(token.value)
            if decoded is not None:
                return bytes(decoded).decode("utf-8", errors="replace")
    return None


def _priority_model(tokens: Sequence[_Token], resolve_integer) -> tuple[int, str]:
    text = _tokens_text(tokens).strip()
    resolved = resolve_integer(text)
    cmsis_priorities = {
        "osPriorityIdle": 1,
        "osPriorityLow": 8,
        "osPriorityBelowNormal": 16,
        "osPriorityNormal": 24,
        "osPriorityAboveNormal": 32,
        "osPriorityHigh": 40,
        "osPriorityRealtime": 48,
    }
    identifier = _first_identifier(tokens, ignore={"osPriority_t"})
    if resolved is None and identifier in cmsis_priorities:
        resolved = cmsis_priorities[identifier]
    label = identifier or (str(resolved) if resolved is not None else text or "Normal")
    return int(resolved if resolved is not None else 24), label


def _parse_thread_attributes(records: Sequence[_ProjectFile], resolve_integer) -> dict[str, dict]:
    attributes: dict[str, dict] = {}
    pattern = re.compile(r"(?:const\s+)?osThreadAttr_t\s+(\w+)\s*=\s*\{(.*?)\}\s*;", re.DOTALL)
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        for match in pattern.finditer(_strip_comments(record.content)):
            name, body = match.group(1), match.group(2)
            display = re.search(r"\.name\s*=\s*\"([^\"]+)\"", body)
            stack = re.search(r"\.stack_size\s*=\s*([^,}\n]+)", body)
            priority = re.search(r"\.priority\s*=\s*([^,}\n]+)", body)
            stack_bytes = resolve_integer(stack.group(1)) if stack else None
            priority_text = priority.group(1) if priority else "osPriorityNormal"
            priority_tokens = _lex_c(priority_text)
            priority_value, priority_label = _priority_model(priority_tokens, resolve_integer)
            attributes[name] = {
                "name": display.group(1) if display else name.removesuffix("_attributes"),
                "stackWords": max(1, int(stack_bytes // 4)) if stack_bytes else 128,
                "priority": priority_value,
                "priorityLabel": priority_label,
            }
    return attributes


def _parse_middlewares(
    records: Sequence[_ProjectFile],
    macros: Mapping[str, _Macro],
    aliases: Mapping[str, dict],
    uarts: dict[str, dict],
    i2cs: dict[str, dict],
    spis: dict[str, dict],
    adcs: dict[str, dict],
    diagnostics: list[dict],
) -> dict:
    resolve_integer, _ = _make_integer_resolver(macros)
    joined = "\n".join(record.content for record in records)
    lowered = joined.casefold()
    freertos_detected = any(marker in lowered for marker in (
        "freertos.h", "task.h", "cmsis_os.h", "cmsis_os2.h", "xtaskcreate", "osthreadnew", "oskernelstart"
    ))
    catalog = []
    module_markers = {
        "lwIP": ("lwip/", "lwip.h", "mx_lwip_init"),
        "FatFS": ("fatfs.h", "ff.h", "mx_fatfs_init"),
        "USB": ("usb_device.h", "usb_host.h", "usbd_"),
        "CMSIS-DSP": ("arm_math.h", "arm_math_types.h"),
    }
    for module, markers in module_markers.items():
        files = [record.path for record in records if any(marker in record.content.casefold() or marker in record.path.casefold() for marker in markers)]
        if files:
            catalog.append({"name": module, "status": "recognized", "files": sorted(set(files))})

    freertos = {
        "detected": freertos_detected,
        "api": "Bare Metal",
        "scheduler": "not-present",
        "tickRateHz": 0,
        "heapBytes": 0,
        "maxPriorities": 0,
        "tasks": [],
        "files": [],
    }
    if not freertos_detected:
        return {"freertos": freertos, "catalog": catalog}

    freertos_files = [
        record.path for record in records
        if any(marker in record.content.casefold() or marker in record.path.casefold() for marker in ("freertos", "cmsis_os", "task.h"))
    ]
    is_cmsis2 = "osthreadnew" in lowered or "cmsis_os2.h" in lowered
    is_cmsis1 = not is_cmsis2 and ("osthreadcreate" in lowered or "cmsis_os.h" in lowered)
    tick_rate = resolve_integer("configTICK_RATE_HZ") or 1000
    freertos.update({
        "api": "CMSIS-RTOS2" if is_cmsis2 else "CMSIS-RTOS1" if is_cmsis1 else "FreeRTOS",
        "scheduler": "ready",
        "tickRateHz": int(tick_rate),
        "heapBytes": int(resolve_integer("configTOTAL_HEAP_SIZE") or 0),
        "maxPriorities": int(resolve_integer("configMAX_PRIORITIES") or 0),
        "files": sorted(set(freertos_files)),
    })
    attributes = _parse_thread_attributes(records, resolve_integer)
    tasks: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES):
            continue
        tokens = _lex_c(record.content)
        for index, token in enumerate(tokens[:-1]):
            if token.value not in {"xTaskCreate", "xTaskCreateStatic", "osThreadNew"} or tokens[index + 1].value != "(":
                continue
            close = _matching(tokens, index + 1, "(", ")")
            if close is None:
                continue
            arguments = _split_arguments(tokens[index + 2 : close])
            if token.value == "osThreadNew" and len(arguments) >= 3:
                entry = _first_identifier(arguments[0])
                attr_name = _first_identifier(arguments[2], ignore={"NULL"})
                attr = attributes.get(attr_name or "", {})
                task_name = str(attr.get("name") or entry or "thread")
                stack_words = int(attr.get("stackWords") or 128)
                priority = int(attr.get("priority") or 24)
                priority_label = str(attr.get("priorityLabel") or "Normal")
                handle = None
            elif len(arguments) >= 5:
                entry = _first_identifier(arguments[0])
                task_name = _string_argument(arguments[1]) or entry or "task"
                stack_words = resolve_integer(_tokens_text(arguments[2])) or 128
                priority, priority_label = _priority_model(arguments[4], resolve_integer)
                handle = _first_identifier(arguments[5], ignore={"NULL"}) if len(arguments) > 5 else None
            else:
                continue
            if not entry or (entry, task_name) in seen:
                continue
            seen.add((entry, task_name))
            source_path, operations = _parse_named_function_program(records, entry, macros, aliases, uarts, i2cs, spis, adcs, diagnostics)
            for operation in _walk_operations(operations):
                operation_name = operation.get("op")
                if operation_name not in {"uartReceive", "uartTransmit"}:
                    continue
                uart_handle = operation.get("uart")
                if not uart_handle:
                    continue
                if uart_handle not in uarts:
                    suffix = re.search(r"(\d+)$", str(uart_handle))
                    uarts[uart_handle] = {
                        "handle": uart_handle,
                        "instance": "USART" + suffix.group(1) if suffix else None,
                        "baudRate": None,
                        "txPin": None,
                        "rxPin": None,
                        "frame": {"dataBits": 8, "stopBits": 1, "parity": "none"},
                        "receiveCalls": [],
                        "transmitCalls": [],
                        "sources": {},
                    }
                uart = uarts[uart_handle]
                operation["instance"] = uart.get("instance")
                metadata = {
                    "operationId": operation.get("id"),
                    "task": task_name,
                    "buffer": operation.get("buffer"),
                    "length": operation.get("length"),
                    "timeout": operation.get("timeout"),
                    "blocking": operation.get("blocking", False),
                    "source": operation.get("source"),
                }
                key = "receiveCalls" if operation_name == "uartReceive" else "transmitCalls"
                if not any(item.get("operationId") == metadata["operationId"] for item in uart[key]):
                    uart[key].append(metadata)
            tasks.append({
                "id": handle or task_name,
                "handle": handle,
                "name": task_name,
                "entry": entry,
                "source": source_path,
                "priority": priority,
                "priorityLabel": priority_label,
                "stackWords": int(stack_words),
                "operations": operations,
            })

    freertos["tasks"] = tasks
    if freertos_detected and not tasks:
        diagnostics.append(_diagnostic(
            "information",
            "FREERTOS_NO_TASKS",
            "FreeRTOS middleware was detected, but no supported task creation call was found",
        ))
    return {"freertos": freertos, "catalog": catalog}


def _parse_program(
    records: Sequence[_ProjectFile],
    macros: Mapping[str, _Macro],
    aliases: Mapping[str, dict],
    uarts: dict[str, dict],
    i2cs: dict[str, dict],
    spis: dict[str, dict],
    adcs: dict[str, dict],
    diagnostics: list[dict],
) -> dict:
    candidates: list[tuple[_ProjectFile, list[_Token], tuple[int, int]]] = []
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES):
            continue
        tokens = _lex_c(record.content)
        body = _find_function(tokens, "main")
        if body:
            candidates.append((record, tokens, body))
    if not candidates:
        diagnostics.append(
            _diagnostic("error", "MAIN_NOT_FOUND", "Could not find a definition of int main(...) in the project")
        )
        return {"entry": "main", "operations": [], "blockingReceives": []}
    candidates.sort(
        key=lambda item: (
            100 if re.fullmatch(r"core/src/main\.(?:c|cc|cpp|cxx)", item[0].path.casefold()) else 90 if re.search(r"/core/src/main\.(?:c|cc|cpp|cxx)$", item[0].path.casefold()) else 0,
            -item[0].path.count("/"),
        ),
        reverse=True,
    )
    selected, tokens, (start, end) = candidates[0]
    if len(candidates) > 1:
        diagnostics.append(
            _diagnostic(
                "warning",
                "MULTIPLE_MAIN_FUNCTIONS",
                f"Multiple main functions were found; using {selected.path}",
                file=selected.path,
                details={"candidates": [item[0].path for item in candidates]},
            )
        )
    parser = _StatementParser(tokens, selected.path, macros, aliases, uarts, i2cs, spis, adcs, diagnostics)
    operations = parser.parse(start, end)
    _assign_operation_ids(operations)
    blocking_receives: list[dict] = []
    for operation in _walk_operations(operations):
        operation_name = operation.get("op")
        if operation_name in {"uartReceive", "uartTransmit", "uartReceiveDma", "uartTransmitDma", "uartDmaStop"}:
            handle = operation.get("uart")
            if handle and handle not in uarts:
                suffix = re.search(r"(\d+)$", str(handle))
                uarts[handle] = {
                    "handle": handle,
                    "instance": "USART" + suffix.group(1) if suffix else None,
                    "baudRate": None,
                    "txPin": None,
                    "rxPin": None,
                    "frame": {"dataBits": 8, "stopBits": 1, "parity": "none"},
                    "receiveCalls": [],
                    "transmitCalls": [],
                    "sources": {},
                }
            uart = uarts.get(handle) if handle else None
            if uart:
                operation["instance"] = uart.get("instance")
                metadata = {
                    "operationId": operation["id"],
                    "buffer": operation.get("buffer"),
                    "length": operation.get("length"),
                    "timeout": operation.get("timeout"),
                    "blocking": operation.get("blocking", False),
                    "source": operation.get("source"),
                }
                if operation_name != "uartDmaStop":
                    metadata["dma"] = operation_name.endswith("Dma")
                    key = "receiveCalls" if "Receive" in operation_name else "transmitCalls"
                    uart[key].append(metadata)
                if operation_name == "uartReceive" and operation.get("blocking"):
                    blocking_receives.append(
                        {
                            "operationId": operation["id"],
                            "uart": handle,
                            "buffer": operation.get("buffer"),
                            "length": operation.get("length"),
                            "timeout": operation.get("timeout"),
                        }
                    )
            continue

        if operation_name in {"i2cMasterTransmit", "i2cMemWrite"}:
            handle = operation.get("i2c")
            if handle and handle not in i2cs:
                suffix = re.search(r"(\d+)$", str(handle))
                i2cs[handle] = {
                    "handle": handle,
                    "instance": "I2C" + suffix.group(1) if suffix else None,
                    "sclPin": None,
                    "sdaPin": None,
                    "clockSpeed": None,
                    "addressBits": 7,
                    "masterTransmitCalls": [],
                    "memWriteCalls": [],
                    "sources": {},
                }
            i2c = i2cs.get(handle) if handle else None
            if i2c:
                operation["instance"] = i2c.get("instance")
                metadata = {
                    "operationId": operation["id"],
                    "deviceAddress": operation.get("deviceAddress"),
                    "buffer": operation.get("buffer"),
                    "length": operation.get("length"),
                    "timeout": operation.get("timeout"),
                    "blocking": operation.get("blocking", False),
                    "source": operation.get("source"),
                }
                if operation_name == "i2cMemWrite":
                    metadata.update(
                        {
                            "memoryAddress": operation.get("memoryAddress"),
                            "memoryAddressSize": operation.get("memoryAddressSize"),
                        }
                    )
                    i2c["memWriteCalls"].append(metadata)
                else:
                    i2c["masterTransmitCalls"].append(metadata)
            continue

        if operation_name == "spiTransmit":
            handle = operation.get("spi")
            if handle and handle not in spis:
                suffix = re.search(r"(\d+)$", str(handle))
                spis[handle] = {
                    "handle": handle,
                    "instance": "SPI" + suffix.group(1) if suffix else None,
                    "sckPin": None,
                    "mosiPin": None,
                    "misoPin": None,
                    "transmitCalls": [],
                    "sources": {},
                }
            spi = spis.get(handle) if handle else None
            if spi:
                operation["instance"] = spi.get("instance")
                spi["transmitCalls"].append({
                    "operationId": operation["id"],
                    "buffer": operation.get("buffer"),
                    "length": operation.get("length"),
                    "timeout": operation.get("timeout"),
                    "blocking": operation.get("blocking", False),
                    "source": operation.get("source"),
                })
            continue

        if operation_name in {"adcStart", "adcPollForConversion", "adcGetValue", "adcStartDma", "adcStopDma"}:
            handle = operation.get("adc")
            if handle and handle not in adcs:
                suffix = re.search(r"(\d+)$", str(handle))
                adcs[handle] = {
                    "handle": handle,
                    "instance": "ADC" + suffix.group(1) if suffix else None,
                    "channels": [],
                    "startCalls": [],
                    "pollCalls": [],
                    "getValueCalls": [],
                    "dmaCalls": [],
                    "sources": {},
                }
            adc = adcs.get(handle) if handle else None
            if adc:
                operation["instance"] = adc.get("instance")
                metadata = {
                    "operationId": operation["id"],
                    "source": operation.get("source"),
                }
                if operation_name == "adcStart":
                    adc["startCalls"].append(metadata)
                elif operation_name in {"adcStartDma", "adcStopDma"}:
                    metadata.update({
                        "operation": operation_name,
                        "buffer": operation.get("buffer"),
                        "length": operation.get("length"),
                    })
                    adc.setdefault("dmaCalls", []).append(metadata)
                elif operation_name == "adcPollForConversion":
                    metadata.update(
                        {
                            "timeout": operation.get("timeout"),
                            "blocking": operation.get("blocking", False),
                        }
                    )
                    adc["pollCalls"].append(metadata)
                else:
                    metadata["target"] = operation.get("target")
                    adc["getValueCalls"].append(metadata)
    return {
        "entry": "main",
        "source": selected.path,
        "operations": operations,
        "blockingReceives": blocking_receives,
    }


def _build_outputs(operations: Sequence[dict], aliases: Mapping[str, dict], pins: Mapping[str, dict]) -> dict:
    outputs: dict[str, dict] = {}
    for operation in _walk_operations(operations):
        if operation.get("op") not in {"gpioWrite", "gpioToggle"}:
            continue
        physical_pin = operation.get("pin")
        if not physical_pin:
            continue
        output = outputs.setdefault(
            physical_pin,
            {
                "physicalPin": physical_pin,
                "aliases": [],
                "initialState": None,
                "writeOperationIds": [],
            },
        )
        alias = operation.get("alias")
        if alias and alias not in output["aliases"]:
            output["aliases"].append(alias)
        output["writeOperationIds"].append(operation["id"])
    for physical_pin, output in outputs.items():
        for alias, model in aliases.items():
            if model.get("physicalPin") == physical_pin and alias not in output["aliases"]:
                output["aliases"].append(alias)
        pin = pins.get(physical_pin, {})
        output["iocSignal"] = pin.get("iocSignal", "")
        output["mode"] = pin.get("mode", "")
    return outputs


def build_hal_model(files: Iterable[object]) -> dict:
    """Parse normalised project files into a JSON-serializable HAL model.

    ``files`` accepts ``(path, content)`` pairs (``path`` may be a ``Path``) or
    mappings containing ``path`` and ``content``.  The returned mapping contains
    no dataclasses, Paths, sets, or other values that require a custom encoder.
    """

    records = _normalise_files(files)
    diagnostics: list[dict] = []
    _, ioc = _parse_ioc(records, diagnostics)
    macros = _collect_macros(records, diagnostics)
    variables = _parse_initial_variables(records, macros)
    variable_types = _parse_variable_types(records)
    aliases = _build_gpio_aliases(macros, ioc, diagnostics)
    uarts = _parse_source_uart_configuration(records, macros, ioc, diagnostics)
    i2cs = _parse_source_i2c_configuration(records, macros, ioc, diagnostics)
    spis = _parse_source_spi_configuration(records, macros, ioc)
    adcs = _parse_source_adc_configuration(records, ioc)
    dmas, dma_links = _parse_source_dma_configuration(records)
    timers = _parse_source_timer_configuration(records, macros, ioc)
    program = _parse_program(records, macros, aliases, uarts, i2cs, spis, adcs, diagnostics)
    middlewares = _parse_middlewares(records, macros, aliases, uarts, i2cs, spis, adcs, diagnostics)
    callbacks = _parse_hal_callbacks(records, macros, aliases, uarts, i2cs, spis, adcs, diagnostics)

    for link in dma_links:
        peripheral_handle = link.get("peripheral")
        peripheral_instance = str(link.get("peripheralInstance") or "").upper()
        field = str(link.get("field") or "").casefold()
        dma_handle = link.get("dma")
        adc_handle = peripheral_handle if peripheral_handle in adcs else next(
            (handle for handle, descriptor in adcs.items() if str(descriptor.get("instance") or "").upper() == peripheral_instance),
            None,
        )
        uart_handle = peripheral_handle if peripheral_handle in uarts else next(
            (handle for handle, descriptor in uarts.items() if str(descriptor.get("instance") or "").upper() == peripheral_instance),
            None,
        )
        if adc_handle:
            adcs[adc_handle]["dmaHandle"] = dma_handle
        if uart_handle:
            if "tx" in field:
                uarts[uart_handle]["txDmaHandle"] = dma_handle
            elif "rx" in field:
                uarts[uart_handle]["rxDmaHandle"] = dma_handle

    pins: dict[str, dict] = ioc["pins"]  # type: ignore[assignment]
    output_operations = list(program["operations"])
    for task in middlewares.get("freertos", {}).get("tasks", []):
        output_operations.extend(task.get("operations", []))
    for callback in callbacks.values():
        output_operations.extend(callback.get("operations", []))
    for operation in _walk_operations(output_operations):
        operation_name = operation.get("op")
        if operation_name in {"adcStartDma", "adcStopDma"}:
            adc = adcs.get(operation.get("adc"), {})
            dma_handle = adc.get("dmaHandle")
            dma = dmas.get(dma_handle, {}) if dma_handle else {}
            operation["dmaHandle"] = dma_handle
            operation["dmaInstance"] = dma.get("instance")
            operation["circular"] = bool(dma.get("circular", False))
        elif operation_name in {"uartTransmitDma", "uartReceiveDma", "uartDmaStop"}:
            uart = uarts.get(operation.get("uart"), {})
            if operation_name == "uartTransmitDma":
                dma_handle = uart.get("txDmaHandle")
            elif operation_name == "uartReceiveDma":
                dma_handle = uart.get("rxDmaHandle")
            else:
                dma_handle = None
            dma = dmas.get(dma_handle, {}) if dma_handle else {}
            operation["dmaHandle"] = dma_handle
            operation["dmaInstance"] = dma.get("instance")
            operation["circular"] = bool(dma.get("circular", False))

        if operation.get("op") not in {"pwmStart", "pwmStop", "pwmSetCompare"}:
            continue
        handle = operation.get("timer")
        timer = timers.get(handle) if handle else None
        if timer is None and handle:
            suffix = re.search(r"(\d+)$", str(handle))
            timer = {
                "handle": handle,
                "instance": "TIM" + suffix.group(1) if suffix else None,
                "prescaler": 0,
                "period": None,
                "clockHz": None,
                "frequencyHz": None,
                "channels": [],
                "pwmCalls": [],
                "sources": {},
            }
            timers[handle] = timer
        if not timer:
            continue
        operation["instance"] = timer.get("instance")
        operation["period"] = timer.get("period")
        operation["prescaler"] = timer.get("prescaler")
        operation["timerClockHz"] = timer.get("clockHz")
        operation["frequencyHz"] = timer.get("frequencyHz")
        channel_number = operation.get("channel")
        channel = next((item for item in timer.get("channels", []) if item.get("channelNumber") == channel_number), None)
        if channel:
            operation["pin"] = channel.get("pin")
            operation["initialCompare"] = channel.get("pulse")
        timer.setdefault("pwmCalls", []).append({
            "operationId": operation.get("id"),
            "operation": operation.get("op"),
            "channel": channel_number,
            "source": operation.get("source"),
        })
    outputs = _build_outputs(output_operations, aliases, pins)
    for pin in pins.values():
        pin["aliases"] = sorted(set(pin.get("aliases", [])))
    diagnostics.sort(
        key=lambda item: (
            {"error": 0, "warning": 1, "information": 2}.get(str(item.get("severity")), 3),
            str(item.get("file", "")),
            int(item.get("line", 0) or 0),
            str(item.get("code", "")),
        )
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "mcu": ioc["mcu"],
        "pins": dict(sorted(pins.items())),
        "gpioAliases": dict(sorted(aliases.items())),
        "uarts": dict(sorted(uarts.items())),
        "i2cs": dict(sorted(i2cs.items())),
        "spis": dict(sorted(spis.items())),
        "adcs": dict(sorted(adcs.items())),
        "dmas": dict(sorted(dmas.items())),
        "timers": dict(sorted(timers.items())),
        "outputs": dict(sorted(outputs.items())),
        "variables": dict(sorted(variables.items())),
        "variableTypes": dict(sorted(variable_types.items())),
        "program": program,
        "callbacks": callbacks,
        "middlewares": middlewares,
        "diagnostics": diagnostics,
    }


parse_hal_model = build_hal_model


__all__ = ["SCHEMA_VERSION", "build_hal_model", "parse_hal_model"]
