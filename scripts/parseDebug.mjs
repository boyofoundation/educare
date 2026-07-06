import { parse } from 'parse5';

const html = [
  '<!doctype html>',
  '<html><head><title>x</title></head><body>',
  '',
  '',
  '',
  '',
  '',
  '<script>',
  'items.forEach(item => {}));',
  '</script>',
  '</body></html>',
].join('\n');

const doc = parse(html, { sourceCodeLocationInfo: true });

const findScripts = (n) => {
  if (n.nodeName === 'script') {
    console.log('SCRIPT element sourceCodeLocation:', JSON.stringify(n.sourceCodeLocation));
    if (n.childNodes) {
      for (const c of n.childNodes) {
        console.log('  child:', c.nodeName, 'sourceCodeLocation:', JSON.stringify(c.sourceCodeLocation), 'value:', JSON.stringify(c.value));
      }
    }
  }
  if (n.childNodes) {
    for (const c of n.childNodes) findScripts(c);
  }
};
findScripts(doc);
