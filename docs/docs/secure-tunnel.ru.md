# Подключение ForgeBridge к ChatGPT через Secure MCP Tunnel

> **Это опционально.**
>
> Если вы используете ForgeBridge локально через MCP-клиент, который умеет запускать stdio-серверы,
> Secure MCP Tunnel и OpenAI API key **не нужны**.
>
> Tunnel нужен, когда ChatGPT, Codex или другой поддерживаемый OpenAI-продукт должен подключаться к
> ForgeBridge, который запущен на вашем личном ПК или в приватной сети и не имеет публичного HTTPS
> адреса.

## Как понять, нужен ли вам Tunnel

### Вариант A — локальный MCP-клиент

Используйте этот вариант, если ваш MCP-клиент работает на том же компьютере и умеет запускать MCP
сервер командой.

Вам нужны только Node.js и ForgeBridge:

```sh
npm install --global forgebridge@next
forgebridge init --root /path/to/project
forgebridge doctor
forgebridge browser install
```

Команда MCP-сервера:

```sh
forgebridge serve --transport stdio
```

В этом сценарии:

- OpenAI Platform не нужен;
- `tunnel_id` не нужен;
- `CONTROL_PLANE_API_KEY` не нужен;
- открывать порт в интернет не нужно.

### Вариант B — ChatGPT подключается к ForgeBridge на вашем ПК

ChatGPT не подключается напрямую к локальному MCP-серверу. Для приватного компьютера используйте
OpenAI Secure MCP Tunnel.

В этом сценарии понадобятся:

1. поддерживаемый аккаунт/рабочее пространство ChatGPT с доступом к developer mode;
2. OpenAI Platform organization;
3. созданный Secure MCP Tunnel и его `tunnel_id`;
4. runtime API key с минимальными правами **Tunnels Read + Use**;
5. официальный `tunnel-client`;
6. запущенный ForgeBridge.

Политики ChatGPT developer mode зависят от плана и могут меняться. Проверяйте актуальную страницу
OpenAI перед настройкой.

## Пошаговая настройка Tunnel

### 1. Установите ForgeBridge

```powershell
npm install --global forgebridge@next
forgebridge init --root C:\Projects\MyProject
forgebridge doctor
```

### 2. Создайте Tunnel в OpenAI Platform

Откройте настройки Secure MCP Tunnel в OpenAI Platform.

Создайте новый tunnel и сохраните его идентификатор вида:

```text
tunnel_0123456789abcdef0123456789abcdef
```

Если вы подключаете ChatGPT, tunnel должен быть связан с нужным ChatGPT workspace/аккаунтом, а не
только с Platform organization.

### 3. Создайте runtime API key

Для запуска `tunnel-client` нужен runtime API key.

Рекомендуемые минимальные права:

- Tunnels Read;
- Tunnels Use.

Для обычного запуска не давайте runtime-ключу Tunnels Manage, если это не требуется.

Ключ **не нужно отправлять ForgeBridge, автору ForgeBridge или кому-либо ещё**. Он остаётся у
пользователя и используется локально официальным `tunnel-client`.

### 4. Установите официальный tunnel-client

Скачивайте актуальный `tunnel-client` по ссылке из OpenAI Platform или официальной документации
OpenAI. Не используйте случайные сторонние бинарники.

Проверьте:

```powershell
tunnel-client --version
```

Если бинарник не добавлен в PATH, можно указать его путь ForgeBridge через `--tunnel-client`.

### 5. Создайте профиль ForgeBridge Tunnel

```powershell
forgebridge tunnel init --tunnel-id tunnel_0123456789abcdef0123456789abcdef
```

Эта команда создаёт локальный профиль. API key на этом шаге не сохраняется в профиль.

### 6. Передайте runtime key через переменную окружения

В PowerShell:

```powershell
$env:CONTROL_PLANE_API_KEY = Read-Host -MaskInput 'Tunnel runtime API key'
```

Не вставляйте runtime key в README, issue, скриншоты, Git repository или аргументы командной строки.

### 7. Проверьте соединение

```powershell
forgebridge tunnel doctor
```

Исправьте ошибки, если doctor сообщает о проблеме с tunnel ID, ключом, доступом или локальным
ForgeBridge.

### 8. Запустите Tunnel

```powershell
forgebridge tunnel run
```

Это окно/процесс должен оставаться запущенным, пока ChatGPT использует локальный ForgeBridge.

Tunnel делает исходящее HTTPS-соединение к OpenAI. Входящий публичный порт на роутере открывать не
нужно.

### 9. Добавьте ForgeBridge в ChatGPT

В ChatGPT включите developer mode, если он доступен вашему плану/рабочему пространству.

При создании developer-mode app выберите **Tunnel** и затем созданный tunnel либо укажите его
`tunnel_id`.

После подключения ChatGPT получит список MCP tools ForgeBridge.

## Что такое этот API key

Runtime API key для Tunnel используется официальным `tunnel-client` для аутентификации в OpenAI
tunnel control plane.

Он не является ключом, который нужно вшивать в ForgeBridge.

Если вы отдельно используете OpenAI Responses API для вызова моделей, это уже другой API-сценарий со
своими настройками и биллингом.

## Безопасность

- никогда не публикуйте `CONTROL_PLANE_API_KEY`;
- выдавайте runtime-ключу минимальные права;
- если ключ утёк — отзовите/замените его в OpenAI Platform;
- не передавайте ключ автору ForgeBridge;
- ForgeBridge не должен сохранять значение runtime API key в Git/config;
- Tunnel не делает ваш локальный MCP публичным сервером;
- для полностью локальной работы используйте stdio без Tunnel.

## Диагностика

ForgeBridge:

```powershell
forgebridge doctor
forgebridge tunnel doctor
```

Проверка официального клиента:

```powershell
tunnel-client help quickstart
```

Если ChatGPT не видит tunnel, проверьте:

1. запущен ли `forgebridge tunnel run`;
2. правильный ли `tunnel_id`;
3. есть ли у runtime key права Tunnels Read + Use;
4. связан ли tunnel с нужным ChatGPT workspace;
5. разрешён ли developer mode для вашего аккаунта/workspace;
6. разрешены ли исходящие HTTPS-подключения к OpenAI.

## Официальная документация

- OpenAI Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- ChatGPT developer mode и MCP apps:
  https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
