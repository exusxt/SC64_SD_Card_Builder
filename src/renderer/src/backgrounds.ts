// Bundled menu background images, used by the console preview and the Gallery
// app theme. Vite inlines the URLs at build time from the assets folder.
export const BACKGROUNDS = Object.values(
  import.meta.glob('./assets/backgrounds/*.{png,jpg,jpeg,webp}', { eager: true, import: 'default' })
) as string[]
