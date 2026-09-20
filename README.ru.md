# ForgeBridge

> **Статус: публичная alpha / beta-тестирование.**
>
> ForgeBridge уже пригоден для реального тестирования, но это пока не стабильный production-релиз.
> Возможны изменения команд, MCP-инструментов, форматов конфигурации и поведения между alpha/beta
> версиями. Проект будет дальше обновляться, улучшаться и получать новые возможности.

[English README](README.md)

ForgeBridge — локальный MCP-агент для разработки на компьютере, которым пользователь владеет и
который явно разрешил использовать. Он даёт AI-клиенту безопасно ограниченный доступ к проектам:
файлам, Git, терминалу, долгоживущим процессам, браузеру и некоторым Windows-функциям.

Главная идея ForgeBridge — не просто дать модели произвольный shell, а предоставить более удобные
семантические инструменты для разработки и применять локальные правила доступа, подтверждения и
аудит действий.

## Что умеет ForgeBridge

- определять стек проекта, runtime, package manager, тесты, lint/typecheck/build и Git-состояние;
- читать и изменять файлы только внутри разрешённых корней;
- безопаснее работать с Git через отдельные semantic-инструменты;
- запускать тесты и проверки через заранее вычисленный план;
- работать с terminal/PTY и долгоживущими jobs;
- управлять браузером через Playwright;
- поддерживать background/gaming execution profiles;
- давать локальные approval-запросы для рискованных действий;
- вести редактируемый от секретов audit log;
- подключаться к совместимым MCP-клиентам через stdio;
- использовать OpenAI Secure MCP Tunnel для удалённого подключения;
- на Windows опционально использовать ограниченную UI Automation.

## Быстрый старт

Требуется Node.js 22 или новее.

После публикации alpha в npm:

```sh
npm install --global forgebridge@next
forgebridge init --root /path/to/your/project
forgebridge doctor
forgebridge browser install
forgebridge serve --transport stdio
```

Без глобальной установки:

```sh
npx -y forgebridge@next serve --transport stdio
```

На Linux, если Chromium требует системные зависимости:

```sh
forgebridge browser install --with-deps
```

## Диагностика

```sh
forgebridge doctor
```

Команда проверяет Node.js, конфигурацию, разрешённые project roots и состояние локального агента и
подсказывает следующие шаги.

## Безопасность

ForgeBridge является мощным локальным инструментом. Даже при deny-first permission engine
разрешённый произвольный shell получает права текущего пользователя ОС. ForgeBridge **не является
полноценной OS sandbox**.

Поэтому:

- разрешайте только нужные project roots;
- не запускайте агент от администратора без необходимости;
- внимательно относитесь к approval-запросам;
- для особо чувствительных систем используйте отдельный Windows-пользователь, Sandbox или VM;
- не публикуйте локальную папку состояния ForgeBridge, ключи, логи или browser profiles.

Подробнее: [SECURITY.md](SECURITY.md) и [модель безопасности](docs/security-model.md).

## Текущий статус проекта

Версия `0.1.x` предназначена для раннего публичного тестирования. Уже есть автоматические unit,
integration и end-to-end тесты, проверка установленного npm-артефакта, SBOM и кроссплатформенный CI.

При этом до стабильного `1.0` ещё возможны несовместимые изменения. Особенно это касается:

- списка и схем MCP tools;
- onboarding и способов подключения разных клиентов;
- Windows UI Automation;
- multi-device / remote UX;
- формата конфигурации и release tooling.

Ошибки, идеи и предложения можно отправлять через GitHub Issues. Новые версии будут постепенно
добавлять улучшения, исправления и более простой пользовательский UX.

## Для разработчиков

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm run package:artifact
pnpm run package:validate
```

Основные документы:

- [Установка и packaging](docs/installation.md)\n-
  [Подключение к ChatGPT через Secure MCP Tunnel — пошагово](docs/secure-tunnel.ru.md)
- [Архитектура](docs/architecture.md)
- [Permission model](docs/permission-model.md)
- [Security model](docs/security-model.md)
- [Threat model](docs/threat-model.md)
- [Public release checklist](docs/public-release.md)
- [Model-first workflow](docs/model-workflows.md)

## Лицензия

Apache License 2.0. См. [LICENSE](LICENSE).
