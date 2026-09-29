# Print Bridge - Sistema Comercial

Esta ponte local habilita funções que o navegador não permite sozinho:

- listar impressoras instaladas no Windows;
- abrir propriedades da impressora;
- escolher caminho/nome do arquivo pelo seletor nativo;
- salvar PDF usando Edge/Chrome local;
- tentar enviar o PDF para a impressora selecionada.

## Como usar

1. Preferencialmente abra `..\INICIAR_SISTEMA_COM_PONTE.bat`.
2. Mantenha a janela `Sistema Comercial - Print Bridge` aberta enquanto usar o módulo `Cortes Fornecedores`.
3. No sistema, clique em `Imprimir / Salvar PDF`.

A ponte ficará disponível em `http://127.0.0.1:9127`.

Se a impressão silenciosa for bloqueada pelo Windows ou pelo leitor de PDF padrão, o PDF será gerado e o sistema mostrará o caminho para impressão manual.

Se Edge/Chrome não aceitar geração de PDF em modo headless neste computador, a ponte usa um PDF textual de contingência em vez de falhar silenciosamente.
