import type { Settings } from './model';
export function resolveTheme(choice:Settings['theme'],editor:boolean,systemDark:boolean){return choice==='auto'?(editor?'dark':'light'):choice==='system'?(systemDark?'dark':'light'):choice;}
