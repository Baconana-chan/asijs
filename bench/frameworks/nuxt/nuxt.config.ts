// nitro preset "bun" → production server output runs directly on Bun:
//   bun .output/server/index.mjs   (PORT env selects the port)
export default defineNuxtConfig({
  devtools: { enabled: false },
  ssr: true,
  nitro: {
    preset: "bun",
  },
});
