import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  // 試用ページ（1ファイル版）では、あとから読み込む部品も1つにまとめる
  build: process.env.ARTIFACT ? { rollupOptions: { output: { inlineDynamicImports: true } } } : {},
  plugins: [
    react(),
    // ARTIFACT=1 のときは試用ページ用（オフライン機能なしの1ファイル版）
    !process.env.ARTIFACT &&
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'めぐる — 声と写真の思い出ムービー',
        short_name: 'めぐる',
        description: '声と写真の思い出ムービー。写真・動画とその時の気持ちを記録して、ムービーのように見返せます',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#14110f',
        theme_color: '#14110f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
