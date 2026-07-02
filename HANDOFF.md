# 炉石传说 AI 辅助项目交接

更新时间：2026-07-02

## 1. 项目目标

开发一个面向《炉石传说》标准构筑模式的桌面辅助程序：

1. 读取当前对局状态。
2. 生成合法操作并评估较优决策。
3. 通过 API 大模型调用一个或多个决策 Skill，给出操作建议和理由。
4. 以类似 Firestone 的浮窗形式显示在炉石窗口上方。

当前仍是原型阶段。浮窗原型已经可运行，但实时对局状态解析、合法动作生成、模型决策和自动出牌尚未完成。

## 2. 当前已经完成

### 2.1 标准模式卡牌数据

- 数据来源：HearthstoneJSON。
- 当前快照：`2026-07-01_35.6_build-245258`。
- 共 1017 张标准模式可收集卡牌。
- 包含中英文名称、描述、版本、系列、职业、类型、费用、机制、效果标签和启发式策略标签。
- 校验结果：卡牌 ID 重复 0、DBF ID 重复 0、缺失中文 0。

关键文件：

- `data/snapshots/2026-07-01_35.6_build-245258/standard_cards.jsonl`
- `data/snapshots/2026-07-01_35.6_build-245258/manifest.json`
- `data/taxonomy/tag_rules.json`
- `scripts/sync_cards.py`

重新生成当前快照：

```powershell
python scripts/sync_cards.py --build 245258 --patch 35.6 --date 2026-07-01
```

更新到新版本时，先确认 HearthstoneJSON 构建号、标准系列和轮换情况，再修改 `tag_rules.json` 并生成新快照，不要覆盖旧快照。

### 2.2 桌面浮窗

当前可用路径是普通 Electron 透明窗口，不是真正注入游戏进程的 Overwolf Overlay。

已实现：

- 检测 `Hearthstone.exe` 和炉石窗口。
- 支持两种模式：
  - `standalone`：游戏未打开时显示为独立窗口。
  - `attached`：游戏打开且炉石在前台时附着到炉石窗口上方。
- 游戏未打开时不会退出，显示“等待炉石启动”。
- 游戏打开后显示“已附着到炉石”。
- 游戏关闭后自动回到独立窗口模式。
- 两种模式都可以拖动、打开设置、关闭。
- 附着模式下拖动会限制在炉石窗口范围内。
- 附着模式只在炉石或浮窗自身处于前台时显示，切到其他程序时隐藏，避免压住所有程序。
- `Ctrl + Shift + H` 手动隐藏或恢复。
- 标题栏具有设置按钮和关闭按钮。
- 关闭按钮会直接调用 preload 暴露的关闭接口，并让主进程销毁窗口后退出。
- 窗口尺寸会根据电脑工作区或炉石窗口大小自适应。
- 自适应尺寸只在屏幕工作区、炉石窗口大小或模式变化时重新计算；普通拖动不会修改尺寸。
- 推荐操作区域已经改成可上下滚动的卷轴式区域，便于后续显示几十步操作。
- 当前前端内置 30 条假操作，用于测试滚动显示。
- 设置面板已经有基础状态：
  - 当前模式
  - 窗口尺寸
  - 初始化状态
  - `初始化设置` 按钮
- `初始化设置` 按钮目前只是占位，点击后显示“初始化设置功能待接入”。
- 已创建快捷启动脚本：`启动炉石助手.cmd`。

关键文件：

- `apps/overlay/src/main/floating.ts`：游戏检测、模式切换、显示隐藏、定位、拖动、自适应尺寸、退出逻辑。
- `apps/overlay/src/main/preload.ts`：关闭按钮、拖动、模式通知 IPC。
- `apps/overlay/src/global.d.ts`：前端 IPC 类型声明。
- `apps/overlay/src/App.tsx`：浮窗界面、设置面板、30 条测试操作。
- `apps/overlay/src/styles.css`：界面样式、卷轴滚动区、状态颜色。
- `apps/overlay/src/main/main.ts`：未成功落地的 Overwolf 注入实验路径，暂时保留。
- `启动炉石助手.cmd`：双击测试用启动脚本。

运行命令：

