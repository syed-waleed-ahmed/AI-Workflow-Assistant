"""Validation and parsing of uploaded spreadsheets.

Nothing about an upload is trusted: the file type is established from the bytes themselves, the
filename is only ever used as a display label, archives are inspected before being opened, and
parsing is bounded by row, column and cell limits. Spreadsheet formulas and macros are never
evaluated — only stored cell values are read.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
import warnings
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath, PureWindowsPath
from typing import Literal

import pandas as pd
from charset_normalizer import from_bytes

from app.core.exceptions import PayloadTooLargeError, UnprocessableError

FileFormat = Literal["csv", "xlsx", "xls"]

ALLOWED_EXTENSIONS: dict[str, FileFormat] = {
    ".csv": "csv",
    ".tsv": "csv",
    ".txt": "csv",
    ".xlsx": "xlsx",
    ".xls": "xls",
}
_ZIP_MAGIC = b"PK\x03\x04"
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
# Limits for the decompressed contents of an .xlsx archive (zip-bomb protection).
MAX_ZIP_ENTRIES = 2000
MAX_ZIP_UNCOMPRESSED_BYTES = 300 * 1024 * 1024
MAX_ZIP_RATIO = 250
MAX_COLUMN_NAME_CHARS = 100
# Markers treated as missing. pandas' default list also contains "NA" and "None", which are
# legitimate values in real data ("NA" = North America), so the list is spelled out instead.
NA_VALUES = ["", "NULL", "null", "NaN", "nan", "N/A", "n/a", "#N/A", "#NA", "<NA>"]
_CURRENCY = re.compile(r"[$€£¥₹,\s]")
_NUMERIC_TEXT = re.compile(r"^\(?-?\d[\d.]*%?\)?$")


@dataclass
class ParsedFile:
    frame: pd.DataFrame
    file_format: FileFormat
    sheet_name: str | None = None
    notes: list[str] = field(default_factory=list)


class SheetSelectionRequired(Exception):
    """The workbook has several sheets and the caller must choose one."""

    def __init__(self, sheets: list[str]):
        super().__init__("sheet selection required")
        self.sheets = sheets


def safe_display_name(filename: str | None) -> str:
    """Reduce a client-supplied filename to a harmless display label.

    Directory components (either separator style), control characters and leading dots are
    removed. The result is never used to build a storage path.
    """
    raw = unicodedata.normalize("NFKC", filename or "")
    raw = PureWindowsPath(PurePosixPath(raw.replace("\x00", "")).name).name
    cleaned = "".join(ch for ch in raw if unicodedata.category(ch)[0] != "C")
    cleaned = re.sub(r"[<>:\"/\\|?*]", "_", cleaned).strip().lstrip(".").strip()
    return cleaned[:200] or "dataset"


def detect_format(filename: str, content: bytes) -> FileFormat:
    """Decide the file format from the extension and confirm it against the file's bytes."""
    suffix = PurePosixPath(safe_display_name(filename).lower()).suffix
    declared = ALLOWED_EXTENSIONS.get(suffix)
    if declared is None:
        raise UnprocessableError(
            "Unsupported file type. Upload a .csv, .tsv, .xlsx or .xls file.", code="unsupported_file_type"
        )
    if not content:
        raise UnprocessableError("The file is empty.", code="empty_file")

    is_zip = content.startswith(_ZIP_MAGIC)
    is_ole = content.startswith(_OLE_MAGIC)
    if declared == "xlsx" and not is_zip:
        raise UnprocessableError("This file is not a valid .xlsx workbook.", code="invalid_file")
    if declared == "xls" and not is_ole:
        raise UnprocessableError("This file is not a valid .xls workbook.", code="invalid_file")
    if declared == "csv" and (is_zip or is_ole or b"\x00" in content[:8192]):
        raise UnprocessableError(
            "This file is not plain text. If it is an Excel workbook, upload it with an .xlsx or .xls extension.",
            code="invalid_file",
        )
    return declared


