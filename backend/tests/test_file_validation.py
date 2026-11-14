"""Upload validation and parsing: real-world CSV/Excel quirks and hostile files."""

from __future__ import annotations

import io
import zipfile

import pandas as pd
import pytest
from openpyxl import Workbook

from app.core.exceptions import PayloadTooLargeError, UnprocessableError
from app.utils.file_validation import SheetSelectionRequired, detect_format, parse_upload, safe_display_name
from tests.conftest import make_xlsx

LIMITS = {"max_rows": 1000, "max_columns": 20, "max_cells": 10_000}


def parse(name: str, content: bytes, sheet: str | None = None, **limits):
    return parse_upload(name, content, sheet=sheet, **{**LIMITS, **limits})


# ---------------------------------------------------------------- CSV


def test_csv_types_are_inferred(sales_csv):
    parsed = parse("sales.csv", sales_csv)
    frame = parsed.frame
    assert parsed.file_format == "csv" and len(frame) == 12
    assert pd.api.types.is_datetime64_any_dtype(frame["date"])
    assert pd.api.types.is_integer_dtype(frame["units"])
    assert pd.api.types.is_float_dtype(frame["revenue"])


def test_region_code_na_is_not_treated_as_missing(sales_csv):
    """pandas reads "NA" as missing by default, which would silently drop North America."""
    frame = parse("sales.csv", sales_csv).frame
    assert frame["region"].isna().sum() == 0
    assert (frame["region"] == "NA").sum() == 5


def test_explicit_missing_markers_are_recognised():
    frame = parse("m.csv", b"a,b\n1,x\nNULL,y\nN/A,w\n4,\n").frame
    assert frame["a"].isna().sum() == 2 and frame["b"].isna().sum() == 1


@pytest.mark.parametrize(("delimiter", "label"), [(";", "semicolon"), ("\t", "tab"), ("|", "pipe")])
def test_delimiter_is_detected(delimiter, label):
    content = f"name{delimiter}amount\nalpha{delimiter}10\nbeta{delimiter}20\n".encode()
    parsed = parse("d.csv", content)
    assert list(parsed.frame.columns) == ["name", "amount"] and parsed.frame["amount"].sum() == 30
    assert any(label in note for note in parsed.notes)


def test_non_utf8_encoding_is_decoded():
    content = "ville,ventes\nMünchen,10\nZürich,20\nKöln,30\n".encode("cp1252")
    frame = parse("e.csv", content).frame
    assert frame["ville"].tolist() == ["München", "Zürich", "Köln"]


def test_utf8_bom_is_stripped():
    frame = parse("b.csv", b"\xef\xbb\xbfname,amount\na,1\n").frame
    assert list(frame.columns) == ["name", "amount"]


def test_currency_percent_and_accounting_numbers_become_numeric():
    content = b'price,margin,delta\n"$1,200.50",45%,(300)\n"$80.00",12.5%,25\n"$3,000",8%,(1.5)\n'
    parsed = parse("n.csv", content)
    assert parsed.frame["price"].tolist() == [1200.5, 80.0, 3000.0]
    assert parsed.frame["margin"].tolist() == [45.0, 12.5, 8.0]
    assert parsed.frame["delta"].tolist() == [-300.0, 25.0, -1.5]
    assert sum("read as numbers" in note for note in parsed.notes) == 3


def test_mostly_text_column_stays_text():
    frame = parse("t.csv", b"code\nA1\nB2\n33\nC4\n").frame
    assert not pd.api.types.is_numeric_dtype(frame["code"])


def test_numeric_ids_are_not_mistaken_for_dates():
    frame = parse("i.csv", b"zip,year\n90210,2024\n10001,2025\n60601,2023\n").frame
    assert pd.api.types.is_integer_dtype(frame["zip"]) and pd.api.types.is_integer_dtype(frame["year"])


def test_column_names_are_cleaned_and_deduplicated():
    frame = parse("c.csv", b" Amount ,Amount,,x\ty\n1,2,3,4\n").frame
    assert list(frame.columns) == ["Amount", "Amount_2", "column_3", "x y"]


def test_empty_rows_and_columns_are_dropped():
    frame = parse("s.csv", b"a,b,c\n1,,x\n,,\n2,,y\n").frame
    assert list(frame.columns) == ["a", "c"] and len(frame) == 2


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (b"", "empty_file"),
        (b"a,b\n", "empty_file"),
        (b"\n\n\n", "empty_file"),
        (b"a,b\n1,2\n3,4,5,6\n", "malformed_file"),
        (b'a,b\n"unterminated,2\n', "malformed_file"),
    ],
)
def test_bad_csv_is_rejected_with_a_reason(content, code):
    with pytest.raises(UnprocessableError) as error:
        parse("bad.csv", content)
    assert error.value.code == code


