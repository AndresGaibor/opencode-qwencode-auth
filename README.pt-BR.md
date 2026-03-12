# 🤖 Qwen Code OAuth Plugin para OpenCode

![npm version](https://img.shields.io/npm/v/opencode-qwencode-auth)
![License](https://img.shields.io/github/license/luanweslley77/opencode-qwencode-auth)
![GitHub stars](https://img.shields.io/github/stars/luanweslley77/opencode-qwencode-auth)

<p align="center">
  <img src="assets/screenshot.png" alt="OpenCode com Qwen Code" width="800">
</p>

**Autentique o OpenCode CLI com sua conta qwen.ai.** Este plugin permite usar o modelo `coder-model` com **2.000 requisições gratuitas por dia** - sem API key ou cartão de crédito!

[🇺🇸 Read in English](./README.md) | [📜 Changelog](./CHANGELOG.md)

## ✨ Funcionalidades

- 🔐 **OAuth Device Flow** - Autenticação segura via navegador (RFC 8628)
- 🆓 **2.000 req/dia grátis** - Plano gratuito generoso para uso pessoal
- 🧠 **1M de contexto** - Suporte a contextos massivos para grandes projetos
- 🔄 **Auto-refresh** - Tokens renovados automaticamente antes de expirarem
- ⏱️ **Confiabilidade** - Throttling de requisições e retry automático para erros temporários
- 🔗 **Compatível com qwen-code** - Reutiliza credenciais de `~/.qwen/oauth_creds.json`

## 🚀 Instalação

### 1. Instale o plugin

```bash
# Usando npm
cd ~/.config/opencode && npm install opencode-qwencode-auth

# Usando bun (recomendado)
cd ~/.config/opencode && bun add opencode-qwencode-auth
```

### 2. Habilite o plugin

Edite `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-qwencode-auth"]
}
```

## 🔑 Uso

### 1. Login

Execute o comando abaixo para iniciar o fluxo OAuth:

```bash
opencode auth login
```

### 2. Selecione o Provider

Escolha **"Other"** e digite `qwen-code`.

### 3. Autentique

Selecione **"Qwen Code (qwen.ai OAuth)"**.

- Uma janela do navegador abrirá para você autorizar.
- O plugin detecta automaticamente quando você completa a autorização.
- **Não precisa copiar/colar códigos ou pressionar Enter!**

## 🎯 Modelos Disponíveis

### Modelo de Código

| Modelo | Contexto | Max Output | Recursos |
|--------|----------|------------|----------|
| `coder-model` | 1M tokens | 64K tokens | Alias oficial (Auto-rotas para Qwen 3.5 Plus - Híbrido & Visão) |

> **Nota:** Este plugin está alinhado com o cliente oficial `qwen-code`. O alias `coder-model` rotaciona automaticamente para o melhor modelo Qwen 3.5 Plus disponível com raciocínio híbrido e capacidades de visão.

### Usando o modelo

```bash
opencode --provider qwen-code --model coder-model
```

## 🔧 Solução de Problemas

### "Invalid access token" ou "Token expired"

O plugin geralmente gerencia a renovação automaticamente. Se você vir este erro imediatamente:

1.  **Re-autentique:** Execute `opencode auth login` novamente.
2.  **Limpe o cache:** Delete o arquivo de credenciais e faça login de novo:
    ```bash
    rm ~/.qwen/oauth_creds.json
    opencode auth login
    ```

### Limite de requisições excedido (erros 429)

Se você atingir o limite de 2.000 requisições/dia:
- Aguarde até a meia-noite UTC para o reset da cota.
- Considere usar uma [API Key do DashScope](https://dashscope.aliyun.com) para uso profissional.

### Habilite Logs de Debug

Se algo não estiver funcionando, você pode ver logs detalhados configurando a variável de ambiente:

```bash
OPENCODE_QWEN_DEBUG=1 opencode
```

## 🛠️ Desenvolvimento

```bash
# Clone o repositório
git clone https://github.com/luanweslley77/opencode-qwencode-auth.git
cd opencode-qwencode-auth

# Instale dependências
bun install

# Rode os testes
bun run tests/debug.ts full
```

### Estrutura do Projeto

```
src/
├── qwen/               # Implementação OAuth
├── plugin/             # Gestão de token & cache
├── utils/              # Utilitários de retry, lock e logs
├── constants.ts        # Modelos e endpoints
└── index.ts            # Entry point do plugin
```

## 📄 Licença

MIT

---

<p align="center">
  Feito com ❤️ para a comunidade OpenCode
</p>
