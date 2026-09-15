"""Build a small, JSON-serializable STM32 HAL behaviour model.

The parser intentionally supports a constrained, explicit subset of STM32Cube
projects.  It never executes project text.  Unsupported or ambiguous source is
reported through diagnostics instead of being replaced by a fabricated board
behaviour.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import math
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
    # ``None`` denotes an object-like macro.  A tuple denotes a function-like
    # macro (including an empty tuple for ``NAME()``).  Keeping this distinction
    # is important because C only treats ``NAME(...)`` as a function macro when
    # the opening parenthesis is adjacent to the macro name.
    parameters: tuple[str, ...] | None = None


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
    # The whitespace before the replacement list is intentionally optional:
    # ``#define BIT(n) ...`` is function-like, while ``#define VALUE (1)`` is
    # object-like.  C uses the adjacency of ``name`` and ``(`` to tell them
    # apart, so capture that shape explicitly instead of using a loose split.
    macro_pattern = re.compile(
        r"^[ \t]*#[ \t]*define[ \t]+"
        r"(?P<name>[A-Za-z_]\w*)"
        r"(?P<params>\((?:[^()]|\([^)]*\))*\))?"
        r"(?:[ \t]+(?P<expression>.*?))?[ \t]*$"
    )
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES + (".inc",)):
            continue
        cleaned = _mask_inactive_preprocessor(record.content, keep_definitions=True)
        priority = _macro_priority(record.path)
        for line_number, line in _logical_lines(cleaned):
            match = macro_pattern.match(line)
            if not match:
                continue
            name = match.group("name")
            raw_parameters = match.group("params")
            parameters: tuple[str, ...] | None
            if raw_parameters is None:
                parameters = None
            else:
                parameter_text = raw_parameters[1:-1].strip()
                if not parameter_text or parameter_text == "void":
                    parameters = ()
                else:
                    parsed_parameters: list[str] = []
                    for parameter in parameter_text.split(","):
                        # Variadic macros are uncommon in firmware logic, but
                        # retaining ``__VA_ARGS__`` as a normal token lets the
                        # expansion path fail explicitly instead of silently
                        # changing the replacement text.
                        parameter = parameter.strip()
                        match_parameter = re.fullmatch(r"([A-Za-z_]\w*)", parameter)
                        if not match_parameter:
                            parsed_parameters = []
                            break
                        parsed_parameters.append(match_parameter.group(1))
                    parameters = tuple(parsed_parameters)
            expression = (match.group("expression") or "").strip()
            candidate = _Macro(name, expression, record.path, line_number, priority, parameters)
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


def _collect_enum_constants(
    records: Sequence[_ProjectFile], macros: Mapping[str, _Macro]
) -> dict[str, _Macro]:
    """Add ordinary C enum members to the shared integer constant table.

    CubeMX headers use enums for GPIO modes, DMA settings, and status values;
    application code also commonly switches on an enum declared in a header.
    Treating members as object-like integer macros keeps the existing resolver
    and expression IR small while preserving explicit initializers and the C
    auto-increment rule.
    """

    result: dict[str, _Macro] = dict(macros)
    enum_pattern = re.compile(
        r"\benum(?:\s+(?:class|struct))?(?:\s+[A-Za-z_]\w*)?\s*\{(?P<body>.*?)\}",
        re.DOTALL,
    )
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _mask_inactive_preprocessor(record.content)
        for enum_match in enum_pattern.finditer(cleaned):
            body_tokens = _lex_c(enum_match.group("body"), result)
            current: int | None = -1
            for item in _split_arguments(body_tokens):
                if not item:
                    continue
                identifier = next(
                    (
                        token.value
                        for token in item
                        if token.kind == "identifier"
                        and token.value not in {"enum", "class", "struct"}
                    ),
                    None,
                )
                if not identifier:
                    continue
                equal = next((index for index, token in enumerate(item) if token.value == "="), None)
                if equal is not None:
                    expression = _tokens_text(item[equal + 1 :]).strip()
                    resolver, _ = _make_integer_resolver(result)
                    value = resolver(expression)
                    if value is None:
                        # Keep the member out of the table rather than
                        # fabricating a number; subsequent members also cannot
                        # be auto-incremented reliably from an unknown base.
                        current = None
                        continue
                    current = int(value)
                elif current is not None:
                    current += 1
                else:
                    continue
                line = _source_line(cleaned, enum_match.start())[0]
                existing = result.get(identifier)
                if existing is None or existing.priority <= _macro_priority(record.path):
                    result[identifier] = _Macro(
                        identifier,
                        str(current),
                        record.path,
                        line,
                        _macro_priority(record.path),
                        None,
                    )
    return result


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
        if macro is None or macro.parameters is not None or name in resolving:
            return None
        resolving.add(name)
        value = resolve_expression(macro.expression)
        resolving.remove(name)
        cache[name] = value
        return value

    def resolve_expression(expression: str) -> int | None:
        # Expand small function-like macros (for example ``BIT(3)``) before
        # feeding the text to the integer evaluator.  The lexer/helper is
        # defined later in this module but is available when this closure is
        # invoked during model construction.
        try:
            expanded_tokens = _expand_function_macros(_lex_c(expression), macros)
            expanded_text = _tokens_text(expanded_tokens)
        except (NameError, TypeError):
            expanded_text = expression
        tokens = _tokenise_integer(expanded_text)
        if not tokens:
            return None
        try:
            return _IntegerParser(tokens, resolve_identifier).parse()
        except (ValueError, OverflowError):
            return None

    # Expression lowering uses this back-reference to apply the same macro
    # expansion when it builds a runtime tree.
    resolve_expression.macros = macros  # type: ignore[attr-defined]
    return resolve_expression, resolve_identifier


def _mask_inactive_preprocessor(
    source: str,
    macros: Mapping[str, _Macro] | None = None,
    *,
    keep_definitions: bool = False,
) -> str:
    """Mask inactive C preprocessor branches while preserving source offsets.

    The semantic parser is intentionally not a full C preprocessor, but it
    still needs the basic conditional-compilation rules used by CubeMX and
    CMSIS headers.  Replacing skipped text with spaces (and retaining every
    newline) means token locations and diagnostics continue to point at the
    original file.  Definitions encountered in active lines are made visible
    to later ``#if`` expressions in the same file.
    """

    cleaned = _strip_comments(source)
    characters = list(cleaned)
    inherited: dict[str, _Macro] = dict(macros or {})
    local = dict(inherited)
    stack: list[dict[str, bool]] = []

    def is_active() -> bool:
        return all(item["active"] for item in stack)

    def mask(start: int, end: int) -> None:
        for position in range(start, end):
            if characters[position] not in "\r\n":
                characters[position] = " "

    def local_integer(name: str, resolving: set[str] | None = None) -> int | None:
        resolving = set() if resolving is None else resolving
        macro = local.get(name)
        if macro is None or macro.parameters is not None or name in resolving:
            return None
        expression = macro.expression.strip()
        tokens = _tokenise_integer(expression)
        if not tokens:
            return None
        try:
            return _IntegerParser(
                tokens,
                lambda identifier: local_integer(identifier, resolving | {name}),
            ).parse()
        except (ValueError, OverflowError):
            return None

    def condition_value(expression: str) -> bool:
        text = expression.strip()
        # ``defined NAME`` and ``defined(NAME)`` are the forms emitted by
        # compiler headers.  Replace them before evaluating the integer part.
        text = re.sub(
            r"\bdefined\s*\(\s*([A-Za-z_]\w*)\s*\)",
            lambda match: "1" if match.group(1) in local else "0",
            text,
            flags=re.IGNORECASE,
        )
        text = re.sub(
            r"\bdefined\s+([A-Za-z_]\w*)",
            lambda match: "1" if match.group(1) in local else "0",
            text,
            flags=re.IGNORECASE,
        )

        # Handle the small boolean layer around integer expressions.  Splitting
        # only at top level keeps parenthesized arithmetic intact.
        def split_top_level(value: str, operator: str) -> list[str]:
            parts: list[str] = []
            depth = 0
            start = 0
            index = 0
            while index <= len(value) - len(operator):
                char = value[index]
                if char == "(":
                    depth += 1
                elif char == ")":
                    depth = max(0, depth - 1)
                if depth == 0 and value.startswith(operator, index):
                    parts.append(value[start:index])
                    index += len(operator)
                    start = index
                    continue
                index += 1
            if parts:
                parts.append(value[start:])
            return parts

        disjunction = split_top_level(text, "||")
        if disjunction:
            return any(condition_value(part) for part in disjunction)
        conjunction = split_top_level(text, "&&")
        if conjunction:
            return all(condition_value(part) for part in conjunction)
        text = text.strip()
        if text.startswith("!"):
            return not condition_value(text[1:])
        while len(text) >= 2 and text[0] == "(" and text[-1] == ")":
            token_list = _lex_c(text)
            if _matching(token_list, 0, "(", ")") != len(token_list) - 1:
                break
            text = text[1:-1].strip()
        tokens = _tokenise_integer(text)
        if not tokens:
            return False
        try:
            return bool(
                _IntegerParser(tokens, lambda identifier: local_integer(identifier)).parse()
            )
        except (ValueError, OverflowError):
            return False

    offset = 0
    # Work with physical lines so masking never changes line/column accounting.
    for line in cleaned.splitlines(keepends=True):
        line_start = offset
        line_end = offset + len(line)
        offset = line_end
        directive = re.match(
            r"^[ \t]*#[ \t]*(if|ifdef|ifndef|elif|else|endif|define|undef)\b(?P<rest>.*)$",
            line.rstrip("\r\n"),
            flags=re.IGNORECASE,
        )
        if directive is None:
            if not is_active():
                mask(line_start, line_end)
            continue

        keyword = directive.group(1).casefold()
        rest = directive.group("rest").strip()
        parent_active = is_active()
        if keyword == "if":
            active = parent_active and condition_value(rest)
            stack.append({"parent": parent_active, "taken": active, "active": active})
        elif keyword in {"ifdef", "ifndef"}:
            identifier = re.match(r"([A-Za-z_]\w*)", rest)
            present = bool(identifier and identifier.group(1) in local)
            if keyword == "ifndef":
                present = not present
            active = parent_active and present
            stack.append({"parent": parent_active, "taken": active, "active": active})
        elif keyword == "elif":
            if stack:
                branch = stack[-1]
                active = branch["parent"] and not branch["taken"] and condition_value(rest)
                branch["active"] = active
                branch["taken"] = branch["taken"] or active
        elif keyword == "else":
            if stack:
                branch = stack[-1]
                active = branch["parent"] and not branch["taken"]
                branch["active"] = active
                branch["taken"] = True
        elif keyword == "endif":
            if stack:
                stack.pop()
        elif keyword == "define":
            if parent_active:
                definition = re.match(
                    r"([A-Za-z_]\w*)(?:\(([^()]*)\))?(?:[ \t]+(.*))?$", rest
                )
                if definition:
                    name, parameters, replacement = definition.groups()
                    parameter_tuple: tuple[str, ...] | None = None
                    if parameters is not None:
                        parsed = [item.strip() for item in parameters.split(",") if item.strip()]
                        parameter_tuple = tuple(parsed)
                    local[name] = _Macro(
                        name,
                        (replacement or "").strip(),
                        "<preprocessor>",
                        0,
                        0,
                        parameter_tuple,
                    )
        elif keyword == "undef" and parent_active:
            identifier = re.match(r"([A-Za-z_]\w*)", rest)
            if identifier:
                local.pop(identifier.group(1), None)
        # Preprocessor directives are consumed by the lexer.  Macro collection
        # asks to retain active ``#define`` lines so it can build the shared
        # macro table; all other directives remain masked.
        if not (
            keep_definitions
            and keyword in {"define", "undef"}
            and parent_active
        ):
            mask(line_start, line_end)

    if offset < len(characters) and not is_active():
        mask(offset, len(characters))
    return "".join(characters)


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


def _interrupt_edge_from_mode(value: object) -> str | None:
    normalized = str(value or "").upper()
    if "RISING_FALLING" in normalized or ("RISING" in normalized and "FALLING" in normalized):
        return "both"
    if "FALLING" in normalized:
        return "falling"
    if "RISING" in normalized:
        return "rising"
    return None


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


def _parse_gpio_interrupt_configuration(
    records: Sequence[_ProjectFile], macros: Mapping[str, _Macro], ioc: Mapping[str, object]
) -> None:
    """Attach EXTI edge metadata from IOC values and CubeMX GPIO init code."""

    pins: dict[str, dict] = ioc["pins"]  # type: ignore[assignment]
    values: Mapping[str, str] = ioc.get("values", {})  # type: ignore[assignment]
    resolve_expression, _ = _make_integer_resolver(macros)

    for physical_pin, pin in pins.items():
        candidates = [pin.get("mode"), pin.get("iocSignal")]
        prefix = physical_pin.casefold() + "."
        candidates.extend(
            value for key, value in values.items()
            if key.casefold().startswith(prefix) and ("EXTI" in key.upper() or "GPIO_MODE_IT" in str(value).upper())
        )
        edge = next((_interrupt_edge_from_mode(value) for value in candidates if _interrupt_edge_from_mode(value)), None)
        if edge:
            pin["interruptEdge"] = edge

    init_call = re.compile(
        r"\bHAL_GPIO_Init\s*\(\s*(?P<port>[^,]+),\s*&?\s*(?P<struct>[A-Za-z_]\w*)\s*\)"
    )
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES):
            continue
        cleaned = _mask_inactive_preprocessor(record.content, macros)
        for call in init_call.finditer(cleaned):
            struct_name = call.group("struct")
            prefix_source = cleaned[: call.start()]
            pin_assignments = list(re.finditer(
                rf"\b{re.escape(struct_name)}\s*\.\s*Pin\s*=\s*(?P<value>[^;]+);", prefix_source
            ))
            mode_assignments = list(re.finditer(
                rf"\b{re.escape(struct_name)}\s*\.\s*Mode\s*=\s*(?P<value>[^;]+);", prefix_source
            ))
            if not pin_assignments or not mode_assignments:
                continue
            pin_assignment = pin_assignments[-1]
            mode_assignment = mode_assignments[-1]
            if mode_assignment.start() < pin_assignment.start():
                continue
            edge = _interrupt_edge_from_mode(mode_assignment.group("value"))
            port = _resolve_port(call.group("port"), macros)
            mask = resolve_expression(pin_assignment.group("value"))
            if not edge or not port or mask is None or mask <= 0:
                continue
            for pin_number in range(16):
                if mask & (1 << pin_number):
                    physical_pin = f"P{port[-1]}{pin_number}"
                    pin = pins.setdefault(physical_pin, _empty_pin(physical_pin))
                    pin["interruptEdge"] = edge
                    pin["interruptSource"] = {
                        "file": record.path,
                        "line": _source_line(cleaned, mode_assignment.start())[0],
                    }


def _source_line(source: str, position: int) -> tuple[int, int]:
    line = source.count("\n", 0, position) + 1
    last_break = source.rfind("\n", 0, position)
    return line, position - last_break


def _lex_c(
    source: str, macros: Mapping[str, _Macro] | None = None
) -> list[_Token]:
    cleaned = _mask_inactive_preprocessor(source, macros)
    tokens: list[_Token] = []
    index = 0
    line = 1
    column = 1
    multi_operators = ("<<=", ">>=", "...", "##", "==", "!=", "<=", ">=", "&&", "||", "->", "++", "--", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=")

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
        if char.isdigit() or (char == "." and index + 1 < len(cleaned) and cleaned[index + 1].isdigit()):
            number_match = re.match(
                r"(?:"
                r"0[xX](?:(?:[0-9A-Fa-f]+\.[0-9A-Fa-f]*|\.[0-9A-Fa-f]+|[0-9A-Fa-f]+)[pP][+-]?\d+[fFlL]?|[0-9A-Fa-f]+[uUlL]*)|"
                r"0[bB][01]+[uUlL]*|"
                r"(?:(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)[fFlL]?|"
                r"\d+[uUlL]*)",
                cleaned[index:],
            )
            text = number_match.group(0) if number_match else char
            index += len(text)
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


def _expand_function_macros(
    tokens: Sequence[_Token],
    macros: Mapping[str, _Macro],
    *,
    depth: int = 0,
    expanding: frozenset[str] = frozenset(),
) -> list[_Token]:
    """Expand function-like preprocessor macros in an expression token list.

    The semantic model does not run a C preprocessor, but common embedded
    headers use small, side-effect-free helpers such as ``BIT(n)``, ``MIN``
    and ``ARRAY_SIZE`` pervasively.  Expanding only function-like macros here
    preserves the existing object-macro names (which are useful for GPIO and
    HAL diagnostics) while making those helpers ordinary expression trees.
    Expansion is bounded and recursive so malformed/self-referential macros
    remain an explicit unsupported expression instead of hanging the build.
    """

    if depth >= 24 or not tokens:
        return list(tokens)
    source_tokens = list(tokens)
    output: list[_Token] = []
    index = 0
    while index < len(source_tokens):
        token = source_tokens[index]
        macro = macros.get(token.value) if token.kind == "identifier" else None
        if (
            macro is None
            or macro.parameters is None
            or macro.name in expanding
            or index + 1 >= len(source_tokens)
            or source_tokens[index + 1].value != "("
        ):
            output.append(token)
            index += 1
            continue

        close = _matching(source_tokens, index + 1, "(", ")")
        if close is None:
            output.append(token)
            index += 1
            continue
        arguments = _split_arguments(source_tokens[index + 2 : close])
        parameters = macro.parameters
        # ``NAME()`` has one empty argument in the token splitter; normalize it
        # to zero arguments when the macro declaration has no parameters.
        if len(parameters) == 0 and len(arguments) == 1 and not arguments[0]:
            arguments = []
        if len(arguments) != len(parameters):
            # Leave the call intact.  The expression validator will report the
            # original source text, which is much more useful than silently
            # dropping a malformed macro invocation.
            output.extend(source_tokens[index : close + 1])
            index = close + 1
            continue

        substitutions = dict(zip(parameters, arguments))
        body_tokens = _lex_c(macro.expression)
        replaced: list[_Token] = []
        body_index = 0
        while body_index < len(body_tokens):
            body_token = body_tokens[body_index]
            # C stringification is occasionally used for debug text.  Preserve
            # it as a normal string literal so printf/formatting can consume it.
            if (
                body_token.value == "#"
                and body_index + 1 < len(body_tokens)
                and body_tokens[body_index + 1].kind == "identifier"
                and body_tokens[body_index + 1].value in substitutions
            ):
                argument_text = _tokens_text(substitutions[body_tokens[body_index + 1].value]).strip()
                escaped = argument_text.replace("\\", "\\\\").replace('"', '\\"')
                replaced.append(_Token(f'"{escaped}"', "string", token.start, token.line, token.column))
                body_index += 2
                continue
            # Token pasting is needed by integer constructor macros such as
            # UINT8_C(value).  Paste the immediate neighboring token values and
            # lex the result so numeric suffixes are recognized normally.
            if body_token.value == "##" and replaced and body_index + 1 < len(body_tokens):
                right = body_tokens[body_index + 1]
                right_tokens = substitutions.get(right.value, [right]) if right.kind == "identifier" else [right]
                if right_tokens:
                    pasted = replaced.pop().value + _tokens_text(right_tokens).strip()
                    pasted_tokens = _lex_c(pasted)
                    replaced.extend(pasted_tokens or [_Token(pasted, "identifier", token.start, token.line, token.column)])
                body_index += 2
                continue
            if body_token.kind == "identifier" and body_token.value in substitutions:
                adjacent_paste = (
                    (body_index > 0 and body_tokens[body_index - 1].value == "##")
                    or (body_index + 1 < len(body_tokens) and body_tokens[body_index + 1].value == "##")
                )
                if adjacent_paste:
                    # Token-paste operands are substituted without protective
                    # parentheses; the neighboring ``##`` handler combines
                    # their spelling into one lexical token.
                    replaced.extend(substitutions[body_token.value])
                    body_index += 1
                    continue
                marker = substitutions[body_token.value][0] if substitutions[body_token.value] else token
                replaced.append(_Token("(", "operator", marker.start, marker.line, marker.column))
                replaced.extend(substitutions[body_token.value])
                replaced.append(_Token(")", "operator", marker.start, marker.line, marker.column))
            else:
                replaced.append(body_token)
            body_index += 1
        output.extend(
            _expand_function_macros(
                replaced,
                macros,
                depth=depth + 1,
                expanding=expanding | {macro.name},
            )
        )
        index = close + 1
    return output


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


def _strip_leading_c_casts(tokens: Sequence[_Token]) -> list[_Token]:
    output = list(tokens)
    type_names = {
        "bool", "char", "const", "double", "enum", "float", "int", "long", "short", "signed",
        "size_t", "struct", "union", "unsigned", "void", "volatile", "_Bool",
    }
    while len(output) >= 4 and output[0].value == "(":
        close = _matching(output, 0, "(", ")")
        if close is None or close >= len(output) - 1:
            break
        cast_tokens = output[1:close]
        identifiers = [token.value for token in cast_tokens if token.kind == "identifier"]
        is_type = bool(identifiers) and all(
            name in type_names or name.endswith("_t") or name.endswith("TypeDef")
            for name in identifiers
        ) and all(token.kind == "identifier" or token.value == "*" for token in cast_tokens)
        if not is_type:
            break
        output = _strip_wrapping_parentheses(output[close + 1 :])
    return output


_SIZEOF_BUILTIN_TYPES = {
    "bool", "_bool", "char", "signed", "unsigned", "short", "int", "long",
    "float", "double", "void", "size_t", "ptrdiff_t", "intptr_t", "uintptr_t",
    "int8_t", "uint8_t", "int16_t", "uint16_t", "int32_t", "uint32_t",
    "int64_t", "uint64_t", "ssize_t",
}


def _sizeof_type_name(tokens: Sequence[_Token]) -> str | None:
    """Return a canonical type spelling for ``sizeof(type)`` operands.

    A typedef name is lexically indistinguishable from a variable name, so we
    only classify names that are conventional C type spellings (built-ins,
    fixed-width ``*_t`` aliases, or an explicit struct/union/enum tag). This
    keeps ``sizeof(buffer)`` an object expression while making
    ``sizeof(uint16_t)`` deterministic in the browser runtime.
    """

    cleaned = _strip_wrapping_parentheses(tokens)
    if not cleaned:
        return None
    if any(token.kind not in {"identifier", "operator"} for token in cleaned):
        return None
    text = _tokens_text(cleaned).replace(" *", "*").strip()
    identifiers = [token.value for token in cleaned if token.kind == "identifier"]
    if not identifiers:
        return None
    lowered = [value.casefold() for value in identifiers]
    if lowered[0] in {"struct", "union", "enum"}:
        # ``struct Foo`` and friends may carry pointer qualifiers.
        if len(identifiers) >= 2 and all(token.value in {"*"} or token.kind == "identifier" for token in cleaned):
            return text
        return None
    if all(value in _SIZEOF_BUILTIN_TYPES or value.endswith("_t") or value.endswith("typedef") for value in lowered):
        # A bare identifier such as ``foo_t`` is accepted as a typedef-sized
        # object; unknown typedefs use the runtime's deterministic word size.
        if all(token.kind == "identifier" or token.value == "*" for token in cleaned):
            return text
    return None


def _postfix_array_model(tokens: Sequence[_Token], resolve_integer, call_resolver=None) -> dict | None:
    """Model ``base[index]`` after arbitrary parenthesized bases.

    The old fast path only accepted ``name[index]``. Macro idioms such as
    ``ARRAY_SIZE(a)`` expand to ``(a)[0]`` and therefore need a general base
    expression while retaining the compact ``name`` field for existing IR.
    """

    cleaned = list(tokens)
    if len(cleaned) < 4 or cleaned[-1].value != "]":
        return None
    # Find the matching opening bracket for the final subscript, respecting
    # nested subscripts in the index itself.
    depth = 0
    opening = None
    for index in range(len(cleaned) - 1, -1, -1):
        value = cleaned[index].value
        if value == "]":
            depth += 1
        elif value == "[":
            depth -= 1
            if depth == 0:
                opening = index
                break
    if opening is None or opening == 0:
        return None
    base_tokens = _strip_wrapping_parentheses(cleaned[:opening])
    if not base_tokens:
        return None
    base = _expression_model(base_tokens, resolve_integer, call_resolver)
    index_model = _expression_model(cleaned[opening + 1 : -1], resolve_integer, call_resolver)
    index_value = index_model.get("value") if index_model.get("kind") == "literal" else index_model
    # Preserve the historical named representation where possible. Runtime
    # uses ``array`` for a general base such as ``(a)`` or ``p + 1``.
    if base.get("kind") == "variable":
        return {
            "kind": "arrayIndex",
            "name": base.get("name"),
            "index": index_value,
        }
    return {
        "kind": "arrayIndex",
        "array": base,
        "index": index_value,
    }


def _postfix_member_model(
    tokens: Sequence[_Token], resolve_integer, call_resolver=None
) -> dict | None:
    """Model ``base.member`` and ``base->member`` for arbitrary bases."""

    cleaned = list(tokens)
    if len(cleaned) < 3 or cleaned[-1].kind != "identifier" or cleaned[-2].value not in {".", "->"}:
        return None
    base_tokens = _strip_wrapping_parentheses(cleaned[:-2])
    if not base_tokens:
        return None
    return {
        "kind": "member",
        "object": _expression_model(base_tokens, resolve_integer, call_resolver),
        "member": cleaned[-1].value,
        "pointer": cleaned[-2].value == "->",
    }


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


def _parse_c_float(text: str) -> tuple[float, str] | None:
    match = re.fullmatch(
        r"(?P<number>(?:"
        r"(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+|"
        r"0[xX](?:[0-9A-Fa-f]+\.[0-9A-Fa-f]*|\.[0-9A-Fa-f]+|[0-9A-Fa-f]+)[pP][+-]?\d+"
        r"))(?P<suffix>[fFlL]?)",
        text,
    )
    if not match:
        return None
    try:
        number = match.group("number")
        value = float.fromhex(number) if number.casefold().startswith("0x") else float(number)
    except ValueError:
        return None
    if not math.isfinite(value):
        return None
    suffix = match.group("suffix").casefold()
    return value, "float" if suffix == "f" else "long double" if suffix == "l" else "double"


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

    This is deliberately not a C evaluator.  It accepts fixed-size numeric
    arrays, flat brace initializers, string literals, floating literals, and
    integer expressions already supported by the macro resolver. Unknown
    expressions are skipped instead of being invented.
    """

    resolve_expression, _ = _make_integer_resolver(macros)
    declaration_pattern = re.compile(
        r"\b(?P<qualifiers>(?:(?:static|const|volatile|register)\s+)*)"
        r"(?P<type>(?:u?int(?:8|16|32|64)_t|size_t|float|double|long\s+double|char|short|int|long|unsigned\s+char|unsigned\s+short|unsigned\s+int|unsigned\s+long))"
        r"\s+(?P<name>[A-Za-z_]\w*)\s*"
        r"(?:\[\s*(?P<size>[^\]]*)\s*\])?\s*"
        r"(?:=\s*(?P<initializer>\{[^;]*\}|\"(?:\\.|[^\"\\])*\"|[^;]+?))?\s*;",
        re.MULTILINE | re.DOTALL,
    )
    variables: dict[str, object] = {}

    def numeric_value(expression: str, floating: bool = False) -> int | float | None:
        text = expression.strip()
        parsed = _parse_c_integer(text)
        if parsed is not None:
            return parsed
        parsed_float = _parse_c_float(text)
        if floating and parsed_float is not None:
            return parsed_float[0]
        if len(text) >= 2 and text[0] == "'" and text[-1] == "'":
            decoded = _decode_c_char(text)
            return ord(decoded) if decoded is not None else None
        return resolve_expression(text)

    def normalise_value(value: int | float, type_text: str) -> int | float:
        """Apply the declared scalar width to an initializer element."""

        lowered = re.sub(r"\s+", " ", type_text.casefold()).strip()
        if "float" in lowered or "double" in lowered:
            return float(value)
        fixed = re.search(r"(?:u|s)?int(8|16|32|64)_t", lowered)
        if fixed:
            bits = int(fixed.group(1))
            unsigned = lowered.startswith("u")
        elif "char" in lowered:
            bits, unsigned = 8, not lowered.startswith("signed")
        elif "short" in lowered:
            bits, unsigned = 16, lowered.startswith("unsigned")
        elif "long long" in lowered:
            bits, unsigned = 64, lowered.startswith("unsigned")
        else:
            bits, unsigned = 32, lowered.startswith("unsigned")
        modulus = 1 << bits
        wrapped = int(value) % modulus
        if not unsigned and wrapped >= modulus // 2:
            wrapped -= modulus
        return wrapped

    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _mask_inactive_preprocessor(record.content, macros)
        for match in declaration_pattern.finditer(cleaned):
            name = match.group("name")
            floating = "float" in match.group("type") or "double" in match.group("type")
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
                        resolved = numeric_value(item, floating)
                        if resolved is None:
                            values = None
                            break
                        values.append(normalise_value(resolved, match.group("type")))
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
            scalar = numeric_value(initializer, floating)
            if scalar is not None:
                variables[name] = scalar
    return variables


