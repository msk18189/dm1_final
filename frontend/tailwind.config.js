/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        warm: {
          50: '#FAF6F0',
          100: '#F3EDE4',
          200: '#E8DDD0',
          300: '#D4C4B0',
          400: '#A89888',
          500: '#7A6B5C',
          600: '#5C4F44',
          700: '#453B33',
          800: '#3A322C',
          900: '#2C2620',
          950: '#1F1B17',
        },
        midnight: {
          DEFAULT: '#3A322C',
          50: '#2C2620',
          100: '#3A322C',
          200: '#5C4F44',
          300: '#7A6B5C',
          400: '#A89888',
          500: '#C4B5A5',
          600: '#D4C4B0',
          700: '#E8DDD0',
          800: '#F3EDE4',
          900: '#FAF6F0',
          950: '#FFFCF8',
        },
        palette: {
          emerald: { DEFAULT: '#7A9E87', light: '#E2EDE5', dark: '#4F6F59', text: '#5A7D66' },
          teal: { DEFAULT: '#6B8F7A', light: '#DCE8E0', dark: '#3D5C4A', text: '#4A6B58' },
          rose: { DEFAULT: '#C75D5D', light: '#F8E8E8', dark: '#8B3D3D', text: '#A84848' },
          amber: { DEFAULT: '#D4A054', light: '#F9F0E0', dark: '#9A7030', text: '#B8873A' },
          orange: { DEFAULT: '#C67B5C', light: '#F8EDE8', dark: '#8F5A42', text: '#A86548' },
          lime: { DEFAULT: '#9AAF5C', light: '#EEF2E0', dark: '#5C6B38', text: '#6D7D45' },
        },
        accent: {
          coral: '#C75D5D',
          teal: '#6B8F7A',
          amber: '#D4A054',
          emerald: '#7A9E87',
          orange: '#C67B5C',
          lime: '#9AAF5C',
          rose: '#C75D5D',
        },
        primary: '#1A1A1A',
        secondary: '#4B5563',
        muted: '#6B7280',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        shell: '28px',
        card: '20px',
      },
      boxShadow: {
        glow: '0 0 40px -8px rgba(198, 123, 92, 0.35)',
        'glow-landing': '0 8px 40px -8px rgba(198, 123, 92, 0.25), 0 0 60px -12px rgba(122, 158, 135, 0.2)',
        card: '0 4px 24px -6px rgba(44, 38, 32, 0.08)',
        shell: '0 4px 32px -8px rgba(44, 38, 32, 0.12)',
      },
      backgroundImage: {
        mesh:
          'radial-gradient(at 30% 20%, rgba(198, 123, 92, 0.12) 0px, transparent 50%), radial-gradient(at 70% 80%, rgba(122, 158, 135, 0.1) 0px, transparent 50%)',
      },
    },
  },
  plugins: [],
}
