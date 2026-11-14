import type { EditDocument } from './model';

export type EditingPreset = Pick<EditDocument, 'color' | 'fontSize' | 'bold' | 'captionBackground'> &
  Partial<Pick<EditDocument, 'captionAnimation' | 'captionHighlight' | 'captionY' | 'zoomPercent' | 'cropMode' |
  'saturation' | 'volume' | 'fadeIn' | 'fadeOut'>> & { name: string; description: string };

export function presetPatch({ name, description, ...settings }: EditingPreset): Partial<EditDocument> {
  void name;
  void description;
  return settings;
}

export const professionalPresets: EditingPreset[] = [
  { name: 'Cinematic Storytelling', description: 'Subtle motion and warm captions.', color: '#F5D68C', fontSize: 46, bold: false,
    captionBackground: false, captionAnimation: 'fade', captionHighlight: null, captionY: 75, zoomPercent: 105,
    cropMode: 'fill', saturation: .9, volume: 1, fadeIn: .25, fadeOut: .35 },
  { name: 'Educational Minimal', description: 'Clear captions and room for on-screen details.', color: '#FFFFFF', fontSize: 48,
    bold: true, captionBackground: true, captionAnimation: 'none', captionHighlight: '#B9D6FF', captionY: 73,
    zoomPercent: 100, cropMode: 'fit', saturation: 1, volume: 1, fadeIn: .05, fadeOut: .12 },
  { name: 'Gaming Highlights', description: 'High-contrast captions and full gameplay framing.', color: '#FFFFFF', fontSize: 56,
    bold: true, captionBackground: true, captionAnimation: 'pop', captionHighlight: '#F5E642', captionY: 72,
    zoomPercent: 100, cropMode: 'fit', saturation: 1.12, volume: .9, fadeIn: .04, fadeOut: .1 },
  { name: 'High-Energy Entertainment', description: 'A closer crop and animated word emphasis.', color: '#FFFFFF', fontSize: 60,
    bold: true, captionBackground: false, captionAnimation: 'pop', captionHighlight: '#FFCC49', captionY: 75,
    zoomPercent: 110, cropMode: 'fill', saturation: 1.08, volume: 1, fadeIn: .04, fadeOut: .1 },
];
