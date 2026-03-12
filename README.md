# 🤖 Qwen Code OAuth Plugin for OpenCode

![npm version](https://img.shields.io/npm/v/opencode-qwencode-auth)
![License](https://img.shields.io/github/license/luanweslley77/opencode-qwencode-auth)
![GitHub stars](https://img.shields.io/github/stars/luanweslley77/opencode-qwencode-auth)

<p align="center">
  <img src="assets/screenshot.png" alt="OpenCode with Qwen Code" width="800">
</p>

**Authenticate OpenCode CLI with your qwen.ai account.** This plugin enables you to use the `coder-model` with **2,000 free requests per day** - no API key or credit card required!

[🇧🇷 Leia em Português](./README.pt-BR.md) | [📜 Changelog](./CHANGELOG.md)

## ✨ Features

- 🔐 **OAuth Device Flow** - Secure browser-based authentication (RFC 8628)
- 🆓 **2,000 req/day free** - Generous free tier for personal use
- 🧠 **1M context window** - Massive context support for large projects
- 🔄 **Auto-refresh** - Tokens renewed automatically before expiration
- ⏱️ **Reliability** - Built-in request throttling and automatic retry for transient errors
- 🔗 **qwen-code compatible** - Reuses credentials from `~/.qwen/oauth_creds.json`

## 🚀 Installation

### 1. Install the plugin

```bash
# Using npm
cd ~/.config/opencode && npm install opencode-qwencode-auth

# Using bun (recommended)
cd ~/.config/opencode && bun add opencode-qwencode-auth
```

### 2. Enable the plugin

Edit `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-qwencode-auth"]
}
```

## 🔑 Usage

### 1. Login

Run the following command to start the OAuth flow:

```bash
opencode auth login
```

### 2. Select Provider

Choose **"Other"** and type `qwen-code`.

### 3. Authenticate

Select **"Qwen Code (qwen.ai OAuth)"**.

- A browser window will open for you to authorize.
- The plugin automatically detects when you complete authorization.
- **No need to copy/paste codes or press Enter!**

## 🎯 Available Models

### Coding Model

| Model | Context | Max Output | Features |
|-------|---------|------------|----------|
| `coder-model` | 1M tokens | 64K tokens | Official alias (Auto-routes to Qwen 3.5 Plus - Hybrid & Vision) |

> **Note:** This plugin aligns with the official `qwen-code` client. The `coder-model` alias automatically routes to the best available Qwen 3.5 Plus model with hybrid reasoning and vision capabilities.

### Using the model

```bash
opencode --provider qwen-code --model coder-model
```

## 🔧 Troubleshooting

### "Invalid access token" or "Token expired"

The plugin usually handles refresh automatically. If you see this error immediately:

1.  **Re-authenticate:** Run `opencode auth login` again.
2.  **Clear cache:** Delete the credentials file and login again:
    ```bash
    rm ~/.qwen/oauth_creds.json
    opencode auth login
    ```

### Rate limit exceeded (429 errors)

If you hit the 2,000 requests/day limit:
- Wait until midnight UTC for the quota to reset.
- Consider using a [DashScope API Key](https://dashscope.aliyun.com) for professional use.

### Enable Debug Logs

If something isn't working, you can see detailed logs by setting the debug environment variable:

```bash
OPENCODE_QWEN_DEBUG=1 opencode
```

## 🛠️ Development

```bash
# Clone the repository
git clone https://github.com/luanweslley77/opencode-qwencode-auth.git
cd opencode-qwencode-auth

# Install dependencies
bun install

# Run tests
bun run tests/debug.ts full
```

### Project Structure

```
src/
├── qwen/               # OAuth implementation
├── plugin/             # Token management & caching
├── utils/              # Retry, locking and logging utilities
├── constants.ts        # Models and endpoints
└── index.ts            # Plugin entry point
```

## 📄 License

MIT

---

<p align="center">
  Made with ❤️ for the OpenCode community
</p>
