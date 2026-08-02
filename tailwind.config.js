/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sc64: {
          bg: 'var(--sc64-bg)',
          panel: 'var(--sc64-panel)',
          panel2: 'var(--sc64-panel2)',
          deep: 'var(--sc64-deep)',
          border: 'var(--sc64-border)',
          borderlight: 'var(--sc64-borderlight)',
          accent: 'var(--sc64-accent)',
          accent2: 'var(--sc64-accent2)',
          good: 'var(--sc64-good)',
          warn: 'var(--sc64-warn)',
          bad: 'var(--sc64-bad)',
          muted: 'var(--sc64-muted)',
          text: 'var(--sc64-text)'
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      boxShadow: {
        glow: 'var(--sc64-glow)'
      }
    }
  },
  plugins: []
}
