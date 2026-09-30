/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        brand: {
          red: '#DB2E3C',
          'red-dark': '#B81E2B',
          cyan: '#0099C5',
          'cyan-light': '#1AB7EA',
          dark: '#171720',
          darker: '#0E0E14',
          gray: '#2C2D3A',
          light: '#F8F9FA',
          muted: '#8A8D9F',
        }
      },
      fontFamily: {
        heading: ['Montserrat', 'Impact', 'sans-serif'],
        sans: ['"Source Sans 3"', 'Inter', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
};
