import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function readRepositoryFile(path: string) {
  // Test-only repository path assembled from fixed literals below.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(join(root, path), 'utf8');
}

describe('public metadata', () => {
  it('keeps the landing page canonical, shareable, and described for software discovery', () => {
    const page = readRepositoryFile('src/app/page.tsx');

    expect(page).toContain("alternates: { canonical: '/' }");
    expect(page).toContain("url: '/opengraph-image'");
    expect(page).toContain("type=\"application/ld+json\"");
    expect(page).toContain("'@type': 'SoftwareApplication'");
  });

  it('uses dedicated application icons and blocks the specified AI-training crawlers', () => {
    const layout = readRepositoryFile('src/app/layout.tsx');
    const manifest = readRepositoryFile('public/manifest.json');
    const robots = readRepositoryFile('src/app/robots.ts');

    expect(layout).toContain('/icon-192.png');
    expect(layout).toContain('/icon-512.png');
    expect(layout).toContain('/apple-touch-icon.png');
    expect(manifest).toContain('"purpose": "any maskable"');
    expect(robots).toContain("userAgent: 'GPTBot'");
    expect(robots).toContain("userAgent: 'ClaudeBot'");
    expect(robots).toContain("userAgent: 'Google-Extended'");
  });
});
