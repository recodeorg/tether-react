import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    dts({
      // The root tsconfig is a solution file with `"files": []`, so the
      // plugin would otherwise emit nothing and still report success.
      tsconfigPath: './tsconfig.app.json',
      include: ['src/lib'],
      entryRoot: 'src/lib',
      afterBuild(files) {
        if (files.size === 0) {
          throw new Error('No declaration files were emitted.')
        }
      },
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/lib/index.ts'),
        clerk: resolve(import.meta.dirname, 'src/lib/clerk.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', '@tetherdb/client', /^@clerk\//],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
  },
})
