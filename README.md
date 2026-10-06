# Treasure Skins Radar

Produto provisório focado em detectar inputs raros/subprecificados para trade-ups avançados de CS2.

## MVP v0
- extensão Chromium (Chrome + Edge)
- motor Radar
- backend/API mínimo
- login Steam
- alertas com link direto para o listing
- arquitetura multi-market

## Fontes de verdade
- Supabase: estado operacional, runs, configs e eventos
- GitHub: código e versões
- Google Drive: documentação humana canônica
- ChatGPT Project: contexto e especialistas

## Regra de autonomia
Mudanças reversíveis, sem custo, sem nova credencial e dentro do escopo aprovado podem avançar autonomamente com teste, validação e rollback.

## Estado
Login Steam e snapshot remoto inicial validados. O [refresh recorrente controlado](docs/recurring-freshness.md) adiciona TTL, lease e limites no runtime existente, sem alterar a autenticação. Veja também o [diagnóstico histórico do 503](docs/authenticated-feed-recovery.md).

## Executar o piloto (Node 22 ou superior)

Na pasta do repositório:

```sh
node scripts/collect-once.mjs
node backend/server.mjs
```

Carregue a pasta `extension` como extensão descompactada em Chrome/Edge. Em Configurações, salve `http://127.0.0.1:8787` e aceite acesso a esse endereço. Abra o popup para consultar o último scan. A coleta é explícita e limitada a 10 consultas; abrir o popup não aciona novas consultas de mercado. Repita o primeiro comando para atualizar (intervalo mínimo de 60 segundos). Após 300 segundos os dados aparecem como antigos.

O piloto só escuta em `127.0.0.1`. Não publique esse servidor por túnel/proxy: autenticação Steam ainda não foi implementada. Nenhum segredo de mercado é necessário localmente; a coleta reutiliza o runtime Deno existente, sem alterá-lo. A certificação preserva a regra do comparador legado; não confirma elegibilidade de Souvenir para trade-up nem garante disponibilidade/execução da compra.

O snapshot fica em `.data/latest.json` e sobrevive a reinícios. `TSR_DATA_DIR` permite escolher outra pasta local. O arquivo `collection.lock` impede coletores concorrentes; após interrupção abrupta, confira que o processo acabou antes de remover somente esse arquivo. O histórico completo e Supabase permanecem pendentes. Não há scheduler novo, billing ou auto-buy.

## Validação e próximos passos

```sh
node scripts/validate.mjs
node tests/options.test.mjs
node tests/opportunity-contract.test.mjs
node tests/health-state.test.mjs
node --test tests/backend.test.mjs
```

Veja [evidências e gates](docs/phase-1-evidence.md), [Steam auth](docs/steam-auth.md) e [backlog](docs/backlog.md).


## Continuity / recovery

If a chat or execution context is lost, start with [CONTINUITY.md](CONTINUITY.md). A copy-paste cold-start command is also available in [RECOVERY_PROMPT.txt](RECOVERY_PROMPT.txt).
