from __future__ import annotations

import base64
import binascii
import hashlib
import io
import re
from pathlib import PurePath
from typing import Any


DATASHEET_SCHEMA_VERSION = 1
MAX_PDF_BYTES = 24 * 1024 * 1024
MAX_PDF_PAGES = 600
MAX_EXTRACTED_CHARACTERS = 8 * 1024 * 1024
MAX_TEXT_PAGES = 600
MAX_PAGE_CHARACTERS = 120_000
MAX_REGISTERS = 2_048
MAX_PINS = 512
MAX_PACKAGES = 32
MAX_INTERFACES = 32
REQUIRED_CONFIRMATIONS = (
    "identity.partNumber",
    "packages",
    "pins",
    "electrical.recommendedOperatingConditions",
    "interfaces",
    "registerMap",
    "simulation.scope",
)


class DatasheetError(ValueError):
    """Raised when an untrusted datasheet cannot be parsed safely."""


def _optional_imports() -> tuple[Any, Any, list[str]]:
    errors: list[str] = []
    pdf_reader = None
    pdfplumber = None
    try:
        from pypdf import PdfReader  # type: ignore

        pdf_reader = PdfReader
    except Exception as exc:
        errors.append(f"pypdf: {exc}")
    try:
        import pdfplumber as imported_pdfplumber  # type: ignore

        pdfplumber = imported_pdfplumber
    except Exception as exc:
        errors.append(f"pdfplumber: {exc}")
    return pdf_reader, pdfplumber, errors


def parser_status() -> dict:
    pdf_reader, pdfplumber, errors = _optional_imports()
    return {
        "available": pdf_reader is not None,
        "engine": "pypdf + pdfplumber" if pdf_reader and pdfplumber else "pypdf" if pdf_reader else "unavailable",
        "tableExtraction": pdfplumber is not None,
        "detail": "; ".join(errors),
        "schemaVersion": DATASHEET_SCHEMA_VERSION,
        "endpoint": "/api/datasheet/parse",
        "validationEndpoint": "/api/datasheet/validate",
    }


def _clean_text(value: object) -> str:
    text = str(value or "")
    text = text.replace("\x00", " ").replace("\uf0e3", "-").replace("\uf0b7", "•")
    return re.sub(r"\s+", " ", text).strip()


def _safe_filename(value: object) -> str:
    name = PurePath(str(value or "datasheet.pdf").replace("\\", "/")).name
    name = re.sub(r"[^\w.()\-\u4e00-\u9fff]+", "_", name, flags=re.UNICODE).strip("._")
    if not name:
        name = "datasheet.pdf"
    if len(name) > 180:
        stem, dot, suffix = name.rpartition(".")
        name = (stem[:160] + dot + suffix[:16]) if dot else name[:180]
    return name


def _bounded_hints(raw_hints: object) -> dict:
    if raw_hints is None:
        return {}
    if not isinstance(raw_hints, dict):
        raise DatasheetError("hints must be an object")
    allowed = {"partNumber", "manufacturer", "package", "title", "interface"}
    hints: dict[str, str] = {}
    for key, value in raw_hints.items():
        if key not in allowed or value is None:
            continue
        text = _clean_text(value)
        if len(text) > 160:
            raise DatasheetError(f"hints.{key} is too long")
        hints[key] = text
    return hints


