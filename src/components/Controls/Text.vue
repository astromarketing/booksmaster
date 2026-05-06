<template>
  <div class="min-w-0" :class="!showLabel ? 'h-full flex flex-col justify-center' : ''">
    <div v-if="showLabel" :class="labelClasses">
      {{ df.label }}
    </div>
    <div :class="showMandatory ? 'show-mandatory' : ''">
      <textarea
        ref="input"
        :rows="df.rows ?? rows"
        :class="['resize-none bg-transparent', inputClasses, containerClasses]"
        :value="value"
        :placeholder="inputPlaceholder"
        :readonly="isReadOnly"
        :tabindex="isReadOnly ? '-1' : '0'"
        @blur="(e) => triggerChange(e.target.value)"
        @focus="(e) => $emit('focus', e)"
        @input="(e) => $emit('input', e)"
      ></textarea>
    </div>
  </div>
</template>

<script>
import Base from './Base.vue';

export default {
  name: 'Text',
  extends: Base,
  props: { rows: { type: Number, default: 3 } },
  emits: ['focus', 'input'],
};
</script>
