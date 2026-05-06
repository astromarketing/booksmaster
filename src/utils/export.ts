import { Fyo } from 'fyo';
import { RawValueMap } from 'fyo/core/types';
import {
  Field,
  FieldType,
  FieldTypeEnum,
  RawValue,
  TargetField,
} from 'schemas/types';
import { generateCSV } from 'utils/csvParser';
import { GetAllOptions, QueryFilter } from 'utils/db/types';
import { getMapFromList, safeParseFloat } from 'utils/index';
import * as XLSX from 'xlsx';
import { ExportField, ExportTableField } from './types';

const excludedFieldTypes: FieldType[] = [
  FieldTypeEnum.AttachImage,
  FieldTypeEnum.Attachment,
];

interface CsvHeader {
  label: string;
  schemaName: string;
  fieldname: string;
  parentFieldname?: string;
}

export function getExportFields(
  fields: Field[],
  exclude: string[] = []
): ExportField[] {
  return fields
    .filter((f) => !f.computed && f.label && !exclude.includes(f.fieldname))
    .map((field) => {
      const { fieldname, label } = field;
      const fieldtype = field.fieldtype as FieldType;
      return {
        fieldname,
        fieldtype,
        label,
        export: !excludedFieldTypes.includes(fieldtype),
      };
    });
}

export function getExportTableFields(
  fields: Field[],
  fyo: Fyo
): ExportTableField[] {
  return fields
    .filter((f) => f.fieldtype === FieldTypeEnum.Table)
    .map((f) => {
      const target = (f as TargetField).target;
      const tableFields = fyo.schemaMap[target]?.fields ?? [];
      const exportTableFields = getExportFields(tableFields, ['name']);

      return {
        fieldname: f.fieldname,
        label: f.label,
        target,
        fields: exportTableFields,
      };
    })
    .filter((f) => !!f.fields.length);
}

export async function getJsonExportData(
  schemaName: string,
  fields: ExportField[],
  tableFields: ExportTableField[],
  limit: number | null,
  filters: QueryFilter,
  fyo: Fyo
): Promise<string> {
  const data = await getExportData(
    schemaName,
    fields,
    tableFields,
    limit,
    filters,
    fyo
  );
  convertParentDataToJsonExport(data.parentData, data.childTableData);
  return JSON.stringify(data.parentData);
}

export async function getCsvExportData(
  schemaName: string,
  fields: ExportField[],
  tableFields: ExportTableField[],
  limit: number | null,
  filters: QueryFilter,
  fyo: Fyo
): Promise<string> {
  const { matrix } = await buildExportDataMatrix(
    schemaName,
    fields,
    tableFields,
    limit,
    filters,
    fyo
  );
  return generateCSV(matrix as unknown[][]);
}

/**
 * XLSX workbook as base64 (for IPC SAVE_DATA with encoding base64).
 */
export async function getXlsxExportBase64(
  schemaName: string,
  fields: ExportField[],
  tableFields: ExportTableField[],
  limit: number | null,
  filters: QueryFilter,
  fyo: Fyo
): Promise<string> {
  const { matrix } = await buildExportDataMatrix(
    schemaName,
    fields,
    tableFields,
    limit,
    filters,
    fyo
  );
  const safeMatrix = sanitizeMatrixForExcel(matrix);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(safeMatrix);
  const labelRow = safeMatrix[0] as unknown[] | undefined;
  if (labelRow?.length) {
    ws['!cols'] = labelRow.map((cell) => ({
      wch: Math.min(50, Math.max(10, String(cell ?? '').length + 2)),
    }));
  }
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    getExcelSheetName(schemaName, fyo)
  );
  return XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
}

/**
 * Export a single document (by `name`) with the same field coverage as the list Export Wizard
 * defaults: all exportable parent fields plus line-item (table) columns.
 */
export async function exportSingleDocToXlsxBase64(
  schemaName: string,
  docName: string,
  fyo: Fyo
): Promise<string> {
  const schema = fyo.schemaMap[schemaName];
  if (!schema) {
    throw new Error(`Unknown schema: ${schemaName}`);
  }

  const fields = getExportFields(schema.fields);
  const tableFields = getExportTableFields(schema.fields, fyo);
  const filters: QueryFilter = { name: docName };

  return getXlsxExportBase64(
    schemaName,
    fields,
    tableFields,
    null,
    filters,
    fyo
  );
}

