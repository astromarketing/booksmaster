<template>
  <div>
    <!-- Export Wizard Header -->
    <FormHeader :form-title="label" :form-sub-title="t`Export Wizard`" />
    <hr class="dark:border-gray-800" />

    <!-- Export Config -->
    <div class="grid grid-cols-3 p-4 gap-4">
      <Check
        v-if="configFields.useListFilters && Object.keys(listFilters).length"
        :df="configFields.useListFilters"
        :space-between="true"
        :show-label="true"
        :label-right="false"
        :value="useListFilters"
        :border="true"
        @change="(value: boolean) => (useListFilters = value)"
      />
      <Select
        v-if="configFields.exportFormat"
        :df="configFields.exportFormat"
        :value="exportFormat"
        :border="true"
        @change="(value: ExportFormat) => (exportFormat = value)"
      />
      <Int
        v-if="configFields.limit"
        :df="configFields.limit"
        :value="limit ?? undefined"
        :border="true"
        @change="(value: number) => (limit = value)"
      />
    </div>
    <hr class="dark:border-gray-800" />

    <!-- Fields Selection -->
    <div class="max-h-80 overflow-auto custom-scroll custom-scroll-thumb2">
      <!-- Main Fields -->
      <div class="p-4">
        <h2 class="text-sm font-semibold text-gray-800 dark:text-gray-300">
          {{ fyo.schemaMap[schemaName]?.label ?? schemaName }}
        </h2>
        <div class="grid grid-cols-3 border dark:border-gray-800 rounded mt-1">
          <Check
            v-for="ef of fields"
            :key="ef.fieldname"
            :label-class="
              ef.fieldtype === 'Table'
                ? 'text-sm text-gray-600 dark:text-gray-300 font-semibold'
                : 'text-sm text-gray-600 dark:text-gray-400'
            "
            :df="getField(ef)"
            :show-label="true"
            :value="ef.export"
            @change="(value: boolean) => setExportFieldValue(ef, value)"
          />
        </div>
      </div>

      <!-- Table Fields -->
      <div v-for="efs of filteredTableFields" :key="efs.fieldname" class="p-4">
        <h2 class="text-sm font-semibold text-gray-800 dark:text-gray-300">
          {{ fyo.schemaMap[efs.target]?.label ?? schemaName }}
        </h2>
        <div class="grid grid-cols-3 border dark:border-gray-800 rounded mt-1">
          <Check
            v-for="ef of efs.fields"
            :key="ef.fieldname"
            label-class="text-gray-600 dark:text-gray-300"
            :df="getField(ef)"
            :show-label="true"
            :value="ef.export"
            @change="(value: boolean) => setExportFieldValue(ef, value, efs.target)"
          />
        </div>
      </div>
    </div>

    <!-- Export Button -->
    <hr class="dark:border-gray-800" />
    <div class="p-4 flex justify-between items-center">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t`${numSelected} fields selected` }}
      </p>
      <Button
        type="primary"
        :disabled="numSelected === 0"
        @click="exportData"
      >
        {{ t`Export` }}
      </Button>
    </div>
  </div>
</template>
<script lang="ts">
import { t } from 'fyo';
import { Verb } from 'fyo/telemetry/types';
import { Field, FieldTypeEnum } from 'schemas/types';
import { fyo } from 'src/initFyo';
import {
  getCsvExportData,
  getExportFields,
  getExportTableFields,
  getJsonExportData,
  getXlsxExportBase64,
} from 'src/utils/export';
import { getErrorMessage } from 'src/utils';
import { showToast } from 'src/utils/interactive';
import { ExportField, ExportFormat, ExportTableField } from 'src/utils/types';
import { getSavePath, showExportInFolder } from 'src/utils/ui';
import { QueryFilter } from 'utils/db/types';
import { PropType, defineComponent } from 'vue';
import Button from './Button.vue';
import Check from './Controls/Check.vue';
import Int from './Controls/Int.vue';
import Select from './Controls/Select.vue';
import FormHeader from './FormHeader.vue';

interface ExportWizardData {
  useListFilters: boolean;
  exportFormat: ExportFormat;
  fields: ExportField[];
  limit: number | null;
  tableFields: ExportTableField[];
  numUnfilteredEntries: number;
}

