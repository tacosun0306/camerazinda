import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#182421',
        canvas: '#f3f5f0',
        fern: '#30594b',
        lime: '#c7ef62',
        coral: '#e36d52',
      },
      fontFamily: {
        sans: ['Avenir Next', 'Segoe UI Variable', 'sans-serif'],
        display: ['Georgia', 'serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};

export default config;