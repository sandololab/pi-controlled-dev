#!/usr/bin/env node
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {safeId,redact} from './protocol.mjs';
const [directory,action='status',commandName,commandArgs='']=process.argv.slice(2);
if(!directory||!['status','tick','command','stop'].includes(action))throw Error('Usage: controller.mjs JOB_DIRECTORY status|tick|command|stop [command] [args]');
const job=JSON.parse(fs.readFileSync(path.join(directory,'job.json'),'utf8'));
if(!safeId(job.id))throw Error('BRIDGE_JOB_INVALID');
const credentials=action==='status'?null:{apiUrl:process.env.PAPERCLIP_API_URL?.replace(/\/$/,'').replace(/\/api$/,''),apiKey:process.env.PAPERCLIP_API_KEY,
 companyId:process.env.PAPERCLIP_COMPANY_ID,issueId:process.env.PAPERCLIP_TASK_ID,agentId:process.env.PAPERCLIP_AGENT_ID,runId:process.env.PAPERCLIP_RUN_ID};
if(action!=='status'&&Object.values(credentials).some(x=>!x))throw Error('PAPERCLIP_RUN_CONTEXT_REQUIRED');
const message={action,...(credentials?{credentials}:{}),waitMs:15000,...(action==='command'?{command:{name:commandName,args:commandArgs,commandId:crypto.randomUUID()}}:{})};
const socket=net.createConnection(path.join(directory,'control.sock'));socket.setTimeout(45000,()=>socket.destroy(Error('BRIDGE_TIMEOUT')));
let data='';
socket.on('connect',()=>socket.write(JSON.stringify(message)+'\n'));
socket.on('data',b=>{data+=b;if(data.length>1024*1024)socket.destroy(Error('BRIDGE_RESPONSE_LIMIT'));});
socket.on('error',e=>{process.stderr.write(redact(e.message)+'\n');process.exitCode=1;});
socket.on('end',()=>{try{const result=JSON.parse(data);process.stdout.write(JSON.stringify(result,null,2)+'\n');if(!result.ok)process.exitCode=1;}catch{process.stderr.write('BRIDGE_RESPONSE_INVALID\n');process.exitCode=1;}});