def _parse_variable_types(
    records: Sequence[_ProjectFile], macros: Mapping[str, _Macro] | None = None
) -> dict[str, str]:
    """Collect scalar/array numeric declarations for runtime C coercion.

    The behaviour model remains value-oriented, but preserving the declared C
    type lets the browser runtime apply the width/sign rules when assigning a
    result back to a variable.  Unknown declarations are intentionally omitted.
    """
    declaration_pattern = re.compile(
        r"\b(?P<qualifiers>(?:(?:static|const|volatile|register)\s+)*)"
        r"(?P<type>(?:u?int(?:8|16|32|64)_t|size_t|_Bool|bool|float|double|long\s+double|char|signed\s+char|short|signed\s+short|int|signed\s+int|long|signed\s+long|"
        r"unsigned\s+(?:char|short|int|long)))"
        r"\s+(?P<pointer>\*+\s*)?(?P<name>[A-Za-z_]\w*)\s*"
        r"(?:\[[^\]]*\])?\s*"
        r"(?:=\s*(?:\{[^;]*\}|\"(?:\\.|[^\"\\])*\"|[^;]+?))?\s*;",
        re.MULTILINE | re.DOTALL,
    )
    variable_types: dict[str, str] = {}
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _mask_inactive_preprocessor(record.content, macros)
        for match in declaration_pattern.finditer(cleaned):
            pointer = (match.group("pointer") or "").replace(" ", "")
            variable_types[match.group("name")] = re.sub(r"\s+", " ", match.group("type").strip().lower()) + pointer
    return variable_types


