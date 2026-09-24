// Copy the agent skill source into the site so it is served at the stable URL
// https://www.gifcompressors.com/skill/SKILL.md
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const src = join(root, '../skills/gif-compressor/SKILL.md');
const dest = join(root, 'public/skill/SKILL.md');

mkdirSync(join(root, 'public/skill'), { recursive: true });
copyFileSync(src, dest);
console.log('sync-skill: skills/gif-compressor/SKILL.md -> public/skill/SKILL.md');
