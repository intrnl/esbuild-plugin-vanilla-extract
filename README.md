Fork of the official esbuild plugin, with a few changes:

- Changes how generated CSS files are imported internally, this removes the
  noise in the sourcemap.
- Adds a basic filesystem cache.
