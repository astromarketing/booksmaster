<template>
  <div class="text-sm" @click.stop @mousedown.stop>
    <div
      v-if="!expanded"
      class="flex items-center justify-between gap-2 px-2 py-2"
    >
      <span class="text-xs text-gray-600 dark:text-gray-400 truncate">
        {{ t`Description presets` }}
      </span>
      <button
        type="button"
        class="
          shrink-0
          flex items-center justify-center
          w-7 h-7 rounded-md
          border border-gray-200 dark:border-gray-700
          bg-gray-50 dark:bg-gray-875
          text-gray-700 dark:text-gray-300
          hover:bg-gray-100 dark:hover:bg-gray-800
          focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        "
        :title="t`Manage description presets`"
        :aria-label="t`Expand description presets`"
        @click="expanded = true"
      >
        <feather-icon name="plus" class="w-4 h-4" />
      </button>
    </div>
    <div v-else class="px-2 py-2.5 space-y-2">
      <div class="flex items-start justify-between gap-2">
        <p
          class="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 pt-0.5"
        >
          {{ t`Description presets` }}
        </p>
        <button
          type="button"
          class="
            shrink-0
            flex items-center justify-center
            w-7 h-7 rounded-md
            border border-gray-200 dark:border-gray-700
            bg-gray-50 dark:bg-gray-875
            text-gray-700 dark:text-gray-300
            hover:bg-gray-100 dark:hover:bg-gray-800
            focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
          "
          :title="t`Hide preset manager`"
          :aria-label="t`Collapse description presets`"
          @click="collapse"
        >
          <feather-icon name="minus" class="w-4 h-4" />
        </button>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-500 leading-snug">
        {{
          t`Add lines you reuse on sales invoices and quotes. They appear above; you can still type any other text in the field.`
        }}
      </p>
      <div class="flex gap-2 items-stretch">
      <input
        v-model="draft"
        type="text"
        class="
          flex-1
          min-w-0
          text-sm
          rounded
          border
          border-gray-200
          dark:border-gray-700
          bg-white
          dark:bg-gray-875
          text-gray-900
          dark:text-gray-100
          px-2
          py-1.5
          focus:outline-none
          focus:ring-1
          focus:ring-blue-500
        "
        :placeholder="t`New preset…`"
        @keydown.enter.prevent="add"
      />
      <Button
        type="primary"
        class="shrink-0 text-xs !px-3 !h-auto min-h-[2rem]"
        :padding="true"
        @click="add"
      >
        {{ t`Add` }}
      </Button>
      </div>
      <ul
      v-if="lines.length"
      class="
        max-h-28
        overflow-auto
        custom-scroll custom-scroll-thumb1
        rounded
        border border-gray-100 dark:border-gray-800
        divide-y divide-gray-100 dark:divide-gray-800
      "
    >
      <li
        v-for="line in lines"
        :key="line"
        class="flex items-center justify-between gap-2 px-2 py-1.5 text-xs"
      >
        <span class="truncate text-gray-800 dark:text-gray-200" :title="line">{{
          line
        }}</span>
        <button
          type="button"
          class="
            shrink-0
            p-1
            rounded
            text-gray-500
            hover:text-red-600
            hover:bg-red-50
            dark:hover:bg-gray-800
            dark:hover:text-red-400
            focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500
          "
          :title="t`Remove preset`"
          @click="remove(line)"
        >
          <feather-icon name="trash-2" class="w-3.5 h-3.5" />
        </button>
      </li>
      </ul>
    </div>
  </div>
</template>

<script lang="ts">
import { ModelNameEnum } from 'models/types';
import Button from 'src/components/Button.vue';
import { fyo } from 'src/initFyo';
import { getErrorMessage } from 'src/utils';
import { showToast } from 'src/utils/interactive';
import { defineComponent } from 'vue';

const FIELD = 'salesInvoiceItemDescriptionOptions';

export default defineComponent({
  name: 'DescriptionPresetManager',
  components: { Button },
  emits: ['updated'],
  data() {
    return {
      expanded: false,
      draft: '',
      lines: [] as string[],
    };
  },
  mounted() {
    this.refreshLines();
  },
  methods: {
    collapse() {
      this.expanded = false;
      this.draft = '';
    },
    refreshLines() {
      const raw = (
        fyo.singles.Defaults as { salesInvoiceItemDescriptionOptions?: string } | undefined
      )?.salesInvoiceItemDescriptionOptions;
      this.lines = this.parseRaw(raw);
    },
    parseRaw(raw: string | undefined | null): string[] {
      if (typeof raw !== 'string' || !raw.trim()) {
        return [];
      }
      return raw
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    },
    async add() {
      const text = this.draft.trim();
      if (!text) {
        return;
      }
      if (this.lines.includes(text)) {
        showToast({
          message: this.t`This preset is already in the list`,
          type: 'warning',
        });
        return;
      }
      try {
        const defaults = await fyo.doc.getDoc(ModelNameEnum.Defaults);
        const next = [...this.lines, text].join('\n');
        await defaults.setAndSync(FIELD, next);
        this.draft = '';
        this.refreshLines();
        this.$emit('updated');
        showToast({ message: this.t`Preset saved`, type: 'success' });
      } catch (e) {
        showToast({
          message: getErrorMessage(e as Error),
          type: 'error',
        });
      }
    },
    async remove(line: string) {
      try {
        const defaults = await fyo.doc.getDoc(ModelNameEnum.Defaults);
        const next = this.lines.filter((l) => l !== line);
        await defaults.setAndSync(FIELD, next.length ? next.join('\n') : '');
        this.refreshLines();
        this.$emit('updated');
        showToast({ message: this.t`Preset removed`, type: 'success' });
      } catch (e) {
        showToast({
          message: getErrorMessage(e as Error),
          type: 'error',
        });
      }
    },
  },
});
</script>
