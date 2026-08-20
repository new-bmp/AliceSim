"""Optional PySpice/NGSpice DC validation for AliceSIM circuit files."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any


SPICE_AVAILABLE = False
SPICE_ERROR = ""

try:
    from PySpice.Spice.Netlist import Circuit
    from PySpice.Unit import u_Ohm, u_V

    SPICE_AVAILABLE = True
except Exception as exc:  # Optional dependency; the browser solver remains usable.
    SPICE_ERROR = str(exc)


def spice_status() -> dict[str, Any]:
    dll_path = Path(__file__).resolve().parent / ".vendor" / "PySpice" / "Spice" / "NgSpice" / "Spice64_dll" / "dll-vs" / "ngspice.dll"
    return {
        "available": SPICE_AVAILABLE and dll_path.exists(),
        "engine": "PySpice 1.5 + NGSpice 34" if SPICE_AVAILABLE and dll_path.exists() else "unavailable",
        "detail": SPICE_ERROR or ("" if dll_path.exists() else "ngspice.dll is not installed"),
    }


def _endpoint_key(endpoint: dict[str, Any]) -> str:
    return f"{endpoint.get('componentId', '')}:{endpoint.get('pin', '')}"


def _parse_resistance(value: Any) -> float | None:
    text = str(value or "").strip().upper().replace("Ω", "R").replace("OHMS", "R").replace("OHM", "R")
    text = re.sub(r"\s+", "", text)
    if not text or any(marker in text for marker in ("DNP", "OPEN", "NC")):
        return None
    embedded = re.fullmatch(r"(\d+)([RKM])(\d+)", text)
    if embedded:
        scale = {"R": 1.0, "K": 1_000.0, "M": 1_000_000.0}[embedded.group(2)]
        return float(f"{embedded.group(1)}.{embedded.group(3)}") * scale
    match = re.match(r"(\d*\.?\d+)([RKM]?)", text)
    if not match:
        return None
    scale = {"": 1.0, "R": 1.0, "K": 1_000.0, "M": 1_000_000.0}[match.group(2)]
    resistance = float(match.group(1)) * scale
    return resistance if math.isfinite(resistance) and resistance >= 0 else None


def _parse_voltage(value: Any, default: float = 3.3) -> float:
    text = str(value or "").strip().upper().replace(" ", "")
    embedded = re.fullmatch(r"([+-]?\d+)V(\d+)", text)
    if embedded:
        voltage = float(f"{embedded.group(1)}.{embedded.group(2)}")
        return voltage if math.isfinite(voltage) else default
    match = re.search(r"[-+]?\d*\.?\d+", text)
    voltage = float(match.group(0)) if match else default
    return voltage if math.isfinite(voltage) else default


def _scalar(vector: Any) -> float:
    return float(vector.as_ndarray().reshape(-1)[0])


def solve_circuit(circuit_payload: dict[str, Any]) -> dict[str, Any]:
    status = spice_status()
    if not status["available"]:
        raise RuntimeError(status["detail"] or "PySpice is unavailable")
    if not isinstance(circuit_payload, dict):
        raise ValueError("circuit must be an object")
    components = circuit_payload.get("components")
    wires = circuit_payload.get("wires")
    if not isinstance(components, list) or not isinstance(wires, list):
        raise ValueError("circuit components and wires must be arrays")

    component_by_id = {
        str(component.get("id")): component
        for component in components
        if isinstance(component, dict) and component.get("id")
    }
    parents: dict[str, str] = {}

    def ensure(key: str) -> str:
        parents.setdefault(key, key)
        return key

    def find(key: str) -> str:
        ensure(key)
        parent = parents[key]
        if parent != key:
            parents[key] = find(parent)
        return parents[key]

    def union(left: str, right: str) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    for wire in wires:
        if not isinstance(wire, dict) or not isinstance(wire.get("from"), dict) or not isinstance(wire.get("to"), dict):
            continue
        union(_endpoint_key(wire["from"]), _endpoint_key(wire["to"]))

    terminal_roots: dict[str, str] = {}
    ground_keys: list[str] = []
    for component in component_by_id.values():
        component_id = str(component["id"])
        component_type = str(component.get("type") or "")
        if component_type == "netTerminal":
            label = re.sub(r"\s+", "_", str(component.get("value") or "").strip()).upper()
            key = ensure(f"{component_id}:NET")
            if label and label in terminal_roots:
                union(terminal_roots[label], key)
            elif label:
                terminal_roots[label] = key
        elif component_type == "ground":
            ground_keys.append(ensure(f"{component_id}:GND"))
        elif component_type == "resistor":
            resistance = _parse_resistance(component.get("value"))
            if resistance is not None and resistance <= 1e-12:
                union(ensure(f"{component_id}:1"), ensure(f"{component_id}:2"))

    if not ground_keys:
        raise ValueError("PySpice DC analysis requires at least one ground component")
    for ground_key in ground_keys[1:]:
        union(ground_keys[0], ground_key)
    ground_root = find(ground_keys[0])

    all_roots = {find(key) for key in parents}
    node_names: dict[str, str] = {}
    node_index = 1
    for root in sorted(all_roots):
        if root == ground_root:
            continue
        node_names[root] = f"n{node_index}"
        node_index += 1

    def node_for(key: str) -> str:
        root = find(key)
        return "0" if root == ground_root else node_names.setdefault(root, f"n{len(node_names) + 1}")

    circuit = Circuit("AliceSIM PySpice DC validation")
    warnings: list[str] = []
    supply_by_node: dict[str, float] = {}
    current_sources: dict[str, str] = {}
    voltage_nodes: dict[str, str] = {}
    resistor_number = 0
    supply_number = 0
    probe_number = 0
    converter_number = 0

    for component in component_by_id.values():
        component_id = str(component["id"])
        component_type = str(component.get("type") or "")
        if component_type == "resistor":
            resistance = _parse_resistance(component.get("value"))
            if resistance is None or resistance <= 1e-12:
                continue
            left = node_for(f"{component_id}:1")
            right = node_for(f"{component_id}:2")
            if left == right:
                continue
            resistor_number += 1
            circuit.R(f"load{resistor_number}", left, right, resistance @ u_Ohm)
        elif component_type == "vcc":
            node = node_for(f"{component_id}:VCC")
            voltage = _parse_voltage(component.get("value"), 3.3)
            if node == "0":
                raise ValueError(f"Supply {component_id} is shorted to ground")
            if node in supply_by_node:
                if abs(supply_by_node[node] - voltage) > 0.001:
                    raise ValueError(f"Conflicting supplies on {node}")
                continue
            supply_by_node[node] = voltage
            supply_number += 1
            circuit.V(f"supply{supply_number}", node, circuit.gnd, voltage @ u_V)
        elif component_type == "dcDcConverter":
            properties = component.get("peripheralProperties") if isinstance(component.get("peripheralProperties"), dict) else {}
            enabled = float(properties.get("enabled", 1) or 0) != 0
            output_voltage = float(properties.get("outputVoltageV", 5) or 5)
            if not enabled or not math.isfinite(output_voltage) or output_voltage <= 0:
                continue
            output_node = node_for(f"{component_id}:VOUT")
            ground_node = node_for(f"{component_id}:GND")
            if output_node == ground_node:
                raise ValueError(f"DC-DC converter {component_id} output is shorted to ground")
            converter_number += 1
            circuit.V(f"converter{converter_number}", output_node, ground_node, output_voltage @ u_V)
        elif component_type == "currentProbe":
            input_node = node_for(f"{component_id}:IN")
            output_node = node_for(f"{component_id}:OUT")
            if input_node == output_node:
                warnings.append(f"{component_id}: probe is bypassed")
                continue
            probe_number += 1
            source_name = f"probe{probe_number}"
            circuit.V(source_name, input_node, output_node, 0 @ u_V)
            current_sources[component_id] = f"v{source_name}".lower()
        elif component_type == "voltageProbe":
            voltage_nodes[component_id] = node_for(f"{component_id}:TIP")

    if not supply_by_node:
        raise ValueError("PySpice DC analysis requires at least one voltage source")

    analysis = circuit.simulator(temperature=25, nominal_temperature=25).operating_point()
    voltage_probes: dict[str, dict[str, Any]] = {}
    current_probes: dict[str, dict[str, Any]] = {}
    for component_id, node in voltage_nodes.items():
        voltage = 0.0 if node == "0" else _scalar(analysis[node])
        voltage_probes[component_id] = {"value": voltage, "text": f"{voltage:.3f} V"}
    for component_id, branch in current_sources.items():
        current = _scalar(analysis.branches[branch])
        magnitude = abs(current)
        text = f"{current:.3f} A" if magnitude >= 1 else (f"{current * 1000:.2f} mA" if magnitude >= 0.001 else f"{current * 1_000_000:.1f} µA")
        current_probes[component_id] = {"value": current, "text": text}

    return {
        "ok": True,
        "engine": status["engine"],
        "analysis": "operating-point",
        "voltageProbes": voltage_probes,
        "currentProbes": current_probes,
        "warnings": warnings,
        "netlist": str(circuit),
    }