def _check_xlsx_archive(content: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            names = {entry.filename for entry in entries}
            if len(entries) > MAX_ZIP_ENTRIES:
                raise UnprocessableError("This workbook has too many internal parts.", code="invalid_file")
            total = sum(entry.file_size for entry in entries)
            compressed = sum(entry.compress_size for entry in entries) or 1
            if total > MAX_ZIP_UNCOMPRESSED_BYTES or total / compressed > MAX_ZIP_RATIO:
                raise PayloadTooLargeError(
                    "This workbook expands to more data than is supported.", code="file_too_large"
                )
            if "[Content_Types].xml" not in names or not any(name.startswith("xl/") for name in names):
                raise UnprocessableError("This file is not a valid .xlsx workbook.", code="invalid_file")
    except zipfile.BadZipFile as exc:
        raise UnprocessableError("This workbook is corrupted and cannot be read.", code="invalid_file") from exc


def _decode(content: bytes) -> tuple[str, str]:
    """Decode CSV bytes: UTF-8 first, then the best statistical guess, then Latin-1."""
    for encoding in ("utf-8-sig",):
        try:
            return content.decode(encoding), "utf-8"
        except UnicodeDecodeError:
            pass
    guess = from_bytes(content[:200_000]).best()
    if guess is not None:
        try:
            return content.decode(guess.encoding), guess.encoding
        except (UnicodeDecodeError, LookupError):
            pass
    return content.decode("latin-1"), "latin-1"


def _sniff_delimiter(text: str) -> str:
    sample = "\n".join(text.splitlines()[:50])
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        return ","


def _read_csv(content: bytes, max_rows: int, notes: list[str]) -> pd.DataFrame:
    text, encoding = _decode(content)
    delimiter = _sniff_delimiter(text)
    if encoding != "utf-8":
        notes.append(f"Text encoding detected as {encoding}.")
    if delimiter != ",":
        names = {";": "semicolon", "\t": "tab", "|": "pipe"}
        notes.append(f"Detected {names.get(delimiter, delimiter)}-separated values.")
    try:
        return pd.read_csv(
            io.StringIO(text),
            sep=delimiter,
            nrows=max_rows + 1,
            on_bad_lines="error",
            skip_blank_lines=True,
            keep_default_na=False,
            na_values=NA_VALUES,
        )
    except pd.errors.EmptyDataError as exc:
        raise UnprocessableError("The file contains no data.", code="empty_file") from exc
    except (pd.errors.ParserError, ValueError) as exc:
        detail = str(exc).split("\n")[0][:200]
        raise UnprocessableError(f"The file could not be parsed as a table: {detail}", code="malformed_file") from exc


def _read_excel(content: bytes, file_format: FileFormat, sheet: str | None, max_rows: int) -> tuple[pd.DataFrame, str]:
    engine = "openpyxl" if file_format == "xlsx" else "xlrd"
    if file_format == "xlsx":
        _check_xlsx_archive(content)
    try:
        # Both engines read stored cell values only; formulas and macros are never executed.
        with pd.ExcelFile(io.BytesIO(content), engine=engine) as workbook:
            sheets = [str(name) for name in workbook.sheet_names]
            if not sheets:
                raise UnprocessableError("The workbook has no sheets.", code="empty_file")
            if sheet is None:
                if len(sheets) > 1:
                    raise SheetSelectionRequired(sheets)
                sheet = sheets[0]
            elif sheet not in sheets:
                raise UnprocessableError(f"Sheet '{sheet[:80]}' does not exist in this workbook.", code="unknown_sheet")
            frame = pd.read_excel(
                workbook, sheet_name=sheet, nrows=max_rows + 1, keep_default_na=False, na_values=NA_VALUES
            )
    except (SheetSelectionRequired, UnprocessableError, PayloadTooLargeError):
        raise
    except Exception as exc:  # the engines raise many unrelated exception types on bad input
        raise UnprocessableError(
            "The workbook is corrupted or uses an unsupported format.", code="malformed_file"
        ) from exc
    return frame, sheet


def _clean_column_names(frame: pd.DataFrame) -> pd.DataFrame:
    seen: dict[str, int] = {}
    names: list[str] = []
    for index, column in enumerate(frame.columns):
        name = re.sub(r"\s+", " ", str(column)).strip()
        name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C")
        if not name or name.lower().startswith("unnamed:"):
            name = f"column_{index + 1}"
        name = name[:MAX_COLUMN_NAME_CHARS]
        count = seen.get(name, 0)
        seen[name] = count + 1
        names.append(name if count == 0 else f"{name}_{count + 1}")
    frame.columns = pd.Index(names)
    return frame


def _numeric_from_text(series: pd.Series) -> pd.Series | None:
    """Parse text such as "$1,200.50", "45%" or "(300)" as numbers when nearly all values fit."""
    values = series.dropna().astype("string").str.strip()
    values = values[values != ""]
    if values.empty:
        return None
    stripped = values.str.replace(_CURRENCY, "", regex=True)
    if stripped.str.match(_NUMERIC_TEXT).mean() < 0.95:
        return None
    negative = stripped.str.startswith("(") & stripped.str.endswith(")")
    core = stripped.str.strip("()").str.rstrip("%")
    parsed = pd.to_numeric(core, errors="coerce").astype("float64")
    parsed = parsed.where(~negative.to_numpy(dtype=bool), -parsed)
    if parsed.notna().mean() < 0.95:
        return None
    parsed = parsed.reindex(series.index)
    if parsed.notna().all() and (parsed % 1 == 0).all():
        return parsed.astype("int64")
    return parsed


def _datetime_from_text(series: pd.Series) -> pd.Series | None:
    values = series.dropna().astype("string").str.strip()
    values = values[values != ""]
    if len(values) < 2:
        return None
    sample = values.head(200)
    # Bare numbers are not dates even though pandas would happily parse them as timestamps.
    if sample.str.fullmatch(r"[-+]?[\d.,]+").mean() > 0.2 or sample.str.len().median() < 6:
        return None
    for options in ({"format": "ISO8601"}, {}, {"format": "mixed"}, {"format": "mixed", "dayfirst": True}):
        try:
            with warnings.catch_warnings():
                # pandas warns when it falls back to per-element parsing; that fallback is intended.
                warnings.simplefilter("ignore", UserWarning)
                if pd.to_datetime(sample, errors="coerce", **options).notna().mean() < 0.95:  # type: ignore[call-overload]
                    continue
                parsed = pd.to_datetime(values, errors="coerce", **options)  # type: ignore[call-overload]
        except (ValueError, TypeError, OverflowError):
            continue
        if parsed.notna().mean() >= 0.95:
            return parsed.reindex(series.index)
    return None


def infer_types(frame: pd.DataFrame, notes: list[str]) -> pd.DataFrame:
    """Convert text columns that are really numbers or dates, and normalise everything else."""
    for name in list(frame.columns):
        series = frame[name]
        if pd.api.types.is_datetime64_any_dtype(series):
            if getattr(series.dt, "tz", None) is not None:
                frame[name] = series.dt.tz_convert("UTC").dt.tz_localize(None)
            continue
        if pd.api.types.is_numeric_dtype(series) or pd.api.types.is_bool_dtype(series):
            continue

        before = int(series.notna().sum())
        numeric = _numeric_from_text(series)
        if numeric is not None:
            lost = before - int(numeric.notna().sum())
            frame[name] = numeric
            notes.append(
                f"Column '{name}' was read as numbers"
                + (f"; {lost} values could not be parsed and were left empty." if lost else ".")
            )
            continue
        dates = _datetime_from_text(series)
        if dates is not None:
            lost = before - int(dates.notna().sum())
            if getattr(dates.dt, "tz", None) is not None:
                dates = dates.dt.tz_convert("UTC").dt.tz_localize(None)
            frame[name] = dates
            notes.append(
                f"Column '{name}' was read as dates"
                + (f"; {lost} values could not be parsed and were left empty." if lost else ".")
            )
            continue
        # Mixed-type object columns cannot be stored in Parquet; keep them as text.
        text = series.astype("string").str.strip()
        frame[name] = text.where(text != "", pd.NA)
    return frame


def parse_upload(
    filename: str,
    content: bytes,
    *,
    sheet: str | None,
    max_rows: int,
    max_columns: int,
    max_cells: int,
) -> ParsedFile:
    """Validate and parse an uploaded file into a typed DataFrame.

    Raises `SheetSelectionRequired` for multi-sheet workbooks when no sheet is named, and
    `AppError` subclasses (safe to show to the user) for everything that is wrong with the file.
    """
    file_format = detect_format(filename, content)
    notes: list[str] = []
    sheet_name: str | None = None
    if file_format == "csv":
        frame = _read_csv(content, max_rows, notes)
    else:
        frame, sheet_name = _read_excel(content, file_format, sheet, max_rows)

    if len(frame) > max_rows:
        raise PayloadTooLargeError(
            f"This dataset has more than {max_rows:,} rows, which is the current limit. "
            "Upload a filtered or aggregated extract.",
            code="too_many_rows",
        )
    frame = frame.dropna(axis=0, how="all").dropna(axis=1, how="all").reset_index(drop=True)
    if frame.empty or frame.shape[1] == 0:
        raise UnprocessableError("The file contains no data rows.", code="empty_file")
    if frame.shape[1] > max_columns:
        raise PayloadTooLargeError(
            f"This dataset has {frame.shape[1]} columns; the limit is {max_columns}.", code="too_many_columns"
        )
    if frame.shape[0] * frame.shape[1] > max_cells:
        raise PayloadTooLargeError(
            f"This dataset has more than {max_cells:,} cells, which is the current limit.", code="too_many_cells"
        )

    frame = infer_types(_clean_column_names(frame), notes)
    return ParsedFile(frame=frame, file_format=file_format, sheet_name=sheet_name, notes=notes)
