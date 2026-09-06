import { defineConfig, mergeConfig } from 'vite';
import userConfig from './vite.config.js';
export default mergeConfig(userConfig, defineConfig({
  server: { hmr: { port: 5173, clientPort: 443 }, strictPort: true, allowedHosts: true },
}));
