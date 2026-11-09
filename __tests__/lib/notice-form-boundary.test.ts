import { readFileSync } from 'fs';
import { join } from 'path';

describe('notice form request boundary', () => {
  it('routes notice mutations through the canonical society-aware fetch helper', () => {
    const path = join(process.cwd(), 'src/components/notices/NoticeForm.tsx');
    const source = readFileSync(path, 'utf8');

    expect(source).toMatch(/import\s*{\s*societyFetch\s*}\s*from\s*['"]@\/lib\/society-path['"]/);
    expect(source).toContain('await societyFetch(path, {');
    expect(source).not.toMatch(/await\s+fetch\s*\(/);
  });
});
