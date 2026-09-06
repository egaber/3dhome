export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--cp-bg)', surface: 'var(--cp-surface)',
        foreground: 'var(--cp-text)', primary: 'var(--cp-accent)',
        border: 'var(--cp-border)', muted: 'var(--cp-text-muted)',
      },
      borderRadius: { lg: '0.625rem', xl: '1rem' },
    },
  },
  plugins: [],
};