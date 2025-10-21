# ST-VarSystemPlugin

这是一个为 SillyTavern 提供变量管理功能的后端插件。它通过 SQLite 数据库持久化存储对话变量快照，配合前端扩展 [ST-VarSystemExtension](https://github.com/scientar/ST-VarSystemExtension) 使用，为角色卡对话提供完善的变量版本管理和回溯能力。

## 主要功能

- **持久化存储**：使用 SQLite 数据库存储变量快照，支持数百上千层对话的变量管理
- **智能优化**：自动对长字符串进行去重存储，减少数据冗余
- **REST API**：提供完整的 HTTP 接口，支持快照、角色模板、全局快照的增删改查
- **自动标识**：为每个消息楼层自动生成唯一标识符，精确追踪变量状态
- **灵活配置**：支持自定义数据存储路径，适应不同部署环境

## 环境要求

- Node.js 22 或更高版本（依赖内置的 `node:sqlite` 模块）
- SillyTavern 服务器（需启用插件功能）

## 开发流程

1. 在仓库根目录执行 `npm install` 安装依赖。
2. 进行开发时可运行 `npm run watch` 以开发模式持续编译，或使用 `npm run build:dev` 诊断 Source Map。
3. 发布前执行 `npm run build`，`dist/index.js` 会作为插件入口文件输出。

## 安装方法

### 第一步：克隆仓库

在 SillyTavern 的 `plugins` 文件夹下克隆本仓库：

```bash
cd /path/to/your/SillyTavern/plugins
git clone https://github.com/scientar/ST-VarSystemPlugin.git
```

或者手动下载后解压到 `SillyTavern/plugins/ST-VarSystemPlugin` 目录。

### 第二步：启用插件功能

编辑 SillyTavern 根目录下的 `config.yaml` 文件，找到并修改以下配置：

```yaml
enableServerPlugins: true
enableServerPluginsAutoUpdate: true  //可选，启用自动更新，会在运行酒馆时自动拉取最新插件仓库
```

### 第三步：重启服务器

重启 SillyTavern 服务器。如果安装成功，控制台日志中应该能看到类似以下的启动提示：

```bash
[VarManagerPlugin] 插件已加载
[VarManagerPlugin] 数据库初始化完成
```

### 数据存储说明

- 默认情况下，数据库文件存储在：`plugins/ST-VarSystemPlugin/data/var-manager.db`
- 如果设置了 `SILLYTAVERN_DATA_DIR` 环境变量，则使用：`{SILLYTAVERN_DATA_DIR}/var-manager/var-manager.db`

## 已实现接口

| 路径                                    | 方法 | 说明                                                                                                                                    |
| --------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/var-manager/probe`                    | POST | 健康检查，返回 204                                                                                                                      |
| `/var-manager/snapshots`                | POST | 保存一份变量快照；`identifier` 为空时会自动生成，成功时返回 `structureId`、`structureHash` 等信息（新建返回 201，覆盖已有记录返回 200） |
| `/var-manager/snapshots/:identifier`    | GET  | 通过标识符读取快照，返回还原后的变量 JSON 及元数据                                                                                      |
| `/var-manager/templates`                | POST | 保存/更新角色初始模板，`characterName` 为唯一键                                                                                         |
| `/var-manager/templates/:characterName` | GET  | 读取指定角色的初始模板                                                                                                                  |

快照写入接口会执行值去重：短字符串、数字等会直接内联，长字符串会统一存放在 `value_pool` 表并以 `{"__vmRef": id}` 的方式引用（仍兼容历史数据中的 `{"$ref": id}`）。模板接口直接存储 JSON 串。

## 项目结构

- `src/index.ts`：插件主入口，注册 REST 路由
- `src/db/`：SQLite 数据库初始化、表结构迁移和数据操作
- `src/routes/`：API 路由实现
- `dist/`：构建输出目录

## 使用建议

本插件需要配合前端扩展 [ST-VarSystemExtension](https://github.com/scientar/ST-VarSystemExtension) 使用，才能获得完整的可视化变量管理体验。单独安装插件只提供 API 接口，不包含用户界面。

## 开发说明

如果您想参与开发或自定义功能：

1. Fork 本仓库
2. 执行 `npm install` 安装依赖
3. 使用 `npm run watch` 进入开发模式（自动编译）
4. 修改源代码后，执行 `npm run build` 构建生产版本

欢迎提交 Issue 和 Pull Request！
