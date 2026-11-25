"use strict";
// Teste das DATAS do Codigo.gs: gravar/comparar DataInicio e DataFim e reparar as
// datas gravadas com o erro de fuso (versão 1.1.1 e anteriores recuavam 1 dia a
// cada salvamento). Carrega o Codigo.gs REAL num sandbox com uma planilha
// simulada no fuso America/Sao_Paulo (UTC−3, o da planilha real).
// Uso: node amostras/verifica_datas.js [caminho/do/Codigo.gs]
const TZ = "America/Sao_Paulo";
if (process.env.TZ !== TZ) { // o fuso local do processo precisa ser o do script do Apps Script
  const r = require("child_process").spawnSync(process.execPath, [__filename, ...process.argv.slice(2)],
    { stdio: "inherit", env: Object.assign({}, process.env, { TZ }) });
  process.exit(r.status === null ? 1 : r.status);
}
const fs = require("fs"), vm = require("vm"), path = require("path");
const arquivo = process.argv[2] || path.join(__dirname, "..", "Codigo.gs");

// ---------- Utilities.formatDate ----------
function fmtTz(d, tz, pat) {
  const p = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  const m = { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second };
  return pat.replace(/yyyy|MM|dd|HH|mm|ss/g, t => m[t]);
}

// ---------- planilha simulada (só o que o Codigo.gs usa aqui) ----------
const colNum = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const vazio = x => x === "" || x == null;
class Aba {
  constructor(nome, linhas) { this.nome = nome; this.v = []; this.fmt = {}; (linhas || []).forEach(l => this.appendRow(l)); }
  getName() { return this.nome; }
  getLastRow() { for (let r = this.v.length; r >= 1; r--) if ((this.v[r - 1] || []).some(x => !vazio(x))) return r; return 0; }
  getLastColumn() { return Math.max(0, ...this.v.map(l => { for (let c = l.length; c >= 1; c--) if (!vazio(l[c - 1])) return c; return 0; })); }
  getMaxRows() { return Math.max(1000, this.v.length); }
  _get(r, c) { const x = (this.v[r - 1] || [])[c - 1]; return x instanceof Date ? new Date(x.getTime()) : (x == null ? "" : x); }
  _set(r, c, x) {
    while (this.v.length < r) this.v.push([]);
    const l = this.v[r - 1]; while (l.length < c) l.push("");
    l[c - 1] = x instanceof Date ? new Date(x.getTime()) : x;
  }
  getRange(a, b, nr, nc) {
    if (typeof a === "string") {
      const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
      const r = +m[2], c = colNum(m[1]);
      return new Intervalo(this, r, c, m[3] ? +m[4] - r + 1 : 1, m[3] ? colNum(m[3]) - c + 1 : 1);
    }
    return new Intervalo(this, a, b, nr || 1, nc || 1);
  }
  getDataRange() { return new Intervalo(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(l) { const r = this.getLastRow() + 1; l.forEach((x, i) => this._set(r, i + 1, x)); return this; }
}
class Intervalo {
  constructor(aba, r, c, nr, nc) { Object.assign(this, { aba, r, c, nr, nc }); }
  _cada(f) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) f(this.r + i, this.c + j, i, j); return this; }
  getValues() { const o = []; this._cada((r, c, i) => { (o[i] = o[i] || []).push(this.aba._get(r, c)); }); return o; }
  getValue() { return this.aba._get(this.r, this.c); }
  setValues(m) { return this._cada((r, c, i, j) => this.aba._set(r, c, m[i][j])); }
  setValue(x) { return this._cada((r, c) => this.aba._set(r, c, x)); }
  setNumberFormat(f) { return this._cada((r, c) => { this.aba.fmt[r + "," + c] = f; }); }
  getNumberFormat() { return this.aba.fmt[this.r + "," + this.c] || ""; }
}
const planilha = {
  abas: {}, tz: TZ,
  getId() { return "TESTE"; },
  getSheetByName(n) { return this.abas[n] || null; },
  getSheets() { return Object.values(this.abas); },
  insertSheet(n) { return (this.abas[n] = new Aba(n)); },
  getSpreadsheetTimeZone() { return this.tz; }
};
const CABECALHO = ["Referencia", "Descricao", "Preco", "DataInicio", "DataFim", "Observacoes", "Unidade",
  "MedidaBase", "PrecoRS", "PrecoBA", "PrecoCE", "PrecoMG", "Peso", "PrecoAtivo"];
const novaAba = (nome, linhas) => (planilha.abas[nome] = new Aba(nome, [CABECALHO].concat(linhas || [])));
planilha.abas.VENDEDORES = new Aba("VENDEDORES", [["ID", "Nome", "Senha", "Clientes", "Email"], ["ADM", "Admin", "x", "*", ""]]);

