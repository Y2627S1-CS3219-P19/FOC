import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` proxies API calls to the services running on the host, mirroring nginx.conf in the container.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1/suppliers': 'http://localhost:3002',
      '/v1/supplier-images': 'http://localhost:3002',
      '/v1/auth': 'http://localhost:3001',
      '/v1/users': 'http://localhost:3001',
      '/v1/admin': 'http://localhost:3001',
    },
  },
});
