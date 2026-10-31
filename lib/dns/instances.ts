/** Explicit Moshpit instance realms. Never infer authority from a query or import ownership. */
import { CLASS, TYPE, RCODE, encodeName, type Message, type ResourceRecord } from './wire';
import { soaFor } from './answers';
import type { GatewayResolver } from './gateway';
export type InstanceRealm = { suffix: string; registry: string; gateway: GatewayResolver };
export type InstanceResolver = { answer(query: Message): Promise<Message | null> };

export function createInstanceResolver(realms: InstanceRealm[], options: { fetchImpl?: typeof fetch; now?: ()=>number; cacheMs?: number } = {}): InstanceResolver {
  const fetchImpl = options.fetchImpl ?? fetch, now = options.now ?? Date.now;
  const cache = new Map<string,{until:number;value:any}>(), inflight = new Map<string,Promise<any>>();
  const configured = realms.map(r=>{
    const suffix=r.suffix.toLowerCase().replace(/\.$/,'');
    const url=new URL(r.registry);
    if(url.protocol!=='https:' || url.username || url.password || !/^[a-z0-9.-]+$/.test(suffix)) throw Error('Invalid instance realm');
    return {...r,suffix,registry:url.origin};
  }).sort((a,b)=>b.suffix.length-a.suffix.length);
  async function load(realm:InstanceRealm,name:string) {
    const key=`${realm.registry}:${name}`, hit=cache.get(key);
    if(hit && hit.until>now())return hit.value;
    if(inflight.has(key))return inflight.get(key);
    const job=(async()=>{
      const read=async(path:string)=>{
        const response=await fetchImpl(`${realm.registry}${path}`,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(2000)});
        if(response.status===404)return null;
        if(!response.ok)throw Error('Instance unavailable');
        return response.json();
      };
      const result=await read(`/api/net/v1/resolve/${encodeURIComponent(name)}`) as any;
      if(!result)return null;
      const records=await read(`/api/net/v1/dns/records?name=${encodeURIComponent(name)}`) as any;
      const value={...result,records:Array.isArray(records?.records)?records.records:[]};
      if(cache.size>=10000)cache.delete(cache.keys().next().value!);
      cache.set(key,{until:now()+(options.cacheMs??2000),value});
      return value;
    })().finally(()=>inflight.delete(key));
    inflight.set(key,job);return job;
  }
  async function answer(query:Message,depth=0):Promise<Message|null>{
    if(query.questions.length!==1 || query.flags.opcode!==0 || query.questions[0].class!==CLASS.IN)return null;
    const question=query.questions[0], host=question.name.toLowerCase().replace(/\.$/,'');
    const realm=configured.find(r=>host.endsWith(`.${r.suffix}`));
    if(!realm)return null;
    const name=host.slice(0,-realm.suffix.length-1);
    if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name))return null;
    const message:Message={id:query.id,flags:{...query.flags,qr:true,aa:true,ra:true,ad:false,rcode:0},questions:query.questions,answers:[],authorities:[],additionals:[]};
    let record:any;
    try{record=await load(realm,name);}catch{message.flags.rcode=RCODE.SERVFAIL;return message;}
    if(!record)return null;
    const gateway=await realm.gateway.addresses().catch(()=>realm.gateway.current());
    if(!['active','backfill','federated'].includes(record.status)){
      message.flags.rcode=RCODE.NXDOMAIN;message.authorities=[soaFor(realm.suffix,gateway,5)];return message;
    }
    const records=record.records.slice(0,100), cname=records.find((r:any)=>r.type==='CNAME');
    const ttl=(r:any)=>Math.min(86400,Math.max(1,Number(r.ttl)||60));
    const base=(r:any):ResourceRecord=>({name:host,type:question.type,class:CLASS.IN,ttl:ttl(r)});
    if(cname){
      if(cname.value===host){message.flags.rcode=RCODE.SERVFAIL;return message;}
      message.answers.push({...base(cname),type:TYPE.CNAME,target:cname.value});
      if((question.type===TYPE.A || question.type===TYPE.AAAA) && depth>=8){message.flags.rcode=RCODE.SERVFAIL;return message;}
      if((question.type===TYPE.A || question.type===TYPE.AAAA) && depth<8 && cname.value!==host){
        const target=await answer({...query,questions:[{...question,name:cname.value}]},depth+1);
        if(target){message.flags.rcode=target.flags.rcode;message.answers.push(...target.answers);}
      }
    }else if(question.type===TYPE.A || question.type===TYPE.AAAA){
      const addresses=records.filter((r:any)=>r.type==='AAAA');
      if(addresses.length){if(question.type===TYPE.AAAA)for(const r of addresses)message.answers.push({...base(r),address:r.value});}
      else for(const address of question.type===TYPE.A?gateway.ipv4:gateway.ipv6)message.answers.push({name:host,type:question.type,class:CLASS.IN,ttl:30,address});
    }else if(question.type===TYPE.TXT){
      for(const r of records.filter((r:any)=>r.type==='TXT')){
        const chunks:string[]=[];let chunk='';
        for(const ch of String(r.value)){if(Buffer.byteLength(chunk+ch)>255){chunks.push(chunk);chunk='';}chunk+=ch;}
        chunks.push(chunk);message.answers.push({...base(r),txt:chunks});
      }
    }else if(question.type===TYPE.MX){
      for(const r of records.filter((r:any)=>r.type==='MX')){const priority=Buffer.alloc(2);priority.writeUInt16BE(Number(r.priority)||0);message.answers.push({...base(r),rdata:Buffer.concat([priority,encodeName(r.value)])});}
    }else if(question.type===TYPE.SOA)message.answers.push(soaFor(realm.suffix,gateway,30));
    if(!message.answers.length)message.authorities=[soaFor(realm.suffix,gateway,5)];
    return message;
  }
  return {answer};
}
