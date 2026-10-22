import { registerHooks } from 'node:module';

const APP_DIR = new URL('../../../app/', import.meta.url).href;

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith(APP_DIR) || result.source == null) return result;
    const source = String(result.source);
    if (!source.includes('import.meta.env')) return result;
    return { ...result, source: source.replaceAll('import.meta.env', 'process.env') };
  },
});