// ---------- sandbox com o Codigo.gs real ----------
const logger = [];
const sb = {
  console, Math, Date, JSON, parseInt, parseFloat, isNaN, RegExp, String, Number, Array, Object, Boolean, Intl, Error,
  SpreadsheetApp: { getActiveSpreadsheet: () => planilha },
  Session: { getScriptTimeZone: () => TZ },
  Utilities: { formatDate: (d, tz, pat) => {
    if (!(d instanceof Date) || isNaN(d.getTime())) throw new Error("Invalid argument");
    return fmtTz(d, tz, pat);
  } },
  CacheService: { getScriptCache: () => ({ get: () => "ADM", put() {}, remove() {} }) },
  Logger: { log: s => { logger.push(String(s)); } }
};
vm.createContext(sb);
vm.runInContext(fs.readFileSync(arquivo, "utf8"), sb, { filename: "Codigo.gs" });

// ---------- utilitários do teste ----------
let total = 0, falhas = 0;
const ok = (cond, msg) => { total++; if (!cond) { falhas++; console.log("   ✗ " + msg); } };
const secao = (nome, f) => {
  const antes = falhas;
  try { f(); } catch (e) { falhas++; total++; console.log("   ✗ exceção: " + e.message); }
  console.log((falhas === antes ? "✅ " : "❌ ") + nome);
};
const dia = d => d instanceof Date ? fmtTz(d, TZ, "dd/MM/yyyy") : String(d);
const hora = d => d instanceof Date ? fmtTz(d, TZ, "HH:mm") : "";
const toISO = s => (!s || s === "Sem vencimento") ? "" : s.split("/").reverse().join("-"); // igual ao Index.html
const dados = o => Object.assign({ ref: "", descricao: "teste", preco: 0, dataInicio: "", dataFim: "", obs: "",
  unidade: "metros", medidaBase: "6", precoRS: "1,00", precoBA: "", precoCE: "", precoMG: "", peso: "" }, o);
const refs = aba => sb.getReferencias(aba, "", "tok").refs;
const linhaPlan = (...vals) => { const l = CABECALHO.map(() => ""); vals.forEach((v, i) => { l[i] = v; }); return l; };

// ---------- 1. helpers ----------
secao("helpers de data (_diaNum, _dataDoForm, _diaAnterior, _fmtDia)", () => {
  ok(sb._diaNum("2026-11-25") === 20261125, "aaaa-mm-dd");
  ok(sb._diaNum("25/11/2026") === 20261125, "dd/mm/aaaa");
  ok(sb._diaNum("2026-02-31") === null && sb._diaNum("31/02/2026") === null, "data inexistente vira null");
  ok(sb._diaNum("29/02/2028") === 20280229, "29/02 em ano bissexto");
  ok(sb._diaNum("") === null && sb._diaNum(null) === null && sb._diaNum("abc") === null, "vazio/texto");
  ok(sb._diaNum(new Date(2026, 3, 6)) === 20260406, "data digitada na planilha (meia-noite local)");
  ok(sb._diaNum(new Date("2026-04-06")) === 20260405, "gravação antiga (meia-noite UTC) aparece no dia anterior");
  const d = sb._dataDoForm("2026-04-06");
  ok(dia(d) === "06/04/2026" && hora(d) === "12:00", "_dataDoForm grava o dia certo ao meio-dia: " + dia(d) + " " + hora(d));
  ok(dia(sb._diaAnterior("2026-03-01")) === "28/02/2026", "_diaAnterior vira o mês");
  ok(sb._fmtDia("2026-01-05", "-") === "05/01/2026" && sb._fmtDia("", "-") === "-", "_fmtDia");
});

