import { useEffect, useMemo, useState } from "react";
import { ActionStep } from "./components/ActionStep";

const actionSamples = [
  { title: "使用英雄技能", detail: "先稳定生命值", kind: "power" as const },
  { title: "打出卡牌", detail: "暮光侍僧，建立场面压力", kind: "card" as const },
  { title: "攻击随从", detail: "处理敌方低生命目标", kind: "attack" as const },
];

const actions = Array.from({ length: 30 }, (_, index) => {
  const sample = actionSamples[index % actionSamples.length];
  return {
    ...sample,
    title: `${sample.title} ${index + 1}`,
    detail: `测试步骤 ${index + 1}：${sample.detail}`,
  };
});

export function App() {
  const [seconds, setSeconds] = useState(72);
  const [alternativeOpen, setAlternativeOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initMessage, setInitMessage] = useState("等待初始化");
  const [overlayMode, setOverlayMode] = useState<OverlayModePayload>({
    mode: "standalone",
    label: "等待炉石启动",
    bounds: {
      width: 0,
      height: 0,
    },
  });
  const previewMode = useMemo(
    () => new URLSearchParams(window.location.search).has("preview"),
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds((value) => (value > 0 ? value - 1 : 72));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return window.hearthstoneOverlay?.onModeChanged(setOverlayMode);
  }, []);

  const timeText = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;

  return (
    <main className={previewMode ? "preview-stage" : "overlay-stage"}>
      <section className="assistant-panel" aria-label="炉石决策助手浮窗原型">
        <header className="panel-header">
          <div>
            <h1>炉石决策助手</h1>
            <p className={`connection-status ${overlayMode.mode}`}>
              <span />
              {overlayMode.label}
            </p>
          </div>
          <div className="header-actions">
            <time aria-label="回合剩余时间">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 3h10M7 21h10M8 3c0 4 2 5 4 7 2-2 4-3 4-7M8 21c0-4 2-5 4-7 2 2 4 3 4 7" />
              </svg>
              {timeText}
            </time>
            <div className="window-controls">
              <button
                className="window-control"
                type="button"
                aria-label="设置"
                aria-expanded={settingsOpen}
                title="设置"
                onClick={() => setSettingsOpen((value) => !value)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
                </svg>
              </button>
              <button
                className="window-control close"
                type="button"
                aria-label="关闭浮窗"
                title="关闭浮窗"
                data-overlay-action="close"
                onClick={() => window.hearthstoneOverlay?.close()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        {settingsOpen && (
          <section className="settings-panel" aria-label="设置面板">
            <div className="settings-panel-title">设置</div>
            <dl className="settings-status">
              <div>
                <dt>当前模式</dt>
                <dd>{overlayMode.label}</dd>
              </div>
              <div>
                <dt>窗口尺寸</dt>
                <dd>
                  {overlayMode.bounds.width > 0
                    ? `${overlayMode.bounds.width} × ${overlayMode.bounds.height}`
                    : "自适应中"}
                </dd>
              </div>
              <div>
                <dt>初始化状态</dt>
                <dd>{initMessage}</dd>
              </div>
            </dl>
            <button
              className="settings-init"
              type="button"
              onClick={() => setInitMessage("初始化设置功能待接入")}
            >
              初始化设置
            </button>
          </section>
        )}

        <div className="ornament" aria-hidden="true"><span /></div>

        <section className="recommendation">
          <h2>推荐操作</h2>
          <div className="action-scroll" role="region" aria-label="推荐操作步骤" tabIndex={0}>
            <ol className="action-list">
              {actions.map((action, index) => (
                <ActionStep key={action.title} index={index + 1} {...action} />
              ))}
            </ol>
          </div>
        </section>

        <section className="confidence" aria-label="置信度 82%">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z" />
            <path d="m8.5 12 2.2 2.2 4.8-5" />
          </svg>
          <span>置信度</span>
          <strong>82%</strong>
        </section>

        <section className="reason">
          <h3>推荐理由</h3>
          <p>先恢复生命值，再用随从建立场面，最后完成有利交换，能保留下一回合的主动权。</p>
        </section>

        <button
          className="alternative"
          type="button"
          aria-expanded={alternativeOpen}
          onClick={() => setAlternativeOpen((value) => !value)}
        >
          <span className="alternative-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7h10l-3-3M17 17H7l3 3M17 7l-3 3M7 17l3-3" />
            </svg>
          </span>
          <span>
            <small>备选操作</small>
            <strong>先打出暗言术：痛</strong>
            {alternativeOpen && <em>解场更直接，但后续节奏收益较低</em>}
          </span>
          <svg className={alternativeOpen ? "chevron open" : "chevron"} viewBox="0 0 24 24" aria-hidden="true">
            <path d="m8 10 4 4 4-4" />
          </svg>
        </button>

        <footer><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>H</kbd><span>隐藏</span></footer>
      </section>
    </main>
  );
}
