# Experiência do KeepMind

Implementação de UX/UI de 13 de novembro de 2026, sobre a continuidade de projetos e o contrato temporal de memória.

## Organização

As cinco áreas principais são **Hoje, Conversar, Projetos, Memória e Rotinas**. Integrações, conexões visuais, atividade, habilidades, avaliação de respostas, diagnóstico, segurança e configurações continuam disponíveis em **Ferramentas**. A edição Corp mantém suas limitações de serviço explícitas.

Capturar está visível na navegação e no cabeçalho compacto. Os atalhos existentes continuam disponíveis: `Ctrl/⌘ K` para busca e navegação, `Ctrl/⌘ Shift M` para captura. No formulário de captura, `Ctrl/⌘ Enter` salva.

O tema usa tipografia legível, hierarquia de texto, superfícies mais tranquilas e foco visível. A navegação compacta tem os mesmos destinos principais. Telas avançadas são carregadas sob demanda; o grafo não faz parte do carregamento inicial.

## Fluxos principais

- **Hoje:** retoma o projeto ativo mais recente, reúne decisões propostas, revisões, lições, fatos e aprovações, e abre a fonte de uma atividade pelo caminho exato. Indicadores ficam recolhidos. Falhas de serviço são diferentes de ausência de pendências.
- **Captura:** bloqueia envios duplicados e mantém o rascunho se a gravação falhar ou se a janela for fechada. Só mostra sucesso depois da resposta do serviço. Rascunhos ficam na sessão da aplicação, separados por usuário e espaço; não são um backup persistente.
- **Memória:** busca com estado de carregamento, erro e nova tentativa; respostas atrasadas não substituem a busca atual. A leitura abre a fonte completa, sem o antigo corte de 4.000 caracteres. A lista renderiza resultados em grupos para não criar milhares de elementos de uma vez. A busca rápida oferece **Abrir na Memória** para continuar a leitura e corrigir fatos na área que preserva o rascunho durante a navegação.
- **Correção:** exige o texto completo de exatamente um fato ativo. Correspondência ausente ou ambígua não grava nada. A substituição mantém o fato anterior no histórico temporal. Corrigir um fato não reescreve arbitrariamente seus documentos de origem.
- **Conversar:** mantém a conversa ao navegar, oferece fontes, preserva respostas parciais e rascunhos e permite interrupção real no aplicativo nativo. Cada solicitação tem identificador e dono; eventos de outra solicitação são ignorados. Ações de ferramentas já iniciadas podem terminar após a interrupção.
- **Projetos:** criação com nome e objetivo; fontes e detalhes opcionais antes de salvar; seções e histórico expansíveis; seleção de fontes autorizadas; contexto legível e completo para copiar ou preencher uma conversa. Nenhuma dessas ações envia automaticamente a mensagem.
- **Revisões e qualidade:** as fontes, o motivo e o efeito da revisão permanecem visíveis. Análises desatualizadas têm ação de atualização. O benchmark resume seus resultados e mantém os casos completos expansíveis; comparações exigem a mesma suíte. O julgamento do modelo continua explicitamente falível.
- **Primeiro uso:** boas-vindas, IA opcional, primeira captura e próximo passo. Se a memória estiver bloqueada, o fluxo oferece criação ou recuperação da proteção. A chave de recuperação precisa ser reconhecida antes de prosseguir; o fluxo não configura credenciais automaticamente.

## Avatar e movimento

`open-bot-avatar` está fixado em **0.2.1**. O KeepMind usa uma definição própria e inclui a atribuição e licença MIT no `NOTICE` distribuído.

O avatar recebe apenas estado de interface, tamanho e preferências. O texto da memória não é enviado ao renderizador. `thinking` acompanha uma solicitação em andamento; `happy` é breve e indica conclusão técnica, não veracidade. Erro e necessidade de revisão têm texto e controles da interface, além de uma expressão neutra.

Em Aparência, o usuário pode desativar avatar, animações e fundo decorativo. O fundo começa desligado. A preferência do sistema por movimento reduzido é respeitada. Há fallback estático, destruição das instâncias ao desmontar e pausa nas telas ocultas.

## Estado, isolamento e compatibilidade

Conversas, projetos, memória e a avaliação iniciada continuam montados durante a navegação comum. A troca de usuário, espaço ou bloqueio da memória reinicia esses painéis. O estado temporário não deve atravessar esses limites. O chat isola também seus registros de arquivos por turno assíncrono, incluindo uma ferramenta que termina depois do cancelamento.

O histórico antigo do chat tinha uma única chave local sem identificação de usuário ou espaço. Essa chave não é apagada nem atribuída automaticamente a uma conta; as novas conversas usam chaves separadas. O histórico de memória gravado pelo backend continua disponível pelas fontes autorizadas.

Na edição Corp, o cancelamento de uma geração no servidor não é oferecido como se estivesse disponível. A prévia do navegador se identifica como demonstração com dados fictícios.

## Verificação

Os testes de interação usam dados sintéticos e incluem preservação de rascunhos, erro/repetição de salvamento, busca atrasada, fonte integral, navegação, modais pelo teclado, aprovação de análises, correções temporais, cancelamento real e isolamento dos turnos.

Comandos de validação:

```sh
npm run typecheck
npm test
npm run build
npm run corp:build-brain
npm run corp:check
npm run test:experience
```

O smoke test de navegador usa o renderer compilado com uma bridge de dados fictícios, sem serviço de IA nem chamadas externas. O workflow **Experience smoke** instala Chromium, executa as interações e disponibiliza screenshots e `report.json` como artefatos. Ele verifica a renderização do avatar, a preferência de movimento reduzido, a desativação do avatar e uma viewport estreita.

A validação visual automatizada é executada pelo GitHub Actions; o resultado de cada execução e suas capturas ficam vinculados ao commit testado. Esse teste de renderer não equivale a medir consumo de CPU/bateria ou certificar todos os pacotes Electron em todos os sistemas.
