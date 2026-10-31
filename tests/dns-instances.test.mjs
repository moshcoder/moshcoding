import test from 'node:test';
import assert from 'node:assert/strict';
import {createInstanceResolver} from '../lib/dns/instances.ts';
import {createDnsServer} from '../lib/dns/server.ts';
import {CLASS,TYPE,RCODE,encodeMessage,decodeMessage} from '../lib/dns/wire.ts';
const query=(name,type=TYPE.A)=>({id:123,flags:{qr:false,rd:true,opcode:0},questions:[{name,type,class:CLASS.IN}],answers:[],authorities:[],additionals:[]});
const gateway={addresses:async()=>({host:'w3bs.org',ipv4:['23.95.228.174'],ipv6:[]}),current:()=>({host:'w3bs.org',ipv4:['23.95.228.174'],ipv6:[]})};
function setup(){
 const state={status:'active',records:[],fail:false};const urls=[];
 const instances=createInstanceResolver([{suffix:'w3bs.org',registry:'https://w3bs.org',gateway}],{cacheMs:0,fetchImpl:async url=>{
  urls.push(String(url));if(state.fail)throw Error('down');
  return Response.json(String(url).includes('/dns/records?')?{records:state.records}:{name:'dumb.fuck',source:'w3bs',status:state.status,target:'https://fumb.duck.w3bs.org/'});
 }});
 return {state,urls,instances};
}
test('a W3BS hostname is authoritative in its configured realm, not primary-network ownership',async()=>{
 const h=setup();let forwarded=0,primary=0;
 const server=createDnsServer({instances:h.instances,registry:{lookup:async()=>{primary++;return null;}},gateway,forwarder:{close(){},query:async bytes=>{forwarded++;const q=decodeMessage(bytes);return encodeMessage({...q,flags:{...q.flags,qr:true,ra:true,rcode:0},answers:[{name:q.questions[0].name,type:TYPE.A,class:CLASS.IN,ttl:300,address:'207.207.210.107'}]});}}});
 const response=decodeMessage(await server.handle(encodeMessage(query('dumb.fuck.w3bs.org'))));
 assert.equal(response.answers[0].address,'23.95.228.174');assert.equal(forwarded,0);assert.equal(primary,0);
 assert(h.urls.every(u=>u.startsWith('https://w3bs.org/')));
 assert.equal(await h.instances.answer(query('dumb.fuck')),null);
 assert.equal(await h.instances.answer(query('dumb.fuck.other-instance.org')),null);
 await server.close();
});
test('AAAA, MX, TXT and CNAME records answer without a zone-copy or ownership merge',async()=>{
 const h=setup();h.state.records=[{type:'AAAA',value:'2606:4700:4700::1111',ttl:300},{type:'MX',value:'mx.example.com',priority:10,ttl:120},{type:'TXT',value:'é'.repeat(300),ttl:60}];
 assert.equal((await h.instances.answer(query('dumb.fuck.w3bs.org',TYPE.AAAA))).answers[0].address,'2606:4700:4700::1111');
 assert.equal((await h.instances.answer(query('dumb.fuck.w3bs.org',TYPE.A))).answers.length,0);
 const mx=decodeMessage(encodeMessage(await h.instances.answer(query('dumb.fuck.w3bs.org',TYPE.MX))));
 assert.equal(mx.answers[0].rdata.readUInt16BE(0),10);
 const txt=decodeMessage(encodeMessage(await h.instances.answer(query('dumb.fuck.w3bs.org',TYPE.TXT))));
 assert.equal(txt.answers[0].txt.join(''),'é'.repeat(300));
 h.state.records=[{type:'CNAME',value:'target.example.com',ttl:60}];
 assert.equal((await h.instances.answer(query('dumb.fuck.w3bs.org',TYPE.CNAME))).answers[0].target,'target.example.com');
});
test('suspension and provider failure cannot fall through to a parked or primary name',async()=>{
 const h=setup();h.state.status='suspended';assert.equal((await h.instances.answer(query('dumb.fuck.w3bs.org'))).flags.rcode,RCODE.NXDOMAIN);
 h.state.fail=true;assert.equal((await h.instances.answer(query('dumb.fuck.w3bs.org'))).flags.rcode,RCODE.SERVFAIL);
 h.state.fail=false;h.state.status='active';h.state.records=[{type:'CNAME',value:'another.fuck.w3bs.org',ttl:60}];
 assert.equal((await h.instances.answer(query('dumb.fuck.w3bs.org'))).flags.rcode,RCODE.SERVFAIL);
});
