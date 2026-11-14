"""Offline test: a fake client shaped like the real PSI responses."""
import json

from ingest.fetch_combustion import run


class FakeClient:
    def search_investigations(self, size=500):
        return [
            {"Accession": "PSI-22", "Research Area": "Combustion Science"},
            {"Accession": "PSI-5", "Research Area": "Fluid Physics"},
        ]

    def investigation(self, acc):
        return {
            "accession": acc, "investigationAcronym": "ACME E-FIELD Flames", "title": "T",
            "doi": "10.60555/se5a-8c73", "licenseIdentifier": "CC0-1.0",
            "projectType": "Microgravity Investigation", "related_glds": "PSI-23",
            "totalFileSize": 950212491107,
            "experimentalTable": [
                {"file_name": "t.csv", "file_size": 2475, "restricted": False},
                {"file_name": "big.csv", "file_size": 10**9, "restricted": False},
            ],
            "images": [], "publications": [{"title": "P", "authorList": "A", "doi": ""}],
        }

    def download_file(self, acc, name):
        return b"Test Type,Test Day\r\n"


def test_run(tmp_path):
    cat = run(tmp_path, 5_000_000, FakeClient())
    assert [r["accession"] for r in cat] == ["PSI-22"]
    assert cat[0]["related"] == ["PSI-23"] and cat[0]["publications"][0]["doi"] is None
    assert (tmp_path / "raw/tables/PSI-22/t.csv").exists()
    assert not (tmp_path / "raw/tables/PSI-22/big.csv").exists()
    assert json.loads((tmp_path / "catalog.json").read_text())[0]["total_bytes"] == 950212491107