def _decode_pdf_base64(value: object) -> bytes:
    if not isinstance(value, str) or not value.strip():
        raise DatasheetError("pdfBase64 must be a non-empty base64 string")
    encoded = value.strip()
    if encoded.startswith("data:"):
        header, separator, encoded = encoded.partition(",")
        if not separator or ";base64" not in header.lower() or "pdf" not in header.lower():
            raise DatasheetError("Only base64 encoded PDF data URLs are supported")
    maximum_encoded = ((MAX_PDF_BYTES + 2) // 3) * 4 + 16
    if len(encoded) > maximum_encoded:
        raise DatasheetError(f"PDF exceeds the {MAX_PDF_BYTES}-byte limit")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise DatasheetError("pdfBase64 is not valid base64") from exc
    if len(content) > MAX_PDF_BYTES:
        raise DatasheetError(f"PDF exceeds the {MAX_PDF_BYTES}-byte limit")
    if not content.startswith(b"%PDF-"):
        raise DatasheetError("Uploaded content is not a PDF")
    return content


def _normalize_pages(raw_pages: object) -> list[dict]:
    if isinstance(raw_pages, str):
        raw_pages = [{"number": 1, "text": raw_pages}]
    if not isinstance(raw_pages, list) or not raw_pages:
        raise DatasheetError("pages must be a non-empty list")
    if len(raw_pages) > MAX_TEXT_PAGES:
        raise DatasheetError(f"Datasheet contains more than {MAX_TEXT_PAGES} pages")
    pages: list[dict] = []
    total = 0
    for index, raw_page in enumerate(raw_pages):
        if isinstance(raw_page, str):
            number = index + 1
            text = raw_page
            tables: list = []
        elif isinstance(raw_page, dict):
            number = raw_page.get("number", index + 1)
            text = raw_page.get("text", "")
            tables = raw_page.get("tables", [])
        else:
            raise DatasheetError("Each page must be text or an object")
        if not isinstance(number, int) or number < 1:
            raise DatasheetError("Page numbers must be positive integers")
        if not isinstance(text, str):
            raise DatasheetError("Page text must be a string")
        if len(text) > MAX_PAGE_CHARACTERS:
            raise DatasheetError(f"Page {number} text exceeds the safety limit")
        if not isinstance(tables, list):
            raise DatasheetError("Page tables must be a list")
        total += len(text)
        if total > MAX_EXTRACTED_CHARACTERS:
            raise DatasheetError("Extracted datasheet text exceeds the safety limit")
        pages.append({"number": number, "text": text, "tables": tables})
    return pages


def _extract_pdf_pages(pdf_bytes: bytes) -> tuple[list[dict], dict, str]:
    pdf_reader, pdfplumber, errors = _optional_imports()
    if pdf_reader is None:
        raise DatasheetError("PDF parser is unavailable: " + "; ".join(errors))
    try:
        reader = pdf_reader(io.BytesIO(pdf_bytes), strict=False)
        if getattr(reader, "is_encrypted", False):
            try:
                unlocked = reader.decrypt("")
            except Exception:
                unlocked = 0
            if not unlocked:
                raise DatasheetError("Password-protected PDFs are not supported")
        page_count = len(reader.pages)
        if page_count < 1:
            raise DatasheetError("PDF contains no pages")
        if page_count > MAX_PDF_PAGES:
            raise DatasheetError(f"PDF contains more than {MAX_PDF_PAGES} pages")
        metadata = {str(key).lstrip("/"): _clean_text(value) for key, value in (reader.metadata or {}).items()}
        pages: list[dict] = []
        total = 0
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            if len(text) > MAX_PAGE_CHARACTERS:
                text = text[:MAX_PAGE_CHARACTERS]
            total += len(text)
            if total > MAX_EXTRACTED_CHARACTERS:
                raise DatasheetError("Extracted PDF text exceeds the safety limit")
            pages.append({"number": index + 1, "text": text, "tables": []})
    except DatasheetError:
        raise
    except Exception as exc:
        raise DatasheetError(f"PDF text extraction failed: {exc}") from exc

    engine = "pypdf"
    if pdfplumber is not None:
        engine = "pypdf + pdfplumber"
        text_table_settings = {
            "vertical_strategy": "text",
            "horizontal_strategy": "text",
            "intersection_tolerance": 5,
            "snap_tolerance": 3,
            "join_tolerance": 3,
            "min_words_vertical": 2,
            "min_words_horizontal": 1,
        }
        try:
            lowered_pages = [page["text"].lower() for page in pages]
            quick_start = next((index for index, text in enumerate(lowered_pages) if "register quick reference" in text), -1)
            description_start = next(
                (index for index, text in enumerate(lowered_pages) if index > quick_start and "register descriptions" in text),
                len(pages),
            )
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as document:
                for index, page in enumerate(document.pages):
                    page_text = lowered_pages[index]
                    relevant = any(
                        marker in page_text
                        for marker in (
                            "pin description",
                            "recommended operating conditions",
                            "absolute maximum",
                            "ordering information",
                        )
                    ) or (quick_start >= 0 and quick_start <= index < description_start)
                    if not relevant:
                        continue
                    tables = page.extract_tables() or []
                    if "pin description" in page_text:
                        has_pin_table = any(
                            isinstance(table, list)
                            and any(
                                isinstance(row, list)
                                and any("pin name" in _clean_text(cell).lower() for cell in row)
                                for row in table[:16]
                            )
                            for table in tables
                        )
                        if not has_pin_table:
                            tables.extend(page.extract_tables(text_table_settings) or [])
                    pages[index]["tables"] = tables[:24]
        except Exception as exc:
            metadata["TableExtractionWarning"] = _clean_text(exc)
    return pages, metadata, engine


def _all_text(pages: list[dict]) -> str:
    return "\n".join(page["text"] for page in pages)


def _part_number_candidates(text: str, filename: str, metadata: dict) -> list[str]:
    sources = [filename, metadata.get("Title", ""), text[:18_000]]
    candidates: list[str] = []
    pattern = re.compile(r"\b(?=[A-Z0-9-]{4,28}\b)(?=[A-Z0-9-]*\d)[A-Z]{1,10}[A-Z0-9]*(?:-[A-Z0-9]+)?\b")
    ignored = {"I2C", "I2S", "PCM", "DSD", "QFN", "WLCSP", "MCLK", "SCLK", "LRCK", "HPOUT"}
    for source in sources:
        for candidate in pattern.findall(str(source).upper()):
            candidate = candidate.strip("-")
            if candidate in ignored or candidate.startswith(("DS11", "DEC20", "SCLK", "LRCK", "SDIN", "HPOUT")):
                continue
            if candidate not in candidates:
                candidates.append(candidate)
    return candidates[:24]


def _detect_identity(pages: list[dict], filename: str, metadata: dict, hints: dict) -> dict:
    text = _all_text(pages)
    candidates = _part_number_candidates(text, filename, metadata)
    hinted_part = hints.get("partNumber", "").upper()
    if hinted_part:
        part_number = hinted_part
    else:
        filename_upper = filename.upper()
        title_upper = str(metadata.get("Title", "")).upper()
        part_number = next((value for value in candidates if value in filename_upper), "")
        if not part_number:
            part_number = next((value for value in candidates if value in title_upper), "")
        if not part_number and candidates:
            part_number = candidates[0]
    title = hints.get("title") or metadata.get("Title") or ""
    if not title:
        first_lines = [_clean_text(line) for line in pages[0]["text"].splitlines() if _clean_text(line)]
        title = next((line for line in first_lines if len(line) >= 12 and line.upper() != part_number), part_number)
    manufacturer = hints.get("manufacturer") or metadata.get("Author") or ""
    order_numbers: list[str] = []
    order_prefix = re.sub(r"[^A-Z0-9]", "", part_number.upper())
    for match in re.findall(r"\b[A-Z]{1,12}\d[A-Z0-9]*(?:-[A-Z0-9]+)+\b", text.upper()):
        if order_prefix and not re.sub(r"[^A-Z0-9]", "", match).startswith(order_prefix):
            continue
        if match not in order_numbers:
            order_numbers.append(match)
    return {
        "manufacturer": _clean_text(manufacturer),
        "partNumber": part_number,
        "title": _clean_text(title),
        "orderNumbers": order_numbers[:32],
        "candidates": candidates,
        "confidence": 0.98 if hinted_part else 0.94 if part_number else 0.25,
    }


def _detect_packages(text: str, hint: str = "") -> list[dict]:
    packages: list[dict] = []
    pattern = re.compile(
        r"(?P<count>\d{1,3})\s*[- ]\s*(?P<terminal>pin|ball|lead)?s?\s*(?P<kind>WLCSP|QFN|TQFP|LQFP|BGA|CSP|SOIC|SSOP|TSSOP|DFN|DIP)",
        re.IGNORECASE,
    )
    for match in pattern.finditer(text):
        kind = match.group("kind").upper()
        count = int(match.group("count"))
        if count < 8:
            continue
        key = (kind, count)
        if any((item["kind"], item["pinCount"]) == key for item in packages):
            continue
        packages.append({"kind": kind, "pinCount": count, "name": f"{count}-{kind}", "confidence": 0.92})
    if any(item["kind"] == "WLCSP" for item in packages):
        wlcsp_counts = {item["pinCount"] for item in packages if item["kind"] == "WLCSP"}
        packages = [item for item in packages if not (item["kind"] == "CSP" and item["pinCount"] in wlcsp_counts)]
    if hint:
        normalized = hint.upper()
        match = re.search(r"(\d{1,3}).*?(WLCSP|QFN|TQFP|LQFP|BGA|CSP|SOIC|SSOP|TSSOP|DFN|DIP)", normalized)
        if match:
            kind, count = match.group(2), int(match.group(1))
            packages = [item for item in packages if item["kind"] != kind or item["pinCount"] != count]
            packages.insert(0, {"kind": kind, "pinCount": count, "name": f"{count}-{kind}", "confidence": 1.0, "hinted": True})
    return packages[:24]


def _table_cell(row: list, index: int) -> str:
    return _clean_text(row[index]) if 0 <= index < len(row) else ""


def _pin_table_columns(table: list) -> dict | None:
    header_rows = table[:16]
    positions: dict[str, int] = {}
    for row in header_rows:
        if not isinstance(row, list):
            continue
        for index, cell in enumerate(row):
            normalized = _clean_text(cell).lower().replace(" ", "")
            if "pinname" in normalized:
                positions["name"] = index
            elif "pin#" in normalized or "pinnumber" in normalized:
                positions["number"] = index
            elif normalized == "ball" or "wlcspball" in normalized:
                positions["ball"] = index
            elif "supply" in normalized:
                positions["supply"] = index
    if "name" not in positions or "number" not in positions:
        return None
    return positions


def _extract_pins(pages: list[dict]) -> list[dict]:
    pins: list[dict] = []
    current: dict | None = None
    pin_name_pattern = re.compile(r"^[A-Z0-9_+\-–/]{1,32}$")
    pin_number_pattern = re.compile(r"^(?:\d{1,3}|—|-)$")
    ball_pattern = re.compile(r"^(?:[A-Z]{1,2}\d{1,2}(?:\s*,\s*[A-Z]{1,2}\d{1,2})*|—|-)$")
    for page in pages:
        if "pin description" not in page["text"].lower():
            continue
        for table in page.get("tables", []):
            if not isinstance(table, list):
                continue
            columns = _pin_table_columns(table)
            if not columns:
                continue
            for row in table:
                if not isinstance(row, list):
                    continue
                name = _table_cell(row, columns["name"]).replace(" ", "")
                number = _table_cell(row, columns["number"])
                ball = _table_cell(row, columns.get("ball", -1))
                supply_index = columns.get("supply", -1)
                supply = _table_cell(row, supply_index)
                direction = ""
                for index in range(max(0, supply_index), min(len(row), supply_index + 3)):
                    candidate = _table_cell(row, index).replace(" ", "").upper()
                    if candidate in {"I", "O", "I/O", "IO"}:
                        direction = "I/O" if candidate in {"I/O", "IO"} else candidate
                        break
                    if candidate.endswith("I/O"):
                        direction = "I/O"
                        supply = candidate[:-3].strip() or supply
                        break
                is_new = bool(
                    name
                    and pin_name_pattern.fullmatch(name)
                    and pin_number_pattern.fullmatch(number)
                    and (not ball or ball_pattern.fullmatch(ball))
                )
                if is_new:
                    if current:
                        pins.append(current)
                    description_start = max(supply_index + 2, columns["number"] + 3)
                    description = _clean_text(" ".join(_table_cell(row, index) for index in range(description_start, len(row))))
                    current = {
                        "name": name,
                        "aliases": [part for part in name.split("/") if part],
                        "qfnPin": number if number not in {"—", "-"} else "",
                        "wlcspBall": ball if ball not in {"—", "-"} else "",
                        "supply": supply,
                        "direction": direction,
                        "description": description,
                        "sourcePage": page["number"],
                        "confidence": 0.88 if direction else 0.76,
                    }
                elif current and name and pin_name_pattern.fullmatch(name) and not number:
                    current["name"] += name
                    current["aliases"] = [part for part in current["name"].split("/") if part]
                elif current:
                    continuation = _clean_text(" ".join(_table_cell(row, index) for index in range(max(0, supply_index + 2), len(row))))
                    if continuation:
                        current["description"] = _clean_text(current["description"] + " " + continuation)
            if current:
                pins.append(current)
                current = None
    unique: dict[tuple[str, str, str], dict] = {}
    for pin in pins:
        key = (pin["name"], pin["qfnPin"], pin["wlcspBall"])
        if key not in unique:
            unique[key] = pin
    return list(unique.values())[:MAX_PINS]


def _split_lines(value: object) -> list[str]:
    return [_clean_text(part) for part in str(value or "").splitlines() if _clean_text(part)]


def _extract_electrical(pages: list[dict]) -> dict:
    recommended: list[dict] = []
    absolute: list[dict] = []
    for page in pages:
        page_text = page["text"].lower()
        target = recommended if "recommended operating conditions" in page_text else absolute if "absolute maximum" in page_text else None
        if target is None:
            continue
        for table in page.get("tables", []):
            if not isinstance(table, list) or not table:
                continue
            header = [_clean_text(cell).lower() for cell in table[0]]
            try:
                symbol_index = next(index for index, value in enumerate(header) if "symbol" in value)
                minimum_index = next(index for index, value in enumerate(header) if "minimum" in value)
                maximum_index = next(index for index, value in enumerate(header) if "maximum" in value)
                units_index = next(index for index, value in enumerate(header) if "unit" in value)
            except StopIteration:
                continue
            for row in table[1:]:
                if not isinstance(row, list):
                    continue
                symbols = _split_lines(row[symbol_index] if symbol_index < len(row) else "")
                minimums = _split_lines(row[minimum_index] if minimum_index < len(row) else "")
                maximums = _split_lines(row[maximum_index] if maximum_index < len(row) else "")
                units = _split_lines(row[units_index] if units_index < len(row) else "")
                parameter = _clean_text(" / ".join(_table_cell(row, index) for index in range(symbol_index)))
                count = max(len(symbols), len(minimums), len(maximums), len(units), 1)
                for index in range(count):
                    symbol = symbols[index] if index < len(symbols) else symbols[-1] if len(symbols) == 1 else ""
                    minimum = minimums[index] if index < len(minimums) else minimums[-1] if len(minimums) == 1 else ""
                    maximum = maximums[index] if index < len(maximums) else maximums[-1] if len(maximums) == 1 else ""
                    unit = units[index] if index < len(units) else units[-1] if len(units) == 1 else ""
                    if not any((symbol, minimum, maximum)):
                        continue
                    target.append(
                        {
                            "parameter": parameter,
                            "symbol": symbol,
                            "minimum": minimum,
                            "maximum": maximum,
                            "unit": unit,
                            "sourcePage": page["number"],
                            "confidence": 0.9,
                        }
                    )
    return {"recommendedOperatingConditions": recommended[:256], "absoluteMaximumRatings": absolute[:256]}


def _detect_interfaces(pages: list[dict], hint: str = "") -> list[dict]:
    text = _all_text(pages)
    compact = re.sub(r"\s+", " ", text)
    interfaces: list[dict] = []
    has_i2c = bool(re.search(r"I\s*[²2]\s*C", text, re.IGNORECASE))
    if has_i2c:
        speed_khz = None
        speed_match = re.search(r"(?:I\s*[²2]\s*C.{0,180}?|SCL clock frequency.{0,80}?)(\d+(?:\.\d+)?)\s*(MHz|kHz)", compact, re.IGNORECASE)
        if speed_match:
            speed_khz = float(speed_match.group(1)) * (1000 if speed_match.group(2).lower() == "mhz" else 1)
        addresses: list[str] = []
        prefix_match = re.search(r"Addr\s*=\s*([01]{3,7})", text, re.IGNORECASE)
        suffix_match = re.search(r"Last Two Bits of I\s*[²2]\s*C Address", text, re.IGNORECASE)
        if prefix_match and suffix_match and len(prefix_match.group(1)) == 5:
            prefix = int(prefix_match.group(1), 2) << 2
            addresses = [f"0x{prefix + suffix:02X}" for suffix in range(4)]
        address_width = 24 if re.search(r"24-bit register address|24-bit register address space|3 bytes after the chip address", compact, re.IGNORECASE) else None
        data_width = 8 if re.search(r"8-bit data access|8-bit \(1 byte\)", compact, re.IGNORECASE) else None
        interfaces.append(
            {
                "kind": "I2C",
                "maximumClockKHz": speed_khz,
                "addresses7Bit": addresses,
                "registerAddressWidthBits": address_width,
                "dataWidthBits": data_width,
                "confidence": 0.95 if addresses else 0.86,
            }
        )
    if re.search(r"\bSPI\b", text, re.IGNORECASE):
        interfaces.append({"kind": "SPI", "confidence": 0.66})
    if re.search(r"\bI\s*[²2]\s*S\b|serial audio input|audio serial port", text, re.IGNORECASE):
        interfaces.append({"kind": "I2S", "confidence": 0.9})
    if re.search(r"\bUART\b|\bUSART\b", text, re.IGNORECASE):
        interfaces.append({"kind": "UART", "confidence": 0.78})
    if hint:
        hinted = hint.upper().replace("²", "2")
        if not any(item["kind"] == hinted for item in interfaces):
            interfaces.insert(0, {"kind": hinted, "confidence": 1.0, "hinted": True})
    return interfaces[:16]


def _normalize_address(value: str) -> tuple[str, str]:
    cleaned = value.replace("\n", " ")
    cleaned = re.sub(r"p\.\s*\d+", "", cleaned, flags=re.IGNORECASE)
    matches = re.findall(r"0x\s*([0-9A-Fa-f ]{2,12})", cleaned)
    normalized = ["0x" + re.sub(r"\s+", "", item).upper() for item in matches]
    if not normalized:
        return "", ""
    return normalized[0], normalized[1] if len(normalized) > 1 else ""


def _extract_registers(pages: list[dict]) -> dict:
    registers: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for page in pages:
        for table in page.get("tables", []):
            if not isinstance(table, list) or len(table) < 2 or not isinstance(table[0], list):
                continue
            header = [_clean_text(cell).lower() for cell in table[0]]
            if not header or "address" not in header[0] or len(header) < 2 or "function" not in header[1]:
                continue
            for row in table[1:]:
                if not isinstance(row, list) or len(row) < 2:
                    continue
                address, end_address = _normalize_address(str(row[0] or ""))
                name = _clean_text(row[1])
                if not address or not name or "reserved" in name.lower():
                    continue
                fields: list[str] = []
                for cell in row[2:]:
                    lines = _split_lines(cell)
                    if not lines:
                        continue
                    field = re.sub(r"(?:\s+[01xX])+$", "", lines[0]).strip()
                    if field and field not in {"—", "-"} and field not in fields:
                        fields.append(field)
                key = (address, name)
                if key in seen:
                    continue
                seen.add(key)
                register = {
                    "address": address,
                    "name": name,
                    "fields": fields[:16],
                    "sourcePage": page["number"],
                    "confidence": 0.91,
                }
                if end_address:
                    register["endAddress"] = end_address
                if "read only" in name.lower():
                    register["access"] = "R"
                registers.append(register)
                if len(registers) >= MAX_REGISTERS:
                    break
    text = _all_text(pages)
    address_width = 24 if re.search(r"24-bit register address|24-bit register address space", text, re.IGNORECASE) else None
    data_width = 8 if re.search(r"8-bit data access|8-bit \(1 byte\)", text, re.IGNORECASE) else None
    return {
        "addressWidthBits": address_width,
        "dataWidthBits": data_width,
        "count": len(registers),
        "registers": registers,
    }


def _driver_stem(part_number: str) -> str:
    stem = re.sub(r"[^a-z0-9]+", "_", part_number.lower()).strip("_")
    return stem or "datasheet_device"


def _pin_mapping_coverage(pins: list[dict], packages: list[dict]) -> tuple[float, list[str]]:
    if not packages:
        return (0.75 if pins else 0.2), []
    coverage_values: list[float] = []
    unresolved: list[str] = []
    for package in packages:
        expected = int(package.get("pinCount") or 0)
        if expected <= 0:
            continue
        field = "wlcspBall" if package.get("kind") in {"WLCSP", "CSP", "BGA"} else "qfnPin"
        positions: set[str] = set()
        for pin in pins:
            for position in re.split(r"\s*,\s*", _clean_text(pin.get(field))):
                if position:
                    positions.add(position.upper())
        coverage = min(1.0, len(positions) / expected)
        coverage_values.append(coverage)
        if len(positions) < expected:
            unresolved.append(f"pinMapping:{package.get('name')}:{len(positions)}/{expected}")
    return (min(coverage_values) if coverage_values else 0.2), unresolved


def build_datasheet_draft(
    pages: list[dict],
    *,
    filename: str = "datasheet.pdf",
    metadata: dict | None = None,
    hints: dict | None = None,
    source_sha256: str = "",
    parser_engine: str = "structured-text",
) -> dict:
    normalized_pages = _normalize_pages(pages)
    safe_filename = _safe_filename(filename)
    metadata = {str(key): _clean_text(value) for key, value in (metadata or {}).items()}
    hints = _bounded_hints(hints)
    text = _all_text(normalized_pages)
    identity = _detect_identity(normalized_pages, safe_filename, metadata, hints)
    packages = _detect_packages(text, hints.get("package", ""))
    pins = _extract_pins(normalized_pages)
    electrical = _extract_electrical(normalized_pages)
    interfaces = _detect_interfaces(normalized_pages, hints.get("interface", ""))
    register_map = _extract_registers(normalized_pages)
    pin_coverage, pin_unresolved = _pin_mapping_coverage(pins, packages)
    confidence = {
        "documentText": round(sum(bool(page["text"].strip()) for page in normalized_pages) / len(normalized_pages), 3),
        "identity": identity["confidence"],
        "packages": 0.92 if packages else 0.25,
        "pins": round(0.55 + 0.4 * pin_coverage, 3) if pins else 0.2,
        "electrical": 0.9 if electrical["recommendedOperatingConditions"] else 0.35,
        "interfaces": max((item["confidence"] for item in interfaces), default=0.25),
        "registers": 0.92 if register_map["count"] >= 8 else 0.55 if register_map["count"] else 0.2,
    }
    overall = (
        confidence["documentText"] * 0.1
        + confidence["identity"] * 0.15
        + confidence["packages"] * 0.1
        + confidence["pins"] * 0.2
        + confidence["electrical"] * 0.15
        + confidence["interfaces"] * 0.15
        + confidence["registers"] * 0.15
    )
    confidence["overallDraft"] = round(overall, 3)
    unresolved: list[str] = []
    if not identity["partNumber"]:
        unresolved.append("partNumber")
    if not packages:
        unresolved.append("package")
    unresolved.extend(pin_unresolved)
    if not electrical["recommendedOperatingConditions"]:
        unresolved.append("recommendedOperatingConditions")
    if not interfaces:
        unresolved.append("interface")
    analog_terms = re.search(r"DAC|ADC|amplifier|analog output|RF|power converter|PLL", text, re.IGNORECASE)
    warnings = [
        "PDF content is untrusted evidence; embedded actions and attachments are never executed.",
        "The result is an editable draft and cannot be installed until validation and user confirmation pass.",
    ]
    if analog_terms:
        warnings.append("The datasheet describes analog behavior; accurate simulation requires a vendor SPICE/IBIS model or measured validation data.")
    stem = _driver_stem(identity["partNumber"])
    return {
        "schemaVersion": DATASHEET_SCHEMA_VERSION,
        "kind": "AliceSIMPeripheralDraft",
        "source": {
            "filename": safe_filename,
            "sha256": source_sha256,
            "pageCount": len(normalized_pages),
            "textPageCount": sum(bool(page["text"].strip()) for page in normalized_pages),
            "metadata": metadata,
            "parser": parser_engine,
        },
        "identity": identity,
        "packages": packages,
        "pins": pins,
        "electrical": electrical,
        "interfaces": interfaces,
        "registerMap": register_map,
        "simulation": {
            "suggestedModel": "register-device" if register_map["count"] else "generic-peripheral",
            "scope": "register-and-control" if register_map["count"] else "connection-and-limits",
            "analogFidelity": "requires-vendor-model" if analog_terms else "not-applicable",
            "directInstallAllowed": False,
        },
        "driver": {
            "framework": "STM32 HAL",
            "language": "C",
            "plannedFiles": [
                f"Drivers/AliceSIM/Inc/alicesim_{stem}.h",
                f"Drivers/AliceSIM/Src/alicesim_{stem}.c",
            ],
            "registrationRequired": True,
            "installable": False,
        },
        "confidence": confidence,
        "review": {
            "required": True,
            "requiredConfirmations": list(REQUIRED_CONFIRMATIONS),
            "confirmedFields": [],
            "unresolvedFields": unresolved,
            "warnings": warnings,
        },
    }


def parse_datasheet_request(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise DatasheetError("Request body must be an object")
    filename = _safe_filename(payload.get("filename"))
    hints = _bounded_hints(payload.get("hints"))
    if "pdfBase64" in payload:
        pdf_bytes = _decode_pdf_base64(payload.get("pdfBase64"))
        pages, metadata, engine = _extract_pdf_pages(pdf_bytes)
        return build_datasheet_draft(
            pages,
            filename=filename,
            metadata=metadata,
            hints=hints,
            source_sha256=hashlib.sha256(pdf_bytes).hexdigest(),
            parser_engine=engine,
        )
    raw_pages = payload.get("pages", payload.get("text"))
    pages = _normalize_pages(raw_pages)
    return build_datasheet_draft(
        pages,
        filename=filename,
        metadata=payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
        hints=hints,
        parser_engine="structured-text",
    )


def validate_datasheet_draft(payload: object) -> dict:
    draft = payload.get("draft") if isinstance(payload, dict) and "draft" in payload else payload
    if not isinstance(draft, dict):
        raise DatasheetError("draft must be an object")
    errors: list[dict] = []
    warnings: list[dict] = []

    def error(path: str, message: str) -> None:
        errors.append({"path": path, "message": message})

    if draft.get("kind") != "AliceSIMPeripheralDraft":
        error("kind", "Expected AliceSIMPeripheralDraft")
    if draft.get("schemaVersion") != DATASHEET_SCHEMA_VERSION:
        error("schemaVersion", f"Expected schema version {DATASHEET_SCHEMA_VERSION}")
    identity = draft.get("identity")
    part_number = _clean_text(identity.get("partNumber")) if isinstance(identity, dict) else ""
    if not part_number:
        error("identity.partNumber", "Part number must be confirmed")
    elif len(part_number) > 80:
        error("identity.partNumber", "Part number is too long")
    packages = draft.get("packages")
    if not isinstance(packages, list) or not packages:
        error("packages", "At least one package must be confirmed")
    elif len(packages) > MAX_PACKAGES:
        error("packages", f"No more than {MAX_PACKAGES} packages are allowed")
    pins = draft.get("pins")
    if not isinstance(pins, list) or not pins:
        error("pins", "At least one pin is required")
    elif len(pins) > MAX_PINS:
        error("pins", f"No more than {MAX_PINS} pins are allowed")
    else:
        seen: set[tuple[str, str, str]] = set()
        for index, pin in enumerate(pins):
            if not isinstance(pin, dict):
                error(f"pins[{index}]", "Pin must be an object")
                continue
            name = _clean_text(pin.get("name"))
            if not name:
                error(f"pins[{index}].name", "Pin name is required")
            elif len(name) > 64:
                error(f"pins[{index}].name", "Pin name is too long")
            key = (name.casefold(), _clean_text(pin.get("qfnPin")).casefold(), _clean_text(pin.get("wlcspBall")).casefold())
            if key in seen:
                error(f"pins[{index}]", "Duplicate pin mapping")
            seen.add(key)
            if _clean_text(pin.get("direction")) not in {"I", "O", "I/O", "POWER", "GROUND", "PASSIVE", ""}:
                error(f"pins[{index}].direction", "Unsupported pin direction")
    register_map = draft.get("registerMap")
    if isinstance(register_map, dict):
        registers = register_map.get("registers", [])
        if not isinstance(registers, list) or len(registers) > MAX_REGISTERS:
            error("registerMap.registers", f"Register list must contain at most {MAX_REGISTERS} entries")
        else:
            seen_addresses: set[tuple[str, str]] = set()
            for index, register in enumerate(registers):
                if not isinstance(register, dict):
                    error(f"registerMap.registers[{index}]", "Register must be an object")
                    continue
                address = _clean_text(register.get("address")).upper()
                name = _clean_text(register.get("name"))
                if not re.fullmatch(r"0X[0-9A-F]{1,8}", address):
                    error(f"registerMap.registers[{index}].address", "Register address must be hexadecimal")
                key = (address, name.casefold())
                if key in seen_addresses:
                    error(f"registerMap.registers[{index}]", "Duplicate register entry")
                seen_addresses.add(key)
    interfaces = draft.get("interfaces")
    if not isinstance(interfaces, list) or not interfaces:
        error("interfaces", "At least one interface must be confirmed")
    elif len(interfaces) > MAX_INTERFACES:
        error("interfaces", f"No more than {MAX_INTERFACES} interfaces are allowed")
    simulation = draft.get("simulation")
    if not isinstance(simulation, dict) or not _clean_text(simulation.get("scope")):
        error("simulation.scope", "Simulation scope must be confirmed")
    elif simulation.get("directInstallAllowed") is not False:
        error("simulation.directInstallAllowed", "Datasheet drafts cannot directly install components")
    driver = draft.get("driver")
    if isinstance(driver, dict) and driver.get("installable") is not False:
        error("driver.installable", "Driver remains non-installable until generation and tests finish")
    review = draft.get("review")
    unresolved = review.get("unresolvedFields", []) if isinstance(review, dict) else []
    provided_required_confirmations = review.get("requiredConfirmations", []) if isinstance(review, dict) else []
    confirmed_fields = review.get("confirmedFields", []) if isinstance(review, dict) else []
    if provided_required_confirmations != list(REQUIRED_CONFIRMATIONS):
        error("review.requiredConfirmations", "Required confirmations are server-controlled and cannot be changed")
    if not isinstance(confirmed_fields, list) or not all(isinstance(item, str) for item in confirmed_fields):
        error("review.confirmedFields", "Confirmed fields must be a list of field paths")
        confirmed_fields = []
    missing_confirmations = [item for item in REQUIRED_CONFIRMATIONS if item not in confirmed_fields]
    if unresolved:
        warnings.append({"path": "review.unresolvedFields", "message": "Manual confirmation is still required", "fields": unresolved})
    if missing_confirmations:
        warnings.append(
            {
                "path": "review.confirmedFields",
                "message": "User confirmation is required before driver generation or installation",
                "fields": missing_confirmations,
            }
        )
    installable = not errors and not unresolved and not missing_confirmations
    return {
        "ok": not errors,
        "installable": installable,
        "errors": errors,
        "warnings": warnings,
        "nextAction": "generate-driver-and-run-tests" if installable else "review-draft",
    }
