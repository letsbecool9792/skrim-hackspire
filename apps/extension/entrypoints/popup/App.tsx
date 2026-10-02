import { useEffect, useRef, useState } from "react";
import { log } from "@skrim/shared";
import { parseMessage, type TaskStatusMessage } from "@/lib/messages.ts";

type Attachment = { id: string; name: string; size: number; type: string };

const statusLabels: Record<string, string> = {
  idle: "Ready", running: "Working", waiting: "Waiting", completed: "Completed",
  failed: "Needs attention", cancelled: "Cancelled",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleMessage = (rawMessage: unknown) => {
      const message = parseMessage(rawMessage);
      if (!message || message.type !== "task.status") return;
      const statusMessage = message as TaskStatusMessage;
      setStatus(statusMessage.status);
      if (statusMessage.stepCount !== undefined) setStepCount(statusMessage.stepCount);
      if (statusMessage.maxSteps !== undefined) setMaxSteps(statusMessage.maxSteps);
      setErrorCode(statusMessage.errorCode ?? "");
    };
    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const isActive = status === "running" || status === "waiting";

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

  const addFiles = (files: FileList | File[]) => {
    const nextFiles = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name, size: file.size, type: file.type || "file",
    }));
    setAttachments((current) => [
      ...current,
      ...nextFiles.filter((file) => !current.some((item) => item.id === file.id)),
    ]);
    setNotice("Attachment staged locally. AI upload wiring is coming next.");
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
      setNotice("Snapshot captured locally. It has not been uploaded.");
    } catch (error) {
      log.warn("popup.snapshotFailed", { error: String(error) });
      setNotice("Could not capture this tab. Check the browser permission or tab type.");
    } finally { setSnapshotBusy(false); }
  };

  return (
    <main className="popup-shell">
      <header className="topbar">
        <div className="brand-mark">P</div>
        <div><p className="eyebrow">Private browser agent</p><h1>What should I do?</h1></div>
        <span className={`status-dot ${isActive ? "is-active" : ""}`} title={statusLabels[status] ?? status} />
      </header>

      <section className="chat-space" aria-label="AI prompt chat space">
        <div className="assistant-bubble"><span className="bubble-icon">✦</span><p>Give me a task for the current page. I’ll keep sensitive details on this device.</p></div>
        {goal && <div className="user-bubble">{goal}</div>}
        {status === "completed" && <div className="result-line">Task completed in {stepCount} step{stepCount === 1 ? "" : "s"}.</div>}
      </section>

      <label className="prompt-label" htmlFor="goal">Task prompt</label>
      <textarea id="goal" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Ask the agent to find, fill, click, or explain something..." disabled={isActive} />

      <div className="tool-row">
        <button className="tool-button" type="button" onClick={() => fileInputRef.current?.click()}><span aria-hidden="true">＋</span> Attach</button>
        <button className="tool-button" type="button" onClick={takeSnapshot} disabled={snapshotBusy}><span aria-hidden="true">▣</span> {snapshotBusy ? "Capturing" : "Snapshot"}</button>
        <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => event.target.files && addFiles(event.target.files)} />
      </div>

      <div className="drop-zone" tabIndex={0} onPaste={handlePaste} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
        <span className="drop-icon" aria-hidden="true">↥</span><span>Paste or drop files here</span><small>Images and documents stay local for now</small>
      </div>

      {(attachments.length > 0 || snapshot) && <section className="staged-items" aria-label="Staged items">
        {attachments.map((file) => <div className="file-chip" key={file.id}><span>▤</span><span className="file-name">{file.name}</span><small>{formatBytes(file.size)}</small><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}>×</button></div>)}
        {snapshot && <img className="snapshot-preview" src={snapshot} alt="Captured browser tab" />}
      </section>}

      <div className="action-row"><button className="primary-button" type="button" onClick={handleStart} disabled={!goal.trim() || isActive}>Start task <span aria-hidden="true">↗</span></button>{isActive && <button className="secondary-button" type="button" onClick={handleCancel}>Stop</button>}</div>
      <section className="status-panel"><div><span className={`status-pill ${status}`}>{statusLabels[status] ?? status}</span><span className="step-copy">{isActive || status === "completed" ? `${stepCount} / ${maxSteps || "—"} steps` : "Ready for a prompt"}</span></div>{errorCode && <p className="error-copy">{errorCode}</p>}</section>
      <div className="placeholder-actions" aria-label="Coming soon actions"><button type="button" disabled>Summarize page</button><button type="button" disabled>Extract data</button><button type="button" disabled>Redact preview</button></div>
      {notice && <p className="notice" role="status">{notice}</p>}
    </main>
  );
}
