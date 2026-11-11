const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

const lines = html.split('\n');
lines.forEach((line, idx) => {
  const lineNo = idx + 1;
  // match onclick="... '${...}' ..." or onclick="... &apos;${...}&apos; ..."
  if (line.includes('onclick=')) {
    const matches = line.match(/onclick\s*=\s*"[^"]*'/gi);
    if (matches) {
      console.log(`Line ${lineNo}: ${line.trim().substring(0, 160)}`);
    }
  }
});
