import {describe,it,expect} from 'vitest';
import {newProject,newClip,sampleProject,validateFile} from '../../lib/repository';

it('applies project aspect and caption style to a new manual clip', () => {
  const project = newProject('My footage');
  project.preferences.ratio = '1:1';
  project.preferences.captionStyle = 'Cinematic Story';
  expect(newClip(project, 2000, 8000).edit).toMatchObject({
    ratio: '1:1', color: '#F5D68C', fontSize: 46, bold: false,
    sourceInMs: 2000, sourceOutMs: 8000,
  });
});
describe('repository domain',()=>{it('never assigns demo results to real projects',()=>{const p=newProject('My footage');const c=newClip(p,2000,8000);expect(p.mode).toBe('real');expect(c.sourceKind).toBe('manual');expect(c.score).toBeUndefined();expect(c.edit.sourceInMs).toBe(2000);});it('seeds stable and clearly identified demo records',()=>{expect(sampleProject().id).toBe(sampleProject().id);expect(sampleProject().mode).toBe('demo');expect(sampleProject().clips[0].score).toBe(92);});it('validates file containers and bounded size',()=>{expect(validateFile({name:'video.mp4',size:1024})).toBe('');expect(validateFile({name:'video.exe',size:1024})).toContain('Choose');expect(validateFile({name:'video.mp4',size:0})).toContain('empty');expect(validateFile({name:'video.mp4',size:3*1024**3})).toContain('2 GB');});});
