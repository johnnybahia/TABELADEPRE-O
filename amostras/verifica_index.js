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
["confValidar","confDakotaLerFixo","confDakotaLerHtm","confParseItemBlocoDakotaFixo","confParseItemBlocoDakotaHtm","confDakotaEhFixo","confDakotaEhHtm","confArredCentPadrao","confAnigerEhEdi","confAnigerLerEdi","confParseItemBlocoAnigerEdi","confAliasSugerido","confIsAnigerPdf","confParseCampos","confExtrairBlocosAnigerPdf","confParseItemBlocoAnigerPdf","confIsBeiraRio","confExtrairBlocosBeiraRio","confParseItemBlocoBeiraRio"].forEach(fn=>{
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

// ===== formato ANIGER/MELBROS em PDF =====
// Roda sobre as LINHAS ja extraidas (amostras/aniger_pdf_linhas.json), geradas
// pelo mesmo confExtrairLinhas do Index.html — assim o harness nao precisa do
// pdf.js instalado. Cobre cabecalho (OC/emissao/prazo/marca/modalidade/cliente),
// extracao dos itens e a conferencia contra a tabela REAL da ANIGER CLIENTE
// ("tabela de preços - ANIGER CLIENTE.csv" na raiz, subida em 2026-09).
let anigerPdfOk=false;
(function(){
  const fx=path.join(DIR,"aniger_pdf_linhas.json");
  const csvPathAniger=path.join(ROOT,"tabela de preços - ANIGER CLIENTE.csv");
  if(!fs.existsSync(fx)||!fs.existsSync(csvPathAniger)){console.log("\n[ANIGER PDF] fixture/tabela ausente — pulado");anigerPdfOk=true;return;}
  const amostras=JSON.parse(fs.readFileSync(fx,"utf8"));
  // Mesma tabela usada pela BEIRA-RIO tem celulas de preco com "R$" como texto —
  // reusa o pBRcel (definido na secao BEIRA RIO abaixo nao ajuda aqui por ordem
  // de execucao, entao repete o mesmo padrao local).
  const pBRcelA=v=>pBR(String(v==null?"":v).replace(/R\$/gi,"").trim());
  const csvA=parseCSV(fs.readFileSync(csvPathAniger,"utf8"));
  const refsAniger=csvA.slice(1).filter(r=>r[0]&&r[0].trim()).map((r,i)=>({
    linha:i+2,ref:(r[0]||"").trim(),descricao:(r[1]||"").trim(),preco:pBRcelA(r[2]),
    dataInicio:(r[3]||"").trim(),dataFim:(r[4]||"").trim(),obs:(r[5]||"").trim(),
    unidade:(r[6]||"metros").trim(),medidaBase:pBRcelA(r[7]),medidaBaseLabel:(r[7]||"").trim(),
    precoRS:pBRcelA(r[8]),precoBA:pBRcelA(r[9]),precoCE:pBRcelA(r[10]),precoMG:pBRcelA(r[11]),aliasesConf:""
  }));
  // esperado por arquivo: [cliente, modalidade, coluna, prazo, nº de itens]
  const esperadoPdf={
    "20109721.pdf":["ANIGER","CE/CE","CE","45",3],
    "80144715.pdf":["ANIGER","CE/CE","CE","45",1],
    "20116455.pdf":["ANIGER","RS/CE","RS","45",1],
    "60001709.pdf":["ANIGER","RS/RS","BA","45",1] // Melbros (Campo Bom/RS) = mesmo cliente, tabela ANIGER
  };
  const problemas=[];const cntP={};
  for(const [nome,linhas] of Object.entries(amostras)){
    if(!F.confIsAnigerPdf(linhas)){problemas.push(nome+": layout nao detectado");continue;}
    const c=F.confParseCampos(linhas);
    const blocos=F.confExtrairBlocosAnigerPdf(linhas);
    const exp=esperadoPdf[nome];
    if(exp){
      if(c.clienteHint!==exp[0])problemas.push(nome+": cliente "+c.clienteHint+" != "+exp[0]);
      if(c.modalidade!==exp[1])problemas.push(nome+": modalidade "+c.modalidade+" != "+exp[1]);
      if(c.uf!==exp[2])problemas.push(nome+": coluna "+c.uf+" != "+exp[2]);
      if(c.prazoPagamento!==exp[3])problemas.push(nome+": prazo "+c.prazoPagamento+" != "+exp[3]);
      if(blocos.length!==exp[4])problemas.push(nome+": "+blocos.length+" itens != "+exp[4]);
    }
    if(!/^\d{2}\/\d{2}\/\d{4}$/.test(c.emissao||""))problemas.push(nome+": emissao invalida");
    if(!c.ordem)problemas.push(nome+": OC nao extraida");
    blocos.forEach(b=>{const it=F.confParseItemBlocoAnigerPdf(b);
      if(!it){problemas.push(nome+": bloco sem parse");return;}
      if(!(it.preco>0)||!(it.qtd>0))problemas.push(nome+": preco/qtd invalidos");
      if(it.unit==="PR"&&!it.cm)problemas.push(nome+": item PR sem tamanho em cm");});
    F.confValidar(blocos,refsAniger,c.uf,"",F.confParseItemBlocoAnigerPdf,{arred:F.confArredCentPadrao,ignorados:[],duplo:true})
     .forEach(r=>{cntP[r.status]=(cntP[r.status]||0)+1;});
  }
  // Achados reais confirmados contra a tabela real (nao bugs de parser):
  // M2173 (RS/CE) diverge -- pedido cobra 2,38, cadastro tem 2,80 na RS/CE;
  // M41552 (RS/RS, pedido da Melbros) fica SEM_PRECO -- a coluna RS/RS desse
  // item nao tem preco cadastrado (so RS/CE e CE/CE), embora o pedido real
  // mostre 2,18 pago nessa modalidade — vale cadastrar esse valor.
  console.log("\n[ANIGER PDF] arquivos:",Object.keys(amostras).length,"| conferencia com tabela real:",JSON.stringify(cntP));
  problemas.slice(0,10).forEach(p=>console.log("   !",p));
  anigerPdfOk=(problemas.length===0&&cntP.OK===4&&cntP.DIVERGENTE===1&&cntP.SEM_PRECO===1);
  console.log(anigerPdfOk?"✅ ANIGER/MELBROS em PDF OK":"❌ ANIGER/MELBROS em PDF com problemas");
})();

// ===== formato BEIRA RIO (PDF do ERP proprio) =====
// Roda sobre as LINHAS ja extraidas (amostras/beira_rio_pdf_linhas.json,
// {arquivo: linhas[]}) — mesmo truque do fixture ANIGER, evita exigir pdf.js
// instalado. Diferente da ANIGER (tabela sintetica), a aba BEIRA-RIO CLIENTE
// ja tem cadastro real ("tabela de preços - BEIRA-RIO CLIENTE.csv" na raiz) —
// a conferencia roda contra ele. Baseline calibrado nos 2 PDFs de amostra:
// 47 OK, 6 DIVERGENTE (achados reais, nao bug do parser — ver CLAUDE.md,
// seção "Aba 'Conferir' — formato BEIRA-RIO"), 3 NAO_CADASTRADO (referencia
// "REF.MFGP" do pedido ainda sem apelido ensinado para M41565 na AC1).
let beiraRioOk=false;
(function(){
  const fx=path.join(DIR,"beira_rio_pdf_linhas.json");
  const csvPath=path.join(ROOT,"tabela de preços - BEIRA-RIO CLIENTE.csv");
  if(!fs.existsSync(fx)||!fs.existsSync(csvPath)){console.log("\n[BEIRA RIO] fixture/tabela ausente — pulado");beiraRioOk=true;return;}
  const amostras=JSON.parse(fs.readFileSync(fx,"utf8"));
  const csvB=parseCSV(fs.readFileSync(csvPath,"utf8"));
  // A tabela BEIRA-RIO tem celulas de preco digitadas como texto com prefixo
  // de moeda ("R$ 0,98") — o pBR do harness (acima) nao trata "R$" porque a
  // amostra DAKOTA nunca trouxe esse caso na CSV exportada; o _pN real do
  // backend (Codigo.gs) trata. Usa um pBR local equivalente ao _pN aqui.
  const pBRcel=v=>pBR(String(v==null?"":v).replace(/R\$/gi,"").trim());
  const refsBeiraRio=csvB.slice(1).filter(r=>r[0]&&r[0].trim()).map((r,i)=>({
    linha:i+2,ref:(r[0]||"").trim(),descricao:(r[1]||"").trim(),preco:pBRcel(r[2]),
    dataInicio:(r[3]||"").trim(),dataFim:(r[4]||"").trim(),obs:(r[5]||"").trim(),
    unidade:(r[6]||"metros").trim(),medidaBase:pBRcel(r[7]),medidaBaseLabel:(r[7]||"").trim(),
    precoRS:pBRcel(r[8]),precoBA:pBRcel(r[9]),precoCE:pBRcel(r[10]),precoMG:pBRcel(r[11]),aliasesConf:""
  }));
  // esperado por arquivo: [ordem, emissao, uf, prazo, nº de itens]
  const esperadoPdf={
    "OrdemCompra6ee4564329e847029cbce391560cc9a7_8281.pdf":["14146396","08/09/2026","RS","7",5],
    "OrdemComprad8d168b405ee41e699d336105716860d_8281.pdf":["14204030","15/09/2026","RS","7",51]
  };
  const problemas=[];const cnt={};
  for(const [nome,linhas] of Object.entries(amostras)){
    if(!F.confIsBeiraRio(linhas)){problemas.push(nome+": layout nao detectado");continue;}
    const c=F.confParseCampos(linhas);
    const blocos=F.confExtrairBlocosBeiraRio(linhas);
    const exp=esperadoPdf[nome];
    if(exp){
      if(c.ordem!==exp[0])problemas.push(nome+": ordem "+c.ordem+" != "+exp[0]);
      if(c.emissao!==exp[1])problemas.push(nome+": emissao "+c.emissao+" != "+exp[1]);
      if(c.uf!==exp[2])problemas.push(nome+": uf "+c.uf+" != "+exp[2]);
      if(c.prazoPagamento!==exp[3])problemas.push(nome+": prazo "+c.prazoPagamento+" != "+exp[3]);
      if(blocos.length!==exp[4])problemas.push(nome+": "+blocos.length+" blocos != "+exp[4]);
    }
    F.confValidar(blocos,refsBeiraRio,c.uf||"RS",c.emissao,F.confParseItemBlocoBeiraRio)
     .forEach(r=>{cnt[r.status]=(cnt[r.status]||0)+1;});
  }
  console.log("\n[BEIRA RIO] arquivos:",Object.keys(amostras).length,"| conferencia com tabela real:",JSON.stringify(cnt));
  problemas.slice(0,10).forEach(p=>console.log("   !",p));
  beiraRioOk=(problemas.length===0&&cnt.OK===47&&cnt.DIVERGENTE===6&&cnt.NAO_CADASTRADO===3);
  console.log(beiraRioOk?"✅ BEIRA RIO OK":"❌ BEIRA RIO com problemas");
})();

process.exit(ok&&ensinarOk&&anigerOk&&anigerPdfOk&&beiraRioOk?0:1);
