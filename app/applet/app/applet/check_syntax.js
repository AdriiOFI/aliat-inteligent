const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const regex = /on[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
let match;
let found = 0;
let errors = [];

const lines = html.split('\n');

for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
  const line = lines[lineIdx];
  // reset regex
  const lineRegex = /on[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((match = lineRegex.exec(line)) !== null) {
    const val = match[1] || match[2] || '';
    found++;
    if (!val) continue;

    // Replace template interpolation like ${...} with dummy identifier 'x'
    const sanitizedVal = val.replace(/\$\{[^}]+\}/g, 'x');
    try {
      new Function(sanitizedVal);
    } catch(err) {
      errors.push({ line: lineIdx + 1, attr: match[0], error: err.message });
    }
  }
}

console.log(`Scanned ${found} event attributes. Syntax errors found: ${errors.length}`);
errors.forEach(e => {
  console.log(`Line ${e.line}: [${e.error}]`);
  console.log(`  Attr: ${e.attr.substring(0, 120)}`);
});
