# Corp em servidor/VPS

O Corp funciona como uma aplicação web compartilhada: instale uma vez no servidor da empresa e distribua a URL. Cada instância possui **um workspace**, com memórias pessoais isoladas e conteúdo compartilhado segundo a política existente. Não é necessário instalar o desktop em cada computador.

## Instalar com Docker Compose

Pré-requisitos: Docker Engine + Compose v2 no servidor Linux, domínio apontando para o VPS, portas 80/443 disponíveis e conta SMTP autorizada a enviar e-mails. A URL deve usar a raiz do domínio, sem subcaminho. A conta SMTP deve suportar TLS (465) ou STARTTLS (587).

Na cópia do repositório:

```sh
cp deploy/corp/.env.example deploy/corp/.env
openssl rand -hex 32
```

Edite `deploy/corp/.env`: informe domínio público, URL HTTPS, domínios corporativos permitidos (separados por vírgula), a chave aleatória de instalação e os dados SMTP. Proteja esse arquivo (`chmod 600 deploy/corp/.env`); não o versione. O endereço remetente deve estar autorizado no provedor SMTP. Configure SPF/DKIM/DMARC com o provedor para entregabilidade.

```sh
docker compose --env-file deploy/corp/.env -f deploy/corp/compose.yml up -d --build
```

O Caddy obtém/renova o certificado HTTPS. Só o proxy expõe portas públicas; o processo Node fica na rede interna e roda sem root. O volume `corp-data` preserva organização, usuários, sessões, convites, memórias e chaves locais. Não execute múltiplas réplicas usando o mesmo volume: o armazenamento atual exige um único processo gravador.

1. Abra a URL e informe a chave de instalação entregue pelo operador do VPS.
2. Defina nome do workspace, seu nome, e-mail corporativo e senha (12+ caracteres).
3. Você entra como administrador principal. A chave prova autorização do operador para criar o primeiro administrador; **não é verificação da caixa postal do administrador**.
4. Remova `KEEPMIND_CORP_SETUP_TOKEN` do `.env` após criar o workspace e recrie o container. O workspace persistido continua funcionando sem a chave.
5. Abra Governança → Pessoas. Convide colegas e escolha membro, auditor ou administrador. Só o administrador principal pode convidar administradores.
6. O destinatário abre o link recebido, confirma o endereço vinculado e define a própria senha. Em acessos posteriores usa a URL, e-mail e senha. SSO exige e-mail verificado pelo IdP e uma conta já admitida no workspace.

Domínios são correspondências exatas: `empresa.com` não permite automaticamente `sub.empresa.com` nem domínios parecidos. O endereço completo do convite deve corresponder ao destinatário. Não existe entrada automática apenas por pertencer à empresa. Convites não concedem o papel de administrador principal.

## Convites e recuperação

Convites expiram após 48 horas e só podem ser aceitos uma vez. O servidor guarda apenas o hash do segredo; o link contém o segredo no fragmento, removido da barra de endereço ao abrir a página. Recarregou antes de aceitar? Abra novamente o e-mail. Não encaminhe o link: ele prova acesso ao destinatário.

A tela distingue enviado, aceito, revogado, expirado e falha. Revogue um convite pendente antes de reenviar. SMTP indisponível retorna erro, sem criar uma conta. Após interrupção durante o envio, o convite incerto é invalidado; envie um novo. A aceitação também exige que quem convidou ainda esteja ativo e autorizado.

A confirmação SMTP significa que o servidor de e-mail aceitou a mensagem, não que ela chegou à caixa de entrada. Não há fluxo de redefinição de senha por e-mail neste incremento; mantenha uma conta administrativa de contingência ou use o SSO configurado. Não apague o volume para recuperar acesso.

## Operação e dados existentes

Faça backup do **volume completo**, não apenas do vault: as chaves locais precisam acompanhar os dados cifrados. Pare o serviço para uma cópia consistente. Guarde os backups cifrados e teste restauração em uma instância isolada. Nunca use `down -v` ao atualizar.

```sh
docker compose --env-file deploy/corp/.env -f deploy/corp/compose.yml stop corp
# Copie o volume corp-data com a ferramenta de backup da sua infraestrutura.
docker compose --env-file deploy/corp/.env -f deploy/corp/compose.yml up -d --build
```

Para migrar uma instalação existente, pare a origem e faça uma cópia integral de seu diretório de dados para o novo volume, preservando permissões (UID/GID 1000 no container). Não misture diretórios de organizações diferentes. Contas existentes continuam preservadas; os domínios configurados controlam novos convites. A migração explícita de CRM antigo continua descrita em [CORP-CRM-STORAGE.md](CORP-CRM-STORAGE.md).

Para execução sem Docker, compile `npm ci && npm run corp:build-brain`, configure as mesmas variáveis mais `KEEPMIND_CORP_MODE=server`, `KEEPMIND_CORP_DATA` e o endereço de bind e execute `npm run corp` com Node 22 sob seu gerenciador de serviços. Use um proxy HTTPS que preserve o cabeçalho Host. Não exponha o backend HTTP diretamente. A origem pública configurada controla cookies Secure, links e proteção contra requisições de outra origem; cabeçalhos forwarded não são usados para confiar em origens.

## Validação reproduzível

```sh
npm run corp:build-brain
TMPDIR=/private/tmp npm test                       # no macOS
TMPDIR=/private/tmp npm run test:crm-browser        # inclui workspace + SMTP TLS
npm run corp:check
# Com Docker disponível:
docker build -f deploy/corp/Dockerfile -t keepmind-corp:test .
node scripts/corp-container-smoke.mjs keepmind-corp:test
```

O batch existente de navegador inclui criação protegida, erro/foco, convite entregue por SMTP STARTTLS local, aceite, senha divergente, login, rejeição de reutilização e layout compacto/movimento reduzido. Tudo usa dados temporários e destinatários `.test`. O job `corp-server-image` verifica Compose, constrói a imagem, cria um workspace, reinicia o container e confirma persistência/login. Relatórios em `artifacts/crm-smoke/` e `artifacts/corp-container/`.

Referência de transporte e TLS: [documentação oficial Nodemailer](https://nodemailer.com/smtp).

## Evidência desta implementação (2026-11-13)

Validação local: instalação limpa por `npm ci`; 303 testes passaram, 2 skips preexistentes; typecheck e builds SB/Corp passaram; selfcheck Corp passou; 11 smokes de experiência e 10 smokes de CRM/workspace passaram; gates de publicação e relatórios passaram. O novo fluxo teve envio SMTP STARTTLS real contra um servidor de teste local, sem destinatários externos. Foram inspecionadas as capturas de Pessoas/convites (1024 px) e aceite (390 px); a entrada e o foco no erro também foram conferidos no navegador interativo.

Jev foi usado como revisão auxiliar do desenho de acesso e apontou recuperação de envio interrompido (probabilidade 0,90, modelo `jev-1.14.0`, 575 tokens de entrada/47 de saída). O caso foi tratado e coberto por regressão; essa análise não substitui testes de autorização.

Docker não está instalado no ambiente local. A evidência do container é produzida pelo job `corp-server-image` no PR; nenhum VPS de produção foi implantado, nenhum domínio real foi configurado e nenhuma entrega para caixa postal externa foi testada. O teste de SMTP comprova transporte e conteúdo; a entrega final depende do provedor e do DNS da empresa.
