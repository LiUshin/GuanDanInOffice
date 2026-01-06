/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/client/**/*.{js,jsx,ts,tsx}",
    "./src/client/index.html",
  ],
  theme: {
    extend: {
      animation: {
        'bounce-in': 'bounceIn 0.4s ease-out',
        'fade-out': 'fadeOut 0.5s ease-in forwards',
      },
      keyframes: {
        bounceIn: {
          '0%': { opacity: '0', transform: 'translateX(-50%) scale(0.3)' },
          '50%': { opacity: '1', transform: 'translateX(-50%) scale(1.05)' },
          '100%': { transform: 'translateX(-50%) scale(1)' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
