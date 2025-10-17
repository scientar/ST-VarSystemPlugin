# VarManagerPlugin

SillyTavern 变量管理服务器插件原型。提供 REST 接口来存储与读取对话变量快照，配合前端扩展实现高效的变量版本管理。

## 环境要求

- Node.js 22 或更高版本（依赖内置的 `node:sqlite` 模块）。

## 开发流程

1. 在仓库根目录执行 `npm install` 安装依赖。
2. 进行开发时可运行 `npm run watch` 以开发模式持续编译，或使用 `npm run build:dev` 诊断 Source Map。
3. 发布前执行 `npm run build`，`dist/index.js` 会作为插件入口文件输出。

## 部署到 SillyTavern

1. 将整个 `VarManagerPlugin` 文件夹复制到 `{SillyTavern_Folder}/plugins/VarManagerPlugin`。
2. 确保 `config.yaml` 中 `enableServerPlugins: true`，并在插件列表里启用本插件（如果首次启动尚无配置文件，可先运行一次 SillyTavern 生成默认配置，再编辑）。
3. 重启 SillyTavern 服务器，日志中应看到 `[VarManagerPlugin]` 的启动提示。
4. 数据库默认写入插件目录下的 `data/var-manager.db`；若设置了 `SILLYTAVERN_DATA_DIR` 环境变量，则会使用 `{SILLYTAVERN_DATA_DIR}/var-manager/var-manager.db`。

## 已实现接口

| 路径                                    | 方法 | 说明                                                                                                                                    |
| --------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/var-manager/probe`                    | POST | 健康检查，返回 204                                                                                                                      |
| `/var-manager/snapshots`                | POST | 保存一份变量快照；`identifier` 为空时会自动生成，成功时返回 `structureId`、`structureHash` 等信息（新建返回 201，覆盖已有记录返回 200） |
| `/var-manager/snapshots/:identifier`    | GET  | 通过标识符读取快照，返回还原后的变量 JSON 及元数据                                                                                      |
| `/var-manager/templates`                | POST | 保存/更新角色初始模板，`characterName` 为唯一键                                                                                         |
| `/var-manager/templates/:characterName` | GET  | 读取指定角色的初始模板                                                                                                                  |

快照写入接口会执行值去重：短字符串、数字等会直接内联，长字符串会统一存放在 `value_pool` 表并以 `{"__vmRef": id}` 的方式引用（仍兼容历史数据中的 `{"$ref": id}`）。模板接口直接存储 JSON 串。

## 后续路线

- `src/index.ts` 暴露插件主入口与 REST 路由。
- `src/db` 目录负责 SQLite 初始化、表结构迁移及后续的数据操作实现。
- 变量快照存储/读取与模板管理均已具备基础能力，后续可继续实现快照回收、引用计数清理、重处理流程等高级功能。
