// Recovery utility: uses an existing npm tarball cache, never downloads packages.
const fs=require('fs'),path=require('path'),{Readable}=require('stream');
const npmRoot='C:/Program Files/nodejs/node_modules/npm/node_modules';
const cacache=require(npmRoot+'/cacache'),tar=require(npmRoot+'/tar'),semver=require(npmRoot+'/semver');
const cache=process.argv[2];
async function main(){
 const entries=await cacache.ls(cache);const available=new Map();
 for(const [key,e] of Object.entries(entries)){const m=key.match(/registry\.npmjs\.org\/(.+)\/-\/[^/]+-(\d+\.\d+\.\d+(?:-[^/]+)?)\.tgz$/);if(m){const rows=available.get(m[1])||[];rows.push({version:m[2],key,integrity:e.integrity});available.set(m[1],rows);}}
 const installed=new Set();
 async function install(name,range,parent=process.cwd(),optional=false){
  if(name.startsWith('@esbuild/')&&!name.includes('win32-x64'))return;
  if(name.startsWith('@rollup/rollup-')&&!name.includes('win32-x64-msvc'))return;
  const dir=path.join(parent,'node_modules',name);let existing;
  try{existing=JSON.parse(fs.readFileSync(dir+'/package.json'));}catch{}
  if(existing&&semver.satisfies(existing.version,range))return;
  if(parent!==process.cwd()){try{const root=JSON.parse(fs.readFileSync(path.join(process.cwd(),'node_modules',name,'package.json')));if(semver.satisfies(root.version,range))return;}catch{}}
  const record=(available.get(name)||[]).filter(x=>semver.satisfies(x.version,range)).sort((a,b)=>semver.rcompare(a.version,b.version))[0];
  if(!record){if(optional)return;throw Error('Not cached: '+name+' '+range);}
  const target=existing?path.join(parent,'node_modules',name,'node_modules',name):dir;
  if(installed.has(target))return;installed.add(target);fs.mkdirSync(target,{recursive:true});
  const {data}=await cacache.get(cache,record.key);await new Promise((resolve,reject)=>Readable.from(data).pipe(tar.x({cwd:target,strip:1})).on('finish',resolve).on('error',reject));
  const p=JSON.parse(fs.readFileSync(target+'/package.json'));console.log(name,p.version);
  for(const [n,r] of Object.entries(p.dependencies||{}))await install(n,r,target);
  for(const [n,r] of Object.entries(p.optionalDependencies||{}))await install(n,r,target,true);
  const bins=typeof p.bin==='string'?{[name.split('/').at(-1)]:p.bin}:p.bin||{};
  const binDir=path.join(process.cwd(),'node_modules','.bin');fs.mkdirSync(binDir,{recursive:true});
  for(const [n,b] of Object.entries(bins)){const rel=path.relative(binDir,path.join(target,b));fs.writeFileSync(path.join(binDir,n+'.cmd'),'@echo off\r\nnode "%~dp0'+rel+'" %*\r\n');}
 }
 await install('lucide-react','0.468.0');await install('zustand','5.0.13');await install('vitest','2.1.9');await install('prettier','3.8.1');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
