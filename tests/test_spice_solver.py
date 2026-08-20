import unittest

import spice_solver


@unittest.skipUnless(spice_solver.spice_status()["available"], "PySpice/NGSpice is not installed")
class SpiceSolverTests(unittest.TestCase):
    def test_dc_probe_values_match_the_circuit(self):
        payload = {
            "components": [
                {"id": "supply", "type": "vcc", "value": "+3V3"},
                {"id": "ground", "type": "ground", "value": "0V"},
                {"id": "current", "type": "currentProbe", "value": "— A"},
                {"id": "voltage", "type": "voltageProbe", "value": "— V"},
                {"id": "load", "type": "resistor", "value": "330 Ω"},
            ],
            "wires": [
                {"from": {"componentId": "supply", "pin": "VCC"}, "to": {"componentId": "current", "pin": "IN"}},
                {"from": {"componentId": "current", "pin": "OUT"}, "to": {"componentId": "load", "pin": "1"}},
                {"from": {"componentId": "load", "pin": "2"}, "to": {"componentId": "ground", "pin": "GND"}},
                {"from": {"componentId": "voltage", "pin": "TIP"}, "to": {"componentId": "current", "pin": "OUT"}},
            ],
        }
        result = spice_solver.solve_circuit(payload)
        self.assertEqual(result["engine"], "PySpice 1.5 + NGSpice 34")
        self.assertAlmostEqual(result["voltageProbes"]["voltage"]["value"], 3.3, places=8)
        self.assertAlmostEqual(result["currentProbes"]["current"]["value"], 0.01, places=8)
        self.assertEqual(result["currentProbes"]["current"]["text"], "10.00 mA")

    def test_dc_dc_converter_creates_a_real_output_rail(self):
        payload = {
            "components": [
                {"id": "input", "type": "vcc", "value": "+12V"},
                {"id": "ground", "type": "ground", "value": "0V"},
                {"id": "converter", "type": "dcDcConverter", "peripheralProperties": {"enabled": 1, "outputVoltageV": 5}},
                {"id": "probe", "type": "voltageProbe", "value": "— V"},
                {"id": "load", "type": "resistor", "value": "10 Ω"},
            ],
            "wires": [
                {"from": {"componentId": "input", "pin": "VCC"}, "to": {"componentId": "converter", "pin": "VIN"}},
                {"from": {"componentId": "ground", "pin": "GND"}, "to": {"componentId": "converter", "pin": "GND"}},
                {"from": {"componentId": "converter", "pin": "VOUT"}, "to": {"componentId": "load", "pin": "1"}},
                {"from": {"componentId": "converter", "pin": "VOUT"}, "to": {"componentId": "probe", "pin": "TIP"}},
                {"from": {"componentId": "load", "pin": "2"}, "to": {"componentId": "ground", "pin": "GND"}},
            ],
        }
        result = spice_solver.solve_circuit(payload)
        self.assertAlmostEqual(result["voltageProbes"]["probe"]["value"], 5.0, places=8)


if __name__ == "__main__":
    unittest.main()
