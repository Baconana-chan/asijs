<script setup>
// Same logical workload as the AsiJS SSR benchmark: a 100-row product table.
const items = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `Product ${i + 1}`,
  description: `This is the description for product ${i + 1}`,
  price: (Math.round(Math.random() * 10000) / 100).toFixed(2),
  inStock: Math.random() > 0.3,
}));
</script>

<template>
  <h1>Product List</h1>
  <table border="1">
    <thead>
      <tr><th>ID</th><th>Name</th><th>Description</th><th>Price</th><th>In Stock</th></tr>
    </thead>
    <tbody>
      <tr v-for="item in items" :key="item.id">
        <td>{{ item.id }}</td>
        <td>{{ item.name }}</td>
        <td>{{ item.description }}</td>
        <td>${{ item.price }}</td>
        <td>{{ item.inStock ? "Yes" : "No" }}</td>
      </tr>
    </tbody>
  </table>
</template>