_PURE_LIBC_FUNCTIONS = {
    "abs", "labs", "llabs", "atoi", "atol", "atoll", "atof",
    "strtol", "strtoul", "strtoll", "strtoull", "strtod", "strtof", "strtold",
    "strcmp", "strncmp", "memcmp", "memchr", "strlen", "strnlen",
    "strchr", "strrchr", "strstr", "strpbrk", "strcspn", "strspn", "strcoll",
    "strtok", "strerror",
    "rand", "sqrt", "sqrtf", "sqrtl", "pow", "powf", "powl",
    "sin", "sinf", "sinl", "cos", "cosf", "cosl", "tan", "tanf", "tanl",
    "asin", "asinf", "asinl", "acos", "acosf", "acosl", "atan", "atanf", "atanl",
    "atan2", "atan2f", "atan2l", "floor", "floorf", "floorl", "ceil", "ceilf", "ceill",
    "round", "roundf", "roundl", "trunc", "truncf", "truncl", "fabs", "fabsf", "fabsl",
    "cosh", "coshf", "coshl", "sinh", "sinhf", "sinhl", "tanh", "tanhf", "tanhl",
    "exp2", "exp2f", "exp2l", "log2", "log2f", "log2l", "cbrt", "cbrtf", "cbrtl",
    "nearbyint", "nearbyintf", "nearbyintl", "rint", "rintf", "rintl",
    "fmod", "fmodf", "fmodl", "remainder", "remainderf", "remainderl",
    "fmin", "fminf", "fminl", "fmax", "fmaxf", "fmaxl",
    "copysign", "copysignf", "copysignl", "hypot", "hypotf", "hypotl",
    "exp", "expf", "expl", "log", "logf", "logl", "log10", "log10f", "log10l",
    "ldexp", "ldexpf", "ldexpl", "frexp", "frexpf", "frexpl",
    "modf", "modff", "modfl", "isnan", "isfinite", "isinf", "signbit",
    "isalnum", "isalpha", "isblank", "iscntrl", "isdigit", "isgraph", "islower", "isprint",
    "ispunct", "isspace", "isupper", "isxdigit", "tolower", "toupper",
}

_STATEMENT_LIBC_FUNCTIONS = {
    "printf", "fprintf", "puts", "fputs", "putchar", "fputc", "fwrite", "sscanf",
    "memcpy", "memmove", "memset", "strcpy", "strncpy", "strcat", "strncat",
    "malloc", "calloc", "realloc", "free", "srand", "exit", "_Exit", "abort",
}

_SIDE_EFFECT_LIBC_FUNCTIONS = {
    "rand", "strtok",
    "strtol", "strtoul", "strtoll", "strtoull", "strtod", "strtof", "strtold",
    "frexp", "frexpf", "frexpl", "modf", "modff", "modfl",
}

_STANDARD_STRING_MACROS = {
    "PRId8": "d", "PRId16": "d", "PRId32": "d", "PRId64": "lld",
    "PRIi8": "i", "PRIi16": "i", "PRIi32": "i", "PRIi64": "lli",
    "PRIu8": "u", "PRIu16": "u", "PRIu32": "u", "PRIu64": "llu",
    "PRIx8": "x", "PRIx16": "x", "PRIx32": "x", "PRIx64": "llx",
    "PRIX8": "X", "PRIX16": "X", "PRIX32": "X", "PRIX64": "llX",
    "SCNd8": "hhd", "SCNd16": "hd", "SCNd32": "d", "SCNd64": "lld",
    "SCNu8": "hhu", "SCNu16": "hu", "SCNu32": "u", "SCNu64": "llu",
}


def _lvalue_expression_model(
    tokens: Sequence[_Token],
    resolve_integer,
    call_resolver=None,
    *,
    postfix: bool = False,
) -> dict | None:
    """Return the small set of writable expressions supported by the runtime.

    This deliberately accepts only a named variable, a single array subscript,
    or a dereference. In particular, the postfix form ``*pointer++`` is not
    treated as ``(*pointer)++``: C binds postfix increment to ``pointer``
    first, so accepting it as a writable dereference here would silently model
    a different program.
    """

    original = list(tokens)
    cleaned = _strip_wrapping_parentheses(original)
    if not cleaned:
        return None
    if postfix and cleaned[0].value == "*" and not (
        original and original[0].value == "(" and _matching(original, 0, "(", ")") is not None
    ):
        return None
    model = _expression_model(cleaned, resolve_integer, call_resolver)
    if model.get("kind") in {"variable", "arrayIndex", "dereference", "member"}:
        return model
    return None


