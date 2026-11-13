# Proteção do armazenamento do CRM Corp

O CRM Corp cifra integralmente cada agregado `crm/relationships.md`: contatos,
interações, compromissos, oportunidades, rascunhos e snapshots de união. Reutiliza
as funções AES-256-GCM do vault nativo (`tools/lib/vault-crypto.mjs`), preservando o
formato `KMS1`. No Corp, a autenticação inclui uma identidade aleatória do vault e
o caminho completo do registro. Trocar arquivos entre pessoas ou equipes falha.
A chave só é usada no servidor. A classificação continua sendo verificada sobre
o texto decifrado antes de permitir uso de modelos externos.

## Chave e limites

A chave de 256 bits fica no arquivo **`<caminho-absoluto-do-vault>.crm-key`**, fora
do vault: por exemplo, `corp/data/vault.crm-key`. O arquivo é criado exclusivamente,
com permissão 0600; permissões de grupo/outros são recusadas em POSIX. Em Windows,
restrinja a ACL do diretório de dados à conta do serviço. O arquivo
`<vault>/ops/crm-encryption.json` guarda versão, identidade do vault e um verificador
cifrado da chave, nunca a chave. Inicialização e operações usam locks exclusivos.

Esse é o modelo de chave local em arquivo já utilizado pelo aplicativo, não um
KMS/HSM nem uma chave protegida pelo keychain do sistema operacional. Protege o
conteúdo do vault e seu backup isolado; quem obtém **o vault e a chave** consegue
decifrar os dados. Proteja a conta do serviço, o disco e a cópia de recuperação.
Não há rotação automática, escrow ou recuperação por senha neste caminho Corp.
Nunca envie a chave ao GitHub, inclua-a em argumentos de comando ou a registre.

Chave ausente, inválida, trocada, com permissões inseguras ou conteúdo adulterado
bloqueia o acesso. Uma chave existente inválida nunca é substituída automaticamente.
A inicialização não cria uma nova identidade se encontrar agregados já cifrados
sem os metadados originais. Não apague metadados para tentar corrigir uma falha.

## Atualizar uma instalação existente

Pare os processos Corp e os workers MCP que usam o vault, principalmente versões
antigas que ainda gravam plaintext. Faça um backup restrito antes da atualização.
Use o caminho absoluto do vault correto, não o diretório de fontes nem uma cópia
somente leitura. Execute sob a mesma conta do serviço:

```sh
npm run corp:crm-migrate -- --vault /caminho/absoluto/vault --check
npm run corp:crm-migrate -- --vault /caminho/absoluto/vault --apply
npm run corp:crm-migrate -- --vault /caminho/absoluto/vault --check
```

Em um pacote instalado, use `node corp/migrate-crm.mjs` no diretório de recursos
que contém `corp/` e `tools/lib/`, ou execute com o runtime Node disponível ao IT.

- `--check` (também o padrão) valida os documentos sem converter nem criar chave.
  Agregados cifrados são autenticados e seu esquema também é verificado.
- `--apply` valida cada documento pelo parser do CRM, cifra, grava temporário
  **já cifrado**, executa fsync, verifica a leitura do temporário e faz rename
  atômico. Sincroniza o diretório em POSIX. Não cria backup plaintext adicional.
- O lock é o mesmo usado por mutações do CRM. Migração é atômica **por arquivo**,
  não por vault. Uma interrupção deixa cada arquivo antigo intacto ou já cifrado.
  Reexecutar verifica os concluídos e converte os restantes; a revisão de negócio,
  IDs e conteúdo são preservados. Um lock deixado por processo morto exige
  inspeção do administrador antes de remoção; não há remoção automática de locks.
- Saída JSON agrega `examined`, `migrated`, `verified`, `pending` e `failed`.
  Erros identificam um hash do caminho, sem dados dos contatos.
- Código 0: todos os registros encontrados convertidos ou autenticados.
  Código 1: há registros pendentes ou falhas. Código 2: entrada inválida, vault
  indisponível ou nenhum registro encontrado; um lote vazio não é sucesso.

O servidor não faz fallback para registros antigos: antes de migrar, o CRM mostra
que a atualização é necessária. Novos CRMs já são cifrados desde a primeira gravação.
Não volte a executar versões antigas após a migração.

## Backup e recuperação

O download `/api/backup` contém os agregados cifrados e `ops/crm-encryption.json`,
mas **não** a chave irmã do vault. Guarde uma cópia da chave separadamente, com
acesso restrito. Para restaurar, recupere o vault inteiro, inclusive metadados,
e coloque a chave original em `<novo-vault>.crm-key` com as permissões corretas.
Execute `--check` antes de iniciar o serviço. Testes cobrem mudança de localização,
chave ausente/incorreta e recuperação com a chave original. Perder a chave torna
os dados cifrados irrecuperáveis.

O comando cobre os agregados pessoais em `people/<id>/memory/crm/relationships.md`
e de equipe em `shared/crm/teams/<id>/crm/relationships.md`, inclusive de contas
inativas ainda presentes no disco. Não reescreve documentos de origem, contatos
Markdown legados importados, outras memórias, snapshots externos nem backups
antigos. Esses materiais podem continuar em plaintext e precisam de sua própria
política de proteção e descarte. Renomear/substituir um arquivo não apaga blocos
antigos do disco. Nomes, tamanhos e horários dos arquivos continuam visíveis.
