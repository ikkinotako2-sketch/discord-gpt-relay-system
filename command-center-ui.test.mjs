import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';
import {DASHBOARD_HTML} from './command-center/page.mjs';

const html=readFileSync(new URL('./command-center/index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
test('Cloudflare inline HTML exactly matches the editable source, no remote scripts',()=>{
 assert.equal(DASHBOARD_HTML,html);
 assert.ok(script);
 assert.doesNotMatch(html,/<script\s+src=|<link\s+[^>]*href=\s*["']https?:/i);
 assert.match(html,/DEMO — 未接続/);
 new Script(script,{filename:'command-center/index.html'});
});
test('operational cockpit contains dynamic real-status panels and accessible controls',()=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(ids.length,new Set(ids).size,'DOM ids must be unique');
 for(const id of ['activeCount','modeBadge','callCount','callFill','completedStages',
 'errorSummary','lastSync','stageState1','stageState2','stageState3','stageState4',
 'agent1','agent2','agent3','agent4','pulse1','pulse2','pulse3','pulse4',
 'failurePanel','failureTitle','failureDetail','historyCount','jobRows',
 'originalTask','lastResult','startButton','stopButton','taskInput','runId']){
  assert.ok(ids.includes(id),'required dynamic ID '+id);
 }
 const literalReferences=[...script.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
 for(const id of literalReferences)assert.ok(ids.includes(id),'JS references non-existent ID '+id);
 assert.match(html,/href="#execution-history"/);
 assert.match(html,/aria-live="polite"/);
});
class El {
 constructor(id=''){
  this.id=id;this.textContent='';this.className='';this.disabled=false;this.hidden=false;this.value='';
  this.style={width:'',setProperty(k,v){this[k]=v}};
  this.children=[];this.listeners={};this.classList={add:()=>{}};
 }
 get firstChild(){return this.children[0]||null}
 removeChild(x){this.children.splice(this.children.indexOf(x),1);return x}
 append(...xs){this.children.push(...xs)}
 appendChild(x){this.children.push(x);return x}
 addEventListener(name,fn){this.listeners[name]=fn}
 setAttribute(key,value){this[key]=value}
 scrollIntoView(){}
}
function fixture(jobs){
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
 const els=new Map(ids.map(id=>[id,new El(id)]));
 const snapshot={schema:'ai-relay-dashboard.v1',jobs,modelName:'GPT-OSS 20B',csrfToken:'test-csrf',status:'idle'};
 const document={getElementById:id=>{assert.ok(els.has(id),'unknown DOM id '+id);return els.get(id)},createElement:()=>new El(),hidden:false};
 const ctx=createContext({document,location:{pathname:'/command-center/',hostname:'test.workers.dev'},
  window:{location:{assign:()=>{throw Error('unexpected redirect')}}},console,Date,
  setInterval:()=>null,fetch:async()=>({ok:true,status:200,json:async()=>snapshot})});
 new Script(script).runInContext(ctx,{timeout:2000});
 return {els,get:id=>els.get(id),snapshot};
}
const job=(id,status,calls,history,errorCode=null)=>({
 id,status,callsUsed:calls,callsMax:4,task:'AIループの実行テスト',history,
 errorCode,finalResult:status==='completed'?'最終成果物':null,
 updatedAt:1750000000000,createdAt:1750000000000
});
const step=(round,role)=>({round,role,text:'結果'});
async function flush(){for(let i=0;i<5;i++)await Promise.resolve();}
test('failed step is marked failed rather than completed when calls count includes failed attempt',async()=>{
 const f=fixture([job('failed-run','failed',2,[step(1,'planner')],'MODEL_ERROR')]);
 await flush();
 assert.equal(f.get('callCount').textContent,'2 / 4');
 assert.equal(f.get('completedStages').textContent,'1 / 4');
 assert.equal(f.get('stageState1').textContent,'保存済み');
 assert.equal(f.get('stageState2').textContent,'失敗');
 assert.equal(f.get('stageState3').textContent,'待機');
 assert.equal(f.get('callFill').style.width,'50%');
 assert.match(f.get('failureTitle').textContent,/失敗/);
 assert.match(f.get('failureDetail').textContent,/MODEL_ERROR/);
 assert.equal(f.get('startButton').disabled,false);
 assert.equal(f.get('stopButton').disabled,true);
});
test('history can select a previous completed job without starting another AI call',async()=>{
 const finished=job('old-success','completed',4,[step(1,'planner'),step(1,'builder'),step(2,'planner'),step(2,'builder')]);
 const f=fixture([job('latest-failure','failed',2,[step(1,'planner')],'MODEL_ERROR'),finished]);
 await flush();
 const tbody=f.get('jobRows');
 assert.equal(tbody.children.length,2);
 tbody.children[1].children[4].children[0].listeners.click();
 assert.equal(f.get('runId').textContent,'Run ID: old-success');
 assert.equal(f.get('completedStages').textContent,'4 / 4');
 assert.equal(f.get('stageState4').textContent,'保存済み');
 assert.equal(f.get('lastResult').textContent,'最終成果物');
 assert.match(f.get('failureTitle').textContent,/正常完了/);
});
test('active task disables start, enables stop, and has no fake completion status',async()=>{
 const f=fixture([job('running-job','claimed',1,[])]);
 await flush();
 assert.equal(f.get('startButton').disabled,true);
 assert.equal(f.get('stopButton').disabled,false);
 assert.equal(f.get('stageState1').textContent,'処理中');
 assert.equal(f.get('completedStages').textContent,'0 / 4');
});
