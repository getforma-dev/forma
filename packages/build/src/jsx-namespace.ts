import {readFileSync} from 'node:fs';
import {dirname,extname} from 'node:path';
import type {Plugin} from 'esbuild';
import {transformJsxNamespaces} from '../../shared/jsx-namespace.mjs';

/** Last source loader: an SSR snapshot owner gets first refusal and composes its own edits. */
export function jsxNamespaceFallback():Plugin {
  return {name:'forma-jsx-namespace',setup(build){
    const sources=new Map<string,string>();
    build.onStart(()=>{sources.clear();});
    build.onLoad({filter:/\.[jt]sx$/,namespace:'file'},args=>{
      const original=readFileSync(args.path,'utf8'),contents=transformJsxNamespaces(original,{factory:build.initialOptions.jsxFactory??'React.createElement',runtime:build.initialOptions.jsx});
      if(contents===original)return;
      sources.set(args.path,original);
      return {contents,loader:extname(args.path)==='.tsx'?'tsx':'jsx',resolveDir:dirname(args.path),watchFiles:[args.path]};
    });
    build.onEnd(result=>{
      if(result.errors.length)return;
      for(const [file,source] of sources) {
        try {if(readFileSync(file,'utf8')===source)continue;} catch { /* Deleted source also invalidates the product. */ }
        return {errors:[{text:`BUILD-610 JSX source changed while compiling ${file}; retry to publish one source generation`}]};
      }
    });
  }};
}
