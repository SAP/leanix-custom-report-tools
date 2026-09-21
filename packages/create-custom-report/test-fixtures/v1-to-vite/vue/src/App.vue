<template>
  <div id="app"></div>
</template>

<script setup>
import { lx } from '@leanix/reporting';
lx.init().then(() => lx.ready({ facets: [] }));
</script>
