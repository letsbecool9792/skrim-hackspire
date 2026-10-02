import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { log } from "@skrim/shared";
import { parseMessage, type TaskStatusMessage } from "@/lib/messages.ts";

type Attachment = { id: string; name: string; size: number; type: string };
type SpeechRecognitionResultEvent = Event & { results: { [index: number]: { [index: number]: { transcript: string } } } };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const statusLabels: Record<string, string> = {
  idle: "Ready", running: "Acting", waiting: "Verifying", completed: "Complete",
  failed: "Error", cancelled: "Stopped",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

export default function App() {
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState("idle");
  const [stepCount, setStepCount] = useState(0);
  const [maxSteps, setMaxSteps] = useState(0);
  const [errorCode, setErrorCode] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [listening, setListening] = useState(false);
  const [currentPage, setCurrentPage] = useState(true);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [perceptionOpen, setPerceptionOpen] = useState(false);
  const [isLightMode, setIsLightMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const handleMessage = (rawMessage: unknown) => {
      const message = parseMessage(rawMessage);
      if (!message || message.type !== "task.status") return;
      const statusMessage = message as TaskStatusMessage;
      setStatus(statusMessage.status);
      if (statusMessage.maxSteps !== undefined) setMaxSteps(statusMessage.maxSteps);
      setErrorCode(statusMessage.errorCode ?? "");
    };
    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, []);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const isActive = status === "running" || status === "waiting";
  const statusLabel = statusLabels[status] ?? status;

  const handleStart = async () => {
    if (!goal.trim() || isActive) return;
    setNotice("");
    try {
      await browser.runtime.sendMessage({ type: "task.start", goal: goal.trim() });
    } catch (error) {
      log.warn("popup.startFailed", { error: String(error) });
      setNotice("The extension background is not available yet.");
    }
  };

  const handleCancel = async () => {
    try {
      await browser.runtime.sendMessage({ type: "task.cancel" });
    } catch (error) {
      log.warn("popup.cancelFailed", { error: String(error) });
    }
  };

  const toggleSpeech = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setNotice("Voice input isn't available in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) setGoal((current) => `${current}${current ? " " : ""}${transcript}`);
    };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    recognition.onerror = () => { setListening(false); recognitionRef.current = null; setNotice("Voice input could not hear a usable phrase."); };
    recognitionRef.current = recognition;
    setNotice("");
    setListening(true);
    recognition.start();
  };

  const addFiles = (files: FileList | File[]) => {
    const nextFiles = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name, size: file.size, type: file.type || "file",
    }));
    setAttachments((current) => [
      ...current,
      ...nextFiles.filter((file) => !current.some((item) => item.id === file.id)),
    ]);
    setNotice("Attachment staged locally.");
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) { event.preventDefault(); addFiles(files); }
  };

  const takeSnapshot = async () => {
    setSnapshotBusy(true);
    setNotice("");
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.windowId) throw new Error("No active browser tab");
      const image = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      setSnapshot(image);
      setNotice("Current-page snapshot captured locally.");
    } catch (error) {
      log.warn("popup.snapshotFailed", { error: String(error) });
      setNotice("Could not capture this tab. Check the browser permission or tab type.");
    } finally { setSnapshotBusy(false); }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleStart();
    }
    if (event.key === "Escape" && isActive) void handleCancel();
  };

  return (
    <main className={`popup-shell ${isLightMode ? "theme-light" : "theme-dark"}`}>
      <div className="popup-content">
        <header className="topbar">
          <div className="brand-mark" aria-hidden="true"><span>S</span></div>
          <div className="brand-copy"><strong>Skrim</strong><p>Privacy at peak</p></div>
          <span className={`status-dot ${isActive ? "is-active" : ""}`} title={statusLabel} aria-label={statusLabel} />
          <div className="theme-switcher" title={isLightMode ? "Switch to night mode" : "Switch to day mode"}>
            <span aria-hidden="true">☾</span>
            <label className="theme-toggle">
              <input type="checkbox" checked={isLightMode} onChange={(event) => setIsLightMode(event.target.checked)} aria-label="Toggle light and dark mode" />
              <span className="theme-slider" />
            </label>
            <span aria-hidden="true">☼</span>
          </div>
          <button className="icon-button settings-button" type="button" onClick={() => setNotice("Settings will be available here.")} aria-label="Open settings" title="Settings">•••</button>
        </header>

        <section className="hero-copy" aria-labelledby="prompt-heading">
          <p className="eyebrow">Browser agent</p>
          <h1 id="prompt-heading">What should I do?</h1>
          <div className="assistant-card"><span className="privacy-glyph" aria-hidden="true">⌁</span><p>Give me a task for this page.<br /><span>Sensitive details stay on-device.</span></p></div>
        </section>

        {(goal || isActive || status === "completed" || status === "failed" || status === "cancelled") && <section className="activity-feed" aria-label="Task activity">
          {goal && <div className="feed-message"><small>You</small><p>{goal}</p></div>}
          {isActive && <div className="feed-message assistant-message"><small>Skrim</small><p>{status === "waiting" ? "Verifying the result..." : "Working through the visible page..."}</p><span className="feed-progress">{stepCount} / {maxSteps || "--"} steps</span></div>}
          {status === "completed" && <div className="feed-result success-text">✓ Task complete <span>{stepCount} step{stepCount === 1 ? "" : "s"}</span></div>}
          {(status === "failed" || status === "cancelled") && <div className="feed-result danger-text">! Task stopped<span>{errorCode || "The next action was not completed safely."}</span></div>}
        </section>}

        <section className="composer" aria-label="Task composer">
          <textarea id="goal" value={goal} onChange={(event) => setGoal(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder="Tell Skrim what to do..." disabled={isActive} aria-label="Task prompt" />
          <div className="composer-toolbar">
            <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => event.target.files && addFiles(event.target.files)} />
            <button className={`context-button ${currentPage ? "is-selected" : ""}`} type="button" onClick={() => setCurrentPage((value) => !value)} aria-pressed={currentPage}><span aria-hidden="true">◉</span> Current page</button>
            <button className="icon-button" type="button" onClick={() => fileInputRef.current?.click()} aria-label="Attach file" title="Attach file">+</button>
            <button className={`icon-button mic-button ${listening ? "is-listening" : ""}`} type="button" onClick={toggleSpeech} aria-label={listening ? "Stop listening" : "Use voice input"} title={listening ? "Stop listening" : "Voice input"}><span aria-hidden="true">{listening ? "●" : "🎙"}</span></button>
            <button className="send-button" type="button" onClick={isActive ? handleCancel : handleStart} disabled={!isActive && !goal.trim()} aria-label={isActive ? "Stop task" : "Send task"} title={isActive ? "Stop task" : "Send task"}>{isActive ? "■" : "↗"}</button>
          </div>
        </section>

        <div className="attachment-row">
          <button className="attach-link" type="button" onClick={() => fileInputRef.current?.click()}>+ Attach</button>
          {attachments.map((file) => <div className="file-chip" key={file.id}><span className="file-name">{file.name}</span><small>{formatBytes(file.size)}</small><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}>×</button></div>)}
          <button className="snapshot-link" type="button" onClick={takeSnapshot} disabled={snapshotBusy}>{snapshotBusy ? "Capturing..." : snapshot ? "✓ Page captured" : "Capture page"}</button>
        </div>

        <section className="status-panel" aria-label="Task status"><div className="status-line"><span className={`status-pill ${status}`}>{isActive ? "●" : status === "completed" ? "✓" : status === "failed" ? "!" : "●"} {statusLabel}</span><span className="step-copy">{isActive ? `${stepCount} / ${maxSteps || "--"} steps` : status === "idle" ? "Ready to act" : ""}</span>{isActive && <button className="stop-button" type="button" onClick={handleCancel}>Stop</button>}</div>{errorCode && <p className="error-copy">{errorCode}</p>}</section>

        <div className="disclosure-list">
          <button className="disclosure" type="button" onClick={() => setPrivacyOpen((value) => !value)} aria-expanded={privacyOpen}><span>🔒 Privacy boundary active</span><span>{privacyOpen ? "−" : "+"}</span></button>
          {privacyOpen && <div className="disclosure-body"><div><span>Raw PII sent</span><strong>0 B</strong></div><div><span>Token vault</span><strong>Active</strong></div><p>Safe structure and typed tokens only. Sensitive values remain on this device.</p></div>}
          {isActive && <button className="disclosure" type="button" onClick={() => setPerceptionOpen((value) => !value)} aria-expanded={perceptionOpen}><span>Perception</span><span>{perceptionOpen ? "−" : "+"}</span></button>}
          {isActive && perceptionOpen && <div className="disclosure-body"><div><span>DOM</span><strong>--</strong></div><div><span>Vision</span><strong>--</strong></div><div><span>PII detection</span><strong>--</strong></div><p>Perception details will appear when the graph reports them.</p></div>}
        </div>
        {notice && <p className="notice" role="status">{notice}</p>}
      </div>
    </main>
  );
}