def _expression_model(tokens: Sequence[_Token], resolve_integer, call_resolver=None) -> dict:
    """Lower a C value expression into runtime IR.

    ``call_resolver`` is supplied by the statement parser so a modeled HAL
    call has exactly the same lowering whether it appears as a statement,
    assignment RHS, or part of a condition.  The generic expression layer
    deliberately remains independent of peripheral metadata.
    """
    cleaned = _strip_wrapping_parentheses(tokens)
    # Expand only function-like macros. Object-like macros remain visible as
    # named constants and are resolved by ``resolve_integer`` below.
    if cleaned:
        expanded = _expand_function_macros(cleaned, getattr(resolve_integer, "macros", {}))
        if expanded != cleaned:
            cleaned = _strip_wrapping_parentheses(expanded)
    while len(cleaned) >= 4 and cleaned[0].kind == "identifier" and cleaned[1].value == ":" and cleaned[2].value == ":":
        cleaned = cleaned[3:]
    if not cleaned:
        return {"kind": "unknown", "text": ""}

    # C concatenates adjacent string literals after macro expansion. Format
    # macros from <inttypes.h> are provided by the Clang compatibility headers
    # rather than uploaded project files, so resolve those names here too.
    string_bytes: list[int] = []
    string_expression = True
    expression_macros = getattr(resolve_integer, "macros", {})
    for token in cleaned:
        literal_text: str | None = None
        if token.kind == "string":
            literal_text = token.value
        elif token.kind == "identifier" and token.value in _STANDARD_STRING_MACROS:
            string_bytes.extend(_STANDARD_STRING_MACROS[token.value].encode("ascii"))
            continue
        elif token.kind == "identifier" and isinstance(expression_macros, Mapping):
            macro = expression_macros.get(token.value)
            if macro is not None and macro.parameters is None:
                replacement = _strip_wrapping_parentheses(_lex_c(macro.expression))
                if len(replacement) == 1 and replacement[0].kind == "string":
                    literal_text = replacement[0].value
        if literal_text is None:
            string_expression = False
            break
        decoded = _decode_c_string_literal(literal_text)
        if decoded is None:
            string_expression = False
            break
        string_bytes.extend(decoded)
    if string_expression and cleaned:
        try:
            string_value = bytes(string_bytes).decode("utf-8")
        except UnicodeDecodeError:
            string_value = bytes(string_bytes).decode("latin-1")
        return {"kind": "string", "value": string_value, "bytes": string_bytes}

    if len(cleaned) >= 3 and cleaned[0].kind == "identifier" and cleaned[1].value == "(":
        close_call = _matching(cleaned, 1, "(", ")")
        if close_call == len(cleaned) - 1:
            if cleaned[0].value == "HAL_GetTick":
                return {"kind": "tick"}
            if cleaned[0].value in {"strlen", "sizeof"}:
                raw_argument = cleaned[2:close_call]
                if cleaned[0].value == "sizeof":
                    type_name = _sizeof_type_name(raw_argument)
                    if type_name is not None:
                        return {"kind": "sizeOf", "cType": type_name}
                argument = _expression_model(raw_argument, resolve_integer, call_resolver)
                return {
                    "kind": "stringLength" if cleaned[0].value == "strlen" else "sizeOf",
                    "value": argument,
                }
            if cleaned[0].value in _PURE_LIBC_FUNCTIONS:
                return {
                    "kind": "libcCall",
                    "function": cleaned[0].value,
                    "arguments": [
                        _expression_model(argument, resolve_integer, call_resolver)
                        for argument in _split_arguments(cleaned[2:close_call])
                    ],
                }
            if call_resolver is not None:
                resolved_call = call_resolver(cleaned[0], _split_arguments(cleaned[2:close_call]))
                if resolved_call is not None:
                    return resolved_call
            # Keep the generic expression parser usable by callers that do
            # not have peripheral metadata (for example legacy standalone
            # parser tests). StatementParser always resolves these through the
            # common HAL call path above.
            if cleaned[0].value in {"HAL_Init", "HAL_ADCEx_Calibration_Start"}:
                return {"kind": "constant", "name": "HAL_OK", "value": 0}
            if cleaned[0].value == "HAL_ADC_PollForConversion":
                arguments = _split_arguments(cleaned[2:close_call])
                return {
                    "kind": "adcPoll",
                    "adc": _first_identifier(arguments[0]) if arguments else None,
                    "timeout": _expression_model(arguments[1], resolve_integer, call_resolver) if len(arguments) > 1 else {"kind": "literal", "value": 0},
                }

    # The conditional operator has lower precedence than every binary
    # arithmetic operator below.  Find its matching colon explicitly because
    # both branches may themselves contain a nested conditional expression.
    question_index: int | None = None
    conditional_colon: int | None = None
    depth = 0
    nested_conditionals = 0
    for index, token in enumerate(cleaned):
        if token.value in {"(", "[", "{"}:
            depth += 1
            continue
        if token.value in {")", "]", "}"}:
            depth = max(0, depth - 1)
            continue
        if depth != 0:
            continue
        if token.value == "?":
            if question_index is None:
                question_index = index
            nested_conditionals += 1
            continue
        if token.value == ":" and question_index is not None:
            nested_conditionals -= 1
            if nested_conditionals == 0:
                conditional_colon = index
                break
    if question_index is not None and conditional_colon is not None:
        return {
            "kind": "conditional",
            "condition": _condition_model(
                cleaned[:question_index],
                resolve_integer,
                lambda value: _expression_model(value, resolve_integer, call_resolver),
            ),
            "consequent": _expression_model(
                cleaned[question_index + 1 : conditional_colon], resolve_integer, call_resolver
            ),
            "alternate": _expression_model(cleaned[conditional_colon + 1 :], resolve_integer, call_resolver),
        }

    # A cast followed by a unary operator is still one cast expression in C,
    # for example ``(uint8_t *)&sample``. Recognize this before binary
    # precedence scanning so the ``&`` is not mistaken for a top-level
    # bitwise-and operator.
    if len(cleaned) >= 4 and cleaned[0].value == "(":
        cast_close = _matching(cleaned, 0, "(", ")")
        if cast_close is not None and cast_close < len(cleaned) - 1:
            cast_tokens = cleaned[1:cast_close]
            cast_identifiers = [token.value for token in cast_tokens if token.kind == "identifier"]
            cast_type_names = {
                "bool", "char", "const", "double", "enum", "float", "int", "long", "short", "signed",
                "size_t", "struct", "union", "unsigned", "void", "volatile", "_Bool",
            }
            is_type_cast = bool(cast_identifiers) and all(
                name in cast_type_names or name.endswith("_t") or name.endswith("TypeDef")
                for name in cast_identifiers
            ) and all(token.kind == "identifier" or token.value == "*" for token in cast_tokens)
            remainder = cleaned[cast_close + 1 :]
            if is_type_cast and remainder and remainder[0].value in {"&", "*", "+", "-", "!", "~"}:
                cast_type = _tokens_text(cast_tokens).replace(" *", "*")
                if "float" in cast_type or "double" in cast_type:
                    return {
                        "kind": "cast",
                        "cType": cast_type,
                        "value": _expression_model(remainder, resolve_integer, call_resolver),
                    }
                return _expression_model(remainder, resolve_integer, call_resolver)

    # The comma operator sequences expressions and yields the value of the
    # final operand.  It is common in compact register/loop code and also
    # appears inside logical operands, so retain it as an explicit node rather
    # than reporting the whole expression as opaque text.
    comma_parts = _split_arguments(cleaned)
    if len(comma_parts) > 1:
        return {
            "kind": "sequence",
            "expressions": [
                _expression_model(part, resolve_integer, call_resolver)
                for part in comma_parts
                if part
            ],
        }

    # Assignment is an expression in C (including inside an ``if`` condition,
    # a function argument, or a return statement).  Keep the writable target
    # separate so the browser runtime can apply the side effect exactly once
    # and still return the assigned value to its parent expression.
    assignment_operators = {
        "=": "assign",
        "+=": "add",
        "-=": "sub",
        "*=": "mul",
        "/=": "div",
        "%=": "mod",
        "&=": "bitAnd",
        "|=": "bitOr",
        "^=": "bitXor",
        "<<=": "shiftLeft",
        ">>=": "shiftRight",
    }
    depth = 0
    assignment_index: int | None = None
    for index, token in enumerate(cleaned):
        if token.value in {"(", "[", "{"}:
            depth += 1
        elif token.value in {")", "]", "}"
        }:
            depth = max(0, depth - 1)
        elif depth == 0 and token.value in assignment_operators:
            assignment_index = index
            break
    if assignment_index is not None and assignment_index > 0:
        target = _lvalue_expression_model(
            cleaned[:assignment_index], resolve_integer, call_resolver
        )
        if target is not None:
            return {
                "kind": "assignment",
                "operator": assignment_operators[cleaned[assignment_index].value],
                "target": target,
                "value": _expression_model(
                    cleaned[assignment_index + 1 :], resolve_integer, call_resolver
                ),
            }

    if len(cleaned) >= 2 and cleaned[-1].value in {"++", "--"}:
        target = _lvalue_expression_model(
            cleaned[:-1], resolve_integer, call_resolver, postfix=True
        )
        if target is not None:
            return {
                "kind": "postIncrement" if cleaned[-1].value == "++" else "postDecrement",
                "target": target,
            }
    if len(cleaned) >= 2 and cleaned[0].value in {"++", "--"}:
        target = _lvalue_expression_model(cleaned[1:], resolve_integer, call_resolver)
        if target is not None:
            return {
                "kind": "preIncrement" if cleaned[0].value == "++" else "preDecrement",
                "target": target,
            }

    # Comparisons and logical operators produce ordinary C values as well as
    # controlling if/while/for. Route them through the condition lowerer so
    # status-returning HAL calls work in assignments and return statements.
    condition_operators = {"==", "!=", "&&", "||", "<", ">", "<=", ">="}
    depth = 0
    has_top_level_condition_operator = False
    for token in cleaned:
        if token.value in {"(", "[", "{"}:
            depth += 1
        elif token.value in {")", "]", "}"}:
            depth = max(0, depth - 1)
        elif depth == 0 and token.value in condition_operators:
            has_top_level_condition_operator = True
            break
    if has_top_level_condition_operator:
        return _condition_model(
            cleaned,
            resolve_integer,
            lambda value: _expression_model(value, resolve_integer, call_resolver),
        )

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
            "left": _expression_model(cleaned[:operator_index], resolve_integer, call_resolver),
            "right": _expression_model(cleaned[operator_index + 1 :], resolve_integer, call_resolver),
        }

    # ``sizeof`` is also a unary operator, so C permits the parenthesis-free
    # form ``sizeof buffer``.  The function-like form is handled above; this
    # branch covers the unary operand after binary precedence has been split,
    # preserving expressions such as ``sizeof buffer + 1U``.
    if len(cleaned) >= 2 and cleaned[0].value == "sizeof":
        operand = cleaned[1:]
        if operand and operand[0].value not in {"(", "*", "&", "+", "-", "!", "~", "++", "--"}:
            # A plain identifier/literal is the complete unary operand.  The
            # array/member postfix forms stay attached so ``sizeof samples[0]``
            # remains one operand as required by C grammar.
            end = 1
            while end < len(operand):
                if operand[end].value == "[":
                    close = _matching(operand, end, "[", "]")
                    if close is None:
                        break
                    end = close + 1
                    continue
                if operand[end].value in {".", "->"} and end + 1 < len(operand):
                    end += 2
                    continue
                if operand[end].value in {"++", "--"}:
                    end += 1
                break
            operand = operand[:end]
        elif operand and operand[0].value == "(":
            close = _matching(operand, 0, "(", ")")
            if close is not None:
                # The parenthesized base may be followed by a postfix
                # subscript/member (``sizeof (buffer)[0]``). Keep those
                # tokens attached to the unary operand instead of silently
                # measuring the unindexed array.
                end = close + 1
                while end < len(operand):
                    if operand[end].value == "[":
                        bracket_close = _matching(operand, end, "[", "]")
                        if bracket_close is None:
                            break
                        end = bracket_close + 1
                        continue
                    if operand[end].value in {".", "->"} and end + 1 < len(operand):
                        end += 2
                        continue
                    break
                operand = operand[:end]
        type_name = _sizeof_type_name(operand)
        if type_name is not None:
            return {"kind": "sizeOf", "cType": type_name}
        return {"kind": "sizeOf", "value": _expression_model(operand, resolve_integer, call_resolver)}

    if cleaned[0].value in {"&", "*", "+", "-", "!", "~"}:
        unary_kinds = {
            "&": "addressOf",
            "*": "dereference",
            "+": "positive",
            "-": "negate",
            "!": "logicalNot",
            "~": "bitNot",
        }
        field = "pointer" if cleaned[0].value == "*" else "value"
        return {"kind": unary_kinds[cleaned[0].value], field: _expression_model(cleaned[1:], resolve_integer, call_resolver)}

    without_cast = _strip_leading_c_casts(cleaned)
    if without_cast != cleaned:
        close = _matching(cleaned, 0, "(", ")")
        cast_type = _tokens_text(cleaned[1:close]).replace(" *", "*") if close is not None else ""
        if "float" in cast_type or "double" in cast_type:
            return {"kind": "cast", "cType": cast_type, "value": _expression_model(cleaned[close + 1 :], resolve_integer, call_resolver)}
        return _expression_model(without_cast, resolve_integer, call_resolver)

    postfix_array = _postfix_array_model(cleaned, resolve_integer, call_resolver)
    if postfix_array is not None:
        return postfix_array
    postfix_member = _postfix_member_model(cleaned, resolve_integer, call_resolver)
    if postfix_member is not None:
        return postfix_member

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
            floating = _parse_c_float(token.value)
            if floating is not None:
                return {"kind": "literal", "value": floating[0], "numericType": floating[1], "text": token.value}
        if token.kind == "identifier":
            constants = {
                "HAL_OK": 0,
                "HAL_ERROR": 1,
                "HAL_BUSY": 2,
                "HAL_TIMEOUT": 3,
                "GPIO_PIN_RESET": 0,
                "GPIO_PIN_SET": 1,
                "NULL": 0,
                "RESET": 0,
                "SET": 1,
                "false": False,
                "true": True,
                "EOF": -1,
                "EXIT_SUCCESS": 0,
                "EXIT_FAILURE": 1,
                "RAND_MAX": 2147483647,
                "CHAR_BIT": 8,
                "SCHAR_MAX": 127,
                "SHRT_MAX": 32767,
                "INT_MAX": 2147483647,
                "LONG_MAX": 2147483647,
                "UCHAR_MAX": 255,
                "USHRT_MAX": 65535,
                "UINT_MAX": 4294967295,
                "M_E": math.e,
                "M_LOG2E": math.log2(math.e),
                "M_LOG10E": math.log10(math.e),
                "M_LN2": math.log(2.0),
                "M_LN10": math.log(10.0),
                "M_PI": math.pi,
                "M_PI_2": math.pi / 2.0,
                "M_PI_4": math.pi / 4.0,
                "M_1_PI": 1.0 / math.pi,
                "M_2_PI": 2.0 / math.pi,
                "M_2_SQRTPI": 2.0 / math.sqrt(math.pi),
                "M_SQRT2": math.sqrt(2.0),
                "M_SQRT1_2": 1.0 / math.sqrt(2.0),
                "FLT_RADIX": 2,
                "FLT_EPSILON": 1.19209290e-7,
                "DBL_EPSILON": 2.2204460492503131e-16,
                "LDBL_EPSILON": 2.2204460492503131e-16,
            }
            if token.value in {"HUGE_VAL", "HUGE_VALF", "HUGE_VALL", "INFINITY", "NAN"}:
                # Keep non-finite values out of the JSON model; the browser
                # runtime resolves these named constants without serialization.
                return {"kind": "constant", "name": token.value}
            if token.value in constants:
                return {"kind": "constant", "name": token.value, "value": constants[token.value]}
            resolved = resolve_integer(token.value)
            if resolved is not None:
                return {"kind": "constant", "name": token.value, "value": resolved}
            # Integer-like macros are handled by ``resolve_integer`` above,
            # but headers also commonly expose literal strings/floats through
            # object-like macros (for example ``VREF_MV 3300.0f`` or
            # ``DEVICE_NAME "ADC1"``).  Expand a bounded chain of literal
            # replacements so those values remain ordinary C expressions.
            macros = getattr(resolve_integer, "macros", {})
            macro = macros.get(token.value) if isinstance(macros, Mapping) else None
            if macro is not None and macro.parameters is None:
                current_name = token.value
                visited = {current_name}
                replacement: list[_Token] = []
                while macro is not None and macro.parameters is None:
                    replacement = _strip_wrapping_parentheses(_lex_c(macro.expression))
                    if len(replacement) == 1 and replacement[0].kind == "identifier":
                        next_name = replacement[0].value
                        if next_name in visited:
                            replacement = []
                            break
                        visited.add(next_name)
                        macro = macros.get(next_name) if isinstance(macros, Mapping) else None
                        continue
                    break
                if replacement:
                    if all(item.kind == "string" for item in replacement):
                        decoded_parts = [_decode_c_string_literal(item.value) for item in replacement]
                        if all(part is not None for part in decoded_parts):
                            combined = b"".join(bytes(part or []) for part in decoded_parts)
                            try:
                                text_value = combined.decode("utf-8")
                            except UnicodeDecodeError:
                                text_value = combined.decode("latin-1")
                            return {"kind": "string", "value": text_value, "bytes": list(combined)}
                    if len(replacement) == 1 and replacement[0].kind in {"number", "char", "string"}:
                        return _expression_model(replacement, resolve_integer, call_resolver)
            return {"kind": "variable", "name": token.value}
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

    # Conditions use the compact ``op`` spelling while ordinary expressions
    # use ``kind``.  They are the same runtime value domain; accepting both is
    # essential when a conditional/logical expression is passed to HAL_Delay,
    # a transfer length, or a malloc size.
    kind = str(expression.get("kind") or expression.get("op") or expression.get("type") or "")
    kind = re.sub(r"[^A-Za-z0-9]", "", kind).casefold()
    if kind in {"literal", "constant", "variable", "char", "string", "tick", "halcall"}:
        return True
    if kind == "inlinecall":
        # Value-returning project helpers are compiled into a local runtime
        # instruction region before their containing HAL call.  The parser
        # has already validated that the helper has a deterministic final
        # return, so it is just as safe here as a direct HAL return value.
        return isinstance(expression.get("operations"), (list, tuple))
    if kind in {"postincrement", "postdecrement", "preincrement", "predecrement"}:
        target = expression.get("target")
        return isinstance(target, Mapping) and _runtime_expression_supported(target)
    if kind == "conditional":
        return all(
            not isinstance(value, Mapping) or _runtime_expression_supported(value)
            for value in (
                expression.get("condition"),
                expression.get("consequent"),
                expression.get("alternate"),
            )
        )
    if kind == "sequence":
        expressions = expression.get("expressions", expression.get("operands", []))
        return isinstance(expressions, (list, tuple)) and all(
            isinstance(value, Mapping) and _runtime_expression_supported(value)
            for value in expressions
        )
    if kind == "assignment":
        target = expression.get("target", expression.get("lvalue"))
        value = expression.get("value", expression.get("expression", expression.get("right")))
        operator = re.sub(
            r"[^A-Za-z0-9]", "", str(expression.get("operator") or "assign")
        ).casefold()
        return (
            isinstance(target, Mapping)
            and _runtime_expression_supported(target)
            and isinstance(value, Mapping)
            and _runtime_expression_supported(value)
            and operator in {"", "assign", "add", "sub", "mul", "div", "mod", "bitand", "bitor", "bitxor", "shiftleft", "shiftright"}
        )
    if kind in {"stringlength", "sizeof", "positive", "negate", "logicalnot", "bitnot", "cast"}:
        value = expression.get("value")
        return not isinstance(value, Mapping) or _runtime_expression_supported(value)
    if kind == "adcpoll":
        timeout = expression.get("timeout")
        return not isinstance(timeout, Mapping) or _runtime_expression_supported(timeout)
    if kind == "addressof":
        value = expression.get("value")
        return not isinstance(value, Mapping) or _runtime_expression_supported(value)
    if kind == "dereference":
        pointer = expression.get("pointer")
        return not isinstance(pointer, Mapping) or _runtime_expression_supported(pointer)
    if kind == "libccall":
        return all(
            not isinstance(argument, Mapping) or _runtime_expression_supported(argument)
            for argument in expression.get("arguments", [])
        )
    if kind == "arrayindex":
        index = expression.get("index")
        return not isinstance(index, Mapping) or _runtime_expression_supported(index)
    if kind == "member":
        object_model = expression.get("object")
        return not isinstance(object_model, Mapping) or _runtime_expression_supported(object_model)
    if kind in {"add", "sub", "mul", "div", "mod", "bitor", "bitxor", "bitand", "shiftleft", "shiftright"}:
        left = expression.get("left")
        right = expression.get("right")
        return (
            isinstance(left, Mapping)
            and isinstance(right, Mapping)
            and _runtime_expression_supported(left)
            and _runtime_expression_supported(right)
        )
    if kind in {"eq", "ne", "and", "or", "lt", "le", "gt", "ge"}:
        left = expression.get("left")
        right = expression.get("right")
        return (
            isinstance(left, Mapping)
            and isinstance(right, Mapping)
            and _runtime_expression_supported(left)
            and _runtime_expression_supported(right)
        )
    return False


def _condition_model(tokens: Sequence[_Token], resolve_integer, expression_model=None) -> dict:
    expression_model = expression_model or (lambda value: _expression_model(value, resolve_integer))
    cleaned = _strip_wrapping_parentheses(tokens)
    if cleaned:
        expanded = _expand_function_macros(cleaned, getattr(resolve_integer, "macros", {}))
        if expanded != cleaned:
            cleaned = _strip_wrapping_parentheses(expanded)
    operator_names = {
        "==": "eq",
        "!=": "ne",
        "&&": "and",
        "||": "or",
        "|": "bitOr",
        "^": "bitXor",
        "&": "bitAnd",
        "<": "lt",
        ">": "gt",
        "<=": "le",
        ">=": "ge",
    }

    def top_level_operator(operators: set[str]) -> int | None:
        depth = 0
        selected: int | None = None
        for index, token in enumerate(cleaned):
            if token.value in {"(", "["}:
                depth += 1
            elif token.value in {")", "]"}:
                depth -= 1
            elif depth == 0 and token.value in operators:
                # Binary operators in this subset are left-associative. Split
                # at the rightmost operator of each precedence level so
                # ``a < b < c`` becomes ``(a < b) < c`` rather than the
                # observably different ``a < (b < c)``.
                selected = index
        return selected

    # Split from lowest to highest C precedence. Bitwise operators sit between
    # logical-and and equality; including them here matters for unparenthesized
    # embedded idioms such as ``flags & READY_MASK == 0``. The expression is
    # unusual but valid C and must retain the compiler's exact meaning.
    for operators in (
        {"||"},
        {"&&"},
        {"|"},
        {"^"},
        {"&"},
        {"==", "!="},
        {"<", ">", "<=", ">="},
    ):
        index = top_level_operator(operators)
        if index is None:
            continue
        token = cleaned[index]
        left_tokens = cleaned[:index]
        right_tokens = cleaned[index + 1 :]
        return {
            "op": operator_names[token.value],
            "left": _condition_model(left_tokens, resolve_integer, expression_model),
            "right": _condition_model(right_tokens, resolve_integer, expression_model),
        }
    # Prefix ! binds more tightly than comparison operators, but a parenthesized
    # compound condition still reaches this branch after its wrapping pair has
    # been stripped. This makes both ``!value == 1`` and ``!(a && b)`` follow
    # C precedence and preserves short-circuit compilation for the latter.
    if len(cleaned) > 1 and cleaned[0].value == "!":
        return {
            "kind": "logicalNot",
            "value": _condition_model(cleaned[1:], resolve_integer, expression_model),
        }
    expression = expression_model(cleaned)
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


def _operations_return_value(operations: Sequence[Mapping[str, object]]) -> bool:
    """Determine whether every reachable path returns a value.

    A helper used as an expression need not have a physically final ``return``
    operation: the usual ``if (...) return a; else return b;`` form ends at an
    ``if`` node.  This conservative structural analysis accepts such complete
    branches while still rejecting a possible fall-through path.
    """

    if not operations:
        return False

    for operation in operations:
        if not isinstance(operation, Mapping):
            continue
        kind = str(operation.get("op") or operation.get("kind") or "").casefold()
        if kind == "return":
            return "value" in operation
        if kind == "if":
            then_ops = operation.get("then", operation.get("body", []))
            else_ops = operation.get("else", operation.get("alternate", []))
            if (
                isinstance(then_ops, Sequence)
                and not isinstance(then_ops, (str, bytes))
                and isinstance(else_ops, Sequence)
                and not isinstance(else_ops, (str, bytes))
                and _operations_return_value(then_ops)
                and _operations_return_value(else_ops)
            ):
                return True
            continue
        if kind == "switch":
            entries = operation.get("entries")
            if not isinstance(entries, Sequence) or isinstance(entries, (str, bytes)):
                cases = operation.get("cases", [])
                default = operation.get("default", [])
                entries = list(cases) if isinstance(cases, Sequence) else []
                if default is not None:
                    entries.append({"default": True, "body": default})
            has_default = False
            complete = True
            for entry in entries:
                if not isinstance(entry, Mapping):
                    complete = False
                    break
                if entry.get("default") or entry.get("value") is None:
                    has_default = True
                body = entry.get("body", entry.get("operations", []))
                if not isinstance(body, Sequence) or isinstance(body, (str, bytes)) or not _operations_return_value(body):
                    complete = False
                    break
            if has_default and complete and entries:
                return True
            continue
        # A statically infinite loop whose body returns on every path is also
        # a complete function path.  Dynamic loops remain conservative.
        if kind in {"while", "dowhile", "dowhileloop"}:
            condition = operation.get("condition", operation.get("test"))
            if kind.startswith("do") or (
                isinstance(condition, Mapping)
                and condition.get("kind") == "literal"
                and bool(condition.get("value"))
            ):
                body = operation.get("body", operation.get("operations", []))
                if isinstance(body, Sequence) and not isinstance(body, (str, bytes)) and _operations_return_value(body):
                    return True
            continue
    return False


