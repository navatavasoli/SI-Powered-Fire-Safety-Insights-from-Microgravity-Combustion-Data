# PSI combustion inventory (snapshot 2026-11-14)

Source: live JSON API behind psi.nasa.gov (see `ingest/psi_client.py`).
PSI lists 133 investigations; 24 are tagged Combustion Science, about 13.5 TB in total.
All but one declare CC0-1.0 (PSI-10 has no licence field set).

| Accession | Acronym | Size (GB) | Test-matrix CSV (bytes) | Pubs | Hardware |
|---|---|---:|---:|---:|---|
| PSI-26 | BASS | 163.6 | 4,726 | 10 | MSG |
| PSI-25 | BASS-II | 274.6 | 16,590 | 17 | MSG |
| PSI-98 | SAFFIRE-I | 12.3 | 469 | 6 | Cygnus enclosure |
| PSI-99 | SAFFIRE-II | 16.9 | 1,973 | 7 | Cygnus enclosure |
| PSI-100 | SAFFIRE-III | 35.2 | 239 | 3 | Cygnus enclosure |
| PSI-102 | SAME | 0.7 | 331 | 16 | Comparative Soot Diagnostic |
| PSI-101 | SAME-R | 6.3 | 5,674 | 6 | Comparative Soot Diagnostic |
| PSI-47 | DAFT / DAFT-2 | <0.1 | 518 | 2 | TSI P-Trak |
| PSI-69 | FLEX | 923.8 | 24,776 | 51 | CIR + MDCA |
| PSI-68 | FLEX-2 | 1,224.8 | 1,029 | 48 | CIR + MDCA |
| PSI-39 | CFI | 718.9 | 7,792 | 7 | CIR + MDCA |
| PSI-159 | ACME CFI-G | 2,085.6 | 22,166 + 39,422 | 2 | CIR + ACME |
| PSI-20 | ACME BRE | 2,035.6 | 1,113 | 16 | CIR + ACME |
| PSI-21 | ACME CLD Flame | 2,005.5 | 2,454 | 18 | CIR + ACME |
| PSI-22 | ACME E-FIELD Flames | 950.2 | 2,475 | 25 | CIR + ACME |
| PSI-23 | ACME s-Flame | 782.2 | 2,456 | 44 | CIR + ACME |
| PSI-10 | ACME Flame Design | 2,180.4 | 26,933 + 17,314 | 33 | CIR + ACME |
| PSI-107 | SPICE | 6.9 | 31,205 | 9 | MSG |
| PSI-106 | SLICE | 72.9 | 734 | 5 | (blank; MSG per challenge brief) |
| PSI-60 | (ground) SPICE analysis | <0.1 | none | 1 | n/a |
| PSI-62 | (ground) flame-spread modelling | <0.1 | none | 4 | n/a |
| PSI-115 | (ground) SAME data utilisation | 0.3 | none | 0 | n/a |
| PSI-117 | (ground) cool-flame CFD | 0.1 | none | 10 | n/a |
| PSI-142 | (ground) cool-flame transitions | <0.1 | 727 | 12 | PI lab hardware |

## What each record gives us
- Free text: objective, approach, hypothesis, research impacts (RAG corpus).
- Structured: DOI, licence, hardware, platform, dates, related investigations, total size.
- `experimentalTable`: small CSV test matrices (fuel, concentration, polarity, test day...).
  These are the basis for the "extract data for predictive modelling" feature.
- `publications`: title + author list; DOI is often blank, so links need a lookup step.
- `images`: representative images for only 5 of 24 investigations.

## Known gaps
- Test-matrix CSVs are hand-made: free-text notes columns, continuation rows, and a
  different column set per investigation. Each needs its own normaliser.
- Granularity varies: E-FIELD's table is per test day, not per flame.
- No file-tree listing endpoint found yet for the bulk data (video, sensor logs).
  Needed before the flame visualiser can be calibrated against measurements.
- The public S3 bucket `nasa-psi` holds only DSI, OASIS and pk4: no combustion data.
