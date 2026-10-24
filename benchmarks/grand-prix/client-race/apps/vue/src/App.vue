<script setup>
import { shallowRef, triggerRef } from 'vue';
import { buildData } from '../../../shared/data.js';

const rows = shallowRef([]);
const selected = shallowRef(null);

function run() { rows.value = buildData(1000); selected.value = null; }
function runLots() { rows.value = buildData(10000); selected.value = null; }
function add() { rows.value = rows.value.concat(buildData(1000)); }
function update() {
  const d = rows.value;
  for (let i = 0; i < d.length; i += 10) d[i] = { id: d[i].id, label: d[i].label + ' !!!' };
  triggerRef(rows);
}
function clear() { rows.value = []; selected.value = null; }
function swap() {
  const d = rows.value;
  if (d.length > 998) {
    const t = d[1]; d[1] = d[998]; d[998] = t;
    triggerRef(rows);
  }
}
function remove(id) {
  const d = rows.value;
  d.splice(d.findIndex((r) => r.id === id), 1);
  triggerRef(rows);
}
</script>

<template>
  <div id="controls">
    <button id="run" @click="run">Create 1,000 rows</button>
    <button id="runlots" @click="runLots">Create 10,000 rows</button>
    <button id="add" @click="add">Append 1,000 rows</button>
    <button id="update" @click="update">Update every 10th row</button>
    <button id="clear" @click="clear">Clear</button>
    <button id="swaprows" @click="swap">Swap Rows</button>
  </div>
  <table>
    <tbody>
      <tr v-for="row in rows" :key="row.id" :class="{ danger: selected === row.id }" v-memo="[row, selected === row.id]">
        <td class="col-id">{{ row.id }}</td>
        <td><a class="lbl" @click="selected = row.id">{{ row.label }}</a></td>
        <td><a class="remove" @click="remove(row.id)">x</a></td>
      </tr>
    </tbody>
  </table>
</template>
