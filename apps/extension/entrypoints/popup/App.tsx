import { useState, useEffect } from 'react';
import { log } from '@skrim/shared';
import { parseMessage } from '@/lib/messages.ts';
import { useState, useEffect } from "react";
import { log } from "@skrim/shared";
import { parseMessage } from "@/lib/messages.ts";
import type { TaskStatusMessage } from "@/lib/messages.ts";

export default function App() {
  const [goal, setGoal] = useState('');
  const [status, setStatus] = useState('idle');
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState("idle");
  const [stepCount, setStepCount] = useState(0);
  const [maxSteps, setMaxSteps] = useState(0);
  const [errorCode, setErrorCode] = useState('');
  const [errorCode, setErrorCode] = useState("");

  useEffect(() => {
    const handleMessage = (rawMessage: unknown) => {
      try {
        const message = parseMessage(rawMessage);
        if (message.type === 'task.status') {
          // @ts-ignore
          setStatus(message.status);
          // @ts-ignore
          if (message.stepCount !== undefined) setStepCount(message.stepCount);
          // @ts-ignore
          if (message.maxSteps !== undefined) setMaxSteps(message.maxSteps);
          // @ts-ignore
          if (message.errorCode) setErrorCode(message.errorCode);
        }
      } catch (err) {
        log.warn('popup.message.parseError', { error: err });
      }
      const message = parseMessage(rawMessage);
      if (!message || message.type !== "task.status") return;

      const statusMsg = message as TaskStatusMessage;
      setStatus(statusMsg.status);
      if (statusMsg.stepCount !== undefined) setStepCount(statusMsg.stepCount);
      if (statusMsg.maxSteps !== undefined) setMaxSteps(statusMsg.maxSteps);
      if (statusMsg.errorCode) setErrorCode(statusMsg.errorCode);
      else setErrorCode("");
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => {
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const handleStart = async () => {
    log.info("popup.startClicked");
    try {
      log.info('popup.startClicked', { goal });
      await browser.runtime.sendMessage({ type: 'task.start', goal });
    } catch (err) {
      log.error('popup.startError', { error: err });
      await browser.runtime.sendMessage({ type: "task.start", goal });
    } catch {
      log.warn("popup.startFailed");
    }
  };

  const handleCancel = async () => {
    log.info("popup.cancelClicked");
    try {
      log.info('popup.cancelClicked');
      await browser.runtime.sendMessage({ type: 'task.cancel' });
    } catch (err) {
      log.error('popup.cancelError', { error: err });
      await browser.runtime.sendMessage({ type: "task.cancel" });
    } catch {
      log.warn("popup.cancelFailed");
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'running': return 'blue';
      case 'completed': return 'green';
      case 'failed': return 'red';
      case 'cancelled': return 'orange';
      default: return 'gray';
    }
  const statusColor: Record<string, string> = {
    running: "#2563eb",
    waiting: "#2563eb",
    completed: "#16a34a",
    failed: "#dc2626",
    cancelled: "#ea580c",
    idle: "#6b7280",
  };

  const isActive = status === "running" || status === "waiting";

  return (
    <div style={{ width: '320px', padding: '16px', fontFamily: 'sans-serif' }}>
      <h2 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>Skrim Task</h2>
      
    <div style={{ width: 320, padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Private Browser Agent</h2>

      <textarea
        style={{ width: '100%', height: '80px', marginBottom: '12px', padding: '8px', boxSizing: 'border-box' }}
        placeholder="Describe what you want done on this page..."
        style={{
          width: "100%",
          height: 72,
          marginBottom: 10,
          padding: 8,
          boxSizing: "border-box",
          fontSize: 13,
          resize: "vertical",
        }}
        placeholder="Describe what you want done on this page…"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        disabled={status === 'running'}
        disabled={isActive}
      />

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button 
          onClick={handleStart} 
          disabled={!goal.trim() || status === 'running'}
          style={{ flex: 1, padding: '8px', cursor: (!goal.trim() || status === 'running') ? 'not-allowed' : 'pointer' }}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={handleStart}
          disabled={!goal.trim() || isActive}
          style={{
            flex: 1,
            padding: "8px 12px",
            cursor: !goal.trim() || isActive ? "not-allowed" : "pointer",
          }}
        >
          Start
        </button>
        {(status === 'running' || status === 'waiting') && (
          <button 
        {isActive && (
          <button
            onClick={handleCancel}
            style={{ flex: 1, padding: '8px', backgroundColor: '#ff4444', color: 'white', border: 'none', cursor: 'pointer' }}
            style={{
              flex: 1,
              padding: "8px 12px",
              backgroundColor: "#dc2626",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        )}
      </div>

      <div style={{ padding: '8px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <strong>Status:</strong>
          <span style={{ color: getStatusColor(), fontWeight: 'bold' }}>{status.toUpperCase()}</span>
      <div
        style={{
          padding: 10,
          backgroundColor: "#f9fafb",
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <strong>Status</strong>
          <span style={{ color: statusColor[status] ?? "#6b7280", fontWeight: 600 }}>
            {status.toUpperCase()}
          </span>
        </div>
        
        {(status === 'running' || status === 'waiting' || status === 'completed') && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <strong>Steps:</strong>
            <span>{stepCount} / {maxSteps}</span>

        {(isActive || status === "completed" || status === "failed") && (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <strong>Steps</strong>
            <span>
              {stepCount} / {maxSteps}
            </span>
          </div>
        )}

        {status === 'failed' && errorCode && (
          <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fee', color: '#c00', borderRadius: '4px', fontSize: '12px' }}>
        {status === "failed" && errorCode && (
          <div
            style={{
              marginTop: 6,
              padding: 8,
              backgroundColor: "#fef2f2",
              color: "#991b1b",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            Error: {errorCode}
          </div>
        )}
      </div>
    </div>
  );
}
