"use strict";
// Harness que reproduz as funções puras da aba Conferir (Index.html) + as novas
// funções DAKOTA, validando contra os 23 arquivos reais e a tabela DAKOTA.
const fs = require("fs");
const DIR = __dirname;

// ---------- helpers reproduzidos do Index.html ----------
function pBR(v){v=String(v==null?"":v).trim();if(!v)return 0;v=v.replace(/\./g,"").replace(",",".");var n=parseFloat(v);return isNaN(n)?0:n;}
function dataBR(s){var m=String(s||"").match(/(\d{2})\/(\d{2})\/(\d{4})/);return m?new Date(+m[3],+m[2]-1,+m[1]):null;}
function normTxt(s){return String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");}
function unidadeDireta(u){u=String(u||"").toLowerCase();return u.indexOf("metro")>=0||u.indexOf("kg")>=0||u.indexOf("kilo")>=0||u.indexOf("quilo")>=0;}
function unidadeKg(u){u=String(u||"").toLowerCase();return u.indexOf("kg")>=0||u.indexOf("kilo")>=0||u.indexOf("quilo")>=0;}
function confCentavos(v){return Math.round((parseFloat(v)||0)*100+1e-9);}
function confPrecoConfere(a,b){return confCentavos(a)===confCentavos(b);}
function confTemGoma(txt){var t=String(txt||"").toUpperCase();if(/(?:\bSEM\s+|\bS\s*\/\s*)(?:GOMA|ENGOMAD|GOMAD)/.test(t))return false;return /\b(?:GOMA|GOMAD[OA]|ENGOMAD[OA]?|EGOMAD[OA]?|ENGO)\b/.test(t);}
function confBaseRef(ref){var s=String(ref||"");var p=s.indexOf("(");if(p>0)s=s.slice(0,p);return s.replace(/\b(?:C\s*\/\s*GOMA|COM\s+GOMA|SEM\s+GOMA|S\s*\/\s*GOMA|ENGOMAD[OA]?|EGOMAD[OA]?|GOMAD[OA]|GOMA|ENGO)\b/gi," ").replace(/\s+/g," ").trim();}
function extrairVarianteMm(base){var m=String(base||"").match(/^(.+?)\s+(\d+(?:[.,]\d+)?\s*MM)\s*$/i);if(!m||normTxt(m[1]).length<3)return null;return {codigoBase:m[1].trim(),mm:m[2].replace(/\s+/g,"").toUpperCase()};}
function confRefRegex(base){var n=normTxt(base);if(n.length<3)return null;return new RegExp("(?:^|[^A-Z0-9]|\\bREF)"+n.split("").join("[\\s./\\-]*")+"(?![0-9])","i");}
function confEscolherVigencia(rows,emissao,medidaPdf){var ref=emissao||new Date();var cobrem=rows.filter(function(r){var ini=dataBR(r.dataInicio),fim=dataBR(r.dataFim);return (!ini||ref>=ini)&&(!fim||ref<=fim);});var pool=cobrem.length?cobrem:rows;var vencido=!cobrem.length;if(medidaPdf>0&&pool.length>1){var match=pool.filter(function(r){return Math.abs((r.medidaBase||0)-medidaPdf)<0.01;});if(match.length)pool=match;}var ord=function(a,b){return (dataBR(b.dataInicio)||0)-(dataBR(a.dataInicio)||0);};pool=pool.slice().sort(ord);return {row:pool[0],vencido:vencido,pool:pool};}
function confPrecoEsperado(row,uf,item,arred){var precoTab=row["preco"+uf]>0?row["preco"+uf]:(row.preco>0?row.preco:0);if(!precoTab)return null;var baseLabel=String(row.medidaBaseLabel||"");var usaCm=/CM/i.test(baseLabel)?true:/MM/i.test(baseLabel)?false:!unidadeDireta(row.unidade||"metros");if(usaCm){var medida=item.cm||0;if(!medida||!(row.medidaBase>0))return null;var e=(medida/row.medidaBase)*precoTab;return {esperado:arred?arred(e):e,medidaLabel:medida+"cm"};}return {esperado:precoTab,medidaLabel:unidadeKg(row.unidade)?"por kg":(row.medidaBase>0?(row.medidaBase+"mm · por metro"):"por metro")};}
function confMedidaPdf(bloco,rxBase){var m=rxBase?rxBase.exec(bloco):null,pos=m?m.index:0;var toks=[],re=/(\d+(?:[.,]\d+)?)\s*MM\b/gi,t;while((t=re.exec(bloco)))toks.push({mm:t[0].replace(/\s+/g,"").toUpperCase(),idx:t.index});if(!toks.length)return "";toks.sort(function(a,b){return Math.abs(a.idx-pos)-Math.abs(b.idx-pos);});return toks[0].mm;}

// ---------- NOVO: arredondamento bancário (round-half-even) p/ DAKOTA ----------
function confArredCentBankers(v){var c=v*100;var f=Math.floor(c);var d=c-f;if(Math.abs(d-0.5)<1e-9){return ((f%2===0)?f:f+1)/100;}return Math.round(c)/100;}

// ---------- NOVO: modalidade DAKOTA por CNPJ ----------
var CONF_DAKOTA_MARFIM={"93825230000170":"RS","19542918000190":"CE"};
function confDakotaOrigem(c){return CONF_DAKOTA_MARFIM[c]||"";}
function confDakotaDestino(c){return /^07414643/.test(c)?"RS":/^00465813/.test(c)?"CE":"";}
function confDakotaModalidade(o,d){if(o==="CE")return "CE/CE";if(o==="RS"&&d==="RS")return "RS/RS";if(o==="RS"&&d==="CE")return "RS/CE";return "";}
function confDakotaModalUf(m){return {"RS/CE":"RS","RS/RS":"BA","CE/CE":"CE"}[m]||"RS";}

// ---------- NOVO: leitura de arquivo DAKOTA ----------
function confDakotaEhFixo(nome,texto){return /\.(dkn|dke)$/i.test(nome)||(/Arquivo XML/i.test(texto)&&/(PR|MT)\s\d{17}R\$/.test(texto));}
function confDakotaEhHtm(nome,texto){return /\.html?$/i.test(nome)||/<html|ORDEM DE COMPRA/i.test(texto);}

function confDakotaLerFixo(texto){
  var linhas=texto.split(/\r?\n/).map(function(l){return l.replace(/\t/g," ").replace(/\s+$/,"");}).filter(function(l){return /Arquivo XML/i.test(l)&&/(PR|MT)\s\d{17}R\$/.test(l);});
  var first=linhas[0]||"";
  var buyer=first.slice(0,14);var ms=first.match(/(\d{14})Arquivo XML/);var sup=ms?ms[1]:"";
  var origem=confDakotaOrigem(sup),destino=confDakotaDestino(buyer);
  var modal=confDakotaModalidade(origem,destino);
  var c={ordem:"",emissao:"",marca:"",uf:confDakotaModalUf(modal),modalidade:modal,prazoPagamento:""};
  var me=first.match(/\s(\d{8})V\d/);if(me)c.emissao=me[1].slice(6,8)+"/"+me[1].slice(4,6)+"/"+me[1].slice(0,4);
  var mp=first.match(/R\$\s*0*(\d{1,3})/);if(mp)c.prazoPagamento=String(parseInt(mp[1],10));
  return {campos:c,linhas:linhas,blocos:linhas};
}
function confParseItemBlocoDakotaFixo(linha){
  var mu=linha.match(/(\d{9})(PR|MT)\s(\d{17})R\$/);if(!mu)return null;
  var qtd=parseInt(mu[1],10)/1000,unit=mu[2],preco=parseInt(mu[3],10)/100;
  if(!(preco>0))return null;
  var desc="";var md=linha.match(/N\s{2,}(.+?)\s*\d{14}Arquivo/i);if(md)desc=md[1].trim();
  var cm=0,mcm=desc.match(/(\d{2,3})\s*CM/i);if(mcm)cm=parseInt(mcm[1],10);
  var mm=null,re=/(\d+(?:[.,]\d+)?)\s*MM/gi,g;while((g=re.exec(desc))){if(/PONT/i.test(desc.slice(Math.max(0,g.index-6),g.index)))continue;mm=pBR(g[1]);break;}
  return {seq:null,preco:preco,cm:cm,mm:mm,qtd:qtd,unit:unit,desc:desc};
}

function pUS(s){var n=parseFloat(String(s==null?"":s).replace(/[^0-9.]/g,""));return isNaN(n)?0:n;} // htm usa ponto decimal ("0.67")
function confStripTags(h){return String(h).replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/\s+/g," ").trim();}
function confDakotaLerHtm(texto){
  var plano=confStripTags(texto);
  var c={ordem:"",emissao:"",marca:"",uf:"",modalidade:"",prazoPagamento:""};
  var m;
  m=plano.match(/Numero\s*:\s*([0-9A-Za-z]+)/i);if(m)c.ordem=m[1];
  m=plano.match(/Emissao\s*:\s*(\d{2}\/\d{2}\/\d{2,4})/i);if(m)c.emissao=m[1];
  m=plano.match(/Prazo\s+Pag\s*:\s*(\d+)/i);if(m)c.prazoPagamento=m[1];
  // fornecedor Marfim (origem) por CNPJ
  var sup="";var mc=plano.match(/(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})/g)||[];
  mc.forEach(function(x){var d=x.replace(/\D/g,"");if(CONF_DAKOTA_MARFIM[d])sup=d;});
  var origem=confDakotaOrigem(sup);
  // comprador município (destino): primeiro "Municipio : <cidade> - <UF>"
  var destino="";m=plano.match(/Municipio\s*:\s*[^-]*-\s*(RS|CE|BA|MG)\b/i);if(m){destino=m[1].toUpperCase()==="RS"?"RS":"CE";}
  c.modalidade=confDakotaModalidade(origem,destino);
  c.uf=confDakotaModalUf(c.modalidade);
  // itens: linhas <tr> com 7 células; desc é a célula com font size=1
  var blocos=[],trRe=/<tr[^>]*>([\s\S]*?)<\/tr>/gi,tr;
  while((tr=trRe.exec(texto))){
    var linhaTr=tr[1];
    var tds=[],tdRe=/<td[^>]*>([\s\S]*?)<\/td>/gi,td;
    while((td=tdRe.exec(linhaTr)))tds.push({raw:td[0],txt:confStripTags(td[1])});
    if(tds.length<7)continue;
    var di=-1;for(var i=0;i<tds.length;i++){if(/size=["']?1["']?/i.test(tds[i].raw)){di=i;break;}}
    if(di<0)continue;
    var desc=tds[di].txt;
    if(!desc||!/[A-Z]{3}/i.test(desc))continue;
    var qtd=pUS(tds[di+1]?tds[di+1].txt:""),uni=(tds[di+2]?tds[di+2].txt:"").toUpperCase().replace(/[^A-Z]/g,""),prc=pUS(tds[di+3]?tds[di+3].txt:"");
    if(!(prc>0))continue;
    // bloco reconstruído: descrição + marcadores (confRefRegex casa na descrição)
    blocos.push(desc+"  ###U:"+uni+" ###P:"+prc+" ###Q:"+qtd);
  }
  return {campos:c,linhas:blocos,blocos:blocos};
}
function confParseItemBlocoDakotaHtm(bloco){
  var mp=bloco.match(/###P:([\d.]+)/),mu=bloco.match(/###U:([A-Z]+)/i),mq=bloco.match(/###Q:([\d.]+)/);
  var preco=mp?parseFloat(mp[1]):0;if(!(preco>0))return null;
  var unit=mu?mu[1].toUpperCase():"";
  var desc=bloco.replace(/\s*###.*/,"");
  var cm=0,mcm=desc.match(/(\d{2,3})\s*CM/i);if(mcm)cm=parseInt(mcm[1],10);
  var mm=null,mmm=desc.match(/(\d+(?:[.,]\d+)?)\s*MM/i);if(mmm)mm=pBR(mmm[1]);
  return {seq:null,preco:preco,cm:cm,mm:mm,qtd:mq?parseFloat(mq[1]):0,unit:/^P/.test(unit)?"PR":"MT",desc:desc};
}

// ---------- confValidar (com opts: arred, aliases já em refs, ignorados) ----------
function confValidar(blocos,refs,uf,emissaoStr,parseFn,opts){
  parseFn=parseFn||confParseItemBlocoDakotaFixo;opts=opts||{};
  var arred=opts.arred||null,ignorados=(opts.ignorados||[]).map(normTxt).filter(function(s){return s.length>=2;});
  var mapa={};
  refs.forEach(function(r){
    var base=confBaseRef(r.ref);var n=normTxt(base);if(n.length<3)return;
    var goma=confTemGoma(String(r.ref)+" "+String(r.descricao||""));var k=n+"|"+(goma?1:0);
    var rxBase=null,rxMm=null,codigoBase=null,medidaMm=null,variante=extrairVarianteMm(base);
    if(variante){rxBase=confRefRegex(variante.codigoBase);rxMm=confRefRegex(variante.mm);codigoBase=variante.codigoBase;medidaMm=variante.mm;}
    if(!mapa[k])mapa[k]={nome:r.ref,norm:n,goma:goma,rx:confRefRegex(base),rxBase:rxBase,rxMm:rxMm,codigoBase:codigoBase,medidaMm:medidaMm,rows:[]};
    mapa[k].rows.push(r);
  });
  // aliases legados "ant.CODIGO" + NOVOS aliases aprendidos (coluna AliasesConf)
  Object.keys(mapa).forEach(function(k){
    var entry=mapa[k];var tokens=[];
    var mParen=entry.nome.match(/\(([^)]+)\)/);
    if(mParen){var antigos=mParen[1].match(/\bant\.?\s*([A-Z][A-Z0-9]{1,}(?:[.\/_\-][A-Z0-9]+)*)/gi)||[];antigos.forEach(function(a){tokens.push(a.replace(/^ant\.?\s*/i,"").trim());});}
    entry.rows.forEach(function(r){String(r.aliasesConf||"").split("|").forEach(function(a){a=a.trim();if(a)tokens.push(a);});});
    tokens.forEach(function(aliasCode){
      var an=normTxt(aliasCode);if(an.length<2)return;var ak=an+"|"+(entry.goma?1:0);
      if(!mapa[ak])mapa[ak]={nome:entry.nome,norm:an,goma:entry.goma,rx:confRefRegex(aliasCode),rows:entry.rows};
    });
  });
  var cands=Object.keys(mapa).map(function(k){return mapa[k];});
  var emissao=dataBR(emissaoStr);var out=[];
  blocos.forEach(function(bloco){
    var item=parseFn(bloco);if(!item)return;
    var blocoGoma=confTemGoma(bloco);var medidaPdf=item.cm||item.mm||0;
    var hits=cands.filter(function(c){if(!c.rx)return false;if(c.rxMm)return !!(c.rxBase&&c.rxBase.test(bloco)&&c.rxMm.test(bloco));return c.rx.test(bloco);});
    var medidaBate=function(c){return medidaPdf>0&&c.rows.some(function(r){return Math.abs((r.medidaBase||0)-medidaPdf)<0.01;});};
    hits.sort(function(a,b){var ma=medidaBate(a)?1:0,mb=medidaBate(b)?1:0;if(mb!==ma)return mb-ma;var ga=(a.goma===blocoGoma)?1:0,gb=(b.goma===blocoGoma)?1:0;if(gb!==ga)return gb-ga;return b.norm.length-a.norm.length;});
    var hit=hits[0]||null;
    var res={seq:item.seq,bloco:bloco,precoPdf:item.preco,qtd:item.qtd,medida:0,medidaLabel:"",refNome:hit?hit.nome:"",descricao:"",unidade:"",vigencia:"",esperado:null,status:"",motivo:""};
    if(!hit){
      var nb=normTxt(bloco);
      if(ignorados.some(function(ig){return nb.indexOf(ig)>=0;})){res.status="IGNORADO";res.motivo="Item marcado como fora da tabela de preço deste cliente.";out.push(res);return;}
      res.status="NAO_CADASTRADO";out.push(res);return;
    }
    // Quando o pedido indica a unidade (PR/MT — formatos Dakota), prefere as
    // linhas da tabela do MESMO tipo (PR→PAR/cm, MT→METRO/direto). Sem isso, um
    // código com linha PAR e linha METRO de mesma data (ex.: M22063) poderia
    // cair na METRO por desempate de data. Formatos sem unidade (DASS/RAMARIM/
    // DILLY) não setam item.unit e este filtro é ignorado.
    var rowsTipo=hit.rows;
    if(item.unit){
      var querCm=(item.unit==="PR");
      var fTipo=hit.rows.filter(function(r){var bl=String(r.medidaBaseLabel||"");var rc=/CM/i.test(bl)?true:/MM/i.test(bl)?false:!unidadeDireta(r.unidade||"metros");return rc===querCm;});
      if(fTipo.length)rowsTipo=fTipo;
    }
    var esc=confEscolherVigencia(rowsTipo,emissao,medidaPdf);var row=esc.row;
    res.refNome=row.ref||res.refNome;res.descricao=row.descricao||"";res.unidade=row.unidade||"metros";
    res.vigencia=(row.dataInicio||"–")+" → "+(row.dataFim||"Sem vencimento");
    var precoTab=row["preco"+uf]>0?row["preco"+uf]:(row.preco>0?row.preco:0);
    if(!precoTab){
      var comPreco=rowsTipo.filter(function(r){return r!==row&&((r["preco"+uf]>0)||(r.preco>0));});
      if(comPreco.length){var mesma=comPreco.filter(function(r){return Math.abs((r.medidaBase||0)-(row.medidaBase||0))<0.01;});if(mesma.length)comPreco=mesma;comPreco.sort(function(a,b){return (dataBR(b.dataInicio)||0)-(dataBR(a.dataInicio)||0);});var alt=comPreco[0];precoTab=alt["preco"+uf]>0?alt["preco"+uf]:alt.preco;}
      else{res.status="SEM_PRECO";res.motivo="Referencia sem preco "+uf+" cadastrado na vigencia "+res.vigencia+".";out.push(res);return;}
    }
    var baseLabel=String(row.medidaBaseLabel||"");
    var usaCm=/CM/i.test(baseLabel)?true:/MM/i.test(baseLabel)?false:!unidadeDireta(res.unidade);
    if(usaCm){res.medida=item.cm||0;res.medidaLabel=res.medida?res.medida+"cm":"";if(!res.medida){res.status="SEM_MEDIDA";res.motivo="tamanho nao identificado";out.push(res);return;}if(!(row.medidaBase>0)){res.status="SEM_MEDIDA";res.motivo="sem medida base";out.push(res);return;}var e=(res.medida/row.medidaBase)*precoTab;res.esperado=arred?arred(e):e;}
    else if(unidadeKg(res.unidade)){res.medida=0;res.medidaLabel="por kg";res.esperado=precoTab;}
    else{res.medida=medidaPdf||row.medidaBase||0;res.medidaLabel=res.medida?(res.medida+"mm · por metro"):"por metro";res.esperado=precoTab;}
    var opcoes=[],melhor=null;
    if(esc.pool.length>1){esc.pool.forEach(function(r){var calc=confPrecoEsperado(r,uf,item,arred);if(!calc)return;if(opcoes.some(function(o){return confPrecoConfere(o.esperado,calc.esperado);}))return;opcoes.push({ref:r.ref||"",esperado:calc.esperado,medidaLabel:calc.medidaLabel,match:confPrecoConfere(item.preco,calc.esperado)});});}
    var difere;
    if(opcoes.length>1){res.opcoes=opcoes;melhor=opcoes.filter(function(o){return o.match;})[0]||null;if(melhor){res.esperado=melhor.esperado;res.refNome=melhor.ref||res.refNome;res.medidaLabel=melhor.medidaLabel||res.medidaLabel;}difere=!melhor;}
    else difere=!confPrecoConfere(item.preco,res.esperado);
    if(esc.vencido){res.status="VENCIDO";}else{res.status=difere?"DIVERGENTE":"OK";}
    out.push(res);
  });
  return out;
}

// ---------- carregar tabela DAKOTA ----------
function parseCSV(t){const R=[];let r=[],c="",q=false;for(let i=0;i<t.length;i++){const x=t[i];if(q){if(x==='"'){if(t[i+1]==='"'){c+='"';i++;}else q=false;}else c+=x;}else{if(x==='"')q=true;else if(x===','){r.push(c);c="";}else if(x==="\n"){r.push(c);R.push(r);r=[];c="";}else if(x==="\r"){}else c+=x;}}if(c.length||r.length){r.push(c);R.push(r);}return R;}
const csv=parseCSV(fs.readFileSync(DIR+"/../tabela de preços - DAKOTA CLIENTE (1).csv","utf8"));
const refs=csv.slice(1).filter(r=>r[0]&&r[0].trim()).map((r,i)=>({linha:i+2,ref:(r[0]||"").trim(),descricao:(r[1]||"").trim(),preco:pBR(r[2]),dataInicio:(r[3]||"").trim(),dataFim:(r[4]||"").trim(),obs:(r[5]||"").trim(),unidade:(r[6]||"metros").trim(),medidaBase:pBR(r[7]),medidaBaseLabel:(r[7]||"").trim(),precoRS:pBR(r[8]),precoBA:pBR(r[9]),precoCE:pBR(r[10]),precoMG:pBR(r[11]),aliasesConf:""}));

// ---------- rodar contra os 23 arquivos ----------
const files=fs.readdirSync(DIR+"/..").filter(f=>/\.(dkn|dke|htm)$/i.test(f)).sort();
let tot=0,cnt={OK:0,DIVERGENTE:0,NAO_CADASTRADO:0,SEM_PRECO:0,SEM_MEDIDA:0,VENCIDO:0,IGNORADO:0};
const modCnt={};
const detalheDiv=[];
for(const f of files){
  const texto=fs.readFileSync(DIR+"/../"+f,"latin1");
  let leitura,parseFn;
  if(confDakotaEhFixo(f,texto)){leitura=confDakotaLerFixo(texto);parseFn=confParseItemBlocoDakotaFixo;}
  else if(confDakotaEhHtm(f,texto)){leitura=confDakotaLerHtm(texto);parseFn=confParseItemBlocoDakotaHtm;}
  else{console.log("?? formato não detectado:",f);continue;}
  const campos=leitura.campos;
  modCnt[campos.modalidade]=(modCnt[campos.modalidade]||0)+1;
  // Dakota confere contra o PREÇO ATUAL (decisão do usuário): emissao vazia →
  // confEscolherVigencia usa a data de hoje = vigência mais recente.
  const out=confValidar(leitura.blocos,refs,campos.uf,"",parseFn,{arred:confArredCentBankers});
  out.forEach(r=>{tot++;cnt[r.status]=(cnt[r.status]||0)+1;if(r.status==="DIVERGENTE"||r.status==="NAO_CADASTRADO"||r.status==="SEM_PRECO")detalheDiv.push(f+" | "+campos.modalidade+" | "+r.status+" | "+(r.refNome||"?")+" | ped="+(r.precoPdf||0).toFixed(2)+" esp="+(r.esperado==null?"—":r.esperado.toFixed(2))+" | "+r.bloco.replace(/###.*/,"").slice(0,40));});
}
console.log("Arquivos:",files.length,"| Itens:",tot);
console.log("Modalidades:",JSON.stringify(modCnt));
console.log("Status:",JSON.stringify(cnt));
console.log("\n--- divergências/não-cadastrado/sem-preço ---");
const uniq={};detalheDiv.forEach(d=>{const k=d.split(" | ").slice(1,5).join("|");uniq[k]=(uniq[k]||0)+1;});
Object.keys(uniq).sort().forEach(k=>console.log("  x"+uniq[k],k));

// ====== TESTE DO FLUXO DE ENSINAR ======
console.log("\n===== TESTE: ensinar alias LS11628 -> M1294 + ignorar FITA REFORCO FR =====");
refs.forEach(r=>{if(r.ref==="M1294")r.aliasesConf="LS11628";});
const ign=["FITA REFORCO FR"];
let antesNC=0,depoisNC=0,virouOK=0,virouIgn=0;
for(const f of files){
  const texto=fs.readFileSync(DIR+"/../"+f,"latin1");
  let leitura,parseFn;
  if(confDakotaEhFixo(f,texto)){leitura=confDakotaLerFixo(texto);parseFn=confParseItemBlocoDakotaFixo;}
  else if(confDakotaEhHtm(f,texto)){leitura=confDakotaLerHtm(texto);parseFn=confParseItemBlocoDakotaHtm;}
  else continue;
  const semEns=confValidar(leitura.blocos,refs.map(r=>({...r,aliasesConf:""})),leitura.campos.uf,"",parseFn,{arred:confArredCentBankers,ignorados:[]});
  const comEns=confValidar(leitura.blocos,refs,leitura.campos.uf,"",parseFn,{arred:confArredCentBankers,ignorados:ign});
  semEns.forEach(r=>{if(r.status==="NAO_CADASTRADO")antesNC++;});
  comEns.forEach((r,i)=>{
    if(r.status==="NAO_CADASTRADO")depoisNC++;
    const prev=semEns[i];
    if(prev&&prev.status==="NAO_CADASTRADO"&&r.status==="OK")virouOK++;
    if(prev&&prev.status==="NAO_CADASTRADO"&&r.status==="IGNORADO")virouIgn++;
  });
}
console.log("NAO_CADASTRADO antes:",antesNC,"| depois:",depoisNC,"| viraram OK (alias):",virouOK,"| viraram IGNORADO:",virouIgn);
