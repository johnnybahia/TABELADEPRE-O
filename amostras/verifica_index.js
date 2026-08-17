"use strict";
// Carrega o <script> real do Index.html num sandbox com stubs de DOM e roda as
// funções portadas (confValidar + funções DAKOTA) contra os 23 arquivos, para
// confirmar que batem com o harness (52 OK / 65 DIV / 6 NC / 1 SP).
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
["confValidar","confDakotaLerFixo","confDakotaLerHtm","confParseItemBlocoDakotaFixo","confParseItemBlocoDakotaHtm","confDakotaEhFixo","confDakotaEhHtm","confArredCentPadrao","confAnigerEhEdi","confAnigerLerEdi","confParseItemBlocoAnigerEdi","confAliasSugerido"].forEach(fn=>{
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
  const out=F.confValidar(leitura.blocos,refs,leitura.campos.uf,"",parseFn,{arred:F.confArredCentPadrao,ignorados:[]});
  out.forEach(r=>{tot++;cnt[r.status]=(cnt[r.status]||0)+1;});
}
console.log("(Index.html real) Arquivos:",files.length,"| Itens:",tot);
console.log("Modalidades:",JSON.stringify(modCnt));
console.log("Status:",JSON.stringify(cnt));
const esperado={OK:52,DIVERGENTE:65,NAO_CADASTRADO:6,SEM_PRECO:1,SEM_MEDIDA:0,VENCIDO:0,IGNORADO:0};
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
    const antes=F.confValidar(leitura.blocos,refs.map(r=>({...r,aliasesConf:""})),leitura.campos.uf,"",parseFn,{arred:F.confArredCentPadrao,ignorados:[]});
    const depois=F.confValidar(leitura.blocos,refs2,leitura.campos.uf,"",parseFn,{arred:F.confArredCentPadrao,ignorados:ign});
    antes.forEach((r,i)=>{if(r.status==="NAO_CADASTRADO"){antesNC++;if(depois[i].status==="OK")viraramOK++;if(depois[i].status==="IGNORADO")viraramIgn++;}});
  }
  console.log("\n[Ensinar] NAO_CADASTRADO antes:",antesNC,"| viraram OK (alias):",viraramOK,"| viraram IGNORADO:",viraramIgn);
  ensinarOk=(antesNC===6&&viraramOK===3&&viraramIgn===3);
  console.log(ensinarOk?"✅ fluxo de ensinar OK":"❌ fluxo de ensinar diverge");
})();
// ===== portas de entrada do arquivo (bug real: .edi era barrado antes de
// chegar no leitor, com "Ignorado (formato nao suportado)") =====
(function(){
  const problemas=[];
  const mAccept=html.match(/id="conf-file"[^>]*accept="([^"]+)"/i);
  if(!mAccept)problemas.push("input #conf-file sem accept");
  else if(!/(^|,)\s*\.edi\s*(,|$)/i.test(mAccept[1]))problemas.push("accept do #conf-file nao aceita .edi");
  const mFiltro=code.match(/\/\\\.\(([a-z|]+)\)\$\/i\.test\(f\.name\)/);
  if(!mFiltro)problemas.push("filtro de extensao de confArquivosSelecionados nao encontrado");
  else{
    const rx=new RegExp("\\.("+mFiltro[1]+")$","i");
    ["pedido.edi","pedido.dkn","pedido.dke","pedido.htm"].forEach(n=>{if(!rx.test(n))problemas.push("filtro JS barra "+n);});
  }
  problemas.forEach(p=>console.log("   !",p));
  console.log(problemas.length?"❌ portas de entrada do arquivo com problema":"\n[Entrada] accept + filtro JS aceitam .edi ✅");
  if(problemas.length)process.exitCode=1;
})();

