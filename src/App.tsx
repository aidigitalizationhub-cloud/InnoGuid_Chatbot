/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import Markdown from "react-markdown";
import { Bot, Loader2, Send, User } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const CHAT_ENDPOINT = `${API_BASE_URL}/api/chat`;

const starterPrompts = [
  "What's the latest news from RID?",
  "Tell me about the Noguchi Medical Research Institute.",
  "How does the IAST Virtual Innovation Hub support students?",
  "List some research centers at UG.",
];

function appendTextToMessage(messageId: string, text: string, setMessages: React.Dispatch<React.SetStateAction<Message[]>>) {
  setMessages((prev) =>
    prev.map((msg) => (msg.id === messageId ? { ...msg, content: `${msg.content}${text}` } : msg)),
  );
}

function linkifyPlainUrls(text: string) {
  const urlPattern = /(?<!\]\()https?:\/\/[^\s<>()]+/g;
  return text.replace(urlPattern, (url) => `[${url}](${url})`);
}

interface SourceItem {
  label: string;
  href: string;
}

function extractSourceItems(lines: string[]) {
  const items: SourceItem[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const linkMatch = line.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    if (linkMatch) {
      items.push({ label: linkMatch[1].trim(), href: linkMatch[2].trim() });
      continue;
    }

    const urlMatch = line.match(/https?:\/\/[^\s<>()]+/);
    if (urlMatch) {
      const href = urlMatch[0].trim();
      items.push({ label: line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "").trim() || href, href });
    }
  }

  return items;
}