// ---------- 2. salvar → ler → editar 3x mantém a data ----------
const abaT = novaAba("TESTE CLIENTE");
secao("cadastrar e editar 3x não recua a data", () => {
  let r = sb.salvarReferencia("TESTE CLIENTE", dados({ ref: "M1", dataInicio: "2026-04-06", dataFim: "2026-12-31" }), "tok", null, "");
  ok(r.ok, "cadastro: " + JSON.stringify(r));
  for (let i = 1; i <= 3; i++) {
    const ref = refs("TESTE CLIENTE").find(x => x.ref === "M1");
    ok(ref.dataInicio === "06/04/2026" && ref.dataFim === "31/12/2026", `leitura ${i}: ${ref.dataInicio} → ${ref.dataFim}`);
    r = sb.salvarReferencia("TESTE CLIENTE", dados({ ref: "M1", dataInicio: toISO(ref.dataInicio), dataFim: toISO(ref.dataFim) }), "tok", ref.linha, "");
    ok(r.ok, `edição ${i}: ` + JSON.stringify(r));
  }
  const ref = refs("TESTE CLIENTE").find(x => x.ref === "M1");
  ok(ref.dataInicio === "06/04/2026" && ref.dataFim === "31/12/2026", `após 3 edições: ${ref.dataInicio} → ${ref.dataFim}`);
  ok(abaT.getRange(2, 4).getNumberFormat() === "dd/MM/yyyy" && abaT.getRange(2, 5).getNumberFormat() === "dd/MM/yyyy", "formato dd/MM/yyyy em D:E");
  ok(hora(abaT.getRange(2, 4).getValue()) === "12:00", "gravada ao meio-dia");
  r = sb.salvarReferencia("TESTE CLIENTE", dados({ ref: "M9", dataInicio: "2026-13-01" }), "tok", null, "");
  ok(!r.ok && /inválida/.test(r.erro), "data inválida é recusada: " + JSON.stringify(r));
  r = sb.salvarReferencia("TESTE CLIENTE", dados({ ref: "M9", dataInicio: "2026-05-10", dataFim: "2026-05-09" }), "tok", null, "");
  ok(!r.ok && /anterior/.test(r.erro), "fim antes do início é recusado");
});

// ---------- 3. Atualizar preço (renovarReferencia) ----------
secao("Atualizar preço: fim da linha antiga = véspera do novo início", () => {
  const r = sb.renovarReferencia("TESTE CLIENTE", 2, { preco: 0, precoRS: "2,00", precoBA: "", precoCE: "", precoMG: "", dataInicio: "2026-11-25", dataFim: "" }, "tok");
  ok(r.ok, "renovar: " + JSON.stringify(r));
  const lista = refs("TESTE CLIENTE");
  const antiga = lista.find(x => x.linha === 2), nova = lista.find(x => x.linha === 3);
  ok(antiga.dataFim === "24/11/2026", "fim da antiga: " + antiga.dataFim);
  ok(nova && nova.dataInicio === "25/11/2026" && nova.dataFim === "Sem vencimento", "início da nova: " + (nova && nova.dataInicio));
  ok(abaT.getRange(3, 4).getNumberFormat() === "dd/MM/yyyy", "formato na linha nova");
  const inv = sb.renovarReferencia("TESTE CLIENTE", 3, { preco: 0, precoRS: "2,00", dataInicio: "2026-02-30", dataFim: "" }, "tok");
  ok(!inv.ok && /inválida/.test(inv.erro), "data inválida é recusada");
});

// ---------- 4. conflito de vigência comparado por DIA ----------
secao("conflito de vigência no mesmo dia (início digitado à mão × novo)", () => {
  abaT.appendRow(linhaPlan("M2", "legado", 0, new Date(2026, 10, 25), "", "", "metros", 6, 1));
  const linhaM2 = abaT.getLastRow();
  let r = sb.salvarReferencia("TESTE CLIENTE", dados({ ref: "M2", descricao: "legado", dataInicio: "2026-11-25" }), "tok", null, "atualizar");
  ok(!r.ok && /igual ou posterior/.test(r.erro), "mesmo dia no modo atualizar é bloqueado: " + JSON.stringify(r));
  r = sb.salvarReferencia("TESTE CLIENTE", dados({ ref: "M2", descricao: "legado", dataInicio: "2026-11-25" }), "tok", null, "");
  ok(!r.ok && r.conflito, "mesmo dia abre o modal de conflito");
  r = sb.salvarReferencia("TESTE CLIENTE", dados({ ref: "M2", descricao: "legado", dataInicio: "2026-11-26" }), "tok", null, "atualizar");
  ok(r.ok && r.vigenciasEncerradas === 1, "dia seguinte encerra a anterior: " + JSON.stringify(r));
  const lista = refs("TESTE CLIENTE");
  ok(lista.find(x => x.linha === linhaM2).dataFim === "25/11/2026", "fim da legada = 25/11/2026");
  ok(lista.some(x => x.ref === "M2" && x.dataInicio === "26/11/2026"), "nova começa em 26/11/2026");

  abaT.appendRow(linhaPlan("M3", "legado", 0, new Date(2026, 0, 1), new Date(2026, 10, 25), "", "metros", 6, 1));
  r = sb.salvarReferencia("TESTE CLIENTE", dados({ ref: "M3", descricao: "legado", dataInicio: "2026-11-25" }), "tok", null, "");
  ok(!r.ok && r.conflito, "início no mesmo dia do fim digitado à mão é conflito");
  ok(r.conflitos && r.conflitos[0].dataFim === "25/11/2026", "modal mostra o fim certo");
  r = sb.salvarReferencia("TESTE CLIENTE", dados({ ref: "M3", descricao: "legado", dataInicio: "2026-11-26" }), "tok", null, "");
  ok(r.ok, "dia seguinte ao fim não conflita");
});