class _StatementParser:
    # ``goto`` remains an explicit semantic boundary because arbitrary labels
    # can cross scopes.  ``do`` has structured control-flow semantics and is
    # lowered below like the other loop forms.
    _UNSUPPORTED_CONTROL = {"goto"}
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
        inline_stack: Sequence[str] | None = None,
        function_tokens: Sequence[_Token] | None = None,
    ) -> None:
        self.tokens = list(tokens)
        self.function_tokens = list(function_tokens) if function_tokens is not None else self.tokens
        self.file = file
        self.macros = macros
        self.aliases = aliases
        self.uart_instances = uart_instances
        self.i2c_instances = i2c_instances
        self.spi_instances = spi_instances
        self.adc_instances = adc_instances
        self.diagnostics = diagnostics
        self.inline_stack = tuple(inline_stack or ())
        self.resolve_expression, self.resolve_identifier = _make_integer_resolver(macros)

    @staticmethod
    def _append_operation(operations: list[dict], operation: dict | list[dict] | None) -> None:
        if isinstance(operation, list):
            operations.extend(operation)
        elif operation:
            operations.append(operation)

    def _source(self, token: _Token) -> dict:
        return {"file": self.file, "line": token.line, "column": token.column}

    _STATUS_RETURNING_OPERATIONS = {
        "uartReceive", "uartTransmit", "uartReceiveIt", "uartTransmitIt", "uartAbortIt",
        "uartReceiveDma", "uartTransmitDma", "uartDmaStop", "i2cMasterTransmit",
        "i2cMasterReceive", "i2cMemWrite", "i2cMemRead", "i2cMasterTransmitIt",
        "i2cMasterReceiveIt", "i2cMemWriteIt", "i2cMemReadIt", "i2cMasterTransmitDma",
        "i2cMasterReceiveDma", "i2cMemWriteDma", "i2cMemReadDma", "i2cAbortIt",
        "spiTransmit", "spiReceive", "spiTransmitReceive", "spiTransmitIt", "spiReceiveIt",
        "spiTransmitReceiveIt", "spiTransmitDma", "spiReceiveDma", "spiTransmitReceiveDma",
        "spiAbortIt", "adcStart", "adcStop", "adcStartIt",
        "adcStopIt", "adcStartDma", "adcStopDma", "adcPollForConversion", "timerStartIt", "timerStopIt",
        "pwmStart", "pwmStop",
    }
    _VALUE_RETURNING_OPERATIONS = {"adcGetValue", "gpioRead"}
    _SUCCESSFUL_NOOP_HAL_CALLS = {
        "HAL_ADC_Init", "HAL_ADC_DeInit", "HAL_ADC_ConfigChannel", "HAL_ADCEx_Calibration_Start",
        "HAL_DMA_DeInit", "HAL_DMA_Init", "HAL_I2C_Init", "HAL_I2C_DeInit", "HAL_Init",
        "HAL_SPI_Init", "HAL_SPI_DeInit", "HAL_TIM_Base_Init", "HAL_TIM_Base_DeInit",
        "HAL_TIM_PWM_ConfigChannel", "HAL_TIM_PWM_Init", "HAL_TIM_PWM_DeInit",
        "HAL_UART_Init", "HAL_UART_DeInit",
        "HAL_RCC_OscConfig", "HAL_RCC_ClockConfig", "HAL_RCCEx_PeriphCLKConfig",
    }

    def _inline_call_expression(self, call: _Token, arguments: Sequence[Sequence[_Token]]) -> dict | None:
        """Lower a project helper call into a value-producing expression.

        The browser compiler expands this into a local instruction region with
        its own return target. Keeping it as an expression here means calls in
        conditions, arithmetic, and switch selectors have the same semantics
        as a call used as an assignment RHS.
        """

        call_name = call.value
        body = _find_function(self.function_tokens, call_name)
        if body is None or call_name in self.inline_stack:
            return None
        parameters = _function_parameter_names(self.function_tokens, call_name)
        if len(arguments) != len(parameters):
            source = self._source(call)
            self.diagnostics.append(
                _diagnostic(
                    "error",
                    "C_UNSUPPORTED_FUNCTION_ARGUMENTS",
                    f"Function call '{call_name}' expects {len(parameters)} arguments but received {len(arguments)}",
                    **source,
                )
            )
            return {"kind": "unsupportedCall", "text": call_name}
        inline_tokens = _substitute_function_parameters(
            self.function_tokens[body[0] : body[1]],
            dict(zip(parameters, arguments)),
        )
        parser = _StatementParser(
            inline_tokens,
            self.file,
            self.macros,
            self.aliases,
            self.uart_instances,
            self.i2c_instances,
            self.spi_instances,
            self.adc_instances,
            self.diagnostics,
            self.inline_stack + (call_name,),
            self.function_tokens,
        )
        operations = parser.parse()
        # A complete branch return makes every reachable path deterministic;
        # the return does not have to be the physically last operation (for
        # example ``if (x) return 1; else return 2;``).
        if not _operations_return_value(operations):
            source = self._source(call)
            self.diagnostics.append(
                _diagnostic(
                    "error",
                    "C_UNSUPPORTED_FUNCTION_RETURN",
                    f"Function call '{call_name}' does not have a supported final return value",
                    **source,
                )
            )
            return {"kind": "unsupportedCall", "text": call_name}
        return {
            "kind": "inlineCall",
            "function": call_name,
            "operations": operations,
            "source": self._source(call),
        }

    def _call_expression_model(self, call: _Token, arguments: Sequence[Sequence[_Token]]) -> dict | None:
        """Model a value-returning call through the same HAL lowerer as statements."""

        name = call.value
        if not name.startswith(("HAL_", "__HAL_")):
            return self._inline_call_expression(call, arguments)
        operation = self._parse_hal_call(call, arguments)
        if operation is None:
            if name in self._SUCCESSFUL_NOOP_HAL_CALLS:
                return {"kind": "constant", "name": "HAL_OK", "value": 0}
            return None
        operation_name = operation.get("op")
        if operation_name == "unsupported":
            # _parse_hal_call already emitted the precise API diagnostic. Keep
            # it out of the generic unsupported-expression pass.
            return {"kind": "unsupportedCall", "text": name}
        if operation_name in self._STATUS_RETURNING_OPERATIONS:
            return {"kind": "halCall", "operation": operation, "returnKind": "status"}
        if operation_name in self._VALUE_RETURNING_OPERATIONS:
            return {"kind": "halCall", "operation": operation, "returnKind": "value"}
        return None

    def _model_expression(self, tokens: Sequence[_Token]) -> dict:
        return _expression_model(tokens, self.resolve_expression, self._call_expression_model)

    def _model_condition(self, tokens: Sequence[_Token]) -> dict:
        return _condition_model(tokens, self.resolve_expression, self._model_expression)

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
            if value == "do":
                operation, index = self._parse_do_while(index, end)
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
            self._append_operation(operations, operation)
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
        if self.tokens[start].value == "do":
            operation, next_index = self._parse_do_while(start, end)
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
        operations: list[dict] = []
        self._append_operation(operations, operation)
        return operations, next_index

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
            "condition": self._model_condition(self.tokens[start + 2 : condition_end]),
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
            "condition": self._model_condition(self.tokens[start + 2 : condition_end]),
            "body": body,
            "source": self._source(self.tokens[start]),
        }, next_index

    def _parse_do_while(self, start: int, end: int) -> tuple[dict | None, int]:
        """Parse ``do statement while (condition);`` with one guaranteed body run."""

        body_ops, next_index = self._body(start + 1, end)
        if next_index >= end or self.tokens[next_index].value != "while":
            return None, next_index
        if next_index + 1 >= end or self.tokens[next_index + 1].value != "(":
            return None, next_index + 1
        condition_end = _matching(self.tokens, next_index + 1, "(", ")")
        if condition_end is None or condition_end >= end:
            return None, end
        statement_end = condition_end + 1
        if statement_end < end and self.tokens[statement_end].value == ";":
            statement_end += 1
        return {
            "op": "doWhile",
            "condition": self._model_condition(self.tokens[next_index + 2 : condition_end]),
            "body": body_ops,
            "source": self._source(self.tokens[start]),
        }, statement_end

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
            self._append_operation(operations, operation)
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
        condition = self._model_condition(header[1]) if header[1] else {"kind": "literal", "value": True}
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
            operation["value"] = self._model_expression(value_tokens)
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
                    label_value = self._model_expression(self.tokens[label_start:colon])
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
            "expression": self._model_expression(self.tokens[start + 2 : expression_end]),
            "cases": cases,
            "default": default_body,
            "entries": entries,
            "source": self._source(self.tokens[start]),
        }, body_end + 1

    def _parse_declaration(self, tokens: Sequence[_Token]) -> list[dict] | None:
        """Lower ordinary local declarations with initializers or fixed arrays.

        A C declaration can contain several declarators, for example
        ``uint16_t first = 0, second = 0``. Treating the first ``=`` as a
        general assignment loses every declarator after it. The runtime needs
        fixed local character arrays as real arrays as well, because snprintf
        and the display drivers write through their addresses.
        """

        cursor = 0
        saw_type = False
        while cursor < len(tokens):
            token = tokens[cursor]
            lowered = token.value.casefold()
            if token.kind == "identifier" and (
                lowered in self._DECLARATION_PREFIXES
                or lowered.endswith("_t")
                or token.value.endswith("TypeDef")
            ):
                saw_type = True
                cursor += 1
                continue
            if token.value == "*" and saw_type:
                cursor += 1
                continue
            break
        if not saw_type or cursor >= len(tokens):
            return None

        operations: list[dict] = []
        for declarator in _split_arguments(tokens[cursor:]):
            if not declarator:
                continue
            depth = 0
            assignment = None
            for index, token in enumerate(declarator):
                if token.value in {"(", "[", "{"}:
                    depth += 1
                elif token.value in {")", "]", "}"}:
                    depth = max(0, depth - 1)
                elif token.value == "=" and depth == 0:
                    assignment = index
                    break
            name_tokens = declarator[:assignment] if assignment is not None else declarator
            bracket = next((index for index, token in enumerate(name_tokens) if token.value == "["), None)
            identifiers = [
                token for token in (name_tokens[:bracket] if bracket is not None else name_tokens)
                if token.kind == "identifier"
            ]
            if not identifiers:
                continue
            name = identifiers[-1]
            source = self._source(name)

            if assignment is not None:
                initializer = declarator[assignment + 1 :]
                # Declarations are parsed before ordinary assignments.  Keep
                # call initializers on the same lowering path as an existing
                # variable assignment, including a leading pointer cast such
                # as ``uint32_t *samples = (uint32_t *)malloc(...)``.
                call_initializer = _strip_leading_c_casts(_strip_wrapping_parentheses(initializer))
                if (
                    len(call_initializer) >= 3
                    and call_initializer[0].kind == "identifier"
                    and call_initializer[1].value == "("
                ):
                    close = _matching(call_initializer, 1, "(", ")")
                    if close == len(call_initializer) - 1:
                        call = call_initializer[0]
                        arguments = _split_arguments(call_initializer[2:close])
                        operation = None
                        # HAL_GetTick is a value-producing HAL helper rather
                        # than a peripheral operation.  Declaration
                        # initializers take this call-specific fast path
                        # before ordinary RHS expression modeling, so retain
                        # its live tick expression explicitly here.
                        if call.value == "HAL_GetTick" and not arguments:
                            operations.append({
                                "op": "assign",
                                "target": name.value,
                                "value": {"kind": "tick"},
                                "source": source,
                            })
                            continue
                        if call.value.startswith(("HAL_", "__HAL_")):
                            operation = self._parse_hal_call(call, arguments)
                        elif call.value in {"snprintf", "sprintf"}:
                            operation = self._parse_format_call(call, arguments)
                        elif call.value in _STATEMENT_LIBC_FUNCTIONS:
                            operation = self._parse_libc_call(call, arguments)
                        if operation is not None:
                            if operation.get("op") == "adcGetValue":
                                operation["target"] = name.value
                            else:
                                operation["resultTarget"] = name.value
                            operations.append(operation)
                            continue
                if len(initializer) >= 2 and initializer[0].value == "{" and initializer[-1].value == "}":
                    values = [
                        self._model_expression(value)
                        for value in _split_arguments(initializer[1:-1])
                        if value
                    ]
                    operations.append({"op": "assign", "target": name.value, "value": values, "source": source})
                else:
                    operations.append({
                        "op": "assign",
                        "target": name.value,
                        "value": self._model_expression(initializer),
                        "source": source,
                    })
                continue

            if bracket is None:
                continue
            close = _matching(name_tokens, bracket, "[", "]")
            if close is None:
                continue
            size = self.resolve_expression(_tokens_text(name_tokens[bracket + 1 : close]))
            if size is None or size < 0 or size > 65536:
                continue
            operations.append({
                "op": "assign",
                "target": name.value,
                "value": [0] * size,
                "source": source,
            })
        return operations

    def _inline_value_function(
        self,
        call: _Token,
        arguments: Sequence[Sequence[_Token]],
        target: str | dict,
        statement: Sequence[_Token],
    ) -> dict | None:
        """Represent a complete helper-call RHS using the common expression IR."""

        expression = self._inline_call_expression(call, arguments)
        if expression is None:
            return None
        return {
            "op": "assign",
            "target": target,
            "value": expression,
            "source": self._source(call),
        }

    def _compound_assignment_target(self, tokens: Sequence[_Token]) -> dict | None:
        """Model an lvalue once so compound operations do not re-evaluate it."""

        return _lvalue_expression_model(tokens, self.resolve_expression, self._call_expression_model)

    def _parse_simple(self, tokens: Sequence[_Token]) -> dict | list[dict] | None:
        if not tokens:
            return None
        # Function-like macros are preprocessor substitutions, so they can
        # form a complete statement (``UNUSED(x);``, ``LOG(...)``) as well as
        # an expression. Expand them before looking for calls/assignments.
        expanded_tokens = _expand_function_macros(tokens, self.macros)
        if [item.value for item in expanded_tokens] != [item.value for item in tokens]:
            return self._parse_simple(expanded_tokens)
        declaration = self._parse_declaration(tokens)
        if declaration is not None:
            return declaration
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
            target = self._compound_assignment_target(left)
            if target is None:
                return self._unsupported(tokens, "C_UNSUPPORTED_COMPOUND_ASSIGNMENT", "Compound assignment target is not supported by the semantic model")
            operator = tokens[compound_assignment_index].value[:-1]
            binary_names = {"+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod", "&": "bitAnd", "|": "bitOr", "^": "bitXor", "<<": "shiftLeft", ">>": "shiftRight"}
            if target.get("kind") == "variable":
                name = target["name"]
                return {
                    "op": "assign",
                    "target": name,
                    "value": {"kind": binary_names[operator], "left": {"kind": "variable", "name": name}, "right": self._model_expression(tokens[compound_assignment_index + 1 :])},
                    "source": self._source(tokens[0]),
                }
            return {
                "op": "compoundAssign",
                "target": target,
                "operator": binary_names[operator],
                "value": self._model_expression(tokens[compound_assignment_index + 1 :]),
                "source": self._source(tokens[0]),
            }
        if len(tokens) == 2 and tokens[0].kind == "identifier" and tokens[1].value in {"++", "--"}:
            return {"op": "assign", "target": tokens[0].value, "value": {"kind": "add" if tokens[1].value == "++" else "sub", "left": {"kind": "variable", "name": tokens[0].value}, "right": {"kind": "literal", "value": 1}}, "source": self._source(tokens[0])}
        if len(tokens) == 2 and tokens[1].kind == "identifier" and tokens[0].value in {"++", "--"}:
            return {"op": "assign", "target": tokens[1].value, "value": {"kind": "add" if tokens[0].value == "++" else "sub", "left": {"kind": "variable", "name": tokens[1].value}, "right": {"kind": "literal", "value": 1}}, "source": self._source(tokens[0])}
        # Only parse a whole statement as an expression when it actually has
        # increment/decrement syntax.  Doing this eagerly turns ordinary
        # void helpers such as MX_GPIO_Init() into value expressions before
        # the dedicated CubeMX no-op path below can handle them.
        if any(token.value in {"++", "--"} for token in tokens):
            update = self._model_expression(tokens)
            if update.get("kind") in {"postIncrement", "postDecrement", "preIncrement", "preDecrement"}:
                return {
                    "op": "compoundAssign",
                    "target": update["target"],
                    "operator": "add" if update["kind"] in {"postIncrement", "preIncrement"} else "sub",
                    "value": {"kind": "literal", "value": 1},
                    "source": self._source(tokens[0]),
                }
        for index, token in enumerate(tokens[:-1]):
            is_hal_call = token.kind == "identifier" and (token.value.startswith("HAL_") or token.value.startswith("__HAL_"))
            is_alice_call = token.kind == "identifier" and token.value.startswith("AliceSIM_")
            is_middleware_call = token.kind == "identifier" and token.value in {
                "vTaskDelay", "vTaskDelayUntil", "taskYIELD", "osDelay", "osDelayUntil", "osThreadYield",
                "xQueueReceive", "xSemaphoreTake", "osMessageQueueGet", "osSemaphoreAcquire",
            }
            expression_only_hal = token.value in {"HAL_GetTick", "HAL_ADCEx_Calibration_Start"}
            if (is_hal_call or is_alice_call or is_middleware_call) and tokens[index + 1].value == "(" and not expression_only_hal:
                close = _matching(tokens, index + 1, "(", ")")
                # The statement lowerer only owns a complete call. A call
                # nested inside arithmetic or another expression must remain
                # an expression node so the runtime can preserve C ordering.
                if close == len(tokens) - 1:
                    arguments = _split_arguments(tokens[index + 2 : close])
                    if is_hal_call:
                        operation = self._parse_hal_call(token, arguments)
                    elif is_alice_call:
                        operation = self._parse_alicesim_call(token, arguments)
                    else:
                        operation = self._parse_middleware_call(token, arguments)
                    if operation is None and is_hal_call:
                        # Status-returning HAL setup calls such as HAL_Init()
                        # intentionally lower to a deterministic HAL_OK value.
                        # Preserve that value when the call is used as an RHS;
                        # a standalone setup call still needs no instruction.
                        if assignment_index is not None and assignment_index < index:
                            left = list(tokens[:assignment_index])
                            target = next((item.value for item in reversed(left) if item.kind == "identifier"), None)
                            if target and not any(item.value in {".", "->"} for item in left):
                                return {
                                    "op": "assign",
                                    "target": target,
                                    "value": self._model_expression(tokens[assignment_index + 1 :]),
                                    "source": self._source(tokens[0]),
                                }
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

        for index, token in enumerate(tokens[:-1]):
            if token.kind != "identifier" or token.value not in {"snprintf", "sprintf"} or tokens[index + 1].value != "(":
                continue
            close = _matching(tokens, index + 1, "(", ")")
            if close is None:
                continue
            arguments = _split_arguments(tokens[index + 2 : close])
            operation = self._parse_format_call(token, arguments)
            if operation and assignment_index is not None and assignment_index < index:
                left = list(tokens[:assignment_index])
                target = next((item.value for item in reversed(left) if item.kind == "identifier"), None)
                if target:
                    operation["resultTarget"] = target
            return operation

        for index, token in enumerate(tokens[:-1]):
            recognized = token.value in _STATEMENT_LIBC_FUNCTIONS or assignment_index is None and token.value in _PURE_LIBC_FUNCTIONS
            if token.kind != "identifier" or not recognized or tokens[index + 1].value != "(":
                continue
            close = _matching(tokens, index + 1, "(", ")")
            if close is None:
                continue
            arguments = _split_arguments(tokens[index + 2 : close])
            operation = self._parse_libc_call(token, arguments)
            if operation is None and assignment_index is None and token.value in _SIDE_EFFECT_LIBC_FUNCTIONS:
                expression = self._model_expression(tokens)
                if expression.get("kind") == "libcCall":
                    return {
                        "op": "expression",
                        "expression": expression,
                        "source": self._source(tokens[0]),
                    }
            if operation and assignment_index is not None and assignment_index < index:
                left = list(tokens[:assignment_index])
                target = next((item.value for item in reversed(left) if item.kind == "identifier"), None)
                if target:
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
                call_close = _matching(tokens, call_index + 1, "(", ")")
                call_arguments = _split_arguments(tokens[call_index + 2 : call_close]) if call_close is not None else []
                inline_body = _find_function(self.function_tokens, call_name)
                if inline_body is not None and call_name not in self.inline_stack:
                    parameter_names = _function_parameter_names(self.function_tokens, call_name)
                    if len(call_arguments) != len(parameter_names):
                        return self._unsupported(
                            tokens,
                            "C_UNSUPPORTED_FUNCTION_ARGUMENTS",
                            f"Function call '{call_name}' expects {len(parameter_names)} arguments but received {len(call_arguments)}",
                        )
                    inline_tokens = _substitute_function_parameters(
                        self.function_tokens[inline_body[0] : inline_body[1]],
                        dict(zip(parameter_names, call_arguments)),
                    )
                    parser = _StatementParser(
                        inline_tokens,
                        self.file,
                        self.macros,
                        self.aliases,
                        self.uart_instances,
                        self.i2c_instances,
                        self.spi_instances,
                        self.adc_instances,
                        self.diagnostics,
                        self.inline_stack + (call_name,),
                        self.function_tokens,
                    )
                    inline_operations = parser.parse()
                    if inline_operations and inline_operations[-1].get("op") == "return" and "value" not in inline_operations[-1]:
                        inline_operations.pop()
                    return inline_operations
                if call_name in {"HAL_GetTick", "HAL_ADCEx_Calibration_Start"}:
                    return None
                return self._unsupported(tokens, "C_UNSUPPORTED_FUNCTION_CALL", f"Function call '{call_name}' is outside the supported HAL/driver subset")
            # A side-effect-free or explicitly modeled expression can appear
            # as a standalone statement, most notably after macro expansion
            # (``UNUSED(value)`` -> ``((void)(value))``). Keep it as a runtime
            # expression instruction so supported assignment/increment/HAL
            # expressions are evaluated in C order and then discarded.
            expression = self._model_expression(tokens)
            if expression.get("kind") not in {"expression", "unknown", "unsupportedCall"} and _runtime_expression_supported(expression):
                return {
                    "op": "expression",
                    "expression": expression,
                    "source": self._source(tokens[0]),
                }
            first = next((token.value.lower() for token in tokens if token.kind == "identifier"), "")
            if first in self._DECLARATION_PREFIXES or first.startswith(("uint", "int")) and first.endswith("_t"):
                return None
            identifiers = [token for token in tokens if token.kind == "identifier"]
            if len(identifiers) >= 2 and not any(token.value in {"+", "-", "/", "%", "&&", "||", "==", "!=", "<", ">", "<=", ">="} for token in tokens):
                # Clang has already validated the statement. Two identifiers
                # without an expression are therefore a typedef/enum variable
                # declaration such as `GPIO_PinState sw_run`.
                return None
            if len(tokens) >= 2 and tokens[0].kind == "identifier" and tokens[0].value.startswith("AliceSIM_") and tokens[1].kind == "identifier":
                return None
            return self._unsupported(tokens, "C_UNSUPPORTED_STATEMENT")
        left = list(tokens[:assignment_index])
        target: str | dict | None = None
        stripped_left = _strip_wrapping_parentheses(left)
        if stripped_left and stripped_left[0].value == "*":
            target = {
                "kind": "dereference",
                "pointer": self._model_expression(stripped_left[1:]),
            }
        bracket_index = next((index for index, token in enumerate(left) if token.value == "["), None)
        if bracket_index is not None and bracket_index > 0 and left[bracket_index - 1].kind == "identifier":
            target_model = self._model_expression(left[bracket_index - 1 :])
            if target_model.get("kind") == "arrayIndex":
                target = target_model
        if target is None:
            member_target = self._compound_assignment_target(left)
            if member_target is not None and member_target.get("kind") == "member":
                target = member_target
        if target is None:
            target = next((token.value for token in reversed(left) if token.kind == "identifier"), None)
        if not target:
            return None
        value_tokens = _strip_wrapping_parentheses(tokens[assignment_index + 1 :])
        if len(value_tokens) >= 3 and value_tokens[0].kind == "identifier" and value_tokens[1].value == "(":
            close = _matching(value_tokens, 1, "(", ")")
            if close == len(value_tokens) - 1:
                inline = self._inline_value_function(
                    value_tokens[0],
                    _split_arguments(value_tokens[2:close]),
                    target,
                    tokens,
                )
                if inline is not None:
                    return inline
        return {
            "op": "assign",
            "target": target,
            "value": self._model_expression(tokens[assignment_index + 1 :]),
            "source": self._source(tokens[0]),
        }

    def _parse_format_call(self, call: _Token, arguments: Sequence[Sequence[_Token]]) -> dict:
        name = call.value
        minimum = 3 if name == "snprintf" else 2
        source = self._source(call)
        if len(arguments) < minimum:
            self.diagnostics.append(
                _diagnostic("error", "C_FORMAT_ARGUMENTS", f"{name} has too few arguments", **source)
            )
            return {"op": "unsupported", "call": name, "source": source}
        buffer = self._buffer_reference(arguments[0])
        if isinstance(buffer, Mapping) and not _runtime_expression_supported(buffer):
            self.diagnostics.append(
                _diagnostic("error", "C_FORMAT_BUFFER", f"Could not resolve the destination buffer for {name}", **source)
            )
            return {"op": "unsupported", "call": name, "source": source}
        format_index = 2 if name == "snprintf" else 1
        operation = {
            "op": "formatString",
            "function": name,
            "buffer": buffer,
            "format": self._model_expression(arguments[format_index]),
            "arguments": [
                self._model_expression(argument)
                for argument in arguments[format_index + 1 :]
            ],
            "source": source,
        }
        if name == "snprintf":
            operation["capacity"] = self._model_expression(arguments[1])
        return operation

    def _parse_libc_call(self, call: _Token, arguments: Sequence[Sequence[_Token]]) -> dict | None:
        name = call.value
        source = self._source(call)

        def require(count: int) -> bool:
            if len(arguments) >= count:
                return True
            self.diagnostics.append(
                _diagnostic("error", "C_LIBRARY_ARGUMENTS", f"{name} has fewer than {count} arguments", **source)
            )
            return False

        def expression(index: int) -> dict:
            return self._model_expression(arguments[index])

        if name in _PURE_LIBC_FUNCTIONS:
            return None
        if name in {"malloc", "calloc", "realloc"}:
            required = 2 if name in {"calloc", "realloc"} else 1
            if not require(required):
                return {"op": "unsupported", "call": name, "source": source}
            operation = {"op": "heapAllocate", "function": name, "source": source}
            if name == "calloc":
                operation.update({"count": expression(0), "size": expression(1), "zero": True})
            elif name == "realloc":
                operation.update({"pointer": expression(0), "size": expression(1)})
            else:
                operation["size"] = expression(0)
            return operation
        if name == "free":
            if not require(1):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": "heapFree", "pointer": expression(0), "source": source}
        if name in {"memcpy", "memmove", "memset", "strcpy", "strncpy", "strcat", "strncat"}:
            required = 3 if name in {"memcpy", "memmove", "memset", "strncpy", "strncat"} else 2
            if not require(required):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": "libcMemory",
                "function": name,
                "arguments": [expression(index) for index in range(required)],
                "source": source,
            }
        if name in {"printf", "fprintf", "puts", "fputs", "putchar", "fputc", "fwrite"}:
            required = {"printf": 1, "fprintf": 2, "puts": 1, "fputs": 2, "putchar": 1, "fputc": 2, "fwrite": 4}[name]
            if not require(required):
                return {"op": "unsupported", "call": name, "source": source}
            operation: dict = {"op": "stdioWrite", "function": name, "stream": "stdout", "source": source}
            if name in {"fprintf", "fputs", "fputc", "fwrite"}:
                operation["stream"] = _first_identifier(arguments[-1], ignore=self._DECLARATION_PREFIXES) or "stdout"
            if name in {"printf", "fprintf"}:
                format_index = 1 if name == "fprintf" else 0
                operation["format"] = expression(format_index)
                operation["arguments"] = [
                    expression(index) for index in range(format_index + 1, len(arguments))
                ]
            elif name in {"puts", "fputs"}:
                operation.update({"data": expression(0), "newline": name == "puts"})
            elif name in {"putchar", "fputc"}:
                operation["character"] = expression(0)
            else:
                operation.update({"data": expression(0), "size": expression(1), "count": expression(2)})
            return operation
        if name == "sscanf":
            if not require(2):
                return {"op": "unsupported", "call": name, "source": source}
            return {
                "op": "stdioScan",
                "input": expression(0),
                "format": expression(1),
                "targets": [expression(index) for index in range(2, len(arguments))],
                "source": source,
            }
        if name == "srand":
            if not require(1):
                return {"op": "unsupported", "call": name, "source": source}
            return {"op": "libcSeed", "seed": expression(0), "source": source}
        if name in {"exit", "_Exit", "abort"}:
            status = expression(0) if arguments else {"kind": "literal", "value": 1 if name == "abort" else 0}
            return {"op": "processExit", "status": status, "abnormal": name == "abort", "source": source}
        return None

    def _parse_middleware_call(self, call: _Token, arguments: Sequence[Sequence[_Token]]) -> dict | None:
        source = self._source(call)
        name = call.value

        def tick_model(tokens: Sequence[_Token]) -> tuple[dict, dict | None]:
            cleaned = _strip_wrapping_parentheses(tokens)
            if len(cleaned) >= 4 and cleaned[0].value == "pdMS_TO_TICKS" and cleaned[1].value == "(":
                close = _matching(cleaned, 1, "(", ")")
                if close == len(cleaned) - 1:
                    milliseconds = self._model_expression(cleaned[2:close])
                    return milliseconds, milliseconds
            return self._model_expression(tokens), None

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
                "ticks": self._model_expression(timeout_tokens),
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
        model = self._model_expression(tokens)
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

    def _transfer_length(self, tokens: Sequence[_Token]) -> tuple[int | dict | None, str]:
        expression_text = _tokens_text(tokens)
        resolved = self.resolve_expression(expression_text)
        if resolved is not None:
            return resolved, expression_text
        expression = self._model_expression(tokens)
        if _runtime_expression_supported(expression):
            return expression, expression_text
        return None, expression_text

    def _buffer_reference(self, tokens: Sequence[_Token]) -> str | dict:
        """Preserve complex pointer expressions used as HAL buffers."""

        cleaned = _strip_leading_c_casts(_strip_wrapping_parentheses(tokens))
        if len(cleaned) == 1 and cleaned[0].kind == "identifier":
            return cleaned[0].value
        if len(cleaned) == 2 and cleaned[0].value == "&" and cleaned[1].kind == "identifier":
            return cleaned[1].value
        return self._model_expression(tokens)

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
                    "compare": self._model_expression(arguments[2]),
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
        if name in {
            "HAL_UART_Receive", "HAL_UART_Transmit",
            "HAL_UART_Receive_IT", "HAL_UART_Transmit_IT",
            "HAL_UART_Receive_DMA", "HAL_UART_Transmit_DMA",
        }:
            is_dma = name.endswith("_DMA")
            is_interrupt = name.endswith("_IT")
            required = 3 if is_dma or is_interrupt else 4
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
            buffer = self._buffer_reference(arguments[1])
            length, length_expression = self._transfer_length(arguments[2])
            timeout = None if is_dma or is_interrupt else _tokens_text(arguments[3])
            timeout_expression = None if is_dma or is_interrupt else self._model_expression(arguments[3])
            timeout_value = None if timeout is None else self.resolve_expression(timeout)
            instance = None
            if handle and handle in self.uart_instances:
                instance = self.uart_instances[handle].get("instance")
            receiving = "Receive" in name
            if is_dma:
                operation_name = "uartReceiveDma" if receiving else "uartTransmitDma"
            elif is_interrupt:
                operation_name = "uartReceiveIt" if receiving else "uartTransmitIt"
            else:
                operation_name = "uartReceive" if receiving else "uartTransmit"
            blocking = not is_dma and not is_interrupt and (timeout_value is None or timeout_value != 0)
            operation = {
                "op": operation_name,
                "uart": handle,
                "instance": instance,
                "buffer": buffer,
                "length": length,
                "lengthExpression": length_expression,
                "timeout": timeout,
                "timeoutExpression": timeout_expression,
                "blocking": blocking,
                "dma": is_dma,
                "interrupt": is_interrupt,
                "source": source,
            }
            # Transfer sizes are often calculated at runtime: ``strlen``, a
            # helper return value, or even ``index++`` are all valid C/HAL
            # idioms.  A static value is convenient metadata, not a
            # requirement for semantic execution, so reject only expressions
            # the runtime cannot evaluate at all.
            if length is None and not _runtime_expression_supported(
                self._model_expression(arguments[2])
            ):
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

        if name in {"HAL_UART_Abort_IT", "HAL_UART_AbortTransmit_IT", "HAL_UART_AbortReceive_IT"}:
            if len(arguments) < 1:
                self.diagnostics.append(_diagnostic("error", "HAL_CALL_ARGUMENTS", f"{name} has too few arguments", **source))
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            return {
                "op": "uartAbortIt",
                "uart": handle,
                "instance": self.uart_instances.get(handle, {}).get("instance") if handle else None,
                "direction": "tx" if "Transmit" in name else "rx" if "Receive" in name else "both",
                "source": source,
            }

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

        i2c_match = re.fullmatch(
            r"HAL_I2C_(Master_(?:Transmit|Receive)|Mem_(?:Write|Read))(?:_(IT|DMA))?",
            name,
        )
        if i2c_match:
            base_name = i2c_match.group(1)
            transfer_mode = i2c_match.group(2)
            memory_access = base_name.startswith("Mem_")
            receiving = base_name.endswith("Receive") or base_name.endswith("Read")
            # Memory transfers carry handle, device address, memory address,
            # memory-address width, buffer and length.  The blocking variant
            # adds a timeout; IT/DMA variants do not.
            required = (6 if memory_access else 4) if transfer_mode else (7 if memory_access else 5)
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
            device_address = self._model_expression(arguments[1])
            if not memory_access:
                buffer_arguments = arguments[2]
                length_arguments = arguments[3]
                timeout_arguments = arguments[4] if not transfer_mode else []
                operation_name = "i2cMasterReceive" if receiving else "i2cMasterTransmit"
            else:
                buffer_arguments = arguments[4]
                length_arguments = arguments[5]
                if transfer_mode:
                    # IT/DMA memory transfers have no timeout parameter.
                    # The canonical argument order is handle, address,
                    # memoryAddress, memoryAddressSize, data, length.
                    timeout_arguments = []
                else:
                    timeout_arguments = arguments[6]
                operation_name = "i2cMemRead" if receiving else "i2cMemWrite"
            if transfer_mode:
                operation_name += "It" if transfer_mode == "IT" else "Dma"
            buffer = self._buffer_reference(buffer_arguments)
            length, length_expression = self._transfer_length(length_arguments)
            timeout = _tokens_text(timeout_arguments) if timeout_arguments else None
            timeout_expression = self._model_expression(timeout_arguments) if timeout_arguments else None
            timeout_value = self.resolve_expression(timeout) if timeout is not None else 0
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
                "timeoutExpression": timeout_expression,
                "blocking": timeout_value is None or timeout_value != 0,
                "interrupt": transfer_mode == "IT",
                "dma": transfer_mode == "DMA",
                "source": source,
            }
            if memory_access:
                operation.update(
                    {
                        "memoryAddress": self._model_expression(arguments[2]),
                        "memoryAddressExpression": _tokens_text(arguments[2]),
                        "memoryAddressSize": self._model_expression(arguments[3]),
                        "memoryAddressSizeExpression": _tokens_text(arguments[3]),
                    }
                )
            if length is None and not _runtime_expression_supported(
                self._model_expression(length_arguments)
            ):
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

        if name == "HAL_I2C_Master_Abort_IT":
            if len(arguments) < 2:
                self.diagnostics.append(
                    _diagnostic("error", "HAL_CALL_ARGUMENTS", f"{name} has fewer than 2 arguments", **source)
                )
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            return {
                "op": "i2cAbortIt",
                "i2c": handle,
                "instance": self.i2c_instances.get(handle, {}).get("instance") if handle else None,
                "deviceAddress": self._model_expression(arguments[1]),
                "deviceAddressExpression": _tokens_text(arguments[1]),
                "interrupt": True,
                "source": source,
            }

        spi_match = re.fullmatch(
            r"HAL_SPI_(TransmitReceive|Transmit|Receive)(?:_(IT|DMA))?",
            name,
        )
        if spi_match:
            spi_base = spi_match.group(1)
            transfer_mode = spi_match.group(2)
            full_duplex = spi_base == "TransmitReceive"
            required = (4 if full_duplex else 3) if transfer_mode else (5 if full_duplex else 4)
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
            tx_buffer = self._buffer_reference(arguments[1])
            rx_buffer = self._buffer_reference(arguments[2]) if full_duplex else None
            length_index = 3 if full_duplex else 2
            timeout_index = length_index + 1
            length, length_expression = self._transfer_length(arguments[length_index])
            timeout = _tokens_text(arguments[timeout_index]) if not transfer_mode else None
            timeout_expression = self._model_expression(arguments[timeout_index]) if not transfer_mode else None
            timeout_value = self.resolve_expression(timeout) if timeout is not None else 0
            instance = self.spi_instances.get(handle, {}).get("instance") if handle else None
            operation_name = {
                "Transmit": "spiTransmit", "Receive": "spiReceive", "TransmitReceive": "spiTransmitReceive",
            }[spi_base]
            if transfer_mode:
                operation_name += "It" if transfer_mode == "IT" else "Dma"
            operation = {
                "op": operation_name,
                "spi": handle,
                "instance": instance,
                "buffer": tx_buffer if spi_base == "Receive" else tx_buffer,
                "txBuffer": tx_buffer,
                "rxBuffer": rx_buffer,
                "length": length,
                "lengthExpression": length_expression,
                "timeout": timeout,
                "timeoutExpression": timeout_expression,
                "blocking": timeout_value is None or timeout_value != 0,
                "interrupt": transfer_mode == "IT",
                "dma": transfer_mode == "DMA",
                "source": source,
            }
            if length is None and not _runtime_expression_supported(
                self._model_expression(arguments[length_index])
            ):
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

        if name == "HAL_SPI_Abort_IT":
            if len(arguments) < 1:
                self.diagnostics.append(
                    _diagnostic("error", "HAL_CALL_ARGUMENTS", f"{name} has too few arguments", **source)
                )
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            return {
                "op": "spiAbortIt",
                "spi": handle,
                "instance": self.spi_instances.get(handle, {}).get("instance") if handle else None,
                "interrupt": True,
                "source": source,
            }

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
                buffer = self._buffer_reference(arguments[1])
                length, length_expression = self._transfer_length(arguments[2])
                operation.update({
                    "buffer": buffer,
                    "length": length,
                    "lengthExpression": length_expression,
                })
                if length is None and not _runtime_expression_supported(
                    self._model_expression(arguments[2])
                ):
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

        if name in {"HAL_ADC_Start_IT", "HAL_ADC_Stop_IT"}:
            if len(arguments) < 1:
                self.diagnostics.append(_diagnostic("error", "HAL_CALL_ARGUMENTS", f"{name} has too few arguments", **source))
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            return {
                "op": "adcStartIt" if name == "HAL_ADC_Start_IT" else "adcStopIt",
                "adc": handle,
                "instance": self.adc_instances.get(handle, {}).get("instance") if handle else None,
                "source": source,
            }

        if name in {"HAL_TIM_Base_Start_IT", "HAL_TIM_Base_Stop_IT"}:
            if len(arguments) < 1:
                self.diagnostics.append(_diagnostic("error", "HAL_CALL_ARGUMENTS", f"{name} has too few arguments", **source))
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            suffix = re.search(r"(\d+)$", str(handle or ""))
            return {
                "op": "timerStartIt" if name == "HAL_TIM_Base_Start_IT" else "timerStopIt",
                "timer": handle,
                "instance": "TIM" + suffix.group(1) if suffix else None,
                "source": source,
            }

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
                operation["timeoutExpression"] = self._model_expression(arguments[1])
                timeout_value = self.resolve_expression(timeout)
                operation["blocking"] = timeout_value is None or timeout_value != 0
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
                operation["value"] = self._model_expression(arguments[2])
            return operation

        if name == "HAL_ADC_Stop":
            if len(arguments) < 1:
                self.diagnostics.append(_diagnostic("error", "HAL_CALL_ARGUMENTS", f"{name} has too few arguments", **source))
                return {"op": "unsupported", "call": name, "source": source}
            handle = _first_identifier(arguments[0])
            return {
                "op": "adcStop",
                "adc": handle,
                "instance": self.adc_instances.get(handle, {}).get("instance") if handle else None,
                "source": source,
            }

        if name == "HAL_Delay":
            expression = _tokens_text(arguments[0]) if arguments else ""
            milliseconds = self.resolve_expression(expression)
            expression_model = self._model_expression(arguments[0] if arguments else [])
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

        if name in {
            "HAL_Init", "HAL_IncTick", "HAL_UART_Init", "HAL_UART_DeInit", "HAL_I2C_Init", "HAL_I2C_DeInit", "HAL_ADC_Init", "HAL_ADC_DeInit", "HAL_ADC_ConfigChannel",
            "HAL_ADCEx_Calibration_Start", "HAL_DMA_Init", "HAL_DMA_DeInit", "HAL_DMA_IRQHandler",
            "HAL_GPIO_Init", "HAL_GPIO_EXTI_IRQHandler", "HAL_ADC_IRQHandler", "HAL_UART_IRQHandler",
            "HAL_TIM_IRQHandler", "HAL_TIM_PWM_Init", "HAL_TIM_PWM_DeInit", "HAL_TIM_PWM_ConfigChannel", "HAL_TIM_Base_Init", "HAL_TIM_Base_DeInit",
            "HAL_SPI_Init", "HAL_SPI_DeInit",
            "HAL_NVIC_SetPriority", "HAL_NVIC_EnableIRQ", "HAL_NVIC_DisableIRQ", "HAL_NVIC_ClearPendingIRQ",
            "HAL_RCC_OscConfig", "HAL_RCC_ClockConfig", "HAL_RCCEx_PeriphCLKConfig",
            "__HAL_RCC_GPIOA_CLK_ENABLE", "__HAL_RCC_GPIOB_CLK_ENABLE", "__HAL_RCC_GPIOC_CLK_ENABLE",
            "__HAL_RCC_GPIOD_CLK_ENABLE", "__HAL_RCC_GPIOE_CLK_ENABLE", "__HAL_RCC_GPIOF_CLK_ENABLE",
            "__HAL_RCC_GPIOG_CLK_ENABLE", "__HAL_LINKDMA", "__HAL_GPIO_EXTI_CLEAR_IT", "__HAL_GPIO_EXTI_CLEAR_FLAG",
        }:
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


