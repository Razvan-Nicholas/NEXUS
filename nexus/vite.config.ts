import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const GOOGLE_FONTS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500&family=Space+Grotesk:wght@500;600&display=swap';

/** `vite build --mode remote-fonts`: link the fonts from Google Fonts instead of bundling the font files. */
function remoteFonts(): Plugin {
  return {
    name: 'nexus-remote-fonts',
    transformIndexHtml: (html) =>
      html.replace(
        '</head>',
        `    <link rel="preconnect" href="https://fonts.googleapis.com" />\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n    <link rel="stylesheet" href="${GOOGLE_FONTS}" />\n  </head>`,
      ),
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwindcss(), ...(mode === 'remote-fonts' ? [remoteFonts()] : [])],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: 0,
  },
}));
