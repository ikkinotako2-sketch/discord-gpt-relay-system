import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { renderPrivateSwarmPage } from './portal.mjs';

class NodeStub {
  constructor() {
    this.disabled = false;
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.style = {};
    this.children = [];
    this.classList = {toggle() {}};
  }
  replaceChildren() { this.children.length = 0; }
  append(...children) { this.children.push(...children); }
}
async function renderWithMockedBrowser({initialRunner=false,initialStatus='queued'}={}) {
  const html = await (await renderPrivateSwarmPage()).text();
  const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(js, 'private page has browser controller script');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
  const elements=new Map(ids.map(id=>[id,new NodeStub()]));
  const posts=[];
  let status=initialStatus;
  const document={
    hidden:false,
    getElementById(id) { assert.ok(elements.has(id),'element '+id);return elements.get(id); },
    createElement:()=>new NodeStub()
  };
  const fetch=async (path,options={})=>{
    if(path==='/command-center/api/swarm/overview')return {
      ok:true,status:200,json:async()=>({
        schema:'discord-swarm.v1',csrfToken:'test-csrf',
        runnerEnabled:initialRunner,modelLinked:false,
        jobs:[{id:'test-job',status,callsUsed:0,callsMax:6,cycles:1,history:[],lastCheckpoint:''}]
      })
    };
    if(path==='/command-center/api/swarm/stop' && options.method==='POST'){
      posts.push({path,method:options.method,headers:options.headers,body:options.body});
      status='stopped';
      return {ok:true,status:200,json:async()=>({status:'stopped'})};
    }
    throw Error('Unexpected API request '+path);
  };
  const context=createContext({document,fetch,location:{assign:()=>{throw Error('Unexpected login redirect')}},setInterval:()=>0});
  new Script(js,{filename:'swarm/portal inline controller'}).runInContext(context,{timeout:500});
  for(let i=0;i<12;i++)await Promise.resolve();
  return {elements,posts};
}
test('disabled execution still lets authenticated owner POST emergency STOP',async()=>{
  const {elements,posts}=await renderWithMockedBrowser({initialRunner:false,initialStatus:'queued'});
  const get=id=>elements.get(id);
  assert.equal(get('create').disabled,true);
  assert.equal(get('resume').disabled,true);
  assert.equal(get('stop').disabled,false,'owner STOP remains actionable even when runner off');
  await get('create').onclick();
  assert.equal(posts.length,0,'cannot start new model jobs with runner off');
  await get('stop').onclick();
  assert.equal(posts.length,1);
  assert.equal(posts[0].path,'/command-center/api/swarm/stop');
  assert.equal(posts[0].method,'POST');
  assert.equal(posts[0].headers['X-CSRF-Token'],'test-csrf');
  assert.equal(posts[0].headers['Content-Type'],'application/json');
  assert.equal(get('stop').disabled,true,'after stopping, no pending job remains');
});
test('disabled execution never requests STOP when no active job is selected',async()=>{
  const {elements,posts}=await renderWithMockedBrowser({initialRunner:false,initialStatus:'completed'});
  assert.equal(elements.get('stop').disabled,true);
  assert.equal(posts.length,0);
});
