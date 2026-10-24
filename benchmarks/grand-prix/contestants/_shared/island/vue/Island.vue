<script setup>
import { ref, onMounted } from 'vue';
import { markReady } from './island-ready.mjs';
const count=ref(0);
onMounted(markReady);
</script>
<template>
<section id="gp-counter"><button id="gp-increment" type="button" @click="count += 1">Increment</button><output id="gp-count">{{ count }}</output></section>
</template>
