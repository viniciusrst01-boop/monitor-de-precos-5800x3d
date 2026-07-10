# Monitor de precos - Ryzen 7 5800X3D 10th Anniversary Edition

App local para acompanhar preco, estoque, historico e alertas do AMD Ryzen 7 5800X3D 10th Anniversary Edition em lojas brasileiras, sempre em real (BRL).

## Como rodar

```powershell
npm start
```

Depois abra:

```text
http://localhost:5174
```

## Como usar

- Adicione URLs de paginas do produto em lojas brasileiras (`.br`).
- Defina um preco alvo por fonte.
- Clique em `Verificar agora` para atualizar o historico imediatamente.
- Deixe o servidor rodando para o monitor atualizar sozinho no intervalo configurado.

O app so registra historico principal quando a pagina parece ser do Ryzen 7 5800X3D e, por padrao, exige sinais da edicao de 10 anos, como `10th Anniversary`, `10 anos`, `Carbice` ou o codigo `100-100000651POF`.

## Lojas brasileiras configuradas

- KaBuM!
- Pichau
- TerabyteShop
- GK Info Store
- Amazon Brasil
- Mercado Livre
- Patoloco

Amazon Brasil e Mercado Livre sao tratados como marketplace: o monitor exige match rigido e pode mostrar erro quando a loja pede verificacao, login ou bloqueia leitura automatica. Pichau e Mercado Livre possuem coletor local como fallback contra bloqueios.

## Coletor local para Mercado Livre

O Mercado Livre pode bloquear leituras feitas pelo servidor online. Para contornar isso, existe um coletor local que abre um navegador real no seu PC, le o preco e envia a leitura para o monitor.

No Render, configure:

```text
MANUAL_INGEST_TOKEN=um-token-longo-e-secreto
```

No PC, instale o Playwright uma vez:

```powershell
npm install --no-save playwright
```

Depois rode:

```powershell
$env:MONITOR_INGEST_TOKEN="o-mesmo-token-do-render"
npm run collect:mercadolivre
```

Se o Mercado Livre pedir verificacao, resolva no navegador aberto e pressione Enter no terminal. O perfil fica salvo em `.collector-profile/mercadolivre` para as proximas coletas.

Para a Pichau, use o mesmo token e rode:

```powershell
npm run collect:pichau
```

O coletor confirma o codigo `100-100000651POF` e envia o valor a vista no PIX, sem confundir com o total parcelado. O servidor tambem tenta um cliente HTTP alternativo, mas a Pichau pode bloquear o endereco de rede do Render. Nesse caso, `scripts/run-pichau-scheduled.vbs` executa a consulta pela conexao deste PC em segundo plano.

## Contexto internacional

No fim da pagina existe um bloco isolado para fontes de fora do Brasil. Ele serve apenas para indicar se o preco internacional subiu, caiu ou ficou estavel. Esses dados nao entram no grafico principal em real e nao disparam alerta de compra.

## Alertas

O painel mostra alertas no app e tambem pode enviar um POST para um webhook configurado em `Configuracoes`.

## Publicar online

O app esta pronto para hospedar em um servico Node.js persistente, como Render ou Railway.

### Render

1. Suba este repositorio para o GitHub.
2. No Render, crie um novo `Blueprint` apontando para o repositorio.
3. O arquivo `render.yaml` cria o servico web no plano gratuito.

O historico fica no caminho configurado por `DATA_DIR`. Localmente, ele usa `./data`; no Render gratuito, usa `/tmp/price-monitor-data`, que pode ser apagado quando o servico reinicia. Para historico permanente em producao, troque para um plano com disco persistente e use `DATA_DIR=/var/data`.

## Historico permanente com Supabase

1. Crie um projeto no Supabase.
2. Abra o SQL Editor e execute `supabase/schema.sql`.
3. No Render, configure as variaveis:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. No GitHub, crie o secret `MONITOR_SCAN_URL` com:

```text
https://monitor-de-precos-5800x3d.onrender.com/api/scan
```

O workflow `.github/workflows/price-scan.yml` chama a verificacao de precos uma vez por hora.
