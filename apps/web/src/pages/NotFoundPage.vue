<template>
  <div class="d-flex flex-column align-center" style="min-height: 80vh; justify-content: center">
    <div class="mark mb-4">¥₹</div>
    <v-card class="mx-auto" max-width="480" width="100%">
      <v-card-title class="text-h5 font-weight-bold pt-6">Page not found</v-card-title>
      <v-card-text>There is nothing at this address.</v-card-text>
      <v-card-actions class="pb-4 px-4"><v-btn to="/" color="primary">Go to the dashboard</v-btn></v-card-actions>
    </v-card>
  </div>
</template>

<style scoped>
.mark {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  display: grid;
  place-items: center;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
</style>
