# Agent instructions

## Cursor Cloud — GitHub (push, PR, `keepmind-corp`)

Cloud Agents use the **Cursor GitHub App** token (`cursor[bot]`) by default. It only covers repos linked to the environment. To push to **`criptogus/keepmind-corp`** from the agent:

### Opção 1 — `repositoryDependencies` (sem PAT)

1. [Cloud Agents → seu environment](https://cursor.com/dashboard/cloud-agents)
2. **Environment.json location** → apontar para **`.cursor/environment.json`** deste repositório (ou recriar o environment a partir do repo).
3. **Rebuild** o environment (Build) para o token incluir `github.com/criptogus/keepmind-corp`.
4. Publicar: `./tools/publish-keepmind-corp.sh cursor/corp-roadmap-v02-e37c`

### Opção 2 — PAT / OAuth via `gh` (conta `criptogus`)

1. GitHub → **Settings → Developer settings → Fine-grained tokens** (ou classic) com **Contents: Read and write** em `keepmind` e `keepmind-corp`.
2. Cursor Dashboard → **Cloud Agents → Environment → Secrets** → adicionar **`GH_TOKEN`** (ou `GITHUB_TOKEN`) com o PAT.
3. No próximo agent boot, `install` roda `./tools/gh-cloud-auth.sh` e o `gh`/git passam a usar sua conta.

Verificar: `gh auth status` e `gh api user -q .login` (deve ser `criptogus`, não `cursor`).

### Opção 3 — GitHub App Cursor (só `keepmind`)

Settings → **Applications → Cursor → Configure** → incluir o repositório **`keepmind-corp`**. Isso amplia o que o **app** pode fazer; ainda pode ser necessário a Opção 1 ou 2 para `git push` no Cloud Agent.
