const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

// Find all template literals in JS code
const lines = html.split('\n');
let onclickLines = [];

lines.forEach((line, idx) => {
  if (line.includes('onclick=')) {
    onclickLines.push({ lineNo: idx + 1, text: line.trim() });
  }
});

console.log(`Found ${onclickLines.length} lines containing 'onclick='`);

// Let's filter lines that have single quotes inside single quotes or complex string building
onclickLines.forEach(item => {
  // Check if line has onclick="... '${...}' ..."
  if (/onclick\s*=\s*"[^"]*'\$\{[^}]+\}'[^"]*"/i.test(item.text) || /onclick\s*=\s*'[^']*"\$\{[^}]+\}"[^']*'/i.test(item.text)) {
    console.log(`Line ${item.lineNo}: suspicious string interpolation in onclick`);
    console.log(`  ${item.text.substring(0, 150)}`);
  }
});