// ===== extracao do formato ANIGER (.edi) =====
// A tabela ANIGER ainda nao existe como CSV aqui (aba nova, sem itens
// cadastrados), entao esta parte valida a EXTRACAO — cabecalho, codigos,
// quantidades e precos — e nao o casamento com a tabela de precos.
let anigerOk=false;
(function(){
  const edis=fs.readdirSync(ROOT).filter(f=>/\.edi$/i.test(f)).sort();
  if(!edis.length){console.log("\n[ANIGER] nenhum .edi na raiz — pulado");anigerOk=true;return;}
  let itens=0,erros=[];const modal={},prazos={},produtos={};
  for(const f of edis){
    const texto=fs.readFileSync(path.join(ROOT,f),"latin1");
    if(!F.confAnigerEhEdi(f,texto)){erros.push(f+": nao detectado como .edi da Aniger");continue;}
    const leitura=F.confAnigerLerEdi(texto);
    const c=leitura.campos;
    modal[c.modalidade||"(vazia)"]=(modal[c.modalidade||"(vazia)"]||0)+1;
    prazos[c.prazoPagamento||"(vazio)"]=(prazos[c.prazoPagamento||"(vazio)"]||0)+1;
    if(!c.ordem)erros.push(f+": OC nao extraida");
    if(!/^\d{2}\/\d{2}\/\d{4}$/.test(c.emissao||""))erros.push(f+": emissao invalida ("+c.emissao+")");
    if(c.clienteHint!=="ANIGER")erros.push(f+": clienteHint errado");
    leitura.blocos.forEach(bl=>{
      const it=F.confParseItemBlocoAnigerEdi(bl);
      if(!it){erros.push(f+": bloco sem parse -> "+bl.slice(0,60));return;}
      itens++;
      if(!(it.preco>0))erros.push(f+": preco invalido");
      if(!(it.qtd>0))erros.push(f+": qtd invalida");
      if(it.unit!=="PR")erros.push(f+": unidade inesperada "+it.unit);
      if(!it.semTamanho)erros.push(f+": deveria marcar semTamanho");
      // preco empacotado (4 casas) deve bater com o preco impresso na descricao
      const mtxt=bl.match(/R\$\s*([\d.]+,\d+)/);
      if(mtxt){const t=parseFloat(mtxt[1].replace(/\./g,"").replace(",","."));
        if(Math.abs(t-it.preco)>1e-9)erros.push(f+": preco empacotado "+it.preco+" != texto "+t);}
      const mp=bl.match(/\bPROD\s+(\d+)/);
      if(!mp)erros.push(f+": bloco sem codigo de produto");
      else{produtos[mp[1]]=produtos[mp[1]]||new Set();produtos[mp[1]].add(it.preco);
        if(F.confAliasSugerido(bl)!==mp[1])erros.push(f+": apelido sugerido != codigo de produto");}
    });
  }
  console.log("\n[ANIGER] arquivos:",edis.length,"| itens:",itens,"| modalidades:",JSON.stringify(modal),"| prazos:",JSON.stringify(prazos));
  console.log("[ANIGER] produtos -> precos:",JSON.stringify(Object.fromEntries(Object.entries(produtos).map(([k,v])=>[k,[...v]]))));
  erros.slice(0,10).forEach(e=>console.log("   !",e));
  // Conferencia ponta a ponta com uma tabela SINTETICA (a aba ANIGER ainda nao
  // tem itens): valida o caminho apelido (codigo Aniger em AC1) -> linha da
  // tabela -> preco direto, sem tamanho no pedido. Os precos abaixo sao
  // fabricados: 294434/294433 batem os do pedido, 290791 diverge de proposito.
  const refsFake=[
    {linha:2,ref:"M99001",descricao:"ATACADOR POLIESTER RECICLADO",unidade:"PAR",medidaBase:100,medidaBaseLabel:"100cm",preco:0,precoRS:0.80,precoBA:0.90,precoCE:0.93,precoMG:0,dataInicio:"01/01/2026",dataFim:"",aliasesConf:"294434"},
    {linha:3,ref:"M99002",descricao:"ATACADOR POLIESTER RECICLADO FINO",unidade:"PAR",medidaBase:100,medidaBaseLabel:"100cm",preco:0,precoRS:0.75,precoBA:0.80,precoCE:0.85,precoMG:0,dataInicio:"01/01/2026",dataFim:"",aliasesConf:"294433"},
    {linha:4,ref:"M99003",descricao:"ATACADOR POLIESTER RECICLADO GROSSO",unidade:"PAR",medidaBase:100,medidaBaseLabel:"100cm",preco:0,precoRS:0.70,precoBA:0.75,precoCE:0.86,precoMG:0,dataInicio:"01/01/2026",dataFim:"",aliasesConf:"290791"}
  ];
  const cntA={};
  for(const f of edis){
    const texto=fs.readFileSync(path.join(ROOT,f),"latin1");
    const l=F.confAnigerLerEdi(texto);
    F.confValidar(l.blocos,refsFake,l.campos.uf,"",F.confParseItemBlocoAnigerEdi,{arred:F.confArredCentPadrao,ignorados:[]})
     .forEach(r=>{cntA[r.status]=(cntA[r.status]||0)+1;});
  }
  console.log("[ANIGER] conferencia com tabela sintetica:",JSON.stringify(cntA));
  const e2eOk=(cntA.OK===15&&cntA.DIVERGENTE===12&&!cntA.SEM_MEDIDA&&!cntA.NAO_CADASTRADO);
  anigerOk=(erros.length===0&&itens===27&&edis.length===5&&e2eOk);
  console.log(anigerOk?"✅ extracao + conferencia ANIGER OK":"❌ ANIGER com problemas");
})();

process.exit(ok&&ensinarOk&&anigerOk?0:1);