```powershell
cd apps/overlay
npm.cmd install
npm.cmd run build
npm.cmd run start:floating
```

也可以双击项目根目录的：

```text
启动炉石助手.cmd
```

该脚本会关闭本项目旧的 Electron 浮窗进程，再启动新的浮窗实例。

### 2.3 GitHub 仓库状态

远程仓库：

```text
https://github.com/xingyuscy-dotcom/Hearthstone-AI-Assistant.git
```

另一个对话中已经确认过：

- 本地 `.git` 正常。
- 当前分支是 `main`。
- 本地和 `origin/main` 曾多次确认一致。
- 工作区在最近检查时是干净的。

已知已推送提交：

- `33a4dfd`：`修复默认状态的窗口移动和点击问题`
- `d3b0c8c`：`扩容操作显示`
- `169e1b9`：`修复了游戏内的显示问题`

新对话开始时仍应先执行：

```powershell
git status --short
```

不要假设用户没有在其他地方继续修改。

### 2.4 Codex 插件和工具检查

另一个对话中检查过当前环境可用能力：

- 可直接使用的 skills 包括：
  - `browser:control-in-app-browser`
  - `computer-use:computer-use`
  - `openai-docs`
  - `skill-creator`
  - `plugin-creator`
  - `imagegen`
- `computer-use` 基础连接可用，能列出 Windows 应用和窗口。
- 但一次被动截图测试被安全策略停止，原因是选中了浏览器窗口且无法确认 URL。
- 后续如果用 `computer-use`，优先指定非浏览器、低风险窗口。

### 2.5 Overwolf 调研结论

- 已尝试 `@overwolf/ow-electron` 的游戏注入接口，但没有成功获得类似 Firestone 的原生游戏内注入效果。
- 当前采用透明、无边框 Electron 窗口覆盖在炉石窗口上的方案。
- 该方案能满足原型和毕业设计演示，但严格来说不是进程内 Overlay。
- 后续如果继续研究 Overwolf，应先确认当前 SDK、应用注册、游戏 ID、签名和分发权限要求，不要直接推翻现有可用浮窗。

## 3. 对局数据调研状态

目标是获取约 1000 场较新、高分段、标准模式的完整对局记录，用于训练或评估决策模型。

目前没有完成数据获取，项目目录中也没有这 1000 场对局数据。

已调研方向：

- Firestone / Zero to Heroes。
- HSGuru。
- 公开 GitHub 项目和可能的回放接口。

当前结论：

- HSGuru 主要提供聚合统计和卡组数据，不能直接等同于完整逐步对局日志。
- Firestone 存在回放能力，但没有确认可合法批量导出 1000 场高分段新对局的公开接口。
- 曾尝试向 Zero to Heroes 联系邮箱发送研究用途申请，邮件退回，截图显示 `seb@zerotoheroes.com` / `contact@zerotoheroes.com` 为未知用户。
- 申请内容已经说明用途是大学毕业设计，但英文申请邮件只存在于原对话中，没有保存为本地文件。

下一步建议：

1. 优先寻找官方或明确授权的数据接口、公开数据集或项目维护者联系方式。
2. 如果无法取得第三方完整回放，改为让受试玩家主动授权并上传本机 `Power.log`，自行采集 1000 场。
3. 保存原始日志、匿名化玩家标识，并记录版本、模式、段位区间、卡组和胜负。
4. 不要把聚合胜率数据伪装成逐回合训练样本，也不要绕过网站限制批量抓取私有数据。

## 4. 最新待实现功能：炉石页面识别

另一个对话最后调研的是：

> 非战斗页面显示当前页面位置，进入战斗页面再显示倒计时。

调研结论：可以参考 Hearthstone Deck Tracker / Firestone 的思路，通过炉石日志判断当前页面。

优先数据源：

```text
%LOCALAPPDATA%\Blizzard\Hearthstone\Logs\LoadingScreen.log
```

可解析的日志形态：

```text
prevMode=xxx currMode=yyy
prevMode=xxx nextMode=yyy
```

建议模式映射：

