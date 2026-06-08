import fs from 'fs';

const fileContent = fs.readFileSync('src/App.tsx', 'utf8');
const lines = fileContent.split('\n');

let state = 'JSX'; // JSX, JS, STRING_DOUBLE, STRING_SINGLE, STRING_BACKTICK, COMMENT_LINE, COMMENT_BLOCK, JSX_COMMENT

for (let lineIdx = 1893; lineIdx < 5000; lineIdx++) {
  const lineNo = lineIdx + 1;
  const line = lines[lineIdx];
  if (!line) continue;
  
  let oldState = state;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i+1] || '';
    
    // Simple state machine
    if (state === 'JSX') {
      if (char === '{') {
        state = 'JS';
      }
    } else if (state === 'JS') {
      if (char === '}') {
        state = 'JSX'; // simplified check
      } else if (char === '"') {
        state = 'STRING_DOUBLE';
      } else if (char === "'") {
        state = 'STRING_SINGLE';
      } else if (char === '`') {
        state = 'STRING_BACKTICK';
      } else if (char === '/' && nextChar === '/') {
        break;
      } else if (char === '/' && nextChar === '*') {
        state = 'COMMENT_BLOCK';
        i++;
      }
    } else if (state === 'STRING_DOUBLE') {
      if (char === '"' && line[i-1] !== '\\') {
        state = 'JS';
      }
    } else if (state === 'STRING_SINGLE') {
      if (char === "'" && line[i-1] !== '\\') {
        state = 'JS';
      }
    } else if (state === 'STRING_BACKTICK') {
      if (char === '`' && line[i-1] !== '\\') {
        state = 'JS';
      }
    } else if (state === 'COMMENT_BLOCK') {
      if (char === '*' && nextChar === '/') {
        state = 'JS';
        i++;
      }
    }
  }
  
  if (state !== oldState) {
    console.log(`Line ${lineNo}: state transitioned from ${oldState} to ${state} | ${line.trim().substring(0, 70)}`);
  }
}
