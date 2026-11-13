# KeepMind Corp

**KeepMind corporativo = o mesmo second brain (Today, Brain, Chat, Skills, Security) + governança da empresa.**

O app de desktop **gratuito** (KeepMind pessoal) continua o produto individual. A edição **Corp** entrega o mesmo cérebro e as regras da empresa num **aplicativo de desktop instalável** (Windows, macOS, Linux): o servidor local sobe automaticamente — usuários finais e TI **não** precisam instalar Node, npm nem Docker.

Desenho completo: [`docs/ENTERPRISE.md`](../docs/ENTERPRISE.md). Roadmap: [`docs/CORP-ROADMAP.md`](../docs/CORP-ROADMAP.md).

## Por que instalar?

KeepMind Corp **não** é a versão gratuita para uso pessoal. É o **mesmo KeepMind** que você já conhece (memória em Markdown, chat, skills, segurança), mais **política da organização**: quem pode ver o quê, provedores de IA, autonomia dos agentes, SSO e auditoria.

Em vez de pedir que cada pessoa configure servidor ou container, o **app Corp** embute o servidor corporativo. Na primeira execução, um assistente cria a organização e a conta **owner**; depois disso, a equipe usa o cérebro em `/brain/` e a TI gere tudo em `/admin/` — tudo na máquina ou no ambiente que vocês escolherem, sem “subir um Docker” como caminho principal.

## Como instalar (usuários finais e TI)

1. Obtenha o instalador para o seu sistema (gerado pela equipe que mantém o repositório):
   - **macOS:** `.dmg` ou `.zip`
   - **Windows:** instalador `.exe` (NSIS)
   - **Linux:** `.AppImage`
2. Abra o app **KeepMind Corp**.
3. Na **primeira vez**, conclua o onboarding (nome da org, conta owner, senha).
4. Use o **KeepMind** em `/brain/`; donos e admins abrem **governança** em `/admin/`.

Dados locais ficam na pasta de dados do app (por exemplo `userData/keepmind-corp/` no Electron).

### Quem gera os instaladores

Quem desenvolve ou empacota o produto, a partir deste repositório:

```bash
npm run dist:corp:mac    # ou dist:corp:win / dist:corp:linux / dist:corp
```

Saída em `dist-corp/`. Configuração: [`electron-builder.corp.yml`](../electron-builder.corp.yml).

## O que você vê depois do login

| Rota | Quem | O quê |
|------|------|--------|
| `/brain/` | Todos | **Second brain** — mesma interface KeepMind, memória em `people/<id>/memory/` + camada `shared/memory/` |
| `/admin/` | Dono, admin | **Governança** — SSO, política, times, agentes, varredura, cofre bruto |

Membros não configuram chave de provedor na interface: a empresa traz BYOK no ambiente do servidor.

## Primeira execução (onboarding)

Não há usuário embutido. Na **primeira vez**, o portal abre um assistente em 4 passos:

1. Explica o que é Corp (brain + governança).
2. Nome da organização.
3. Conta **owner** (nome + email).
4. Senha (mín. 12 caracteres).

Alternativa para automação: `KEEPMIND_CORP_OWNER_EMAIL` e `KEEPMIND_CORP_OWNER_PASSWORD` no ambiente (pula o wizard se definidos antes do primeiro login).

Depois do login, um tour rápido no `/brain/` marca o onboarding do usuário como concluído.

## Desenvolvimento local (somente quem altera o código)

Para testar o servidor e a UI sem gerar instalador:

```bash
npm run corp:build-brain   # compila a UI KeepMind (base /brain/)
npm run corp
```

Portal: `http://127.0.0.1:8787` → onboarding ou login → **KeepMind** em `/brain/`.

## Sync desktop → Corp (v0.4)

1. Admin → **Agentes** — ligue **Sync**.  
2. Admin → **Sync (tokens)** — gere um token (segredo exibido uma vez).  
3. No desktop ou CI:

```bash
KEEPMIND_CORP_TOKEN='…' node tools/corp-push.mjs \
  --url http://127.0.0.1:8787 \
  --dir ./memory
```

Alternativa: export JSON do Brain + `--bundle ./export.json`. Requer escopos `memory:import` no token.

**Bidirecional (merge por `updatedAt`):**

```bash
KEEPMIND_CORP_TOKEN='…' node tools/corp-sync.mjs --url http://127.0.0.1:8787 --dir ./memory
```

### MCP remoto (Composer / agentes externos)

Runtime HTTP: `POST /api/mcp/call` (auditoria em `vault/ops/mcp-invocations.jsonl`).  
Bridge stdio para Cursor:

```bash
KEEPMIND_CORP_URL='http://127.0.0.1:8787' KEEPMIND_CORP_TOKEN='…' \
  node tools/corp-mcp-bridge.mjs
```

Registre no `.cursor/mcp.json` apontando para o bridge. Ative **Composer** e respeite **cotas diárias** no admin.

**Stdio in-process (sem HTTP)** — na mesma máquina do servidor Corp:

```bash
KEEPMIND_CORP_DATA=./corp/data KEEPMIND_CORP_TOKEN='…' npm run corp:mcp
```

### ABAC em `people/` (v0.7)

Em **Política**, JSON `peopleAccess` — ex.: diretores leem `people/lead/memory/inbox`.

### GitHub corporativo (v0.7)

**Chaves org → github** (PAT `repo`). **Admin → GitHub sync** — push/pull de `shared/`.

### Metering (v0.6)

**Admin → Times** — orçamento diário em unidades (MCP=1, chat nuvem=10).  
**Admin → Metering** — visão de uso por time e agente.

## Verificação

```bash
npm run corp:build-brain
npm run corp:check
```

### Publicar instaladores (CI)

Tag no repositório dispara build nos três sistemas:

```bash
git tag corp-v0.1.0 && git push origin corp-v0.1.0
```

Artefatos ficam na **GitHub Release** ligada à tag (workflow `release-corp.yml`).

## Armazenamento cifrado do CRM Corp

Novos registros do CRM Corp são cifrados em repouso. Instalações existentes precisam executar a migração explícita antes de acessar seus relacionamentos. Consulte [migração, chave local e recuperação](../docs/CORP-CRM-STORAGE.md). A chave fica fora do vault e precisa de backup separado.
