<script setup lang="ts">
import { showSidebar } from 'src/utils/refs';
import { toggleSidebar } from 'src/utils/ui';
</script>
<template>
  <div class="relative flex min-h-0 w-full overflow-hidden">
    <Transition name="sidebar">
      <!-- eslint-disable vue/require-explicit-emits -->
      <Sidebar
        v-show="showSidebar"
        class="
          flex-shrink-0
          border-e
          dark:border-gray-800
          whitespace-nowrap
          w-sidebar
        "
        :dark-mode="darkMode"
        @change-db-file="$emit('change-db-file')"
      />
    </Transition>

    <div
      class="
        flex flex-1
        overflow-y-hidden
        custom-scroll custom-scroll-thumb1
        bg-white
        dark:bg-gray-875
      "
    >
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component
            :is="Component"
            :key="$route.path"
            :dark-mode="darkMode"
            class="flex-1"
          />
        </keep-alive>
      </router-view>

      <router-view v-slot="{ Component, route }" name="edit">
        <Transition name="quickedit">
          <div v-if="route?.query?.edit">
            <component
              :is="Component"
              :key="route.query.schemaName + route.query.name"
              :dark-mode="darkMode"
            />
          </div>
        </Transition>
      </router-view>
    </div>

    <!-- Show Sidebar: must stay visible and above content (was opacity-0 + mis-positioned). -->
    <button
      v-show="!showSidebar"
      type="button"
      :title="t`Show sidebar`"
      class="
        window-no-drag
        absolute
        bottom-3
        start-3
        z-30
        flex
        items-center
        justify-center
        rounded-md
        border
        border-gray-200
        bg-gray-100
        p-2
        text-gray-700
        shadow-sm
        rtl-rotate-180
        dark:border-gray-700
        dark:bg-gray-800
        dark:text-gray-200
        dark:hover:bg-gray-875
        hover:bg-gray-200
      "
      @click="() => toggleSidebar()"
    >
      <feather-icon name="chevrons-right" class="h-4 w-4" />
    </button>
  </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import Sidebar from '../components/Sidebar.vue';
export default defineComponent({
  name: 'Desk',
  components: {
    Sidebar,
  },
  props: {
    darkMode: { type: Boolean, default: false },
  },
  emits: ['change-db-file'],
});
</script>

<style scoped>
.sidebar-enter-from,
.sidebar-leave-to {
  opacity: 0;
  transform: translateX(calc(-1 * var(--w-sidebar)));
  width: 0px;
}
[dir='rtl'] .sidebar-leave-to {
  opacity: 0;
  transform: translateX(calc(1 * var(--w-sidebar)));
  width: 0px;
}

.sidebar-enter-to,
.sidebar-leave-from {
  opacity: 1;
  transform: translateX(0px);
  width: var(--w-sidebar);
}

.sidebar-enter-active,
.sidebar-leave-active {
  transition: all 150ms ease-out;
}
</style>