def test_row_column_and_cell_limits():
    many_rows = b"a\n" + b"1\n" * 50
    with pytest.raises(PayloadTooLargeError) as error:
        parse("r.csv", many_rows, max_rows=10)
    assert error.value.code == "too_many_rows"
    wide = (",".join(f"c{i}" for i in range(30)) + "\n" + ",".join("1" for _ in range(30)) + "\n").encode()
    with pytest.raises(PayloadTooLargeError) as error:
        parse("w.csv", wide)
    assert error.value.code == "too_many_columns"
    with pytest.raises(PayloadTooLargeError) as error:
        parse("c.csv", b"a,b\n" + b"1,2\n" * 20, max_cells=30)
    assert error.value.code == "too_many_cells"


# ---------------------------------------------------------------- type detection


@pytest.mark.parametrize(
    "name", ["report.pdf", "script.exe", "data.json", "archive.zip", "macro.xlsm", "noextension", ".csv.exe"]
)
def test_unsupported_extensions_are_rejected(name):
    with pytest.raises(UnprocessableError) as error:
        detect_format(name, b"a,b\n1,2\n")
    assert error.value.code == "unsupported_file_type"


def test_extension_must_match_the_actual_bytes(sales):
    xlsx = make_xlsx({"Sheet1": sales})
    with pytest.raises(UnprocessableError, match="not plain text"):
        detect_format("renamed.csv", xlsx)
    with pytest.raises(UnprocessableError, match=r"not a valid \.xlsx"):
        detect_format("fake.xlsx", b"a,b\n1,2\n")
    with pytest.raises(UnprocessableError, match=r"not a valid \.xls"):
        detect_format("fake.xls", b"a,b\n1,2\n")
    with pytest.raises(UnprocessableError, match="not plain text"):
        detect_format("binary.csv", b"MZ\x90\x00\x03\x00\x00\x00")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("../../etc/passwd", "passwd"),
        ("..\\..\\windows\\system32\\config.csv", "config.csv"),
        ("C:\\Users\\me\\sales.csv", "sales.csv"),
        ("/abs/path/sales.csv", "sales.csv"),
        ("sales\x00.csv", "sales.csv"),
        ("....hidden.csv", "hidden.csv"),
        ("we<i>rd:na|me?.csv", "we_i_rd_na_me_.csv"),
        ("", "dataset"),
        (None, "dataset"),
        ("a" * 400 + ".csv", "a" * 200),
    ],
)
def test_filenames_are_reduced_to_harmless_labels(raw, expected):
    assert safe_display_name(raw) == expected


# ---------------------------------------------------------------- Excel


def test_single_sheet_workbook(sales):
    parsed = parse("book.xlsx", make_xlsx({"Orders": sales}))
    assert parsed.file_format == "xlsx" and parsed.sheet_name == "Orders" and len(parsed.frame) == 12
    assert pd.api.types.is_datetime64_any_dtype(parsed.frame["date"])
    assert (parsed.frame["region"] == "NA").sum() == 5


def test_multi_sheet_workbook_requires_a_choice(sales):
    content = make_xlsx({"Orders": sales, "Notes": pd.DataFrame({"k": ["a"], "v": [1]})})
    with pytest.raises(SheetSelectionRequired) as error:
        parse("book.xlsx", content)
    assert error.value.sheets == ["Orders", "Notes"]
    assert len(parse("book.xlsx", content, sheet="Notes").frame) == 1
    with pytest.raises(UnprocessableError) as unknown:
        parse("book.xlsx", content, sheet="Missing")
    assert unknown.value.code == "unknown_sheet"


def test_formulas_are_read_as_stored_values_never_evaluated():
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["item", "amount", "formula"])
    sheet.append(["a", 10, "=1+1"])
    sheet.append(["b", 20, '=HYPERLINK("http://evil.example","click")'])
    sheet.append(["c", 30, "=cmd|' /C calc'!A0"])
    buffer = io.BytesIO()
    workbook.save(buffer)
    frame = parse("f.xlsx", buffer.getvalue()).frame
    # A workbook written without a calculation engine has no cached results: formula cells are empty.
    assert frame["amount"].sum() == 60
    assert "formula" not in frame.columns or frame["formula"].isna().all()


def test_corrupted_workbook_is_rejected():
    with pytest.raises(UnprocessableError) as error:
        parse("broken.xlsx", b"PK\x03\x04" + b"\x00" * 200)
    assert error.value.code == "invalid_file"


def test_zip_that_is_not_a_workbook_is_rejected():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("readme.txt", "hello")
    with pytest.raises(UnprocessableError, match=r"not a valid \.xlsx"):
        parse("zip.xlsx", buffer.getvalue())


def test_zip_bomb_is_rejected_before_extraction():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("xl/workbook.xml", "<workbook/>")
        archive.writestr("xl/worksheets/sheet1.xml", b"0" * (40 * 1024 * 1024))  # 40 MB of zeros, ~40 KB compressed
    content = buffer.getvalue()
    assert len(content) < 200_000
    with pytest.raises(PayloadTooLargeError) as error:
        parse("bomb.xlsx", content)
    assert error.value.code == "file_too_large"


def test_workbook_with_too_many_parts_is_rejected():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        for index in range(2100):
            archive.writestr(f"xl/part{index}.xml", "x")
    with pytest.raises(UnprocessableError, match="too many internal parts"):
        parse("parts.xlsx", buffer.getvalue())
