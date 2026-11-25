# Notas

## Histórico de versões

| Versão | Data | Mudança |
|---|---|---|
| 1.2.0 | 25/11/2026 | Conferir: quando a variante mais recente não tem preço na coluna do pedido, confere pela outra variante vigente que tem, com aviso correto — antes misturava a descrição de um item com o preço de outro e chamava de "vigência anterior" (BIBI, pedido 3842008, MEER 6MM). A "vigência anterior" passa a valer só para o mesmo item (referência + medida + descrição). Cadastro: aviso ao salvar referência com texto depois da espessura (ex.: "MEER 6MM NORMAL"), que impede a conferência de encontrar o item. Tabela BIBI de calibração atualizada e pedido 3842008 incluído nos testes. |
| 1.1.2 | 25/11/2026 | Corrige a data de início/fim que recuava 1 dia a cada salvamento pelo formulário (cadastro, edição e "Atualizar preço"): o texto `aaaa-mm-dd` era lido como meia-noite UTC = 21:00 do dia anterior em UTC−3. Datas passam a ser gravadas ao meio-dia do dia digitado e as vigências comparadas por dia. Novas funções `revisarDatasDeslocadas()` (só lista) e `corrigirDatasDeslocadas()` (devolve 1 dia às datas gravadas com o erro), para rodar no editor do Apps Script. Teste `amostras/verifica_datas.js`. |
| 1.1.1 | 12/11/2026 | Emails de atualização de preço (item único e lote) passam a mostrar o Peso quando preenchido. |
| 1.1.0 | 12/11/2026 | Campo Peso passa a aceitar texto livre (ex.: "1mt = 0,0028gr"); valor numérico puro continua exibido com "g". Criada a faixa de versão. |
