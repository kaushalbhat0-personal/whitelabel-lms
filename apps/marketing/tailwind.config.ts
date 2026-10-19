import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Fixed marketing tokens (MKT-01A). NOT connected to BusinessConfig.
        cream: '#FAF7F2',
        paper: '#FFFFFF',
        sand: '#F3EFE7',
        clay: {
          DEFAULT: '#C2410C',
          dark: '#9A3412',
        },
        teal: {
          DEFAULT: '#0F766E',
          dark: '#115E59',
        },
        ink: {
          DEFAULT: '#1C1917',
          soft: '#57534E',
        },
        line: '#E7E0D3',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        // Single editorial display face (MKT-02B). Headlines only; body stays Inter.
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      maxWidth: {
        content: '80rem', // 1280px editorial cap
      },
      borderRadius: {
        card: '12px',
        hero: '20px',
        cta: '10px',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(28 25 23 / 0.05), 0 1px 2px -1px rgb(28 25 23 / 0.07)',
        'card-hover': '0 12px 24px -8px rgb(28 25 23 / 0.12), 0 4px 8px -4px rgb(28 25 23 / 0.06)',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.35s ease-out both',
        'fade-in': 'fadeIn 0.25s ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
