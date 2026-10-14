import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages at /<repo>/).
  base: './',
  build: {
    rollupOptions: {
      // The game, and the level editor at editor/ (paths relative to the project root).
      input: { main: 'index.html', editor: 'editor/index.html' },
    },
  },
});
