import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // MD2 Brand
        primary: {
          DEFAULT: 'rgb(var(--md-primary) / <alpha-value>)',
          dark: 'rgb(var(--md-primary-dark) / <alpha-value>)',
          light: 'rgb(var(--md-primary-light) / <alpha-value>)',
          on: 'rgb(var(--md-on-primary) / <alpha-value>)',
          container: 'rgb(var(--md-primary-light) / <alpha-value>)',
          'on-container': 'rgb(var(--md-primary-dark) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'rgb(var(--md-secondary) / <alpha-value>)',
          on: 'rgb(var(--md-on-secondary) / <alpha-value>)',
          container: 'rgb(var(--md-secondary-container) / <alpha-value>)',
          'on-container': 'rgb(var(--md-on-secondary-container) / <alpha-value>)',
        },
        tertiary: {
          DEFAULT: 'rgb(var(--md-secondary) / <alpha-value>)',
          on: 'rgb(var(--md-on-secondary) / <alpha-value>)',
          container: 'rgb(var(--md-secondary-container) / <alpha-value>)',
          'on-container': 'rgb(var(--md-on-secondary-container) / <alpha-value>)',
        },
        background: 'rgb(var(--md-background) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--md-surface) / <alpha-value>)',
          dim: 'rgb(var(--md-background) / <alpha-value>)',
          bright: 'rgb(var(--md-surface) / <alpha-value>)',
          variant: 'rgb(var(--md-surface-variant) / <alpha-value>)',
          on: 'rgb(var(--md-on-surface) / <alpha-value>)',
          'on-variant': 'rgb(var(--md-on-surface-variant) / <alpha-value>)',
        },
        outline: {
          DEFAULT: 'rgb(var(--md-outline) / <alpha-value>)',
          variant: 'rgb(var(--md-divider) / <alpha-value>)',
        },
        divider: 'rgb(var(--md-divider) / <alpha-value>)',
        error: {
          DEFAULT: 'rgb(var(--md-error) / <alpha-value>)',
          on: 'rgb(var(--md-on-error) / <alpha-value>)',
          container: 'rgb(var(--md-error-container) / <alpha-value>)',
          'on-container': 'rgb(var(--md-on-error-container) / <alpha-value>)',
        },
        success: 'rgb(var(--md-success) / <alpha-value>)',
        warning: 'rgb(var(--md-warning) / <alpha-value>)',
        // Inverse (用于 snackbar 之类) — 与原 MD3 兼容
        'inverse-surface': 'rgb(var(--md-on-surface) / <alpha-value>)',
        'inverse-on-surface': 'rgb(var(--md-surface) / <alpha-value>)',
        'inverse-primary': 'rgb(var(--md-primary-light) / <alpha-value>)',
      },
      borderRadius: {
        // MD2 偏向更小、更"硬"的圆角
        none: '0',
        xs: '2px',
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
        '3xl': '24px',
        full: '9999px',
      },
      boxShadow: {
        // MD2 elevation spec
        'elevation-0': 'none',
        'elevation-1': 'var(--md-elevation-1)',
        'elevation-2': 'var(--md-elevation-2)',
        'elevation-3': 'var(--md-elevation-4)',
        'elevation-4': 'var(--md-elevation-4)',
        'elevation-6': 'var(--md-elevation-6)',
        'elevation-8': 'var(--md-elevation-8)',
        'elevation-16': 'var(--md-elevation-16)',
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"Roboto"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'ripple-expand': {
          '0%': { transform: 'scale(0)', opacity: '0.4' },
          '100%': { transform: 'scale(2.5)', opacity: '0' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'heart-beat': {
          '0%, 100%': { transform: 'scale(1)' },
          '25%': { transform: 'scale(1.3)' },
          '50%': { transform: 'scale(0.95)' },
          '75%': { transform: 'scale(1.15)' },
        },
      },
      animation: {
        'ripple-expand': 'ripple-expand 600ms ease-out forwards',
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 220ms ease-out',
        'heart-beat': 'heart-beat 400ms ease-in-out',
      },
      transitionTimingFunction: {
        // MD2 标准缓动曲线
        'md-standard': 'cubic-bezier(0.4, 0.0, 0.2, 1)',
        'md-decelerate': 'cubic-bezier(0.0, 0.0, 0.2, 1)',
        'md-accelerate': 'cubic-bezier(0.4, 0.0, 1, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config