// ---------- 5. reparo das datas gravadas com o erro ----------
secao("revisarDatasDeslocadas / corrigirDatasDeslocadas", () => {
  const abaR = novaAba("REPARO CLIENTE", [
    linhaPlan("R1", "digitada", 0, new Date(2021, 0, 21)),                          // L2 intocada
    linhaPlan("M10", "bug 1x", 0, new Date("2026-04-06")),                         // L3 05/04 → 06/04
    linhaPlan("R4", "bug ini+fim", 0, new Date("2026-11-25"), new Date("2026-12-31")), // L4 → 25/11 e 31/12
    linhaPlan("R5", "ja corrigida", 0, new Date(2026, 3, 6, 12)),                  // L5 intocada
    linhaPlan("R6", "inverteria", 0, new Date("2026-05-10"), new Date(2026, 4, 9)), // L6 pulada
    linhaPlan("R7", "texto", 0, "15/03/2026"),                                     // L7 ignorada
    linhaPlan("", "sem ref", 0, new Date("2026-06-01"))                            // L8 ignorada
  ]);
  const log = planilha.getSheetByName("LOG") || planilha.insertSheet("LOG");
  log.appendRow([new Date(), "ADM", "EDITAR", "REPARO CLIENTE | m10"]);
  log.appendRow([new Date(), "ADM", "EDITAR", "REPARO CLIENTE | M10"]);

  let r = sb.revisarDatasDeslocadas();
  ok(r.ok && r.celulas === 3 && r.puladas === 1, `revisar: ${r.celulas} a corrigir, ${r.puladas} pulada(s)`);
  ok(r.itens.every(t => t.aba === "REPARO CLIENTE"), "nada listado nas linhas gravadas pela versão nova (TESTE CLIENTE)");
  ok(dia(abaR.getRange(3, 4).getValue()) === "05/04/2026", "revisar não altera a planilha");
  const m10 = r.itens.find(t => t.ref === "M10");
  ok(m10 && m10.atual === "05/04/2026" && m10.corrigida === "06/04/2026" && m10.gravacoesLog === 2 && /2 vezes/.test(m10.aviso),
    "M10 listada com o aviso do LOG: " + JSON.stringify(m10));

  r = sb.corrigirDatasDeslocadas();
  ok(r.ok && r.celulas === 3 && r.puladas === 1, `corrigir: ${r.celulas} corrigida(s), ${r.puladas} pulada(s)`);
  ok(dia(abaR.getRange(2, 4).getValue()) === "21/01/2021", "digitada à mão intocada");
  ok(dia(abaR.getRange(3, 4).getValue()) === "06/04/2026" && hora(abaR.getRange(3, 4).getValue()) === "12:00", "M10 → 06/04/2026 ao meio-dia");
  ok(dia(abaR.getRange(4, 4).getValue()) === "25/11/2026" && dia(abaR.getRange(4, 5).getValue()) === "31/12/2026", "R4 início e fim");
  ok(abaR.getRange(4, 5).getNumberFormat() === "dd/MM/yyyy", "formato aplicado");
  ok(hora(abaR.getRange(5, 4).getValue()) === "12:00" && dia(abaR.getRange(5, 4).getValue()) === "06/04/2026", "já corrigida intocada");
  ok(dia(abaR.getRange(6, 4).getValue()) === "09/05/2026", "a que inverteria não foi alterada");
  ok(abaR.getRange(7, 4).getValue() === "15/03/2026", "texto intocado");
  ok(dia(abaR.getRange(8, 4).getValue()) === "31/05/2026", "linha sem referência intocada");
  ok(log.getDataRange().getValues().some(l => l[2] === "CORRIGIR_DATAS"), "registrado no LOG");

  r = sb.revisarDatasDeslocadas();
  ok(r.celulas === 0 && r.puladas === 1, "segunda revisão: nada a corrigir (idempotente)");

  planilha.tz = "America/Manaus";
  r = sb.corrigirDatasDeslocadas();
  ok(!r.ok && /Fuso do script/.test(r.erro), "fusos diferentes: corrigir recusa");
  ok(sb.revisarDatasDeslocadas().ok && logger.some(l => /fusos diferentes/.test(l)), "fusos diferentes: revisar avisa");
  planilha.tz = TZ;
});

console.log(`\n${total - falhas}/${total} verificações OK`);
process.exit(falhas ? 1 : 0);
