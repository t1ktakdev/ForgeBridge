# ForgeBridge

[![CI](https://github.com/t1ktakdev/ForgeBridge/actions/workflows/ci.yml/badge.svg)](https://github.com/t1ktakdev/ForgeBridge/actions/workflows/ci.yml)
[![npm next](https://img.shields.io/npm/v/forgebridge/next?label=npm%20next)](https://www.npmjs.com/package/forgebridge)
[![GitHub release](https://img.shields.io/github/v/release/t1ktakdev/ForgeBridge?include_prereleases&label=release)](https://github.com/t1ktakdev/ForgeBridge/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![До 1.0](https://img.shields.io/badge/%D0%B4%D0%BE%201.0-%E2%89%8868%25-f2c16e)](ROADMAP.ru.md)
![Активная разработка](https://img.shields.io/badge/%D1%81%D1%82%D0%B0%D1%82%D1%83%D1%81-%D0%B0%D0%BA%D1%82%D0%B8%D0%B2%D0%BD%D0%B0%D1%8F%20%D1%80%D0%B0%D0%B7%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%BA%D0%B0-2ea44f)

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

## Control Center

В ForgeBridge есть локальный Control Center, где видно, что делает агент: активные проекты и задачи,
сессии, подтверждения, политики доступа и редактированный audit log.

<p align="center">
  <img src="docs/assets/control-center/overview.png" alt="Главный экран ForgeBridge Control Center" width="920">
</p>

| Проекты                                                                                 | Подтверждения                                                                                 |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| <img src="docs/assets/control-center/projects.png" alt="Страница проектов ForgeBridge"> | <img src="docs/assets/control-center/approvals.png" alt="Страница подтверждений ForgeBridge"> |

<p align="center">
  <img src="docs/assets/control-center/settings-ru-light.png" alt="Настройки ForgeBridge на русском в светлой теме" width="920">
</p>

Интерфейс поддерживает русский и английский языки, тёмную и светлую темы, адаптивную вёрстку,
реальные jobs/sessions/approvals, политики проектов и audit-ленту из локального Control API.

## Статус проекта

**Текущий публичный релиз:** `v0.1.0-alpha.4` · **Канал:** `next` · **Оценка готовности к 1.0:**
**≈68%**

> Процент — это взвешенная оценка крупных milestone-блоков, а не оценка качества и не обещанная дата
> релиза. Он меняется по мере того, как экспериментальные части становятся release-ready.

| Направление                                                                           | Состояние                 |
| ------------------------------------------------------------------------------------- | ------------------------- |
| Локальный агент, permissions, audit, filesystem, Git, terminal, durable jobs, browser | ✅ Готово                 |
| Control Center, RU/EN, темы, lifecycle actions, guided setup                          | ✅ Готово                 |
| Кроссплатформенный CI, npm, MCP Registry, SBOM/checksum                               | ✅ Готово                 |
| Update / repair / recovery                                                            | 🟡 В работе               |
| Стабилизация public API, migrations и deprecation policy                              | 🟡 В работе               |
| Multi-device / remote routing                                                         | 🟠 Следующий крупный блок |
| Compatibility matrix + независимый security pass                                      | 🟠 Нужны до 1.0           |

**Следующая цель:** `0.2.0-beta.1` — multi-device foundation, lifecycle/update UX и первый
compatibility freeze.

Полный план: [Road to 1.0](ROADMAP.ru.md).

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

- [Установка и packaging](docs/installation.md)
- [Подключение к ChatGPT через Secure MCP Tunnel — пошагово](docs/secure-tunnel.ru.md)
- [Архитектура](docs/architecture.md)
- [Permission model](docs/permission-model.md)
- [Security model](docs/security-model.md)
- [Threat model](docs/threat-model.md)
- [Public release checklist](docs/public-release.md)
- [Model-first workflow](docs/model-workflows.md)

## Лицензия

Apache License 2.0. См. [LICENSE](LICENSE).
