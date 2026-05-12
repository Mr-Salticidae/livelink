/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/**/*.{vue,ts,html}',
    './src/overlay/**/*.{vue,ts,html}'
  ],
  theme: {
    extend: {
      colors: {
        // 控制台基调：暗色 slate
        brand: {
          DEFAULT: '#3b82f6',
          dark: '#1e40af'
        }
      }
    }
  },
  plugins: []
}
