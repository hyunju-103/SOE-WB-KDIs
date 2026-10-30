# Changes — 2026-10-30 (meeting: beta version for the training)

Rebuild: `python report.py --training --allow-download --out SOE-Fiscal-Risk-Final.html`.
All checks in `tests/` pass (including `check_engine_parity.py` and `check_snapshot_sync.py`).
No model formula, calibration or default value changed. The site address stays the same.

| Meeting point | Change |
|---|---|
| Header | "SOE FISCAL RISK TOOL" above the title in bright sky blue (`templates/app.css`, `.band .eyebrow`). |
| Home | Title "About this tool" (no "..."). The practice strip now offers **⬇ Excel data (.xlsx)** and **⬇ Workbook (Word)** instead of Excel + CSV. The Word file is `training_material/WB_KDIS_SOE_Training_Workbook.docx`, embedded by `report.py`. Footer link to Report removed; the four question cards and "What the tool calculates" follow the new tab order. |
| KPI Dashboard | "Effective tax rate" taken off the Fiscal dependency dropdown (`config.KPI_CATEGORIES`); alert counts now cover only the ratios on the menu (15, `availableKpis` / `available_kpis`). "Reported vs tariff-compensation-adjusted EBIT margin" chart hidden (no PSO / compensation work yet; `showSupportKPI` kept, not wired). |
| Distress Indicator | The top boxes follow the SOE chosen below: in distress or not, distress score (with its median over the selected years), shadow credit rating, probability of default. Portfolio view shows the same four for the portfolio. |
| Expected Fiscal Cost | EFC results table moved up under the two charts; Z-EM, Rating, EAD basis, LGD and EFC (FCFA) columns removed (SOE, Zone, PD, EAD, EFC / GDP, Share). LGD calibration reference folded at the bottom. The "Guaranteed debt" EAD switch removed: EAD is a share of total liabilities. |
| Shock Scenarios | Moved to the last tab. Distress score path and Expected fiscal cost path on top; "How the shock travels" folded under them; "Show costs as a share of GDP" shown directly. Removed: "Distress score / Expected fiscal cost: what moved it", "Cash, State compensation and payment priority", "Background data: year-by-year tables and downloads", "Payment-priority scenarios and sensitivity (Senegal case)". Monte Carlo, portfolio macro shock and model check unchanged. |
| Report | Tab and page removed (participants work from the tabs, not from a generated report). |
| Early Warning / DSA-DSF | Every DSA/DSF mention removed from the page text (Early Warning intro, standard-stress note, How it works, glossary, size note, parameter-register sources). |
| How it works | Website overview: six stops in the new order, no Report; chapter 11 is Early warning only. |

Training workbook (`training_material/WB_KDIS_SOE_Training_Workbook.docx`): 16 → 5 pages. The reviewer's tracked deletions are applied;
no hand calculation and no Excel reading (data tables and formula tables removed); KPI module asks for at most three KPIs per category;
distress module reads the four new boxes and asks whether the KPIs and the score agree; EFC module records EFC / GDP only (LGD and
guaranteed-debt sensitivities removed); new Early Warning module; shock module uses a +60% fuel shock with the two path charts and one
tariff pass-through question (0% vs 100%); an executive summary replaces the summary and debrief tables. Screenshots taken from this build.
