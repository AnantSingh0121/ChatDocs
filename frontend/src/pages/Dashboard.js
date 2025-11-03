import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API } from "../App";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import ChatMarkdown from "@/components/ui/ChatMarkdown";

import {
  FileText,
  Upload,
  Trash2,
  Send,
  LogOut,
  MessageSquare,
  FileUp,
} from "lucide-react";

const Dashboard = ({ onLogout }) => {
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editContent, setEditContent] = useState("");

  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchDocuments();
  }, []);
useEffect(() => {
    if (selectedDoc) {
      const saved = localStorage.getItem(`chat_history_${selectedDoc.id}`);
      if (saved) {
        setMessages(JSON.parse(saved));
      } else {
        setMessages([]);
      }
    }
  }, [selectedDoc]);

  // Save history when messages change
  useEffect(() => {
    if (selectedDoc) {
      localStorage.setItem(
        `chat_history_${selectedDoc.id}`,
        JSON.stringify(messages)
      );
    }
  }, [messages, selectedDoc]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchDocuments = async () => {
    try {
      const response = await axios.get(`${API}/documents`);
      setDocuments(response.data);
    } catch (error) {
      toast.error("Failed to fetch documents");
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      await axios.post(`${API}/documents/upload`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      toast.success("Document uploaded and processed successfully!");
      fetchDocuments();
    } catch (error) {
      toast.error(
        error.response?.data?.detail || "Failed to upload document"
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDeleteDocument = async (docId) => {
    try {
      await axios.delete(`${API}/documents/${docId}`);
      toast.success("Document deleted successfully");
      if (selectedDoc?.id === docId) {
        setSelectedDoc(null);
        setMessages([]);
      }
      fetchDocuments();
    } catch (error) {
      toast.error("Failed to delete document");
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !selectedDoc || loading) return;

    const userMessage = { role: "user", content: inputMessage };
    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setLoading(true);

    try {
      const response = await fetch(`${API}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          document_id: selectedDoc.id,
          message: inputMessage,
          conversation_history: messages.slice(-10),
        }),
      });

      if (!response.ok) {
        throw new Error("Chat request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = "";

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", streaming: true },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                assistantMessage += data.content;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {
                    role: "assistant",
                    content: assistantMessage,
                    streaming: true,
                  };
                  return newMessages;
                });
              }
              if (data.done) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {
                    role: "assistant",
                    content: assistantMessage,
                    streaming: false,
                  };
                  return newMessages;
                });
              }
              if (data.error) {
                toast.error("Error: " + data.error);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      toast.error("Failed to send message");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 to-blue-50" data-testid="dashboard">
      {/* Sidebar */}
      <div className="w-80 bg-white/80 backdrop-blur-sm border-r border-slate-200 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">ChatDocs</h1>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onLogout}
              data-testid="logout-button"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </div>

          <Button
            className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            data-testid="upload-button"
          >
            {uploading ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Uploading...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Upload PDF
              </span>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileUpload}
            className="hidden"
            data-testid="file-input"
          />
        </div>

{/* Documents List */}
<ScrollArea className="flex-1 overflow-y-auto px-3">
  <div className="flex flex-col gap-3 w-full max-w-full overflow-hidden">
    {documents.length === 0 ? (
      <div className="text-center py-12" data-testid="no-documents">
        <FileUp className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">
          No documents yet.
          <br />
          Upload a PDF to get started!
        </p>
      </div>
    ) : (
      documents.map((doc) => (
        <Card
          key={doc.id}
          className={`cursor-pointer transition-all hover:shadow-md ${
            selectedDoc?.id === doc.id
              ? "border-blue-500 bg-blue-50"
              : "border-slate-200 hover:border-blue-300"
          }`}
          onClick={() => {
            setSelectedDoc(doc);
            setMessages([]);
          }}
          data-testid={`document-${doc.id}`}
        >
          <CardContent className="p-4 overflow-hidden">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {doc.filename}
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  {doc.chunk_count} chunks
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-red-50 hover:text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteDocument(doc.id);
                }}
                data-testid={`delete-doc-${doc.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))
    )}
  </div>
</ScrollArea>
</div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedDoc ? (
          <>
            {/* Chat Header */}
            <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900" data-testid="selected-document-title">
                    {selectedDoc.filename}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Ask questions about this document
                  </p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-6">
              <div className="max-w-3xl mx-auto space-y-4" data-testid="chat-messages">
                {messages.length === 0 ? (
                  <div className="text-center py-12 animate-fade-in">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <MessageSquare className="w-8 h-8 text-blue-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">
                      Start a conversation
                    </h3>
                    <p className="text-sm text-slate-500">
                      Ask me anything about &quot;{selectedDoc.filename}&quot;
                    </p>
                  </div>
                ) : (
                  messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex gap-3 message-bubble ${
                        msg.role === "user" ? "justify-end" : "justify-start"
                      }`}
                      data-testid={`message-${msg.role}-${idx}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-lg flex items-center justify-center flex-shrink-0">
                          <MessageSquare className="w-4 h-4 text-white" />
                        </div>
                      )}
                      <div
                        className={`max-w-[90%] rounded-2xl px-4 py-3 ${
                          msg.role === "user"
                            ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white"
                            : "bg-white border border-slate-200 text-slate-900"
                        }`}
                      >
<div className="text-sm">
  <ChatMarkdown content={msg.content} />
  {msg.streaming && (
    <span className="inline-flex gap-1 ml-2 align-middle">
      <span className="typing-dot w-1.5 h-1.5 bg-slate-400 rounded-full"></span>
      <span className="typing-dot w-1.5 h-1.5 bg-slate-400 rounded-full"></span>
      <span className="typing-dot w-1.5 h-1.5 bg-slate-400 rounded-full"></span>
    </span>
  )}
</div>

                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input Area */}
            <div className="bg-white/80 backdrop-blur-sm border-t border-slate-200 p-4">
              <div className="max-w-3xl mx-auto">
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Ask a question about the document..."
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="resize-none min-h-[60px] max-h-[120px]"
                    disabled={loading}
                    data-testid="message-input"
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim() || loading}
                    className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 px-6"
                    data-testid="send-message-button"
                  >
                    <Send className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center" data-testid="no-document-selected">
            <div className="text-center animate-fade-in">
              <div className="w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <FileText className="w-10 h-10 text-slate-400" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900 mb-2">
                No document selected
              </h3>
              <p className="text-slate-500">
                Upload a PDF or select one from the sidebar to start chatting
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
