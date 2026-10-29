"""WB-KDIs training data: 8 SOEs x 2015-2024, every schema column filled, accounting identities exact,
no KPI suppressed or missing, all three Z''-EM zones present, and the CSV/Excel files in sample_data/
(also offered for download on the start screen) read back through the normal upload path unchanged."""
import pathlib
import sys

import numpy as np
import pandas as pd

R = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(R))
import calculations  # noqa: E402
import config  # noqa: E402
import data_loader  # noqa: E402
import schema  # noqa: E402
import training_data as td  # noqa: E402

fails, n = [], 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


df = td.training_portfolio()
check(len(df) == 80 and df["Entity"].nunique() == 8, f"shape {df.shape}, {df['Entity'].nunique()} SOEs")
check(sorted(df["Year"].unique()) == list(range(2015, 2025)), "years 2015-2024")
check(df.groupby("Entity")["Year"].nunique().eq(10).all(), "10 years per SOE")
missing = [v["column"] for v in schema.VARIABLES if v["column"] != "Country" and v["column"] not in df.columns]
check(not missing, f"schema columns missing: {missing}")
check(not df.isna().any().any(), "blank cells: " + ", ".join(df.columns[df.isna().any()]))

# accounting identities, to the unit
eq = lambda a, b, what: check((df[a] == b).all(), what)
eq("Total Assets", df["Total Liabilities"] + df["Equity"], "TA = TL + E")
eq("EBITDA", df["Operating Profits (EBIT)"] + df["Depreciation"], "EBITDA = EBIT + D&A")
eq("Operating Expense", df["Revenues"] - df["Operating Profits (EBIT)"], "OpEx = Rev - EBIT")
eq("Total Expense", df["Operating Expense"] + df["Interest Expense"] + df["Tax Expense"], "TotalExp")
eq("Net Income", df["Revenues"] - df["Total Expense"], "NI = Rev - TotalExp")
eq("Government Grants", df["Tariff / PSO Compensation"] + df["Operating Subsidy (Flow)"], "grants = tariff + op. subsidy")
eq("Cost of Goods Sold", df["Operating Expense"] - df["Depreciation"] - df["Other Operating Expenses"], "COGS + other = OpEx - D&A")
check((df["Current Liabilities"] < df["Total Liabilities"]).all(), "CL < TL")
check((df["Cash and Equivalents"] + df["Receivables"] + df["Inventory"] + df["VAT Credits"] <= df["Current Assets"]).all(), "CA components")
check((df["Government Arrears Owed"] <= df["Receivables"]).all(), "gov arrears within receivables")
check((df["Fuel Cost"] <= df["Cost of Goods Sold"]).all(), "fuel within COGS")
check((df["FX Debt"] <= df["Short Term Debt"] + df["Long Term Debt"]).all(), "FX debt within debt")
check((df["Short Term Debt"] <= df["Current Liabilities"]).all(), "ST debt within CL")
# retained earnings roll forward with net income less dividends (never up by more than net income)
for ent, g in df.sort_values("Year").groupby("Entity"):
    d = g["Retained Earnings"].diff().iloc[1:] - g["Net Income"].iloc[1:]
    check((d <= 1).all(), f"{ent}: retained earnings rose by more than net income")

# every ratio defined everywhere (no suppression: equity, EBITDA and EBIT positive)
k = calculations.compute_kpis(calculations.compute_zem_components(df))
keys = [key for keys in config.KPI_CATEGORIES.values() for key in keys]
check(not k[keys].isna().any().any(), "KPI gaps: " + ", ".join(c for c in keys if k[c].isna().any()))
check((df["Equity"] > 0).all() and (df["EBITDA"] > 0).all() and (df["Operating Profits (EBIT)"] > 0).all(), "E, EBITDA, EBIT > 0")
zones = set(k.loc[k["Year"] == 2024, "Zone"])
check(zones == {"Distress", "Grey", "Safe"}, f"2024 zones {zones}")
check(k.groupby("Entity")["Zone"].nunique().gt(1).sum() >= 2, "at least two SOEs change zone over the decade")
for col in ["Tariff / PSO Compensation"]:
    check(df.groupby("Entity")[col].apply(lambda s: (s > 0).any()).all(), f"{col}: every SOE reports some")

# the files on disk are the current build, and read back unchanged through the upload path
folder = R / "sample_data"
csv_path, xlsx_path = folder / td.CSV_NAME, folder / td.XLSX_NAME
check(csv_path.read_text(encoding="utf-8") == td.training_csv_text(df), "sample_data CSV out of date: run python training_data.py")
check(xlsx_path.read_bytes() == td.training_excel_bytes(df), "sample_data Excel out of date: run python training_data.py")
for path in (csv_path, xlsx_path):
    back, mapping = data_loader.load_and_standardize(str(path))
    check(list(back.columns) == list(df.columns), f"{path.name}: columns differ after upload")
    back = data_loader.coerce_numeric(back)
    for c in df.columns:
        if pd.api.types.is_numeric_dtype(df[c]):
            check(np.allclose(back[c].astype(float), df[c].astype(float), rtol=0, atol=1e-9), f"{path.name}: {c} differs")
        else:
            check((back[c].astype(str) == df[c].astype(str)).all(), f"{path.name}: {c} differs")
    check(not data_loader.validate_schema(back)["missing_required"], f"{path.name}: required columns missing")

# the Excel file's Grants_detail repeats the main-sheet flows exactly (the page joins it without conflicts)
gd = pd.read_excel(xlsx_path, sheet_name="Grants_detail")
cols = {"tariff_pso_compensation": "Tariff / PSO Compensation", "operating_subsidy": "Operating Subsidy (Flow)",
        "investment_grant": "Investment Grant (Flow)", "equity_injection": "Equity Injection (Flow)"}
m = gd[gd["Code"].isin(cols)].merge(df, on=["Entity", "Year"])
check(len(m) == 320, f"Grants_detail flow rows {len(m)}")
check(all(r["Value (FCFA, Ones)"] == r[cols[r["Code"]]] for _, r in m.iterrows()), "Grants_detail differs from the Data sheet")
check(list(pd.ExcelFile(xlsx_path).sheet_names) == ["Readme", "Data", "Grants_detail", "Source_lines", "Validation", "Definitions"], "sheets")

if fails:
    print(f"FAIL — {len(fails)} of {n} training-data checks:")
    for f in fails[:40]:
        print("  ", f)
    sys.exit(1)
print(f"OK — training data: {n} checks passed (8 SOEs x 2015-2024, {df.shape[1]} columns, zones 2024: "
      + ", ".join(f"{z} {int((k.loc[k['Year'] == 2024, 'Zone'] == z).sum())}" for z in ["Distress", "Grey", "Safe"]) + ").")
