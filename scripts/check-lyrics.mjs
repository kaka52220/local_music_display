import { parseFile } from 'music-metadata';
import fs from 'node:fs';

const dir = 'D:\\Script\\ncm2flac\\tools\\output';
const files = fs.readdirSync(dir).filter((f) => /\.(flac|mp3)$/i.test(f));

for (const file of files) {
  const path = `${dir}\\${file}`;
  const meta = await parseFile(path);
  console.log('====================', file);
  console.log('common 字段:', Object.keys(meta.common).join(', '));
  let hit = 0;
  for (const [tagType, tags] of Object.entries(meta.native)) {
    for (const tag of tags) {
      if (/USLT|SYLT|LYRICS|CUESHEET/i.test(tag.id)) {
        hit += 1;
        const val = JSON.stringify(tag.value);
        console.log(`  [歌词相关] ${tagType} / ${tag.id} ->`, val.slice(0, 200));
      }
    }
  }
  if (!hit) console.log('  未发现内嵌歌词字段（USLT/SYLT/LYRICS）');
}
