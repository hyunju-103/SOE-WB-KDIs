# Changes — 2026-10-28 (WB-KDIs training version)

Rebuild: `python report.py --training --allow-download --out SOE-Fiscal-Risk-Final.html`.
Rewrite the practice files: `python training_data.py` (writes `sample_data/`).
All checks in `tests/` pass, including the new `check_training_data.py` and `check_snapshot_sync.py`.
No model formula, calibration or default value changed.

## 1. Title

The tool is now called **WB-KDIs Training : SOE Fiscal Risk** (`config.REPORT_TITLE`): the browser tab, the header of the
HTML page, the Streamlit page title (`Home.py`, `classic.py`) and the classic Home header.

## 2. Training dataset: 8 SOEs × 10 years, every column filled

New module `training_data.py`. Eight invented SOEs (SOE A–H, 7 sectors), fiscal years 2015–2024, FCFA, absolute units.
The page now opens on this dataset, and it is also a built-in choice (**Training data**) next to Example, Demo portfolio and
Long panel.

Why: with the previous demo (5 years, required columns plus a few exposures) several panels had nothing to draw:
Cost recovery (no COGS / other operating expenses), the reported vs tariff-compensation-adjusted EBIT margin and the
government-support flow chart (no support flows), the workbook evidence panel (no supplementary sheets), and some KPI
lines had gaps where equity or EBITDA was negative.

What the dataset carries:

- every column of the standard schema except `Country`: cash, receivables, inventory, short- and long-term debt, FX and
  government-guaranteed debt, COGS and other operating expenses, fuel and labour cost, operating cash flow, capex,
  debt service, government grants split into tariff/PSO compensation and operating subsidy, investment grants, equity
  injections, on-lending, concessional loans, guarantees, tax support, government arrears, VAT credits, the five
  exposure shares, and the five provenance columns;
- equity, EBITDA and EBIT positive in every SOE-year, so no ratio is suppressed (all 16 KPIs defined for all 80 rows);
- every SOE reports tariff/PSO compensation and at least one other support flow, so the support charts draw for any SOE;
- consistent statements: assets = liabilities + equity; EBITDA = EBIT + depreciation; operating expense (incl.
  depreciation) = revenue − EBIT; net income = revenue − total expense; grants = tariff/PSO compensation + operating
  subsidy (booked in revenue); COGS + other operating expenses = operating expense − depreciation; retained earnings
  and equity roll forward with net income, dividends, equity injections and investment grants (in equity, as under
  SYSCOHADA).

| SOE | Sector | Activity (invented) | Z″-EM 2015 → 2024 | Story |
|---|---|---|---|---|
| SOE A | Energy | Petroleum products importer | 1.96 → 0.07 | grey → distress in 2020; fuel 58% of opex, FX debt, rising State arrears |
| SOE B | Transport | National railway | 1.60 → 1.31 | grey throughout; grants rise from 40% to 52% of revenue (grant-dependent), asset-heavy, large investment grants |
| SOE C | Power / Utilities | Integrated electricity utility | 1.46 → −0.21 | grey → distress in 2020; tariff compensation up to 23% of revenue, 80% FX debt, recapitalised in 2023 |
| SOE D | Telecoms | Telecoms operator | 3.82 → 4.67 | safe; pays dividends |
| SOE E | Agriculture | Cotton company | 1.41 → 2.23 | grey throughout, volatile revenue (Monte Carlo volatility from its own history), 62% FX revenue |
| SOE F | Industry | Cement producer | 3.10 → 2.15 | safe → grey (2020, and from 2022 on); floating-rate FX debt |
| SOE G | Transport | Urban bus and ferry company | 0.19 → −1.22 | distress throughout; 85% FX debt, equity injections 2018, 2021, 2024 |
| SOE H | Other | Housing and real estate | 4.34 → 5.32 | safe |

Latest year: 3 SOEs in distress, 3 in the grey zone, 2 safe. All figures are invented; they are not real enterprises.

The Excel file has six sheets: **Readme**, **Data** (the sheet the tool reads), **Grants_detail** (support by type and
year; flows, stocks and contingent items kept apart), **Source_lines**, **Validation** (accounting identity checks, all
OK) and **Definitions**. The CSV is the Data sheet. The workbook bytes are fixed (zip times and document dates), so
rebuilds are identical.

## 3. Download on the start screen, upload back

Home › Load data has a new strip under the drop area: **Practice file: WB-KDIs training data**, with **⬇ Excel (.xlsx)**
and **⬇ CSV**. The files are embedded in the page (no network needed to download) and are byte-identical to
`sample_data/WB-KDIs_SOE_training_data_2015-2024.xlsx` / `.csv`. About › Load data has the same two buttons.
The classic Streamlit Home (`classic.py`) has the dataset button and the two downloads too.

Uploading either file through the usual Load data box gives exactly the same screens as the built-in training data
(checked tab by tab in a browser: KPI Dashboard, Distress Indicator, Expected Fiscal Cost, Shock Scenarios,
Early Warning, Government Support and Report have identical text; only the data label differs). The Excel upload
also fills the Technical notes workbook-evidence panel from its extra sheets; the CSV cannot carry those sheets, so that
one panel stays empty after a CSV upload. Reading `.xlsx` in the browser still loads SheetJS from cdnjs, as before.

The built-in training data opens with its supplementary sheets attached (`report.py` embeds them; `app.js`
`builtinExtras()` joins them with the same `mergeSupportUpload()` as an upload), so the page looks the same before and
after uploading the Excel file.

## Files

`training_data.py` (new), `sample_data/` (new), `tests/check_training_data.py` (new), `config.py` (title),
`report.py` (`--training`, training dataset, supplementary sheets, embedded downloads, `alias` so the opening data is
not embedded twice), `templates/app.js` (training chip, download strip, built-in supplementary sheets),
`templates/app.css` (download strip), `templates/support_additions.js` (card title no longer says "uploaded"),
`Home.py`, `classic.py`, `app_pages/home.py`, `tests/check_snapshot_sync.py` (release build is `--training`),
`tests/check_engine_parity.py` (`SOE_PARITY_DATA=training` runs the parity check on the training data; the Monte Carlo
median Z-EM may fall inside the Python sampling band, as the EFC percentiles already could), `SOE-Fiscal-Risk-Final.html`
(rebuilt).
