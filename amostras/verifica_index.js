"use strict";
// Carrega o <script> real do Index.html num sandbox com stubs de DOM e roda as
// funções portadas (confValidar + funções DAKOTA) contra os 23 arquivos, para
// confirmar que batem com o harness (60 OK / 57 DIV / 6 NC / 1 SP).
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const DIR = __dirname;

const html = fs.readFileSync(path.join(DIR, "..", "Index.html"), "utf8");
const m = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i);
if (!m) { console.error("script inline não encontrado"); process.exit(1); }
let code = m[1];

// stub de elemento DOM "engole tudo"
const el = new Proxy(function(){}, {
  get(){ return el; }, set(){ return true; }, apply(){ return el; }, construct(){ return el; }
});
const documentStub = new Proxy({}, { get(){ return function(){ return el; }; } });
const noop = new Proxy(function(){ return el; }, { get(){ return noop; }, apply(){ return el; } });

const sandbox = {
  console, Math, Date, JSON, parseInt, parseFloat, isNaN, RegExp, String, Number, Array, Object, Boolean, setTimeout, clearTimeout,
  window: {}, document: documentStub, navigator: { userAgent: "node" }, location: { href: "" },
  localStorage: { getItem(){return null;}, setItem(){}, removeItem(){} },
  google: { script: { run: {}, host: {} } },
  fetch: noop, alert: noop, confirm: ()=>true, FileReader: function(){}, Blob: function(){},
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// remove IIFEs que dependem de DOM real de eventos, mas o Proxy já cobre; roda direto
try { vm.runInContext(code, sandbox, { timeout: 5000 }); }
catch (e) { console.error("Erro ao avaliar script:", e.message); process.exit(1); }

const F = sandbox; // funções ficam no escopo global do sandbox
["confValidar","confDakotaLerFixo","confDakotaLerHtm","confParseItemBlocoDakotaFixo","confParseItemBlocoDakotaHtm","confDakotaEhFixo","confDakotaEhHtm","confArredCentBankers"].forEach(fn=>{
  if(typeof F[fn]!=="function"){console.error("Função ausente no sandbox:",fn);process.exit(1);}
});

// tabela DAKOTA
function parseCSV(t){const R=[];let r=[],c="",q=false;for(let i=0;i<t.length;i++){const x=t[i];if(q){if(x==='"'){if(t[i+1]==='"'){c+='"';i++;}else q=false;}else c+=x;}else{if(x==='"')q=true;else if(x===','){r.push(c);c="";}else if(x==="\n"){r.push(c);R.push(r);r=[];c="";}else if(x==="\r"){}else c+=x;}}if(c.length||r.length){r.push(c);R.push(r);}return R;}
const csv=parseCSV(fs.readFileSync(path.join(DIR,"..","tabela de preços - DAKOTA CLIENTE (1).csv"),"utf8"));
const pBR=v=>{v=String(v==null?"":v).trim();if(!v)return 0;v=v.replace(/\./g,"").replace(",",".");const n=parseFloat(v);return isNaN(n)?0:n;};
const refs=csv.slice(1).filter(r=>r[0]&&r[0].trim()).map((r,i)=>({linha:i+2,ref:(r[0]||"").trim(),descricao:(r[1]||"").trim(),preco:pBR(r[2]),dataInicio:(r[3]||"").trim(),dataFim:(r[4]||"").trim(),obs:(r[5]||"").trim(),unidade:(r[6]||"metros").trim(),medidaBase:pBR(r[7]),medidaBaseLabel:(r[7]||"").trim(),precoRS:pBR(r[8]),precoBA:pBR(r[9]),precoCE:pBR(r[10]),precoMG:pBR(r[11]),aliasesConf:""}));

const ROOT=path.join(DIR,"..");  // os 23 arquivos-amostra e a CSV DAKOTA ficam na raiz do repo
const files=fs.readdirSync(ROOT).filter(f=>/\.(dkn|dke|htm)$/i.test(f)).sort();
let tot=0;const cnt={OK:0,DIVERGENTE:0,NAO_CADASTRADO:0,SEM_PRECO:0,SEM_MEDIDA:0,VENCIDO:0,IGNORADO:0};const modCnt={};
for(const f of files){
  const texto=fs.readFileSync(path.join(ROOT,f),"latin1");
  let leitura,parseFn;
  if(F.confDakotaEhFixo(f,texto)){leitura=F.confDakotaLerFixo(texto);parseFn=F.confParseItemBlocoDakotaFixo;}
  else if(F.confDakotaEhHtm(f,texto)){leitura=F.confDakotaLerHtm(texto);parseFn=F.confParseItemBlocoDakotaHtm;}
  else{console.log("?? não detectado:",f);continue;}
  modCnt[leitura.campos.modalidade]=(modCnt[leitura.campos.modalidade]||0)+1;
  const out=F.confValidar(leitura.blocos,refs,leitura.campos.uf,"",parseFn,{arred:F.confArredCentBankers,ignorados:[]});
  out.forEach(r=>{tot++;cnt[r.status]=(cnt[r.status]||0)+1;});
}
console.log("(Index.html real) Arquivos:",files.length,"| Itens:",tot);
console.log("Modalidades:",JSON.stringify(modCnt));
console.log("Status:",JSON.stringify(cnt));
const esperado={OK:60,DIVERGENTE:57,NAO_CADASTRADO:6,SEM_PRECO:1,SEM_MEDIDA:0,VENCIDO:0,IGNORADO:0};
const ok=Object.keys(esperado).every(k=>cnt[k]===esperado[k]);
console.log(ok?"\n✅ BATE com o harness (código real do Index.html confere)":"\n❌ DIVERGE do harness — revisar portabilidade");

// ===== verificação do fluxo de ensinar (código real do Index.html) =====
let ensinarOk=false;
(function(){
  const refs2=refs.map(r=>({...r,aliasesConf:r.ref==="M1294"?"LS11628":""}));
  const ign=["FITA REFORCO FR"];
  let antesNC=0,viraramOK=0,viraramIgn=0;
  for(const f of files){
    const texto=fs.readFileSync(path.join(ROOT,f),"latin1");
    let leitura,parseFn;
    if(F.confDakotaEhFixo(f,texto)){leitura=F.confDakotaLerFixo(texto);parseFn=F.confParseItemBlocoDakotaFixo;}
    else if(F.confDakotaEhHtm(f,texto)){leitura=F.confDakotaLerHtm(texto);parseFn=F.confParseItemBlocoDakotaHtm;}
    else continue;
    const antes=F.confValidar(leitura.blocos,refs.map(r=>({...r,aliasesConf:""})),leitura.campos.uf,"",parseFn,{arred:F.confArredCentBankers,ignorados:[]});
    const depois=F.confValidar(leitura.blocos,refs2,leitura.campos.uf,"",parseFn,{arred:F.confArredCentBankers,ignorados:ign});
    antes.forEach((r,i)=>{if(r.status==="NAO_CADASTRADO"){antesNC++;if(depois[i].status==="OK")viraramOK++;if(depois[i].status==="IGNORADO")viraramIgn++;}});
  }
  console.log("\n[Ensinar] NAO_CADASTRADO antes:",antesNC,"| viraram OK (alias):",viraramOK,"| viraram IGNORADO:",viraramIgn);
  ensinarOk=(antesNC===6&&viraramOK===3&&viraramIgn===3);
  console.log(ensinarOk?"✅ fluxo de ensinar OK":"❌ fluxo de ensinar diverge");
})();
process.exit(ok&&ensinarOk?0:1);
