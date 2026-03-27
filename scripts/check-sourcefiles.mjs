import fs from 'fs';
const wsDir = 'workspaces/veldmoor-chronicles';
if (fs.existsSync(wsDir + '/uploads')) {
  console.log('uploads:', fs.readdirSync(wsDir + '/uploads'));
} else { console.log('no uploads folder'); }
const notesDir = wsDir + '/notes';
for (const f of fs.readdirSync(notesDir).filter(f => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(notesDir + '/' + f, 'utf-8'));
  const sf = d.sourceFile || '';
  if (sf && !sf.includes('/')) {
    console.log('bare sourceFile:', f, '->', sf);
  }
}