def _function_parameter_names(tokens: Sequence[_Token], name: str) -> list[str]:
    for index, token in enumerate(tokens[:-1]):
        if token.value != name or tokens[index + 1].value != "(":
            continue
        close_paren = _matching(tokens, index + 1, "(", ")")
        if close_paren is None:
            continue
        cursor = close_paren + 1
        while cursor < len(tokens) and tokens[cursor].value in {"__attribute__", "(", ")"}:
            cursor += 1
        if cursor >= len(tokens) or tokens[cursor].value != "{":
            continue
        parameters: list[str] = []
        for argument in _split_arguments(tokens[index + 2 : close_paren]):
            identifiers = [item.value for item in argument if item.kind == "identifier" and item.value != "void"]
            if identifiers:
                parameters.append(identifiers[-1])
        return parameters
    return []


def _substitute_function_parameters(
    body: Sequence[_Token],
    arguments: Mapping[str, Sequence[_Token]],
) -> list[_Token]:
    substituted: list[_Token] = []
    for index, token in enumerate(body):
        is_member_name = index > 0 and body[index - 1].value in {".", "->"}
        actual = arguments.get(token.value) if token.kind == "identifier" and not is_member_name else None
        if actual is None:
            substituted.append(token)
            continue
        if not actual:
            continue
        marker = actual[0]
        substituted.append(_Token("(", "operator", marker.start, marker.line, marker.column))
        substituted.extend(actual)
        substituted.append(_Token(")", "operator", marker.start, marker.line, marker.column))
    return substituted


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
        cleaned = _mask_inactive_preprocessor(record.content, macros)
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
            if inferred:
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
        cleaned = _mask_inactive_preprocessor(record.content, macros)
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
        model["masterReceiveCalls"] = []
        model["memWriteCalls"] = []
        model["memReadCalls"] = []
        model["abortCalls"] = []
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
    # Collect declarations before scanning field assignments.  Generic
    # ``.Init.Mode``/``.Init.Direction`` expressions are also used by UART,
    # DMA and other CubeMX handles; creating an SPI descriptor for an
    # undeclared name would pollute the model (for example ``huart2`` could be
    # misreported as ``SPI2`` merely because it has a UART mode assignment).
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _mask_inactive_preprocessor(record.content, macros)
        for match in declaration_pattern.finditer(cleaned):
            line, column = _source_line(cleaned, match.start(1))
            handle = match.group(1)
            handles.setdefault(handle, {"handle": handle, "sources": {}})["sources"]["declaration"] = {
                "file": record.path,
                "line": line,
                "column": column,
            }
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _mask_inactive_preprocessor(record.content, macros)
        for field, (pattern, numeric) in assignment_patterns.items():
            for match in pattern.finditer(cleaned):
                handle, raw_value = match.group(1), match.group(2).strip()
                if handle not in handles:
                    continue
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
        model["receiveCalls"] = []
        model["abortCalls"] = []
    return handles