export default defineComponent({
  components: { FormHeader, Check, Select, Button, Int },
  props: {
    schemaName: { type: String, required: true },
    listFilters: { type: Object as PropType<QueryFilter>, default: () => {} },
    pageTitle: String,
  },
  data() {
    const fields = fyo.schemaMap[this.schemaName]?.fields ?? [];
    const exportFields = getExportFields(fields);
    const exportTableFields = getExportTableFields(fields, fyo);

    return {
      limit: null,
      useListFilters: true,
      exportFormat: 'xlsx',
      fields: exportFields,
      tableFields: exportTableFields,
    } as ExportWizardData;
  },
  computed: {
    label() {
      if (this.pageTitle) {
        return this.pageTitle;
      }

      return fyo.schemaMap?.[this.schemaName]?.label ?? '';
    },
    filteredTableFields() {
      return this.tableFields.filter((f) => {
        const ef = this.getExportField(f.fieldname);
        return !!ef?.export;
      });
    },
    numSelected() {
      return (
        this.filteredTableFields.reduce(
          (acc, f) => f.fields.filter((f) => f.export).length + acc,
          0
        ) +
        this.fields.filter(
          (f) => f.fieldtype !== FieldTypeEnum.Table && f.export
        ).length
      );
    },
    configFields() {
      return {
        useListFilters: {
          fieldtype: 'Check',
          label: t`Use List Filters`,
          fieldname: 'useListFilters',
        } as Field,
        limit: {
          placeholder: 'Limit number of rows',
          fieldtype: 'Int',
          label: t`Limit`,
          fieldname: 'limit',
        } as Field,
        exportFormat: {
          fieldtype: 'Select',
          label: t`Export Format`,
          fieldname: 'exportFormat',
          options: [
            { value: 'xlsx', label: 'Microsoft Excel (.xlsx)' },
            { value: 'csv', label: 'CSV' },
            { value: 'json', label: 'JSON' },
          ],
        } as Field,
      };
    },
  },
  methods: {
    getField(ef: ExportField): Field {
      return {
        fieldtype: 'Check',
        label: ef.label,
        fieldname: ef.fieldname,
      };
    },
    getExportField(
      fieldname: string,
      target?: string
    ): ExportField | undefined {
      let fields: ExportField[] | undefined;

      if (!target) {
        fields = this.fields;
      } else {
        fields = this.tableFields.find((f) => f.target === target)?.fields;
      }

      if (!fields) {
        return undefined;
      }

      return fields.find((f) => f.fieldname === fieldname);
    },
    setExportFieldValue(ef: ExportField, value: boolean, target?: string) {
      const field = this.getExportField(ef.fieldname, target);
      if (!field) {
        return;
      }

      field.export = value;
    },
    async exportData() {
      if (this.numSelected === 0) {
        showToast({
          message: fyo.t`Select at least one field to export`,
          type: 'warning',
        });
        return;
      }

      const filters = JSON.parse(
        JSON.stringify(this.useListFilters ? this.listFilters : {})
      );

      try {
        let data: string;
        let encoding: 'utf8' | 'base64' = 'utf8';

        if (this.exportFormat === 'json') {
          data = await getJsonExportData(
            this.schemaName,
            this.fields,
            this.tableFields,
            this.limit,
            filters,
            fyo
          );
        } else if (this.exportFormat === 'xlsx') {
          data = await getXlsxExportBase64(
            this.schemaName,
            this.fields,
            this.tableFields,
            this.limit,
            filters,
            fyo
          );
          encoding = 'base64';
        } else {
          data = await getCsvExportData(
            this.schemaName,
            this.fields,
            this.tableFields,
            this.limit,
            filters,
            fyo
          );
        }

        await this.saveExportData(data, encoding);
      } catch (e) {
        showToast({
          message: `${fyo.t`Export failed`}: ${getErrorMessage(e as Error)}`,
          type: 'error',
        });
      }
    },
    async saveExportData(data: string, encoding: 'utf8' | 'base64' = 'utf8') {
      const fileName = this.getFileName();
      const { canceled, filePath } = await getSavePath(
        fileName,
        this.exportFormat
      );
      if (canceled || !filePath) {
        return;
      }

      await ipc.saveData(data, filePath, encoding);
      this.fyo.telemetry.log(Verb.Exported, this.schemaName, {
        extension: this.exportFormat,
      });
      showExportInFolder(fyo.t`Export Successful`, filePath);
    },
    getFileName() {
      const fileName = this.label.toLowerCase().replace(/\s/g, '-');
      const dateString = new Date().toISOString().split('T')[0];
      return `${fileName}_${dateString}`;
    },
  },
});
</script>
