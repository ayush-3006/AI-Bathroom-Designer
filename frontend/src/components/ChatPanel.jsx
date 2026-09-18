import { useState, useRef, useEffect } from "react";
import MessageBubble from "./MessageBubble.jsx";

const GREETING =
  "Hi! I'm your Kohler bathroom design assistant. Tell me a bit about your project and I'll put together a product bundle that fits your space and budget.";

function newSessionId() {
  return crypto.randomUUID();
}

export default function ChatPanel({ onSlots, onBundle, onReset }) {
  const [sessionId, setSessionId] = useState(newSessionId());
  const [messages, setMessages] = useState([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const data = await res.json();

      if (!res.ok) {
        const detail = data.detail ? `\n\n(${data.detail})` : "";
        setMessages((m) => [...m, { role: "assistant", content: (data.error || "Something went wrong.") + detail }]);
        return;
      }

      setMessages((m) => [...m, { role: "assistant", content: data.reply, bundle: data.bundle || null }]);
      if (data.slots) onSlots(data.slots);
      if (data.bundle) onBundle(data.bundle);
      if (data.done) setDone(true);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Couldn't reach the design assistant. Is the backend running?" }]);
    } finally {
      setLoading(false);
    }
  }

  async function restart() {
    const fresh = newSessionId();
    await fetch("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: fresh }),
    });
    setSessionId(fresh);
    setMessages([{ role: "assistant", content: GREETING }]);
    setDone(false);
    onReset();
  }

  return (
    <div className="chat-panel">
      <div className="app-header">
        <h1>Kohler AI bathroom designer</h1>
        <p>Describe your bathroom and I'll recommend fixtures that fit your space and budget.</p>
      </div>

      <div className="chat-window" ref={scrollRef}>
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} content={m.content} bundle={m.bundle} />
        ))}
        {loading && <div className="typing">Thinking…</div>}
        {done && (
          <button className="restart" onClick={restart}>
            Start a new bathroom
          </button>
        )}
      </div>

      <div className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type your answer…"
          disabled={loading}
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