def _parse_source_adc_configuration(
    records: Sequence[_ProjectFile],
    ioc: Mapping[str, object],
    macros: Mapping[str, _Macro] | None = None,
) -> dict[str, dict]:
    handles: dict[str, dict] = {}
    declaration_pattern = re.compile(r"\bADC_HandleTypeDef\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;")
    instance_pattern = re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*Instance\s*=\s*(ADC\d+)\s*;")
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _mask_inactive_preprocessor(record.content, macros)
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
    macros: Mapping[str, _Macro] | None = None,
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

    # As with SPI, declaration discovery must precede generic ``.Init.*``
    # matching.  Without this guard a UART/ADC handle's mode assignment would
    # become a fabricated DMA channel in the returned model.
    declared_handles: set[str] = set()
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _mask_inactive_preprocessor(record.content, macros)
        for match in declaration_pattern.finditer(cleaned):
            line, column = _source_line(cleaned, match.start(1))
            handle = match.group(1)
            declared_handles.add(handle)
            handles.setdefault(handle, {"handle": handle, "sources": {}, "links": []})["sources"]["declaration"] = {
                "file": record.path,
                "line": line,
                "column": column,
            }
    for record in records:
        if not record.path.casefold().endswith(C_SOURCE_SUFFIXES + C_HEADER_SUFFIXES):
            continue
        cleaned = _mask_inactive_preprocessor(record.content, macros)
        for field, pattern in assignment_patterns.items():
            for match in pattern.finditer(cleaned):
                handle, raw_value = match.group(1), match.group(2).strip()
                if handle not in declared_handles:
                    continue
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
        cleaned = _mask_inactive_preprocessor(record.content, macros)
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