```ts
GAMEPLAY -> 战斗中
HUB -> 主页面
COLLECTIONMANAGER -> 收藏
PACKOPENING -> 开包
TOURNAMENT -> 对战选择
DRAFT -> 竞技场
TAVERN_BRAWL -> 乱斗
BACON -> 酒馆战棋
GAME_MODE -> 模式选择
ADVENTURE -> 冒险
FRIENDLY -> 好友对战
```

建议第一版实现：

1. 主进程新增页面状态监听器。
2. 只读取并 tail `LoadingScreen.log`。
3. 解析 `currMode` 或 `nextMode`。
4. 通过 IPC 发给 React。
5. 前端标题栏右侧当前是倒计时，改成：
   - `GAMEPLAY`：显示倒计时。
   - 非 `GAMEPLAY`：显示页面名，例如“主页面”“收藏”“开包”“竞技场”。
6. 日志不存在时显示“等待页面状态”。
7. 第一版不要自动修改炉石本地 `log.config`。

后续如果要让“初始化设置”按钮真正生效，再考虑写入或修复炉石日志配置：

- 开启 `LoadingScreen` 日志。
- 开启 `Power` 日志。

这会写入项目外部的炉石本地配置目录，实施前需要先给用户方案确认。

## 5. 决策模型建议架构

“让 API 大模型调用决策 Skill”是可行的，但不建议让大模型直接凭文本猜最优操作。

建议保持简单的分层结构：

```text
Power.log / 游戏状态
        ↓
状态解析器
        ↓
合法动作生成器
        ↓
决策 Skills
  - 场面价值评估
  - 斩杀检查
  - 资源与节奏评估
  - 对手范围推断
        ↓
评分器或特化模型
        ↓
API 大模型组织结果、调用 Skill、解释建议
        ↓
浮窗显示
```

主要原因：

- 合法性、费用、目标和卡牌效果必须由确定性代码保证。
- 通用大模型容易遗漏隐藏规则、产生非法操作，延迟和调用成本也较高。
- Skill 更适合作为工具接口和推理流程，不等于训练好的决策模型。
- 第一阶段可用规则评分器完成可运行闭环，积累数据后再训练排序模型或策略模型。

建议的第一个决策接口：

```ts
type DecisionInput = {
  gameState: GameState;
  legalActions: LegalAction[];
};

type DecisionOutput = {
  bestAction: LegalAction;
  alternatives: Array<{ action: LegalAction; score: number }>;
  confidence: number;
  reasons: string[];
};
```

## 6. 推荐的后续开发顺序

当前最贴近最新对话的顺序：

1. 先实现 `LoadingScreen.log -> 当前页面状态`。
2. 非战斗页在标题栏右侧显示页面名，战斗页继续显示倒计时。
3. 再实现 `Power.log -> GameState` 的最小解析链路。
4. 实现合法动作数据结构，不急着自动操作鼠标。
5. 将实时状态接入现有浮窗，替换当前 30 条假操作。
6. 实现最小规则决策 Skill：斩杀、解场、费用利用、场面交换。
7. 设计并保存对局样本格式，再开始采集授权数据。
8. 有足够样本后训练动作排序模型，并用留出的完整对局做离线评估。
9. 最后再接入 API 大模型，负责 Skill 编排和自然语言解释。

## 7. 已知限制

- 当前浮窗内容仍是静态示例，不读取真实对局。
- 当前 30 条操作是测试数据，不是模型输出。
- 没有自动出牌功能。
- `初始化设置` 只是占位按钮，尚未真正修改炉石日志配置。
- 没有完整对局训练集。
- Overwolf 原生注入尚未成功。
- 页面识别方案已有调研，但尚未落地到代码。
- `Power.log -> GameState` 尚未实现。

## 8. 新对话建议开场指令

```text
请先阅读 C:\Users\USER\Desktop\炉石传说ai辅助项目\HANDOFF.md，并核对当前 git 状态和 apps/overlay 代码。不要重新创建已经存在的卡牌数据或浮窗。接下来优先实现 LoadingScreen.log 到当前页面状态的最小解析链路：非战斗页在标题栏右侧显示页面名，GAMEPLAY 战斗页继续显示倒计时。先给出方案让我确认，再开始修改代码。
```
