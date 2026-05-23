import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Protocol palette — exposed for HUD components in Phase 3.
        genesis: '#FF5722',
        sentinel: '#9C27B0',
        routing: '#03A9F4',
        settlement: '#FFC107',
        eco: '#8BC34A',
      },
      fontFamily: {
        // Phase 3 will swap these out for the bespoke serif used in
        // the boardroom mockup (something in the Cormorant / Tiempos family).
        display: ['Cormorant Garamond', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