def _walk_inline_call_operations(value: object) -> Iterable[dict]:
    """Yield statement trees embedded in value-producing helper calls."""

    if isinstance(value, Mapping):
        if value.get("kind") == "inlineCall":
            operations = value.get("operations")
            if isinstance(operations, (list, tuple)):
                yield from _walk_operations(operations)
            return
        for key, child in value.items():
            # Control-flow bodies are walked by _walk_operations itself. Skip
            # them here so an inline helper nested in a branch is not emitted
            # twice during id/metadata collection.
            if key not in {"source", "then", "else", "body", "init", "increment", "cases", "default", "operations"}:
                yield from _walk_inline_call_operations(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            yield from _walk_inline_call_operations(child)


def _walk_operations(operations: Sequence[dict]) -> Iterable[dict]:
    for operation in operations:
        yield operation
        for key, value in operation.items():
            if key != "source":
                yield from _walk_inline_call_operations(value)
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


def _walk_hal_call_operations(value: object) -> Iterable[dict]:
    """Yield lowered operations embedded inside ``halCall`` expressions.

    A call used in a condition is not part of the statement tree, but it still
    needs an operation id, a resolved peripheral instance, DMA links, and the
    same metadata as its statement-form equivalent.  Keeping this traversal
    separate avoids treating arbitrary expression nodes as executable
    statements.
    """

    if isinstance(value, Mapping):
        if value.get("kind") == "halCall":
            operation = value.get("operation")
            if isinstance(operation, dict):
                yield operation
                for key, child in operation.items():
                    if key != "source":
                        yield from _walk_hal_call_operations(child)
            return
        for key, child in value.items():
            if key != "source":
                yield from _walk_hal_call_operations(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            yield from _walk_hal_call_operations(child)


def _walk_model_operations(operations: Sequence[dict]) -> Iterable[dict]:
    """Yield statement operations followed by calls embedded in expressions."""

    yield from _walk_operations(operations)
    yield from _walk_hal_call_operations(operations)


def _find_unsupported_expressions(value: object) -> list[tuple[Mapping[str, object], Mapping[str, object] | None]]:
    """Find expression placeholders while retaining the nearest operation source."""

    found: list[tuple[Mapping[str, object], Mapping[str, object] | None]] = []

    def visit(current: object, source: Mapping[str, object] | None = None) -> None:
        if isinstance(current, Mapping):
            own_source = current.get("source")
            if isinstance(own_source, Mapping) and own_source.get("file"):
                source = own_source
            if current.get("kind") in {"expression", "unknown"}:
                found.append((current, source))
            for key, child in current.items():
                if key != "source":
                    visit(child, source)
        elif isinstance(current, (list, tuple)):
            for child in current:
                visit(child, source)

    visit(value)
    return found


def _assign_operation_ids(operations: Sequence[dict], prefix: str = "op") -> None:
    counter = 0
    for item in _walk_model_operations(operations):
        counter += 1
        item["id"] = f"{prefix}-{counter}"


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
        tokens = _lex_c(record.content, macros)
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
        "HAL_GPIO_EXTI_Callback",
        "HAL_ADC_ConvHalfCpltCallback",
        "HAL_ADC_ConvCpltCallback",
        "HAL_ADC_ErrorCallback",
        "HAL_UART_TxHalfCpltCallback",
        "HAL_UART_TxCpltCallback",
        "HAL_UART_RxHalfCpltCallback",
        "HAL_UART_RxCpltCallback",
        "HAL_UART_ErrorCallback",
        "HAL_UART_AbortCpltCallback",
        "HAL_UART_AbortTransmitCpltCallback",
        "HAL_UART_AbortReceiveCpltCallback",
        "HAL_I2C_MasterTxCpltCallback",
        "HAL_I2C_MasterRxCpltCallback",
        "HAL_I2C_MemTxCpltCallback",
        "HAL_I2C_MemRxCpltCallback",
        "HAL_I2C_ErrorCallback",
        "HAL_I2C_AbortCpltCallback",
        "HAL_SPI_TxCpltCallback",
        "HAL_SPI_RxCpltCallback",
        "HAL_SPI_TxRxCpltCallback",
        "HAL_SPI_ErrorCallback",
        "HAL_SPI_AbortCpltCallback",
        "HAL_TIM_PeriodElapsedCallback",
        "HAL_TIM_PWM_PulseFinishedCallback",
        "HAL_TIM_ErrorCallback",
    )
    callbacks: dict[str, dict] = {}
    for name in callback_names:
        has_project_definition = any(
            record.path.casefold().endswith(C_SOURCE_SUFFIXES)
            and not re.search(r"(?:^|/)drivers?/", record.path.casefold())
            and _find_function(_lex_c(record.content, macros), name) is not None
            for record in records
        )
        if not has_project_definition:
            continue
        source_path, operations = _parse_named_function_program(
            records, name, macros, aliases, uarts, i2cs, spis, adcs, diagnostics
        )
        if source_path is None:
            continue
        source_record = next((record for record in records if record.path == source_path), None)
        callbacks[name] = {
            "entry": name,
            "source": source_path,
            "parameters": _function_parameter_names(_lex_c(source_record.content, macros), name) if source_record else [],
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
        tokens = _lex_c(record.content, macros)
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
            for operation in _walk_model_operations(operations):
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
        tokens = _lex_c(record.content, macros)
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
    for operation in _walk_model_operations(operations):
        operation_name = operation.get("op")
        if operation_name in {
            "uartReceive", "uartTransmit", "uartReceiveIt", "uartTransmitIt",
            "uartReceiveDma", "uartTransmitDma", "uartDmaStop", "uartAbortIt",
        }:
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
                if operation_name not in {"uartDmaStop", "uartAbortIt"}:
                    metadata["dma"] = operation_name.endswith("Dma")
                    metadata["interrupt"] = operation_name.endswith("It")
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

        if operation_name in {
            "i2cMasterTransmit", "i2cMasterReceive", "i2cMemWrite", "i2cMemRead",
            "i2cMasterTransmitIt", "i2cMasterReceiveIt", "i2cMemWriteIt", "i2cMemReadIt",
            "i2cMasterTransmitDma", "i2cMasterReceiveDma", "i2cMemWriteDma", "i2cMemReadDma",
            "i2cAbortIt",
        }:
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
                    "masterReceiveCalls": [],
                    "memWriteCalls": [],
                    "memReadCalls": [],
                    "abortCalls": [],
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
                base_operation_name = re.sub(r"(?:It|Dma)$", "", operation_name)
                if operation_name == "i2cAbortIt":
                    metadata["interrupt"] = True
                    i2c.setdefault("abortCalls", []).append(metadata)
                elif base_operation_name in {"i2cMemWrite", "i2cMemRead"}:
                    metadata.update(
                        {
                            "memoryAddress": operation.get("memoryAddress"),
                            "memoryAddressSize": operation.get("memoryAddressSize"),
                        }
                    )
                    i2c["memReadCalls" if base_operation_name == "i2cMemRead" else "memWriteCalls"].append(metadata)
                else:
                    i2c["masterReceiveCalls" if base_operation_name == "i2cMasterReceive" else "masterTransmitCalls"].append(metadata)
            continue

        if operation_name in {
            "spiTransmit", "spiReceive", "spiTransmitReceive",
            "spiTransmitIt", "spiReceiveIt", "spiTransmitReceiveIt",
            "spiTransmitDma", "spiReceiveDma", "spiTransmitReceiveDma", "spiAbortIt",
        }:
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
                    "receiveCalls": [],
                    "abortCalls": [],
                    "sources": {},
                }
            spi = spis.get(handle) if handle else None
            if spi:
                operation["instance"] = spi.get("instance")
                base_operation_name = re.sub(r"(?:It|Dma)$", "", operation_name)
                spi["receiveCalls" if base_operation_name == "spiReceive" else "transmitCalls"].append({
                    "operationId": operation["id"],
                    "buffer": operation.get("buffer"),
                    "txBuffer": operation.get("txBuffer"),
                    "rxBuffer": operation.get("rxBuffer"),
                    "length": operation.get("length"),
                    "timeout": operation.get("timeout"),
                    "blocking": operation.get("blocking", False),
                    "interrupt": operation.get("interrupt", False),
                    "dma": operation.get("dma", False),
                    "source": operation.get("source"),
                })
            continue

        if operation_name in {
            "adcStart", "adcPollForConversion", "adcGetValue",
            "adcStartIt", "adcStopIt", "adcStartDma", "adcStopDma",
        }:
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
                if operation_name in {"adcStart", "adcStartIt", "adcStopIt"}:
                    metadata["operation"] = operation_name
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
    macros = _collect_enum_constants(records, macros)
    variables = _parse_initial_variables(records, macros)
    variable_types = _parse_variable_types(records, macros)
    aliases = _build_gpio_aliases(macros, ioc, diagnostics)
    _parse_gpio_interrupt_configuration(records, macros, ioc)
    uarts = _parse_source_uart_configuration(records, macros, ioc, diagnostics)
    i2cs = _parse_source_i2c_configuration(records, macros, ioc, diagnostics)
    spis = _parse_source_spi_configuration(records, macros, ioc)
    adcs = _parse_source_adc_configuration(records, ioc, macros)
    dmas, dma_links = _parse_source_dma_configuration(records, macros)
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
        i2c_handle = peripheral_handle if peripheral_handle in i2cs else next(
            (handle for handle, descriptor in i2cs.items() if str(descriptor.get("instance") or "").upper() == peripheral_instance),
            None,
        )
        if i2c_handle:
            if "tx" in field:
                i2cs[i2c_handle]["txDmaHandle"] = dma_handle
            elif "rx" in field:
                i2cs[i2c_handle]["rxDmaHandle"] = dma_handle
        spi_handle = peripheral_handle if peripheral_handle in spis else next(
            (handle for handle, descriptor in spis.items() if str(descriptor.get("instance") or "").upper() == peripheral_instance),
            None,
        )
        if spi_handle:
            if "tx" in field:
                spis[spi_handle]["txDmaHandle"] = dma_handle
            elif "rx" in field:
                spis[spi_handle]["rxDmaHandle"] = dma_handle

    pins: dict[str, dict] = ioc["pins"]  # type: ignore[assignment]
    output_operations = list(program["operations"])
    for task in middlewares.get("freertos", {}).get("tasks", []):
        output_operations.extend(task.get("operations", []))
    for callback in callbacks.values():
        output_operations.extend(callback.get("operations", []))
    for operation in _walk_model_operations(output_operations):
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
        elif operation_name in {
            "i2cMasterTransmitDma", "i2cMasterReceiveDma", "i2cMemWriteDma", "i2cMemReadDma"
        }:
            i2c = i2cs.get(operation.get("i2c"), {})
            dma_handle = i2c.get("rxDmaHandle") if "Receive" in operation_name or "Read" in operation_name else i2c.get("txDmaHandle")
            dma = dmas.get(dma_handle, {}) if dma_handle else {}
            operation["dmaHandle"] = dma_handle
            operation["dmaInstance"] = dma.get("instance")
            operation["circular"] = bool(dma.get("circular", False))
        elif operation_name in {"spiTransmitDma", "spiReceiveDma", "spiTransmitReceiveDma"}:
            spi = spis.get(operation.get("spi"), {})
            dma_handle = spi.get("rxDmaHandle") if operation_name == "spiReceiveDma" else spi.get("txDmaHandle")
            dma = dmas.get(dma_handle, {}) if dma_handle else {}
            operation["dmaHandle"] = dma_handle
            operation["dmaInstance"] = dma.get("instance")
            operation["circular"] = bool(dma.get("circular", False))

        if operation.get("op") not in {"pwmStart", "pwmStop", "pwmSetCompare", "timerStartIt", "timerStopIt"}:
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

    reported_expressions: set[tuple[str, str, int, int]] = set()
    for expression, source in _find_unsupported_expressions(output_operations):
        text = str(expression.get("text") or "").strip()
        location = source or {}
        key = (
            text,
            str(location.get("file") or ""),
            int(location.get("line") or 0),
            int(location.get("column") or 0),
        )
        if key in reported_expressions:
            continue
        reported_expressions.add(key)
        diagnostics.append(
            _diagnostic(
                "error",
                "C_UNSUPPORTED_EXPRESSION",
                f"Unsupported firmware expression: {text or expression.get('kind')}",
                file=str(location.get("file") or "") or None,
                line=int(location.get("line") or 0) or None,
                column=int(location.get("column") or 0) or None,
                details={"expression": text, "kind": expression.get("kind")},
            )
        )
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
