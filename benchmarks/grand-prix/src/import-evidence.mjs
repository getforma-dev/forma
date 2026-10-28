import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { acquire, hash, runPath, safePath, writeJSON, seal } from './session.mjs';
import { generateReport } from './report.mjs';

export function importEvidence(root, relative, id) {
  // Deliberately limited to this repository's preserved evidence, not arbitrary downloads.
  if(typeof relative!=='string'||!relative.startsWith('evidence/')||!relative.endsWith('.zip'))throw Error('Select a retained evidence/*.zip archive');
  const archive=safePath(root,relative),destination=runPath(root,id);
  if(fs.existsSync(destination))throw Error('Run ID already exists');
  const release=acquire(root,id,{operation:'import'});
  try {
    fs.mkdirSync(destination,{recursive:true});
    const bytes=fs.readFileSync(archive),digest=hash(bytes);
    const manifest={schemaVersion:1,id,status:'historical',mode:'historical',quality:'historical-import',protocolVersion:'recorded-in-original-artifacts',
      startedAt:new Date().toISOString(),importedAt:new Date().toISOString(),archive:{path:relative,sha256:digest,bytes:bytes.length},
      note:'Imported observations, not a new race. Original campaign/source identities and qualification limitations remain in every raw record.'};
    writeJSON(path.join(destination,'manifest.json'),manifest,true);
    fs.writeFileSync(path.join(destination,'original.zip'),bytes,{flag:'wx'});
    const output=path.join(destination,'artifacts');fs.mkdirSync(output);
    // Python's standard library is already used by the retained evidence verifiers.
    const script=`import zipfile, pathlib, stat, sys
archive,out=sys.argv[1:]; root=pathlib.Path(out).resolve()
with zipfile.ZipFile(archive) as z:
 infos=z.infolist()
 assert len(infos)<=20000 and sum(i.file_size for i in infos)<=512*1024*1024, 'archive exceeds import limits'
 names=set()
 for i in infos:
  p=pathlib.PurePosixPath(i.filename)
  assert not p.is_absolute() and '..' not in p.parts and '\\\\' not in i.filename, 'unsafe archive path'
  assert i.filename not in names, 'duplicate archive member'
  names.add(i.filename)
  assert not stat.S_ISLNK(i.external_attr >> 16), 'linked archive member'
  assert (root / str(p)).resolve().is_relative_to(root), 'path escapes archive'
 for i in infos:
  p=root / i.filename
  if i.is_dir(): p.mkdir(parents=True,exist_ok=True)
  else:
   p.parent.mkdir(parents=True,exist_ok=True)
   with p.open('xb') as f: f.write(z.read(i))
print(len(infos))`;
    try {manifest.importedMembers=Number(execFileSync('python3',['-c',script,path.join(destination,'original.zip'),output],{encoding:'utf8',timeout:60000}));}
    catch(e){manifest.status='failed';manifest.error='Archive import rejected: '+e.message;writeJSON(path.join(destination,'manifest.json'),manifest);seal(destination);throw e;}
    manifest.finishedAt=new Date().toISOString();writeJSON(path.join(destination,'manifest.json'),manifest);
    const report=generateReport(destination);
    manifest.observedAt=report.measurements.map(m=>m.context?.campaign?.createdAt).filter(Boolean).sort()[0]||null;
    writeJSON(path.join(destination,'manifest.json'),manifest);generateReport(destination);seal(destination);return {id,directory:destination,archiveSha256:digest};
  }finally{release();}
}
