import { expect, it } from 'vitest';
import { isHttpsMediaLink, youtubeId } from '../../lib/source-links';

it('recognizes YouTube references without accepting lookalike hosts', () => {
  for (const url of ['https://youtu.be/YGaGz7t8Ov4', 'https://www.youtube.com/watch?v=YGaGz7t8Ov4', 'https://m.youtube.com/shorts/YGaGz7t8Ov4']) {
    expect(youtubeId(url)).toBe('YGaGz7t8Ov4');
    expect(isHttpsMediaLink(url)).toBe(false);
  }
  expect(youtubeId('https://youtube.com.example.org/watch?v=YGaGz7t8Ov4')).toBeNull();
  expect(youtubeId('https://user@youtube.com/watch?v=YGaGz7t8Ov4')).toBeNull();
  expect(isHttpsMediaLink('https://example.org/clip.webm?signature=abc')).toBe(true);
  expect(isHttpsMediaLink('http://example.org/clip.webm')).toBe(false);
});
