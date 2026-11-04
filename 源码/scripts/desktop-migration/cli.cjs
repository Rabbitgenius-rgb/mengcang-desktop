#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const api=require('./core.cjs');
const [command,...args]=process.argv.slice(2);const options={};
for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||args[i+1]===undefined)throw new Error('Expected --name value');options[args[i].slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=args[i+1];}
try{
 let result;
 if(command==='plan'||command==='inspect')result=api.createPlan(options);
 else if(command==='apply')result=api.applyPlan(options);
 else if(command==='verify')result=api.verifyPlan(options);
 else if(command==='restore')result=api.restorePlan(options);
 else if(command==='test-copy')result=api.prepareTestVault(options);
 else throw new Error('Usage: cli.cjs plan --preview DIR --vault DIR --out BUNDLE [--purposes FILE] [--browser-export FILE] | apply/verify/restore --bundle BUNDLE --vault DIR | test-copy --plan-bundle BUNDLE --out DIR');
 if(command==='plan'||command==='inspect') console.log(JSON.stringify({ok:result.conflicts.length===0,plan:path.join(path.resolve(options.out),'plan.json'),report:path.join(path.resolve(options.out),'report.md'),counts:result.counts,actions:result.operations.reduce((a,o)=>(a[o.action]=(a[o.action]||0)+1,a),{}),conflicts:result.conflicts,previewRecovery:result.previewRecovery},null,2));
 else console.log(JSON.stringify(result,null,2));
 if(result.ok===false||result.conflicts?.length)process.exitCode=1;
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'MIGRATION_ERROR',message:error.message},null,2));process.exitCode=1;}
