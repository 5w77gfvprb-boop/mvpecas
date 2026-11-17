# MV Peças: como colocar no ar

Sistema **separado** da Agenda Premier e do financeiro: banco próprio (Supabase), site próprio (Vercel), GitHub próprio e login próprio.
Leva uns 20 minutos. Faça na ordem.

---

## 1. Criar o banco de dados (Supabase)

1. Entre em https://supabase.com com a sua conta e clique em **New project**.
   - Nome: `mv-pecas`
   - Senha do banco: crie uma e **guarde** (não vai usar no dia a dia, mas não perca).
   - Região: **South America (São Paulo)**.
   - Clique em **Create new project** e espere uns 2 minutos até ficar pronto.
2. No menu da esquerda, abra **SQL Editor** → **New query**.
3. Abra o arquivo `supabase/migrations/0001_base.sql` (no computador, com o Bloco de Notas), copie **tudo**, cole na tela do Supabase e clique em **Run**.
   Deve aparecer *Success. No rows returned*.
4. Clique de novo em **New query**, faça o mesmo com o arquivo `supabase/migrations/0002_backup_ativo.sql` e clique em **Run**.

> Rodou duas vezes sem querer? Não tem problema: os arquivos não apagam nem duplicam nada.
> Ele já cadastra os clientes **Protivaço** e **Aliar** (dá para mudar em Cadastros).

## 2. Criar o seu login

1. No Supabase: **Authentication** → **Users** → **Add user** → **Create new user**.
2. Coloque o seu e-mail e uma senha, marque **Auto Confirm User** e clique em **Create user**.
   (Se alguém mais for usar, crie um login para cada pessoa.)

## 3. Pegar o endereço e a chave do banco

1. No Supabase: **Project Settings** (engrenagem) → **API Keys** (em alguns painéis aparece como **Data API** / **API**).
2. Copie dois valores e deixe num bloco de notas:
   - **Project URL** — algo como `https://abcdefghij.supabase.co`
   - **Publishable key** — começa com `sb_publishable_…` (se só aparecer a antiga, use a **anon public**).

⚠️ **Nunca** use a chave *secret* / *service_role*.

## 4. Subir o código no GitHub

1. Em https://github.com clique em **New** (repositório novo). Nome: `mv-pecas`. Pode deixar **Private**. Clique em **Create repository**.
2. Na página do repositório vazio, clique em **uploading an existing file**.
3. Descompacte o zip no computador, abra a pasta, **selecione tudo o que está dentro** (pastas `src`, `public`, `supabase` e os arquivos soltos como `package.json`) e arraste para a página do GitHub. Clique em **Commit changes**.
   - Os arquivos que começam com ponto (`.gitignore`) às vezes não aparecem no Windows; tudo bem se ficarem de fora.
4. Agora cole o endereço e a chave: no GitHub, abra `src` → `lib` → `config.ts` e clique no **lápis** (Edit).
   - Troque `COLE_AQUI_A_PROJECT_URL` pela **Project URL** (mantenha as aspas).
   - Troque `COLE_AQUI_A_CHAVE_PUBLISHABLE` pela **Publishable key** (mantenha as aspas).
   - Fica assim:
     ```ts
     process.env.NEXT_PUBLIC_SUPABASE_URL || "https://abcdefghij.supabase.co";
     ...|| "sb_publishable_xxxxxxxxxxxxxxxx";
     ```
   - Clique em **Commit changes**.

> Se preferir, me mande a Project URL e a Publishable key que eu devolvo o zip já preenchido.

## 5. Colocar o site no ar (Vercel)

1. Em https://vercel.com: **Add New** → **Project** → escolha o repositório `mv-pecas` → **Import**.
2. Não precisa mexer em nada (nem em *Environment Variables*). Clique em **Deploy** e espere 1–2 minutos.
3. Abra o endereço que a Vercel mostrar (ex.: `https://mv-pecas.vercel.app`) e entre com o login do passo 2.

## 6. Instalar como app na tela de início

- **iPhone / iPad** (Safari): abra o site → botão **Compartilhar** (quadrado com seta) → **Adicionar à Tela de Início** → nome **MV Peças**.
- **Android** (Chrome): menu ⋮ → **Instalar app** (ou *Adicionar à tela inicial*).
- **PC** (Chrome/Edge): ícone de instalar na barra de endereço.

## 7. "Esqueci a senha" (configurar uma vez)

1. Supabase → **Authentication** → **URL Configuration**:
   - *Site URL*: o endereço do site na Vercel (ex.: `https://mv-pecas.vercel.app`).
   - *Redirect URLs* → **Add URL**: o mesmo endereço com `/nova-senha` no fim (ex.: `https://mv-pecas.vercel.app/nova-senha`).
