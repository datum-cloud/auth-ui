import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const APP_DIR = new URL('../../../app/', import.meta.url).href;

const RAW_SUFFIX = '?raw';

registerHooks({
  load(url, context, nextLoad) {
    // Vite's `?raw` import: the file's text as the default export. The app is built by Vite, but
    // the node harness loads it through tsx, which has no such loader.
    if (url.startsWith(APP_DIR) && url.endsWith(RAW_SUFFIX)) {
      const text = readFileSync(new URL(url.slice(0, -RAW_SUFFIX.length)), 'utf8');
      return {
        format: 'module',
        shortCircuit: true,
        source: `export default ${JSON.stringify(text)};`,
      };
    }
    const result = nextLoad(url, context);
    if (!url.startsWith(APP_DIR) || result.source == null) return result;
    const source = String(result.source);
    if (!source.includes('import.meta.env')) return result;
    return { ...result, source: source.replaceAll('import.meta.env', 'process.env') };
  },
});
