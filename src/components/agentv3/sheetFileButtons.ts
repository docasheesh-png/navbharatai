// What the spreadsheet Download card offers (SheetFileCard.tsx). PURE.
//
// One .xlsx always (it holds every sheet), then a .csv per sheet — CSV has no sheets, so a two-sheet
// file needs two CSVs, each named for its sheet. The server signs each link for exactly the format and
// sheet it was minted for, so these keys must match what `routes/spreadsheetFiles.ts` accepts.

import type { SheetFileRef } from './agentV3Types';

export interface SheetFileButton {
  key: string;
  format: 'xlsx' | 'csv';
  sheet: number;
  label: string;
  ariaLabel: string;
  primary: boolean;
}

export function sheetFileButtons(file: SheetFileRef): SheetFileButton[] {
  const sheets = file.sheets.length > 0 ? file.sheets : [{ name: 'Sheet1', rows: 0, columns: 0 }];
  const out: SheetFileButton[] = [{
    key: 'xlsx',
    format: 'xlsx',
    sheet: 0,
    label: 'Excel (.xlsx)',
    ariaLabel: `Download ${file.fileBase}.xlsx`,
    primary: true,
  }];
  sheets.forEach((s, i) => {
    const one = sheets.length === 1;
    out.push({
      key: `csv-${i}`,
      format: 'csv',
      sheet: i,
      label: one ? 'CSV' : `CSV · ${s.name}`,
      ariaLabel: one ? `Download ${file.fileBase}.csv` : `Download the ${s.name} sheet as CSV`,
      primary: false,
    });
  });
  return out;
}

/** "20 rows × 6 columns" or "2 sheets · 45 rows". */
export function sheetFileSummary(file: SheetFileRef): string {
  if (file.sheets.length === 1) {
    const s = file.sheets[0];
    return `${s.rows} ${s.rows === 1 ? 'row' : 'rows'} × ${s.columns} ${s.columns === 1 ? 'column' : 'columns'}`;
  }
  const rows = file.sheets.reduce((n, s) => n + s.rows, 0);
  return `${file.sheets.length} sheets · ${rows} ${rows === 1 ? 'row' : 'rows'}`;
}