2. **Authentication** → **Emails** → **Reset Password**. Troque o texto por este e salve:
   ```html
   <h2>MV Peças: nova senha</h2>
   <p>Toque no link abaixo para criar uma senha nova. Ele vale por 1 hora e só funciona uma vez.</p>
   <p><a href="{{ .SiteURL }}/nova-senha?token_hash={{ .TokenHash }}&type=recovery">Criar senha nova</a></p>
   <p>Se não foi você que pediu, ignore este e-mail.</p>
   ```
3. O e-mail grátis do Supabase só chega para quem faz parte da equipe da conta (no máximo 2 por hora). Se o login é o mesmo e-mail da sua conta do Supabase, já funciona. Para outro e-mail: **Organization** → **Team** → **Invite** com esse e-mail.

**Se o e-mail não chegar de jeito nenhum**, troque a senha direto: **SQL Editor → New query**, troque o e-mail e a senha abaixo e clique em **Run**:
```sql
update auth.users set encrypted_password = extensions.crypt('SenhaNova123', extensions.gen_salt('bf')) where email = 'seu@email.com';
```
Depois troque para uma senha só sua em **Ajustes → Trocar minha senha** (no celular: **Mais → Trocar minha senha**).

## 8. Para o Supabase não pausar

O plano grátis pausa o banco depois de 7 dias sem uso. O site já vem com uma rotina diária da Vercel (arquivo `vercel.json`) que "cutuca" o banco todo dia, então isso não deve acontecer nem nas férias.
- Para conferir: na Vercel, **Settings → Cron Jobs** deve mostrar `/api/manter-ativo`. Abrir `https://SEU-SITE/api/manter-ativo` deve mostrar `"ok":true`.
- Se mesmo assim pausar, o sistema mostra uma tela explicando: entre em supabase.com/dashboard, abra o projeto e clique em **Resume project**. Nada é perdido.

## 9. Backup

- **Ajustes → Backup → Baixar backup** gera um arquivo `.json` com tudo. Guarde no Drive ou mande para o seu e-mail uma vez por mês.
- Se ficar 30 dias sem baixar, aparece um aviso amarelo no topo.
- O sistema também guarda sozinho uma cópia por semana dentro do banco (as 8 últimas).
- **Restaurar** troca todos os dados pelos do arquivo. Antes, ele guarda uma cópia do estado atual, então dá para voltar em "Cópias guardadas".

---

## Como usar no dia a dia

1. **Novo** (botão vermelho): escolha o cliente, a oficina (digite o nome; se for nova, toque em *Cadastrar*), carro, placa, ano e observações. **Cole a lista de peças do WhatsApp** e toque em *Pôr na lista*; confira e toque em *Criar pedido*.
   - Se a placa já tem pedido aberto, ele avisa e oferece pôr as peças novas no mesmo carro.
2. No carro, o quadro vermelho diz **o próximo passo** com um botão: *Marcar compra* → *Enviei* → *Entregue* → *Mandei ao contador* → *Nota emitida* → *Cobrar* → *Recebi*.
   - **Comprei**: fornecedor, data, se a nota do fornecedor veio, e custo/venda de cada peça.
   - Para peças diferentes em momentos diferentes: toque nos quadradinhos das peças e use a barra de baixo (*Comprei*, *Enviei*, *Entregue*…).
3. **A fazer** (tela inicial) mostra tudo o que está pendente, de todos os carros: comprar, enviar, confirmar entrega, mandar nota, esperar o contador, cobrar, receber (com vencidos em vermelho), nota de fornecedor pendente, peças sem preço.
4. **Cobranças**: uma cobrança pode ter um carro ou vários carros do mesmo cliente, em 1 parcela ou 30/60/90 (boleto, cheque, pix…). *Copiar texto*/*WhatsApp* manda a lista para o cliente; *Extrato do cliente* mostra tudo o que ele deve.
5. **Relatórios**: vendido, custo, lucro, por cliente e por fornecedor; *Planilha (Excel)* baixa tudo do mês.

### Errou? Dá para voltar
- Depois de cada ação aparece **Desfazer** no aviso do topo.
- Toque num passo verde (ex.: *Enviada 16/11*) para **mudar a data ou desmarcar**.
- O lápis de cada peça abre tudo para editar (inclusive datas, cancelar peça e excluir).
- O que for excluído vai para **Ajustes → Lixeira** e volta com *Trazer de volta*.
- No carro, **⋯ → Histórico de mudanças** mostra tudo o que mudou.
