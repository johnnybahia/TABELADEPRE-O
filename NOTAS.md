# Notas

## Histórico de versões

| Versão | Data | Mudança |
|---|---|---|
| 1.1.2 | 25/11/2026 | Corrige a data de início/fim que recuava 1 dia a cada salvamento pelo formulário (cadastro, edição e "Atualizar preço"): o texto `aaaa-mm-dd` era lido como meia-noite UTC = 21:00 do dia anterior em UTC−3. Datas passam a ser gravadas ao meio-dia do dia digitado e as vigências comparadas por dia. Novas funções `revisarDatasDeslocadas()` (só lista) e `corrigirDatasDeslocadas()` (devolve 1 dia às datas gravadas com o erro), para rodar no editor do Apps Script. Teste `amostras/verifica_datas.js`. |
| 1.1.1 | 12/11/2026 | Emails de atualização de preço (item único e lote) passam a mostrar o Peso quando preenchido. |
| 1.1.0 | 12/11/2026 | Campo Peso passa a aceitar texto livre (ex.: "1mt = 0,0028gr"); valor numérico puro continua exibido com "g". Criada a faixa de versão. |
