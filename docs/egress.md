# Sincronização e redução de egress

O histórico sincroniza resumos e exclusões por `updated_at` gerado no servidor. Os produtos são carregados quando um orçamento ou relatório precisa deles. A memória de fornecedores e o financeiro verificam `updated_at` antes de baixar conteúdo.

## Comportamento

- Realtime conectado: reconciliação de resumos/metadados a cada cinco minutos.
- Realtime indisponível: consulta incremental a cada 60 segundos; reconciliação completa de resumos a cada cinco minutos.
- Reconexão, retorno à aba e carga inicial reconciliam os resumos. Abas ocultas não fazem consultas periódicas.
- Resumos em lotes de 200, com cursor `(updated_at, id)` e sobreposição inclusiva de cinco minutos. O cursor só é persistido quando a consulta de todos os lotes e a gravação do cache terminam.
- Histórico com 50 cartões por página, depois de aplicar filtros. Os cartões usam contagens calculadas no banco.
- Cache IndexedDB `comercial-cache-v3`, separado por usuário autenticado, com stores `summaries`, `details` e `meta`. O cache antigo é removido do localStorage somente após sua migração persistir; a fila `vsorcamentos_pending_ops_v1` é preservada e reaplicada.
- Um detalhe só é reutilizado quando sua versão corresponde ao resumo ou contém uma edição local pendente. O servidor confirma uma gravação retornando apenas ID e versão; o detalhe salvo continua disponível offline.
- Relatórios carregam detalhes ausentes com no máximo três requisições simultâneas. Se houver dados indisponíveis offline, a operação falha com uma mensagem, sem gerar um relatório parcial.
- Logout encerra os controles de sincronização e canais. Uma gravação já enviada pode concluir, mas as demais operações pendentes permanecem na fila.

## Banco e implantação

As migrações `reduce_egress_updated_at` e `restrict_history_summary_grants` são aditivas e já foram aplicadas no projeto `vwlpoeyqifnjcjoaltgf`. Os arquivos no repositório usam as versões registradas pelo servidor. Não executar esse SQL novamente nesse projeto; em outros ambientes com o esquema original, aplicar pela rotina normal de migrações antes de publicar o frontend.

A view `historico_orcamentos_resumos` usa `security_invoker=true` e só concede SELECT a `authenticated`. As políticas da tabela base continuam sendo aplicadas. O trigger sobrescreve timestamps fornecidos por clientes antigos. Exclusões continuam sendo lógicas; não há limpeza física de tombstones.

Este PR prepara a versão 2.0.0.84. Publicar o frontend pelo fluxo habitual de merge/hosting do repositório. Reverter o frontend não exige remover view, índice ou trigger. Navegadores precisam recarregar a página para usar os novos scripts.

## Validação reproduzível

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

O teste de navegador usa a página real e duas abas com API/Realtime simuladas; não faz gravações em produção. Para usar Chrome já instalado, definir `BROWSER_EXECUTABLE` com seu caminho. `PLAYWRIGHT_MODULE` permite apontar para um runtime Playwright previamente instalado.

`tests/verify-egress.sql` verifica contagens, segurança da view, RLS para cada perfil existente e timestamps de inserção/atualização. A escrita sintética ocorre dentro de uma transação com rollback; o script não deve ser dividido em execuções independentes.

Em 30/10/2026, o banco retornou 441 resumos ativos em 176.977 bytes de JSON, contra 5.763.630 bytes das linhas completas, aproximadamente 97% menos nessa consulta antes de compressão. As onze verificações SQL passaram. Os advisors não apontaram novos avisos de segurança; o índice novo pode aparecer como ainda não utilizado antes da publicação do frontend.

## Medição após publicação

Na página Usage da organização, filtrar este projeto e comparar Database Egress e Realtime Egress em jornadas equivalentes, registrando a quantidade de usuários/abas. Contagens de logs não medem bytes faturados. A redução de 97% acima refere-se apenas ao tamanho do JSON da leitura completa do histórico, não a uma promessa sobre a fatura.

No Network do navegador, uma aba ociosa não deve repetir leituras completas de `historico_orcamentos`, `cortes_fornecedores_memoria` ou `financeiro_ultima_analise`. A abertura de um orçamento baixa um detalhe, e mudanças remotas invalidam somente versões afetadas. Uma reconciliação completa baixa resumos, nunca todos os produtos.