async function buildExportDataMatrix(
  schemaName: string,
  fields: ExportField[],
  tableFields: ExportTableField[],
  limit: number | null,
  filters: QueryFilter,
  fyo: Fyo
): Promise<{ matrix: RawValue[][] }> {
  const { childTableData, parentData } = await getExportData(
    schemaName,
    fields,
    tableFields,
    limit,
    filters,
    fyo
  );
  const parentNameMap = getParentNameMap(childTableData);
  const headers = getCsvHeaders(schemaName, fields, tableFields);

  const rows: RawValue[][] = [];
  for (const parentRow of parentData) {
    const parentName = parentRow.name as string;
    if (!parentName) {
      continue;
    }

    const baseRowData = headers.parent.map(
      (f) => (parentRow[f.fieldname] as RawValue) ?? ''
    );

    const tableFieldRowMap = parentNameMap[parentName];
    if (!tableFieldRowMap || !Object.keys(tableFieldRowMap ?? {}).length) {
      rows.push([baseRowData, headers.child.map(() => '')].flat());
      continue;
    }

    for (const tableFieldName of orderedChildTableKeys(
      tableFieldRowMap,
      tableFields
    )) {
      const tableRows = tableFieldRowMap[tableFieldName] ?? [];

      for (const tableRow of tableRows) {
        const tableRowData = headers.child.map((f) => {
          if (f.parentFieldname !== tableFieldName) {
            return '';
          }

          return (tableRow[f.fieldname] as RawValue) ?? '';
        });

        rows.push([baseRowData, tableRowData].flat());
      }
    }
  }

  const flatHeaders = [headers.parent, headers.child].flat();
  const labels = flatHeaders.map((f) => f.label);
  const keys = flatHeaders.map((f) => `${f.schemaName}.${f.fieldname}`);

  rows.unshift(keys);
  rows.unshift(labels);

  return { matrix: rows };
}

function orderedChildTableKeys(
  tableFieldRowMap: Record<string, RawValueMap[]>,
  tableFields: ExportTableField[]
): string[] {
  const ordered = tableFields
    .map((tf) => tf.fieldname)
    .filter((name) =>
      Object.prototype.hasOwnProperty.call(tableFieldRowMap, name)
    );
  const rest = Object.keys(tableFieldRowMap).filter(
    (k) => !ordered.includes(k)
  );
  return ordered.concat(rest);
}

function getExcelSheetName(schemaName: string, fyo: Fyo): string {
  const raw = (fyo.schemaMap[schemaName]?.label ?? schemaName)
    .replace(/[:\\/?*[\]]/g, ' ')
    .trim();
  return (raw.slice(0, 31) || 'Export').trim() || 'Export';
}

/**
 * Neutralize CSV/Excel formula injection and normalize values for Excel cells.
 */
function sanitizeMatrixForExcel(matrix: RawValue[][]): unknown[][] {
  return matrix.map((row) => row.map((cell) => sanitizeExcelScalar(cell)));
}

function sanitizeExcelScalar(value: RawValue): unknown {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '';
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value !== 'string') {
    return sanitizeExcelScalar(String(value) as RawValue);
  }
  const trimmed = value.trim();
  if (/^[=+\-@]/.test(trimmed)) {
    return `'${value}`;
  }
  return value;
}

function getCsvHeaders(
  schemaName: string,
  fields: ExportField[],
  tableFields: ExportTableField[]
) {
  const headers = {
    parent: [] as CsvHeader[],
    child: [] as CsvHeader[],
  };
  for (const { label, fieldname, fieldtype, export: shouldExport } of fields) {
    if (!shouldExport || fieldtype === FieldTypeEnum.Table) {
      continue;
    }

    headers.parent.push({ schemaName, label, fieldname });
  }

  for (const tf of tableFields) {
    if (!fields.find((f) => f.fieldname === tf.fieldname)?.export) {
      continue;
    }

    for (const field of tf.fields) {
      if (!field.export) {
        continue;
      }

      headers.child.push({
        schemaName: tf.target,
        label: field.label,
        fieldname: field.fieldname,
        parentFieldname: tf.fieldname,
      });
    }
  }

  return headers;
}

