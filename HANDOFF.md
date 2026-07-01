# 炉石传说 AI 辅助项目交接

更新时间：2026-07-01

## 1. 项目目标

开发一个面向《炉石传说》标准构筑模式的桌面辅助程序：

1. 读取当前对局状态。
2. 生成合法操作并评估较优决策。
3. 通过 API 大模型调用一个或多个决策 Skill，给出操作建议和理由。
4. 以类似 Firestone 的浮窗形式显示在炉石窗口上方。

当前仍是原型阶段，尚未实现实时对局状态解析、模型决策和自动出牌。

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

当前可用路径是普通 Electron 透明置顶窗口，不是真正注入游戏进程的 Overwolf Overlay。

已实现：

- 检测 `Hearthstone.exe` 和炉石窗口。
- 炉石位于前台时显示浮窗，切出游戏时隐藏。
- 浮窗可在炉石窗口范围内拖动。
- `Ctrl + Shift + H` 手动隐藏或恢复。
- 标题栏具有设置按钮和关闭按钮。
- 设置按钮目前只显示“设置功能开发中”。
- 关闭按钮会完整退出 Electron 进程。
- 浮窗曾因项目路径包含“炉石传说”而把自身误认为游戏，现已改成严格匹配游戏进程名或窗口标题。
- 已检测到游戏后，如果游戏进程消失，应用会自动退出；如果辅助程序先于游戏启动，则会在后台等待游戏出现。

关键文件：

- `apps/overlay/src/main/floating.ts`：游戏检测、显示隐藏、定位、拖动、退出逻辑。
- `apps/overlay/src/main/preload.ts`：拖动和关闭按钮的 IPC 通信。
- `apps/overlay/src/App.tsx`：浮窗界面和设置占位入口。
- `apps/overlay/src/styles.css`：界面样式。
- `apps/overlay/src/main/main.ts`：未成功落地的 Overwolf 注入实验路径，暂时保留。

运行命令：

```powershell
cd apps/overlay
npm.cmd install
npm.cmd run build
npm.cmd run start:floating
```

当前构建已通过。交接文档创建时，新版浮窗进程处于运行状态；新对话开始时仍应重新检查进程和 `apps/overlay/floating-runtime.log`。

### 2.3 Overwolf 调研结论

- 已尝试 `@overwolf/ow-electron` 的游戏注入接口，但没有成功获得类似 Firestone 的原生游戏内注入效果。
- 当前采用透明、无边框、置顶 Electron 窗口覆盖在炉石窗口上的方案。
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

## 4. 决策模型建议架构

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

## 5. 推荐的后续开发顺序

1. 解析炉石 `Power.log`，先输出稳定的结构化 `GameState`。
2. 实现合法动作数据结构，不急着自动操作鼠标。
3. 将实时状态接入现有浮窗，替换当前静态示例内容。
4. 实现最小规则决策 Skill：斩杀、解场、费用利用、场面交换。
5. 设计并保存对局样本格式，再开始采集授权数据。
6. 有足够样本后训练动作排序模型，并用留出的完整对局做离线评估。
7. 最后再接入 API 大模型，负责 Skill 编排和自然语言解释。

## 6. 已知限制

- 当前浮窗内容是静态示例，不读取真实对局。
- 没有自动出牌功能。
- 没有设置页，只有入口占位。
- 没有完整对局训练集。
- Overwolf 原生注入尚未成功。
- 游戏退出自动结束逻辑已经编译通过，但没有为了测试而主动关闭用户游戏；后续应在实际游戏启动—退出流程中再验一次运行日志。
- 当前目录虽存在 `.git`，此前命令曾报告不是有效 Git 仓库；新对话开始时应先执行 `git status` 核实，不要假设版本历史可用。

## 7. 新对话建议开场指令

```text
请先阅读 C:\Users\USER\Desktop\炉石传说ai辅助项目\HANDOFF.md，核对当前代码和运行状态，不要重新创建已经存在的卡牌数据或浮窗。接下来优先实现 Power.log 到结构化 GameState 的最小解析链路，并先给出方案让我确认。
```

