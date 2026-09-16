import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ── MCT Brand: Green / White / Black ──────────────────
        brand: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981', // primary brand
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
          navy: '#064e3b',
          navyDark: '#022c22',
        },
        // ── Surface / Container colors ────────────────────────
        surface: {
          page: '#f9fafb',
          card: '#ffffff',
          elevated: '#ffffff',
          muted: '#f3f4f6',
          border: '#e5e7eb',
          'border-light': '#f3f4f6',
        },
        // ── Text hierarchy ─────────────────────────────────────
        text: {
          primary: '#111827',
          secondary: '#4b5563',
          muted: '#9ca3af',
          inverse: '#ffffff',
          link: '#059669',
        },
        // ── Status indicators ──────────────────────────────────
        status: {
          live: '#ef4444',
          scheduled: '#3b82f6',
          ended: '#6b7280',
          success: '#10b981',
          warning: '#f59e0b',
          error: '#ef4444',
          info: '#3b82f6',
        },
        // ── Sidebar ────────────────────────────────────────────
        sidebar: {
          bg: '#064e3b',
          text: '#a7f3d0',
          active: '#10b981',
          hover: '#065f46',
          divider: '#047857',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '112': '28rem',
      },
      borderRadius: {
        card: '16px',
        'card-lg': '20px',
        pill: '9999px',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        'card-hover': '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)',
        elevated: '0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        modal: '0 25px 50px -12px rgb(0 0 0 / 0.15)',
        nav: '0 1px 3px 0 rgb(0 0 0 / 0.08)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'fade-in-up': 'fadeInUp 0.4s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'progress-fill': 'progressFill 1s ease-out forwards',
        'count-up': 'countUp 0.6s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        progressFill: {
          '0%': { width: '0%' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