function getParentNameMap(childTableData: Record<string, RawValueMap[]>) {
  const parentNameMap: Record<string, Record<string, RawValueMap[]>> = {};
  for (const key in childTableData) {
    for (const row of childTableData[key]) {
      const parent = row.parent as string;
      if (!parent) {
        continue;
      }

      parentNameMap[parent] ??= {};
      parentNameMap[parent][key] ??= [];
      parentNameMap[parent][key].push(row);
    }
  }
  return parentNameMap;
}

async function getExportData(
  schemaName: string,
  fields: ExportField[],
  tableFields: ExportTableField[],
  limit: number | null,
  filters: QueryFilter,
  fyo: Fyo
) {
  const parentData = await getParentData(
    schemaName,
    filters,
    fields,
    limit,
    fyo
  );
  const parentNames = parentData.map((f) => f.name as string).filter(Boolean);
  const childTableData = await getAllChildTableData(
    tableFields,
    fields,
    parentNames,
    fyo
  );
  return { parentData, childTableData };
}

function convertParentDataToJsonExport(
  parentData: RawValueMap[],
  childTableData: Record<string, RawValueMap[]>
) {
  /**
   * Map from List does not create copies. Map is a
   * map of references, hence parentData is altered.
   */

  const nameMap = getMapFromList(parentData, 'name');
  for (const fieldname in childTableData) {
    const data = childTableData[fieldname];

    for (const row of data) {
      const parent = row.parent as string | undefined;
      if (!parent || !nameMap?.[parent]) {
        continue;
      }

      nameMap[parent][fieldname] ??= [];

      delete row.parent;
      delete row.name;

      (nameMap[parent][fieldname] as RawValueMap[]).push(row);
    }
  }
}

async function getParentData(
  schemaName: string,
  filters: QueryFilter,
  fields: ExportField[],
  limit: number | null,
  fyo: Fyo
) {
  const orderBy = ['created'];
  if (fyo.db.fieldMap[schemaName]?.['date']) {
    orderBy.unshift('date');
  }

  const options: GetAllOptions = { filters, orderBy, order: 'desc' };
  if (limit) {
    options.limit = limit;
  }

  options.fields = fields
    .filter((f) => f.export && f.fieldtype !== FieldTypeEnum.Table)
    .map((f) => f.fieldname);
  if (!options.fields.includes('name')) {
    options.fields.unshift('name');
  }
  const data = await fyo.db.getAllRaw(schemaName, options);
  convertRawPesaToFloat(data, fields);
  return data;
}

async function getAllChildTableData(
  tableFields: ExportTableField[],
  parentFields: ExportField[],
  parentNames: string[],
  fyo: Fyo
) {
  const childTables: Record<string, RawValueMap[]> = {};

  // Getting Child Row data
  for (const tf of tableFields) {
    const f = parentFields.find((f) => f.fieldname === tf.fieldname);
    if (!f?.export) {
      continue;
    }

    childTables[tf.fieldname] = await getChildTableData(tf, parentNames, fyo);
  }

  return childTables;
}

async function getChildTableData(
  exportTableField: ExportTableField,
  parentNames: string[],
  fyo: Fyo
) {
  if (!parentNames.length) {
    return [];
  }

  const exportTableFields = exportTableField.fields
    .filter((f) => f.export && f.fieldtype !== FieldTypeEnum.Table)
    .map((f) => f.fieldname);
  if (!exportTableFields.includes('parent')) {
    exportTableFields.unshift('parent');
  }

  const data = await fyo.db.getAllRaw(exportTableField.target, {
    orderBy: 'idx',
    fields: exportTableFields,
    filters: { parent: ['in', parentNames] },
  });
  convertRawPesaToFloat(data, exportTableField.fields);
  return data;
}

function convertRawPesaToFloat(data: RawValueMap[], fields: ExportField[]) {
  const currencyFields = fields.filter(
    (f) => f.fieldtype === FieldTypeEnum.Currency
  );

  for (const row of data) {
    for (const { fieldname } of currencyFields) {
      row[fieldname] = safeParseFloat((row[fieldname] ?? '0') as string);
    }
  }
}
