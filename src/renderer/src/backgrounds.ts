/**
 * Renderer-side list of bundled preview background images, used by the menu
 * preview and the Gallery app theme. Vite inlines the URLs at build time from
 * the assets folder; the glob is eager so the list is available up front.
 */
export const BACKGROUNDS = Object.values(
  import.meta.glob('./assets/backgrounds/*.{png,jpg,jpeg,webp}', { eager: true, import: 'default' })
) as string[]