function splitAssistantContent(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");
  let sourceStart = -1;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^(#{1,3}\s*)?(sources|references)\s*:?\s*$/i.test(lines[i].trim())) {
      sourceStart = i;
      break;
    }
  }

  if (sourceStart === -1) {
    return { body: normalized, sources: [] as SourceItem[] };
  }

  const body = lines.slice(0, sourceStart).join("\n").trim();
  const sources = extractSourceItems(lines.slice(sourceStart + 1));
  return { body, sources };
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isEmbedded, setIsEmbedded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    try {
      setIsEmbedded(window.self !== window.top);
    } catch {
      setIsEmbedded(true);
    }
  }, []);

  const handleSend = async (e?: React.FormEvent, text?: string) => {
    e?.preventDefault();
    const outbound = (text ?? input).trim();

    if (!outbound || isLoading) {
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: outbound,
      timestamp: new Date(),
    };

    const assistantMessageId = `${Date.now()}-assistant`;
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: outbound,
          history: messages.map((msg) => ({ role: msg.role, content: msg.content })),
        }),
      });

      if (!response.ok) {
        let errorMessage = "Failed to get response";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          const errorText = await response.text();
          if (errorText) {
            errorMessage = `${response.status} ${response.statusText}: ${errorText.slice(0, 250)}`;
          }
        }
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const data = await response.json();
        const textFromJson = data?.text || data?.t || "";
        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, content: textFromJson } : msg)),
        );
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body found.");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const dataLine = event
            .split("\n")
            .find((line) => line.startsWith("data: "));

          if (!dataLine) {
            continue;
          }

          const data = dataLine.slice(6).trim();
          if (data === "[DONE]") {
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.t) {
              appendTextToMessage(assistantMessageId, parsed.t, setMessages);
            } else if (parsed.text) {
              appendTextToMessage(assistantMessageId, parsed.text, setMessages);
            } else if (parsed.error) {
              throw new Error(parsed.error);
            }
          } catch (parseError) {
            console.error("Error parsing stream chunk:", parseError);
          }
        }
      }
    } catch (error: any) {
      const message = error?.message || "Unexpected error";
      console.error("Chat request failed:", error);
      const visibleMessage = import.meta.env.DEV
        ? message.slice(0, 250)
        : "Unable to get a response right now";
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: `I'm sorry, ${visibleMessage}. Please try again later.` }
            : msg,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] bg-[#f8fafc] text-slate-900 font-sans overflow-hidden">
      <main className="flex-1 flex flex-col relative min-w-0 min-h-[100dvh]">
        {!isEmbedded && (
          <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center px-4 sm:px-6 sticky top-0 z-10">
            <div className="flex flex-col min-w-0">
              <h2 className="font-semibold text-slate-800">University of Ghana Assistant</h2>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Live Context Active</span>
              </div>
            </div>
          </header>
        )}

        <div className={`flex-1 overflow-y-auto px-4 sm:px-6 space-y-6 sm:space-y-8 ${isEmbedded ? "py-3 sm:py-4" : "py-4 sm:py-6"}`}>
          {messages.length === 0 && (
            <div className={`min-h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-5 sm:space-y-6 ${isEmbedded ? "py-4 sm:py-8" : "py-8 sm:py-12"}`}>
              <div className="w-14 h-14 sm:w-16 sm:h-16 bg-indigo-100 rounded-2xl flex items-center justify-center">
                <Bot className="w-8 h-8 text-indigo-600" />
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-slate-900 mb-2">Welcome to UG InnoGuide</h3>
                <p className="text-sm sm:text-base text-slate-500 leading-relaxed">
                  I'm your assistant for the University of Ghana and the IAST Virtual Innovation Hub. Ask about UG units,
                  innovation opportunities, and research information.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 w-full">
                {starterPrompts.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => void handleSend(undefined, suggestion)}
                    className="p-3 text-sm text-left bg-white border border-slate-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50/50 transition-all text-slate-700 font-medium"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={message.id}
              className={`flex gap-3 sm:gap-4 ${message.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center ${
                  message.role === "user" ? "bg-slate-800" : "bg-indigo-600"
                }`}
              >
                {message.role === "user" ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
              </div>
              <div className="max-w-[90%] sm:max-w-[80%] space-y-1">
                <div
                  className={`p-3 sm:p-4 rounded-2xl ${
                    message.role === "user"
                      ? "bg-indigo-600 text-white rounded-tr-none"
                      : "bg-white border border-slate-200 shadow-sm rounded-tl-none"
                  }`}
                >
                  {message.role === "assistant" ? (() => {
                    const { body, sources } = splitAssistantContent(message.content);
                    return (
                      <div className="space-y-3">
                        {body && (
                          <div className="prose prose-sm max-w-none text-slate-700">
                            <Markdown
                              components={{
                                a: ({ href, children }) => (
                                  <a href={href || "#"} target="_blank" rel="noreferrer noopener">
                                    {children}
                                  </a>
                                ),
                              }}
                            >
                              {linkifyPlainUrls(body)}
                            </Markdown>
                          </div>
                        )}

                        {sources.length > 0 && (
                          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-3 sm:p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div>
                                <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                                  Sources
                                </h4>
                                <p className="text-[11px] text-slate-400 mt-1">
                                  Click a source to open it in a new tab.
                                </p>
                              </div>
                            </div>
                            <div className="space-y-2">
                              {sources.map((source, idx) => (
                                <a
                                  key={`${source.href}-${idx}`}
                                  href={source.href}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 transition-all hover:border-indigo-300 hover:bg-indigo-50/60"
                                >
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 font-semibold text-xs">
                                    {idx + 1}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block font-medium text-slate-800 truncate">
                                      {source.label}
                                    </span>
                                    <span className="block text-[11px] text-slate-400 truncate group-hover:text-indigo-500">
                                      {source.href}
                                    </span>
                                  </span>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })() : (
                    <div className="prose prose-sm max-w-none prose-invert">
                      <Markdown>{message.content}</Markdown>
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 px-1">
                  {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </motion.div>
          ))}

          {isLoading && (
            <div className="flex gap-3 sm:gap-4">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="bg-white border border-slate-200 shadow-sm p-4 rounded-2xl rounded-tl-none flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                <span className="text-sm text-slate-500 font-medium">Generating answer...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 sm:p-6 bg-white border-t border-slate-200">
          <form onSubmit={(e) => void handleSend(e)} className="max-w-4xl mx-auto relative group">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about UG research, news, or the Innovation Hub..."
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 sm:py-4 pl-4 sm:pl-6 pr-12 sm:pr-14 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-800 text-sm sm:text-base"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors shadow-lg shadow-indigo-200"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          {!isEmbedded && (
            <p className="text-center text-[10px] text-slate-400 mt-4 uppercase tracking-widest font-semibold">
              University of Ghana - Institute of Applied Science and Technology
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
