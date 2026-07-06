import { validateProjectFiles, formatStaticDiagnosticsForLlm } from '../services/staticValidationService.ts';

const tests = [
  { label: 'valid JS', files: [{ path: '/foo.js', content: 'export const x = 1;' }] },
  { label: 'JS syntax error', files: [{ path: '/foo.js', content: 'items.forEach(item => {}));' }] },
  { label: 'CSS lint error', files: [{ path: '/styles.css', content: 'body { display: flexx; }' }] },
  { label: 'CSS syntax error', files: [{ path: '/styles.css', content: 'body { color: ;' }] },
  { label: 'HTML missing-doctype', files: [{ path: '/index.html', content: '<div><span>hi</span></div>' }] },
  { label: 'TS file', files: [{ path: '/app.tsx', content: 'const x: number = 1;' }] },
  { label: 'SCSS file', files: [{ path: '/styles.scss', content: '$primary: #333; body { color: $primary; }' }] },
  { label: 'JSON syntax error', files: [{ path: '/data.json', content: '{"a": 1, "b":}' }] },
  { label: 'base64 skipped', files: [{ path: '/img.png', content: 'iVBORw0...', encoding: 'base64' }] },
  {
    label: 'inline script in HTML',
    files: [
      {
        path: '/index.html',
        content: [
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
        ].join('\n'),
      },
    ],
  },
];

for (const t of tests) {
  const result = await validateProjectFiles(t.files);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
  console.log(`\n=== ${t.label} ===`);
  console.log(`  ok=${result.ok} durationMs=${result.stats.durationMs.toFixed(2)}`);
  console.log(`  errors=${errors.length} warnings=${warnings.length}`);
  for (const d of result.diagnostics) {
    console.log(`  - [${d.lang}:${d.severity}] L${d.line}:${d.column} ${d.message} (rule=${d.rule})`);
  }
  if (result.diagnostics.length > 0) {
    console.log('  --- formatted ---');
    console.log(formatStaticDiagnosticsForLlm(result.diagnostics));
  }
}
