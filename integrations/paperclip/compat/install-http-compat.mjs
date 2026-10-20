#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [serverDirectory,backupDirectory,apply]=process.argv.slice(2);
if(!serverDirectory||!backupDirectory||apply!=='--apply')throw Error('Usage: install-http-compat.mjs SERVER_DIRECTORY BACKUP_DIRECTORY --apply');
const server=fs.realpathSync(serverDirectory),version=JSON.parse(fs.readFileSync(path.join(server,'package.json'),'utf8')).version;
if(version!=='2026.1012.0')throw Error('PAPERCLIP_COMPAT_UNSUPPORTED_VERSION');
const ui=path.join(server,'ui-dist'),index=path.join(ui,'index.html'),before=fs.readFileSync(index,'utf8');
const source=fs.readFileSync(new URL('./http-uuid.js',import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
const asset='paperclip-http-uuid-'+hash(source).slice(0,16)+'.js',tag='<script src="/assets/'+asset+'"></script>';
if(before.includes(tag)){
 if(!fs.readFileSync(path.join(ui,'assets',asset)).equals(source))throw Error('PAPERCLIP_COMPAT_ASSET_CHANGED');
 process.stdout.write('Already installed and verified.\n');process.exit(0);
}
const marker='<script type="module" crossorigin src="/assets/index-xCoSuYwt.js"></script>';
if(before.split(marker).length!==2||before.includes('paperclip-http-uuid-'))throw Error('PAPERCLIP_COMPAT_UNEXPECTED_INDEX');
const after=before.replace(marker,tag+'\n    '+marker),backup=path.resolve(backupDirectory);
fs.mkdirSync(backup,{recursive:true,mode:0o700});
const original=path.join(backup,'index-before-http-uuid.html');
if(fs.existsSync(original)&&fs.readFileSync(original,'utf8')!==before)throw Error('PAPERCLIP_COMPAT_BACKUP_MISMATCH');
if(!fs.existsSync(original))fs.writeFileSync(original,before,{flag:'wx',mode:0o600});
const target=path.join(ui,'assets',asset);
if(fs.existsSync(target)&&!fs.readFileSync(target).equals(source))throw Error('PAPERCLIP_COMPAT_ASSET_CHANGED');
fs.writeFileSync(target,source,{mode:0o644});
fs.writeFileSync(index+'.http-uuid.tmp',after,{mode:fs.statSync(index).mode&0o777});fs.renameSync(index+'.http-uuid.tmp',index);
fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({version,index,original,asset:target,beforeSha256:hash(before),afterSha256:hash(after),sourceSha256:hash(source)},null,2)+'\n',{mode:0o600});
process.stdout.write('Installed compatibility asset; original index and hashes saved. Reload the page and verify actual submission.\n');
